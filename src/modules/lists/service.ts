import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { db, type DbOrTx } from "@/server/db";
import { folders, listStatuses, projects, taskLists, tasks } from "@/server/db/schema";
import { canProject, type ActorContext } from "@/server/authz/policy";
import type { ProjectAction, ProjectRole } from "@/server/authz/matrix";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  assertId,
  pgErrorInfo,
} from "@/server/errors";
import { enqueueOutbox, recordActivity } from "@/modules/activity/service";
import { loadProjectAccess } from "@/modules/projects/service";
import { isItemColor, isItemIcon, type ItemAppearance, type ItemKind } from "@/lib/appearance";
import { readViewSettings } from "./view-settings";
import { STATUS_TEMPLATES } from "./templates";
import {
  createFolderInput,
  createListInput,
  renameFolderInput,
  statusInput,
  updateListInput,
  type CreateListInput,
  type StatusInput,
  type UpdateListInput,
} from "./validators";

function assertProject(role: ProjectRole, action: ProjectAction): void {
  if (!canProject(role, action)) throw new ForbiddenError();
}

/** Position after the current last sibling. */
function nextPosition(lastPosition: string | null | undefined): string {
  return generateKeyBetween(lastPosition ?? null, null);
}

/** A list in the actor's workspace, with the actor's effective project role. Invisible → NotFound. */
export async function loadListAccess(tx: DbOrTx, actor: ActorContext, listId: string) {
  assertId(listId, "List not found");
  const [list] = await tx
    .select()
    .from(taskLists)
    .where(and(eq(taskLists.id, listId), eq(taskLists.workspaceId, actor.workspaceId)));
  if (!list) throw new NotFoundError("List not found");
  const { project, role } = await loadProjectAccess(tx, actor, { id: list.projectId });
  return { list, project, role };
}

// ── Project tree ──────────────────────────────────────────────────────────────────────────

export async function getProjectTree(actor: ActorContext, projectId: string) {
  const { role } = await loadProjectAccess(db(), actor, { id: projectId });
  const [folderRows, listRows] = await Promise.all([
    db()
      .select({
        id: folders.id,
        name: folders.name,
        icon: folders.icon,
        color: folders.color,
        position: folders.position,
      })
      .from(folders)
      .where(and(eq(folders.projectId, projectId), isNull(folders.archivedAt)))
      .orderBy(asc(folders.position)),
    db()
      .select({
        id: taskLists.id,
        name: taskLists.name,
        icon: taskLists.icon,
        color: taskLists.color,
        folderId: taskLists.folderId,
        position: taskLists.position,
        openTasks: sql<number>`(select count(*)::int from ${tasks} t
          join ${listStatuses} s on s.id = t.status_id
          where t.list_id = "task_lists"."id" and t.archived_at is null and t.parent_task_id is null
            and s.category not in ('done', 'cancelled'))`,
      })
      .from(taskLists)
      .where(and(eq(taskLists.projectId, projectId), isNull(taskLists.archivedAt)))
      .orderBy(asc(taskLists.position)),
  ]);
  return {
    folders: folderRows.map((f) => ({ ...f, lists: listRows.filter((l) => l.folderId === f.id) })),
    rootLists: listRows.filter((l) => l.folderId === null),
    can: { manage: canProject(role, "list.manage") },
  };
}

/**
 * Folders and lists for the sidebar, for projects the caller has *already* been shown
 * (the ids come from listVisibleProjects, which applies visibility). Two queries in total.
 */
export async function getSidebarTree(actor: ActorContext, projectIds: string[]) {
  type Item = { id: string; name: string } & ItemAppearance;
  const tree = new Map<string, { folders: (Item & { lists: Item[] })[]; rootLists: Item[] }>();
  if (projectIds.length === 0) return tree;
  const scope = (table: typeof folders | typeof taskLists) =>
    and(
      eq(table.workspaceId, actor.workspaceId),
      inArray(table.projectId, projectIds),
      isNull(table.archivedAt),
    );
  const [folderRows, listRows] = await Promise.all([
    db()
      .select({
        id: folders.id,
        projectId: folders.projectId,
        name: folders.name,
        icon: folders.icon,
        color: folders.color,
      })
      .from(folders)
      .where(scope(folders))
      .orderBy(asc(folders.position)),
    db()
      .select({
        id: taskLists.id,
        projectId: taskLists.projectId,
        folderId: taskLists.folderId,
        name: taskLists.name,
        icon: taskLists.icon,
        color: taskLists.color,
      })
      .from(taskLists)
      .where(scope(taskLists))
      .orderBy(asc(taskLists.position)),
  ]);
  const item = ({ id, name, icon, color }: Item) => ({ id, name, icon, color });
  for (const id of projectIds) {
    const lists = listRows.filter((l) => l.projectId === id);
    tree.set(id, {
      folders: folderRows
        .filter((f) => f.projectId === id)
        .map(({ projectId: _p, ...f }) => ({
          ...f,
          lists: lists.filter((l) => l.folderId === f.id).map(item),
        })),
      rootLists: lists.filter((l) => l.folderId === null).map(item),
    });
  }
  return tree;
}

// ── Folders ───────────────────────────────────────────────────────────────────────────────

export async function createFolder(actor: ActorContext, projectId: string, raw: { name: string }) {
  const input = createFolderInput.parse(raw);
  return db().transaction(async (tx) => {
    const { role } = await loadProjectAccess(tx, actor, { id: projectId });
    assertProject(role, "list.manage");
    const [last] = await tx
      .select({ position: folders.position })
      .from(folders)
      .where(eq(folders.projectId, projectId))
      .orderBy(desc(folders.position))
      .limit(1);
    const [folder] = await tx
      .insert(folders)
      .values({
        workspaceId: actor.workspaceId,
        projectId,
        name: input.name,
        position: nextPosition(last?.position),
        createdBy: actor.userId,
      })
      .returning({ id: folders.id, name: folders.name });
    await recordActivity(tx, actor, {
      entityType: "folder",
      entityId: folder!.id,
      action: "created",
      metadata: { name: input.name },
    });
    return folder!;
  });
}

async function loadFolder(tx: DbOrTx, actor: ActorContext, folderId: string) {
  assertId(folderId, "Folder not found");
  const [folder] = await tx
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.workspaceId, actor.workspaceId)));
  if (!folder) throw new NotFoundError("Folder not found");
  const { role } = await loadProjectAccess(tx, actor, { id: folder.projectId });
  return { folder, role };
}

export async function renameFolder(actor: ActorContext, folderId: string, raw: { name: string }) {
  const input = renameFolderInput.parse(raw);
  await db().transaction(async (tx) => {
    const { folder, role } = await loadFolder(tx, actor, folderId);
    assertProject(role, "list.manage");
    await tx.update(folders).set({ name: input.name }).where(eq(folders.id, folderId));
    await recordActivity(tx, actor, {
      entityType: "folder",
      entityId: folderId,
      action: "renamed",
      changes: { name: [folder.name, input.name] },
    });
  });
}

/** Deletes a folder. Its lists move to the project root (nothing inside is lost). */
export async function deleteFolder(actor: ActorContext, folderId: string) {
  await db().transaction(async (tx) => {
    const { folder, role } = await loadFolder(tx, actor, folderId);
    assertProject(role, "list.manage");
    await tx.delete(folders).where(eq(folders.id, folderId));
    await recordActivity(tx, actor, {
      entityType: "folder",
      entityId: folderId,
      action: "deleted",
      metadata: { name: folder.name },
    });
  });
}

// ── Lists ─────────────────────────────────────────────────────────────────────────────────

export async function createList(actor: ActorContext, projectId: string, raw: CreateListInput) {
  const input = createListInput.parse(raw);
  return db().transaction(async (tx) => {
    const { role } = await loadProjectAccess(tx, actor, { id: projectId });
    assertProject(role, "list.manage");
    if (input.folderId) {
      const [folder] = await tx
        .select({ id: folders.id })
        .from(folders)
        .where(and(eq(folders.id, input.folderId), eq(folders.projectId, projectId)));
      if (!folder) throw new NotFoundError("Folder not found");
    }
    const [last] = await tx
      .select({ position: taskLists.position })
      .from(taskLists)
      .where(eq(taskLists.projectId, projectId))
      .orderBy(desc(taskLists.position))
      .limit(1);
    const [list] = await tx
      .insert(taskLists)
      .values({
        workspaceId: actor.workspaceId,
        projectId,
        folderId: input.folderId,
        name: input.name,
        position: nextPosition(last?.position),
        createdBy: actor.userId,
      })
      .returning({ id: taskLists.id, name: taskLists.name });
    const template = STATUS_TEMPLATES[input.template].statuses;
    const positions = generateNKeysBetween(null, null, template.length);
    await tx.insert(listStatuses).values(
      template.map((s, i) => ({
        workspaceId: actor.workspaceId,
        listId: list!.id,
        name: s.name,
        category: s.category,
        color: s.color,
        position: positions[i]!,
      })),
    );
    await recordActivity(tx, actor, {
      entityType: "list",
      entityId: list!.id,
      action: "created",
      metadata: { name: input.name, template: input.template, projectId },
    });
    await enqueueOutbox(tx, actor.workspaceId, "list.created", { listId: list!.id, projectId });
    return list!;
  });
}

export async function getList(actor: ActorContext, listId: string) {
  const { list, project, role } = await loadListAccess(db(), actor, listId);
  const statuses = await listStatusesFor(db(), listId);
  const [folder] = list.folderId
    ? await db()
        .select({ id: folders.id, name: folders.name })
        .from(folders)
        .where(eq(folders.id, list.folderId))
    : [];
  return {
    list,
    project,
    folder: folder ?? null,
    statuses,
    role,
    view: readViewSettings(list.viewSettings),
    can: {
      manage: canProject(role, "list.manage"),
      createTask: canProject(role, "task.create"),
      updateTask: canProject(role, "task.update"),
      saveView: canSaveView(role, list.viewProtected),
      protectView: canProject(role, "view.protect"),
    },
  };
}

export async function listStatusesFor(tx: DbOrTx, listId: string) {
  return tx
    .select({
      id: listStatuses.id,
      name: listStatuses.name,
      category: listStatuses.category,
      color: listStatuses.color,
      position: listStatuses.position,
    })
    .from(listStatuses)
    .where(eq(listStatuses.listId, listId))
    .orderBy(asc(listStatuses.position));
}

export async function updateList(actor: ActorContext, listId: string, raw: UpdateListInput) {
  const input = updateListInput.parse(raw);
  await db().transaction(async (tx) => {
    const { list, role } = await loadListAccess(tx, actor, listId);
    assertProject(role, "list.manage");
    if (input.folderId) {
      const [folder] = await tx
        .select({ id: folders.id })
        .from(folders)
        .where(and(eq(folders.id, input.folderId), eq(folders.projectId, list.projectId)));
      if (!folder) throw new NotFoundError("Folder not found");
    }
    const changes: Record<string, [unknown, unknown]> = {};
    for (const field of ["name", "description", "folderId"] as const) {
      if (input[field] !== undefined && input[field] !== list[field])
        changes[field] = [list[field], input[field]];
    }
    if (Object.keys(changes).length === 0) return;
    await tx.update(taskLists).set(input).where(eq(taskLists.id, listId));
    await recordActivity(tx, actor, { entityType: "list", entityId: listId, action: "updated", changes });
  });
}

export async function setListArchived(actor: ActorContext, listId: string, archived: boolean) {
  await db().transaction(async (tx) => {
    const { list, role } = await loadListAccess(tx, actor, listId);
    assertProject(role, "list.manage");
    if (Boolean(list.archivedAt) === archived) return;
    await tx
      .update(taskLists)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(taskLists.id, listId));
    await recordActivity(tx, actor, {
      entityType: "list",
      entityId: listId,
      action: archived ? "archived" : "restored",
    });
  });
}

// ── Statuses (per list) ───────────────────────────────────────────────────────────────────

function mapStatusConflict(error: unknown): never {
  if (pgErrorInfo(error).constraint === "list_statuses_list_name_uq") {
    throw new ValidationError("This list already has a status with that name", {
      name: "Name already used in this list",
    });
  }
  throw error;
}

export async function addStatus(actor: ActorContext, listId: string, raw: StatusInput) {
  const input = statusInput.parse(raw);
  try {
    return await db().transaction(async (tx) => {
      const { role } = await loadListAccess(tx, actor, listId);
      assertProject(role, "list.manage");
      const statuses = await listStatusesFor(tx, listId);
      const [status] = await tx
        .insert(listStatuses)
        .values({
          workspaceId: actor.workspaceId,
          listId,
          ...input,
          position: nextPosition(statuses.at(-1)?.position),
        })
        .returning({ id: listStatuses.id });
      await recordActivity(tx, actor, {
        entityType: "list",
        entityId: listId,
        action: "status_added",
        metadata: input,
      });
      return status!;
    });
  } catch (error) {
    mapStatusConflict(error);
  }
}

async function loadStatus(tx: DbOrTx, actor: ActorContext, statusId: string) {
  assertId(statusId, "Status not found");
  const [status] = await tx
    .select()
    .from(listStatuses)
    .where(and(eq(listStatuses.id, statusId), eq(listStatuses.workspaceId, actor.workspaceId)));
  if (!status) throw new NotFoundError("Status not found");
  const access = await loadListAccess(tx, actor, status.listId);
  return { status, ...access };
}

export async function updateStatus(actor: ActorContext, statusId: string, raw: StatusInput) {
  const input = statusInput.parse(raw);
  try {
    await db().transaction(async (tx) => {
      const { status, role } = await loadStatus(tx, actor, statusId);
      assertProject(role, "list.manage");
      const changes: Record<string, [unknown, unknown]> = {};
      for (const field of ["name", "category", "color"] as const) {
        if (input[field] !== status[field]) changes[field] = [status[field], input[field]];
      }
      if (Object.keys(changes).length === 0) return;
      await tx.update(listStatuses).set(input).where(eq(listStatuses.id, statusId));
      if (changes.category) {
        // Keep "finished" in step with the status's new meaning.
        const closed = input.category === "done" || input.category === "cancelled";
        await tx
          .update(tasks)
          .set({ completedAt: closed ? sql`coalesce(${tasks.completedAt}, now())` : null })
          .where(eq(tasks.statusId, statusId));
      }
      await recordActivity(tx, actor, {
        entityType: "list",
        entityId: status.listId,
        action: "status_updated",
        changes,
      });
    });
  } catch (error) {
    mapStatusConflict(error);
  }
}

/** Moves a status one place up or down in its list. */
export async function moveStatus(actor: ActorContext, statusId: string, direction: "up" | "down") {
  await db().transaction(async (tx) => {
    const { status, role } = await loadStatus(tx, actor, statusId);
    assertProject(role, "list.manage");
    const statuses = await listStatusesFor(tx, status.listId);
    const index = statuses.findIndex((s) => s.id === statusId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= statuses.length) return;
    // New position between the neighbours on the far side of the target.
    const [lo, hi] =
      direction === "up"
        ? [statuses[target - 1]?.position ?? null, statuses[target]!.position]
        : [statuses[target]!.position, statuses[target + 1]?.position ?? null];
    await tx
      .update(listStatuses)
      .set({ position: generateKeyBetween(lo, hi) })
      .where(eq(listStatuses.id, statusId));
  });
}

/** Deletes a status, moving its tasks to another status of the same list first. */
export async function deleteStatus(actor: ActorContext, statusId: string, replacementStatusId: string) {
  assertId(replacementStatusId, "Replacement status not found");
  await db().transaction(async (tx) => {
    const { status, role } = await loadStatus(tx, actor, statusId);
    assertProject(role, "list.manage");
    if (replacementStatusId === statusId)
      throw new ValidationError("Choose a different status for its tasks");
    const statuses = await listStatusesFor(tx, status.listId);
    if (statuses.length <= 1) throw new ConflictError("A list needs at least one status");
    const replacement = statuses.find((s) => s.id === replacementStatusId);
    if (!replacement) throw new NotFoundError("Replacement status not found");
    const closed = replacement.category === "done" || replacement.category === "cancelled";
    const moved = await tx
      .update(tasks)
      .set({
        statusId: replacementStatusId,
        completedAt: closed ? sql`coalesce(${tasks.completedAt}, now())` : null,
        version: sql`${tasks.version} + 1`,
      })
      .where(eq(tasks.statusId, statusId))
      .returning({ id: tasks.id });
    await tx.delete(listStatuses).where(eq(listStatuses.id, statusId));
    await recordActivity(tx, actor, {
      entityType: "list",
      entityId: status.listId,
      action: "status_deleted",
      metadata: { name: status.name, movedTo: replacement.name, tasksMoved: moved.length },
    });
  });
}

// ── Saved view ────────────────────────────────────────────────────────────────────────────

function canSaveView(role: ProjectRole, isProtected: boolean) {
  return canProject(role, "view.save") && (!isProtected || canProject(role, "view.protect"));
}

/** Makes `raw` the list's saved view: what everyone sees by default. */
export async function saveListView(actor: ActorContext, listId: string, raw: unknown) {
  const view = readViewSettings(raw);
  await db().transaction(async (tx) => {
    const { list, role } = await loadListAccess(tx, actor, listId);
    if (!canSaveView(role, list.viewProtected)) throw new ForbiddenError();
    await tx.update(taskLists).set({ viewSettings: view }).where(eq(taskLists.id, listId));
    await recordActivity(tx, actor, {
      entityType: "list",
      entityId: listId,
      action: "view_saved",
      metadata: view,
    });
  });
}

/** Protected views can only be saved by managers. */
export async function setListViewProtected(actor: ActorContext, listId: string, isProtected: boolean) {
  await db().transaction(async (tx) => {
    const { list, role } = await loadListAccess(tx, actor, listId);
    if (!canProject(role, "view.protect")) throw new ForbiddenError();
    if (list.viewProtected === isProtected) return;
    await tx.update(taskLists).set({ viewProtected: isProtected }).where(eq(taskLists.id, listId));
    await recordActivity(tx, actor, {
      entityType: "list",
      entityId: listId,
      action: isProtected ? "view_protected" : "view_unprotected",
    });
  });
}

// ── Icons and colours ─────────────────────────────────────────────────────────────────────

/**
 * Sets the sidebar icon and colour of a project (project managers) or a folder or list
 * (list managers). Null resets to the default; names outside the catalogue are refused.
 */
export async function setItemAppearance(
  actor: ActorContext,
  kind: ItemKind,
  id: string,
  raw: ItemAppearance,
) {
  if (raw.icon !== null && !isItemIcon(raw.icon)) throw new ValidationError("Pick an icon from the list");
  if (raw.color !== null && !isItemColor(raw.color)) throw new ValidationError("Pick a colour from the list");
  const next = { icon: raw.icon, color: raw.color };
  await db().transaction(async (tx) => {
    let before: ItemAppearance;
    if (kind === "project") {
      assertId(id, "Project not found");
      const { project, role } = await loadProjectAccess(tx, actor, { id });
      assertProject(role, "project.update");
      before = { icon: project.icon, color: project.color };
      await tx
        .update(projects)
        .set(next)
        .where(and(eq(projects.id, id), eq(projects.workspaceId, actor.workspaceId)));
    } else if (kind === "folder") {
      const { folder, role } = await loadFolder(tx, actor, id);
      assertProject(role, "list.manage");
      before = { icon: folder.icon, color: folder.color };
      await tx.update(folders).set(next).where(eq(folders.id, id));
    } else if (kind === "list") {
      const { list, role } = await loadListAccess(tx, actor, id);
      assertProject(role, "list.manage");
      before = { icon: list.icon, color: list.color };
      await tx.update(taskLists).set(next).where(eq(taskLists.id, id));
    } else {
      throw new ValidationError("Unknown item");
    }
    const changes: Record<string, [unknown, unknown]> = {};
    if (before.icon !== next.icon) changes.icon = [before.icon, next.icon];
    if (before.color !== next.color) changes.color = [before.color, next.color];
    if (Object.keys(changes).length) {
      await recordActivity(tx, actor, { entityType: kind, entityId: id, action: "updated", changes });
    }
  });
}
