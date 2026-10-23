import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/server/db";
import { projectMembers, projects, tags, tasks, taskTags } from "@/server/db/schema";
import { visibleProjectCondition } from "@/modules/projects/visibility";
import { canProject, type ActorContext } from "@/server/authz/policy";
import { ForbiddenError, NotFoundError, ValidationError, assertId, pgErrorInfo } from "@/server/errors";
import { recordActivity } from "@/modules/activity/service";
import { loadProjectAccess } from "@/modules/projects/service";
import { loadTaskAccess } from "@/modules/tasks/service";
import { tagInput, type TagInput } from "./validators";

export interface TagSummary {
  id: string;
  name: string;
  color: string;
}

const tagColumns = { id: tags.id, name: tags.name, color: tags.color };

function mapTagError(error: unknown): never {
  if (pgErrorInfo(error).constraint === "tags_project_name_uq") {
    throw new ValidationError("This project already has a tag with that name", {
      name: "Already in use",
    });
  }
  throw error;
}

async function loadTagAccess(tx: DbOrTx, actor: ActorContext, tagId: string) {
  assertId(tagId, "Tag not found");
  const [tag] = await tx
    .select()
    .from(tags)
    .where(and(eq(tags.id, tagId), eq(tags.workspaceId, actor.workspaceId)));
  if (!tag) throw new NotFoundError("Tag not found");
  const { project, role } = await loadProjectAccess(tx, actor, { id: tag.projectId });
  return { tag, project, role };
}

export async function listProjectTags(actor: ActorContext, projectId: string): Promise<TagSummary[]> {
  await loadProjectAccess(db(), actor, { id: projectId });
  return db()
    .select(tagColumns)
    .from(tags)
    .where(eq(tags.projectId, projectId))
    .orderBy(asc(sql`lower(${tags.name})`));
}

export async function createTag(actor: ActorContext, projectId: string, raw: TagInput) {
  const input = tagInput.parse(raw);
  try {
    return await db().transaction(async (tx) => {
      const { project, role } = await loadProjectAccess(tx, actor, { id: projectId });
      if (!canProject(role, "tag.manage")) throw new ForbiddenError();
      const [tag] = await tx
        .insert(tags)
        .values({
          workspaceId: actor.workspaceId,
          projectId: project.id,
          name: input.name,
          color: input.color,
          createdBy: actor.userId,
        })
        .returning(tagColumns);
      await recordActivity(tx, actor, {
        entityType: "tag",
        entityId: tag!.id,
        action: "created",
        metadata: { name: input.name, projectId },
      });
      return tag!;
    });
  } catch (error) {
    mapTagError(error);
  }
}

export async function updateTag(actor: ActorContext, tagId: string, raw: TagInput) {
  const input = tagInput.parse(raw);
  try {
    await db().transaction(async (tx) => {
      const { tag, role } = await loadTagAccess(tx, actor, tagId);
      if (!canProject(role, "tag.manage")) throw new ForbiddenError();
      if (tag.name === input.name && tag.color === input.color) return;
      await tx.update(tags).set({ name: input.name, color: input.color }).where(eq(tags.id, tagId));
      await recordActivity(tx, actor, {
        entityType: "tag",
        entityId: tagId,
        action: "updated",
        changes: { name: [tag.name, input.name], color: [tag.color, input.color] },
      });
    });
  } catch (error) {
    mapTagError(error);
  }
}

/** Deletes a tag and removes it from every task. */
export async function deleteTag(actor: ActorContext, tagId: string) {
  await db().transaction(async (tx) => {
    const { tag, role } = await loadTagAccess(tx, actor, tagId);
    if (!canProject(role, "tag.manage")) throw new ForbiddenError();
    await tx.delete(tags).where(eq(tags.id, tagId));
    await recordActivity(tx, actor, {
      entityType: "tag",
      entityId: tagId,
      action: "deleted",
      metadata: { name: tag.name, projectId: tag.projectId },
    });
  });
}

/** Replaces a task's tags. Every tag must belong to the task's project. */
export async function setTaskTags(actor: ActorContext, taskId: string, tagIds: string[]) {
  const wanted = [...new Set(tagIds)];
  wanted.forEach((id) => assertId(id, "Tag not found"));
  if (wanted.length > 30) throw new ValidationError("A task can have at most 30 tags");
  await db().transaction(async (tx) => {
    const { task, role } = await loadTaskAccess(tx, actor, taskId);
    if (!canProject(role, "task.update")) throw new ForbiddenError();
    const projectTags = await tx.select(tagColumns).from(tags).where(eq(tags.projectId, task.projectId));
    const byId = new Map(projectTags.map((t) => [t.id, t]));
    if (wanted.some((id) => !byId.has(id))) throw new NotFoundError("Tag not found in this project");

    const current = (
      await tx.select({ tagId: taskTags.tagId }).from(taskTags).where(eq(taskTags.taskId, taskId))
    ).map((r) => r.tagId);
    const added = wanted.filter((id) => !current.includes(id));
    const removed = current.filter((id) => !wanted.includes(id));
    if (!added.length && !removed.length) return;
    if (removed.length) {
      await tx.delete(taskTags).where(and(eq(taskTags.taskId, taskId), inArray(taskTags.tagId, removed)));
    }
    if (added.length) {
      await tx.insert(taskTags).values(
        added.map((tagId) => ({
          workspaceId: actor.workspaceId,
          projectId: task.projectId,
          taskId,
          tagId,
        })),
      );
    }
    await tx
      .update(tasks)
      .set({ version: sql`${tasks.version} + 1` })
      .where(eq(tasks.id, taskId));
    await recordActivity(tx, actor, {
      entityType: "task",
      entityId: taskId,
      action: "tags_changed",
      metadata: {
        added: added.map((id) => byId.get(id)!.name),
        removed: removed.map((id) => byId.get(id)?.name ?? "a deleted tag"),
      },
    });
  });
}

/** Tags for many tasks at once (list rows). The caller has already checked access. */
export async function tagsForTasks(tx: DbOrTx, taskIds: string[]) {
  const map = new Map<string, TagSummary[]>();
  if (!taskIds.length) return map;
  const rows = await tx
    .select({ taskId: taskTags.taskId, ...tagColumns })
    .from(taskTags)
    .innerJoin(tags, eq(tags.id, taskTags.tagId))
    .where(inArray(taskTags.taskId, taskIds))
    .orderBy(asc(sql`lower(${tags.name})`));
  for (const { taskId, ...tag } of rows) map.set(taskId, [...(map.get(taskId) ?? []), tag]);
  return map;
}

/** Distinct tag names across the projects the actor can see (for filter menus). */
export async function visibleTagNames(actor: ActorContext): Promise<string[]> {
  const rows = await db()
    .selectDistinct({ name: tags.name })
    .from(tags)
    .innerJoin(projects, eq(projects.id, tags.projectId))
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actor.userId)),
    )
    .where(
      and(
        eq(tags.workspaceId, actor.workspaceId),
        isNull(projects.archivedAt),
        visibleProjectCondition(actor),
      ),
    )
    .orderBy(tags.name)
    .limit(200);
  // Same name in several projects shows once.
  return [...new Map(rows.map((r) => [r.name.toLowerCase(), r.name])).values()];
}
