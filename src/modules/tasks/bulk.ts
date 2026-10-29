import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { activityEvents, attachments, outboxEvents, taskAssignees, tasks } from "@/server/db/schema";
import { canProject, type ActorContext } from "@/server/authz/policy";
import { DomainError, ValidationError, assertId } from "@/server/errors";
import { loadListAccess } from "@/modules/lists/service";
import { discardStored } from "@/server/storage";
import { canDeleteTask, setTaskAssignees, updateTask } from "./service";
import { TASK_PRIORITIES, type TaskPriority } from "./validators";

export const BULK_LIMIT = 200;

export type BulkOperation =
  | { kind: "status"; statusId: string }
  | { kind: "priority"; priority: TaskPriority }
  | { kind: "dueDate"; dueDate: string | null }
  | { kind: "assign"; userId: string }
  | { kind: "unassign" }
  | { kind: "archive" }
  | { kind: "delete" };

export interface BulkResult {
  done: number;
  /** Tasks left unchanged, with the first reason (e.g. no permission). */
  skipped: number;
  reason?: string;
}

function checkOperation(op: BulkOperation) {
  switch (op.kind) {
    case "status":
      return assertId(op.statusId, "Status not found");
    case "assign":
      return assertId(op.userId, "Member not found");
    case "priority":
      if (!(TASK_PRIORITIES as readonly string[]).includes(op.priority))
        throw new ValidationError("Pick a priority");
      return;
    case "dueDate":
    case "unassign":
    case "archive":
    case "delete":
      return;
    default:
      throw new ValidationError("Unknown action");
  }
}

/**
 * Applies one change to many tasks of a list. Each task goes through the same service call
 * (and permission check) as a single edit, in its own transaction; tasks the actor may not
 * change are skipped and counted. Bulk edits apply to the task as it is now (no version check).
 */
export async function bulkUpdateTasks(
  actor: ActorContext,
  listId: string,
  taskIds: string[],
  op: BulkOperation,
): Promise<BulkResult> {
  assertId(listId, "List not found");
  const ids = [...new Set(taskIds)];
  if (ids.length === 0) throw new ValidationError("Select at least one task");
  if (ids.length > BULK_LIMIT) throw new ValidationError(`Select at most ${BULK_LIMIT} tasks at a time`);
  ids.forEach((id) => assertId(id, "Task not found"));
  checkOperation(op);
  if (op.kind === "archive" || op.kind === "delete") return archiveOrDeleteMany(actor, listId, ids, op.kind);

  // Only tasks of this list in the actor's workspace; per-task calls check visibility and roles.
  const rows = await db()
    .select({ id: tasks.id, version: tasks.version })
    .from(tasks)
    .where(and(inArray(tasks.id, ids), eq(tasks.listId, listId), eq(tasks.workspaceId, actor.workspaceId)));
  const assignees =
    op.kind === "assign"
      ? await db()
          .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId })
          .from(taskAssignees)
          .where(
            inArray(
              taskAssignees.taskId,
              rows.map((r) => r.id),
            ),
          )
      : [];

  const result: BulkResult = { done: 0, skipped: ids.length - rows.length };
  if (result.skipped) result.reason = "Some tasks are no longer in this list";
  for (const row of rows) {
    try {
      switch (op.kind) {
        case "status":
          await updateTask(actor, row.id, row.version, { statusId: op.statusId });
          break;
        case "priority":
          await updateTask(actor, row.id, row.version, { priority: op.priority });
          break;
        case "dueDate":
          await updateTask(actor, row.id, row.version, { dueDate: op.dueDate });
          break;
        case "assign": {
          const current = assignees.filter((a) => a.taskId === row.id).map((a) => a.userId);
          if (!current.includes(op.userId)) await setTaskAssignees(actor, row.id, [...current, op.userId]);
          break;
        }
        case "unassign":
          await setTaskAssignees(actor, row.id, []);
          break;
      }
      result.done++;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      result.skipped++;
      result.reason ??= error.message;
    }
  }
  return result;
}

/**
 * Archive and delete as one transaction for the whole selection (a few queries in total,
 * however many tasks): every task is in the same list, so the role is looked up once.
 * Permissions are the single-task ones, including "own tasks only" for editors.
 */
async function archiveOrDeleteMany(
  actor: ActorContext,
  listId: string,
  ids: string[],
  kind: "archive" | "delete",
): Promise<BulkResult> {
  const { keys, result } = await db().transaction(async (tx) => {
    const { project, role } = await loadListAccess(tx, actor, listId);
    const rows = await tx
      .select({ id: tasks.id, number: tasks.number, title: tasks.title, createdBy: tasks.createdBy })
      .from(tasks)
      .where(and(inArray(tasks.id, ids), eq(tasks.listId, listId), eq(tasks.workspaceId, actor.workspaceId)));
    const allowed = rows.filter((t) =>
      kind === "delete"
        ? canDeleteTask(role, actor, t)
        : canProject(role, "task.archive") ||
          (t.createdBy === actor.userId && canProject(role, "task.archive_own")),
    );
    const result: BulkResult = { done: 0, skipped: 0 };
    let keys: { storageKey: string }[] = [];
    if (allowed.length) {
      const allowedIds = allowed.map((t) => t.id);
      // Subtasks go with their parent, so a selected subtask under a selected parent counts as done.
      const subtree = await tx.execute<{ id: string }>(sql`
        with recursive subtree(id) as (
          select unnest(${sql`array[${sql.join(
            allowedIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}]`})
          union
          select t.id from ${tasks} t join subtree s on t.parent_task_id = s.id
        )
        select id from subtree`);
      const covered = new Set(subtree.rows.map((r) => r.id));
      result.done = rows.filter((r) => covered.has(r.id)).length;

      if (kind === "delete") {
        keys = await tx
          .select({ storageKey: attachments.storageKey })
          .from(attachments)
          .where(inArray(attachments.taskId, [...covered]));
        await tx.delete(tasks).where(inArray(tasks.id, allowedIds));
      } else {
        await tx
          .update(tasks)
          .set({ archivedAt: new Date(), version: sql`${tasks.version} + 1` })
          .where(and(inArray(tasks.id, allowedIds), isNull(tasks.archivedAt)));
      }
      await tx.insert(activityEvents).values(
        allowed.map((t) => ({
          workspaceId: actor.workspaceId,
          actorId: actor.actorKind === "user" ? actor.userId : null,
          actorKind: actor.actorKind,
          entityType: "task",
          entityId: t.id,
          action: kind === "delete" ? "deleted" : "archived",
          changes: {},
          metadata:
            kind === "delete" ? { ref: `${project.key}-${t.number}`, title: t.title, bulk: true } : {},
          requestId: actor.requestId,
        })),
      );
      if (kind === "delete") {
        await tx.insert(outboxEvents).values(
          allowed.map((t) => ({
            workspaceId: actor.workspaceId,
            type: "task.deleted",
            payload: { taskId: t.id, listId },
          })),
        );
      }
    }
    result.skipped = ids.length - result.done;
    if (result.skipped) {
      result.reason =
        rows.length < ids.length
          ? "Some tasks are no longer in this list"
          : "You don't have permission to do that";
    }
    return { keys, result };
  });
  await discardStored(keys);
  return result;
}
