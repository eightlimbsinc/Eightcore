import "server-only";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { db, type DbOrTx } from "@/server/db";
import { docs, projectMembers, projects, taskLists, users } from "@/server/db/schema";
import { canProject, canSeeList, type ActorContext } from "@/server/authz/policy";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, assertId } from "@/server/errors";
import { recordActivity } from "@/modules/activity/service";
import { loadProjectAccess } from "@/modules/projects/service";
import { visibleProjectCondition } from "@/modules/projects/visibility";
import { DocContentError, sanitizeDocContent } from "./content";

const title = z.string().trim().max(200, "Keep the title under 200 characters");

/**
 * A guest limited to some lists sees only docs tied to those lists (not project-wide docs).
 * Everyone else who can see the project sees all its docs.
 */
function canSeeDoc(scope: string[] | null, listId: string | null) {
  return scope === null || (listId !== null && canSeeList(scope, listId));
}

/** A live doc the actor can see, with its project and the actor's role. Invisible → NotFound. */
export async function loadDocAccess(tx: DbOrTx, actor: ActorContext, docId: string) {
  assertId(docId, "Doc not found");
  const [doc] = await tx
    .select()
    .from(docs)
    .where(and(eq(docs.id, docId), eq(docs.workspaceId, actor.workspaceId), isNull(docs.archivedAt)));
  if (!doc) throw new NotFoundError("Doc not found");
  const { project, role, listScope } = await loadProjectAccess(tx, actor, { id: doc.projectId });
  if (!canSeeDoc(listScope, doc.listId)) throw new NotFoundError("Doc not found");
  return { doc, project, role, listScope };
}

/** The project's docs the actor can see, as a flat list (parentId gives the tree), in order. */
export async function listDocs(actor: ActorContext, projectId: string) {
  assertId(projectId, "Project not found");
  const { role, listScope } = await loadProjectAccess(db(), actor, { id: projectId });
  const rows = await db()
    .select({
      id: docs.id,
      title: docs.title,
      parentId: docs.parentId,
      listId: docs.listId,
      listName: taskLists.name,
      updatedAt: docs.updatedAt,
      updatedByName: users.name,
    })
    .from(docs)
    .leftJoin(taskLists, eq(taskLists.id, docs.listId))
    .leftJoin(users, eq(users.id, sql`coalesce(${docs.updatedBy}, ${docs.createdBy})`))
    .where(
      and(eq(docs.projectId, projectId), eq(docs.workspaceId, actor.workspaceId), isNull(docs.archivedAt)),
    )
    .orderBy(asc(docs.position));
  const visible = rows.filter((r) => canSeeDoc(listScope, r.listId));
  // A sub-page whose parent is hidden from this actor shows at the top level.
  const ids = new Set(visible.map((r) => r.id));
  return {
    docs: visible.map((r) => ({ ...r, parentId: r.parentId && ids.has(r.parentId) ? r.parentId : null })),
    canCreate: canProject(role, "doc.edit"),
  };
}

export async function createDoc(
  actor: ActorContext,
  projectId: string,
  raw: { title?: string; parentId?: string | null; listId?: string | null },
) {
  assertId(projectId, "Project not found");
  const name = title.parse(raw.title ?? "");
  return db().transaction(async (tx) => {
    const { role, listScope } = await loadProjectAccess(tx, actor, { id: projectId });
    if (!canProject(role, "doc.edit")) throw new ForbiddenError();
    let listId = raw.listId ?? null;
    if (raw.parentId) {
      const { doc: parent } = await loadDocAccess(tx, actor, raw.parentId);
      if (parent.projectId !== projectId) throw new NotFoundError("Doc not found");
      // A sub-page belongs where its parent does, unless told otherwise.
      listId ??= parent.listId;
    }
    if (listId) {
      assertId(listId, "List not found");
      const [list] = await tx
        .select({ id: taskLists.id })
        .from(taskLists)
        .where(and(eq(taskLists.id, listId), eq(taskLists.projectId, projectId)));
      if (!list || !canSeeList(listScope, listId)) throw new NotFoundError("List not found");
    } else if (listScope) {
      // Guests limited to some lists can only make docs inside those lists.
      throw new ValidationError("Choose one of your lists for this doc");
    }
    const [last] = await tx
      .select({ position: docs.position })
      .from(docs)
      .where(
        and(
          eq(docs.projectId, projectId),
          raw.parentId ? eq(docs.parentId, raw.parentId) : isNull(docs.parentId),
        ),
      )
      .orderBy(desc(docs.position))
      .limit(1);
    const [doc] = await tx
      .insert(docs)
      .values({
        workspaceId: actor.workspaceId,
        projectId,
        listId,
        parentId: raw.parentId ?? null,
        title: name,
        position: generateKeyBetween(last?.position ?? null, null),
        createdBy: actor.userId,
      })
      .returning({ id: docs.id });
    await recordActivity(tx, actor, {
      entityType: "doc",
      entityId: doc!.id,
      action: "created",
      metadata: { projectId, title: name },
    });
    return { id: doc!.id };
  });
}

/** Saves the title and/or content. `version` must be the one the editor started from. */
export async function updateDoc(
  actor: ActorContext,
  docId: string,
  version: number,
  raw: { title?: string; content?: unknown },
) {
  const patch: Partial<typeof docs.$inferInsert> = {};
  if (raw.title !== undefined) patch.title = title.parse(raw.title);
  if (raw.content !== undefined) {
    try {
      const { content, text } = sanitizeDocContent(raw.content);
      patch.content = content;
      patch.plainText = text;
    } catch (error) {
      if (error instanceof DocContentError) throw new ValidationError(error.message);
      throw error;
    }
  }
  return db().transaction(async (tx) => {
    const { role } = await loadDocAccess(tx, actor, docId);
    if (!canProject(role, "doc.edit")) throw new ForbiddenError();
    const [row] = await tx
      .update(docs)
      .set({ ...patch, version: sql`${docs.version} + 1`, updatedBy: actor.userId, updatedAt: new Date() })
      .where(and(eq(docs.id, docId), eq(docs.version, version)))
      .returning({ version: docs.version, updatedAt: docs.updatedAt });
    if (!row) throw new ConflictError("Someone else changed this doc. Reload to see their version.");
    return row;
  });
}

/** Deletes a doc and its sub-pages. Managers delete any; editors their own. */
export async function deleteDoc(actor: ActorContext, docId: string) {
  await db().transaction(async (tx) => {
    const { doc, role } = await loadDocAccess(tx, actor, docId);
    const own = doc.createdBy === actor.userId && canProject(role, "doc.edit");
    if (!canProject(role, "doc.delete")) {
      if (!own) throw new ForbiddenError();
      // Deleting removes sub-pages too: editors may only take their own with it.
      const [others] = await tx
        .execute<{ n: number }>(
          sql`
        with recursive down as (
          select id, created_by from docs where parent_id = ${docId}::uuid
          union all
          select d.id, d.created_by from docs d join down on d.parent_id = down.id)
        select count(*)::int as n from down where created_by <> ${actor.userId}::uuid`,
        )
        .then((r) => r.rows);
      if (others && Number(others.n) > 0) {
        throw new ForbiddenError(
          "This doc has sub-pages by other people. Ask a project manager to delete it.",
        );
      }
    }
    await tx.delete(docs).where(eq(docs.id, docId));
    await recordActivity(tx, actor, {
      entityType: "doc",
      entityId: docId,
      action: "deleted",
      metadata: { projectId: doc.projectId, title: doc.title },
    });
  });
}

/** One doc for its page: content, where it sits (ancestors), its sub-pages, and what the actor may do. */
export async function getDoc(actor: ActorContext, docId: string) {
  const { doc, project, role, listScope } = await loadDocAccess(db(), actor, docId);
  const [ancestors, children, people, list] = await Promise.all([
    db().execute<{ id: string; title: string; list_id: string | null; depth: number }>(sql`
      with recursive up as (
        select id, title, parent_id, list_id, 0 as depth from docs where id = ${doc.parentId ?? null}::uuid
        union all
        select d.id, d.title, d.parent_id, d.list_id, up.depth + 1 from docs d join up on d.id = up.parent_id
         where up.depth < 20)
      select id, title, list_id, depth from up order by depth desc`),
    db()
      .select({ id: docs.id, title: docs.title, listId: docs.listId })
      .from(docs)
      .where(and(eq(docs.parentId, doc.id), isNull(docs.archivedAt)))
      .orderBy(asc(docs.position)),
    db()
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(sql`${users.id} in (${doc.createdBy}, ${doc.updatedBy ?? doc.createdBy})`),
    doc.listId
      ? db()
          .select({ id: taskLists.id, name: taskLists.name })
          .from(taskLists)
          .where(eq(taskLists.id, doc.listId))
      : Promise.resolve([]),
  ]);
  const nameOf = (id: string | null) => people.find((p) => p.id === id)?.name ?? "Someone";
  return {
    doc: {
      id: doc.id,
      title: doc.title,
      content: doc.content,
      version: doc.version,
      listId: doc.listId,
      list: list[0] ?? null,
      createdByName: nameOf(doc.createdBy),
      updatedByName: nameOf(doc.updatedBy ?? doc.createdBy),
      updatedAt: doc.updatedAt,
    },
    project: { id: project.id, key: project.key, name: project.name },
    // Hidden ancestors (a guest's view) are left out of the trail rather than revealed.
    ancestors: ancestors.rows
      .filter((a) => canSeeDoc(listScope, a.list_id))
      .map((a) => ({ id: a.id, title: a.title })),
    children: children.filter((c) => canSeeDoc(listScope, c.listId)).map(({ id, title }) => ({ id, title })),
    can: {
      edit: canProject(role, "doc.edit"),
      delete:
        canProject(role, "doc.delete") || (doc.createdBy === actor.userId && canProject(role, "doc.edit")),
    },
  };
}

/** Docs whose title or text has every word, in projects (and lists) the actor can see. */
export async function searchDocs(actor: ActorContext, query: string, limit = 5) {
  const words = query.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return [];
  const rows = await db()
    .select({
      id: docs.id,
      title: docs.title,
      projectKey: projects.key,
      projectName: projects.name,
    })
    .from(docs)
    .innerJoin(projects, eq(projects.id, docs.projectId))
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actor.userId)),
    )
    .where(
      and(
        eq(docs.workspaceId, actor.workspaceId),
        isNull(docs.archivedAt),
        isNull(projects.archivedAt),
        // Project-wide docs have no list, so guests limited to lists don't get them.
        visibleProjectCondition(actor, docs.listId),
        ...words.map((w) => {
          const like = `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
          return or(ilike(docs.title, like), ilike(docs.plainText, like))!;
        }),
      ),
    )
    .orderBy(desc(docs.updatedAt))
    .limit(limit);
  return rows;
}
