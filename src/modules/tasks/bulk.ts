import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { taskAssignees, tasks } from "@/server/db/schema";
import type { ActorContext } from "@/server/authz/policy";
import { DomainError, NotFoundError, ValidationError, assertId } from "@/server/errors";
import { deleteTask, setTaskArchived, setTaskAssignees, updateTask } from "./service";
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

  // Only tasks of this list in the actor's workspace; per-task calls check visibility and roles.
  const rows = await db()
    .select({ id: tasks.id, version: tasks.version, parentTaskId: tasks.parentTaskId })
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
  // Parents first, so deleting a parent takes its selected subtasks with it.
  rows.sort((a, b) => Number(Boolean(a.parentTaskId)) - Number(Boolean(b.parentTaskId)));

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
        case "archive":
          await setTaskArchived(actor, row.id, true);
          break;
        case "delete":
          await deleteTask(actor, row.id);
          break;
      }
      result.done++;
    } catch (error) {
      // A subtask already deleted with its selected parent counts as done.
      if (op.kind === "delete" && error instanceof NotFoundError && row.parentTaskId) {
        result.done++;
        continue;
      }
      if (!(error instanceof DomainError)) throw error;
      result.skipped++;
      result.reason ??= error.message;
    }
  }
  return result;
}
