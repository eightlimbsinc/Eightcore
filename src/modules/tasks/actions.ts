"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { formString, runAction } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { ValidationError } from "@/server/errors";
import { viewerToday } from "@/server/today";
import { EMPTY_FILTER } from "./filters";
import { searchTasks } from "./search";
import { bulkUpdateTasks, type BulkOperation } from "./bulk";
import {
  createTask,
  deleteTask,
  moveTask,
  setTaskArchived,
  setTaskAssignees,
  setWatching,
  updateTask,
} from "./service";
import { TASK_PRIORITIES, type TaskPriority } from "./validators";

async function actorFor(workspaceSlug: string) {
  const user = await requireUser();
  return resolveActor(user.id, workspaceSlug);
}

function priorityFrom(form: FormData): TaskPriority | undefined {
  const value = formString(form, "priority");
  return (TASK_PRIORITIES as readonly string[]).includes(value) ? (value as TaskPriority) : undefined;
}

export async function createTaskAction(
  workspaceSlug: string,
  listId: string,
  parentTaskId: string | null,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const statusId = formString(form, "statusId");
    const task = await createTask(await actorFor(workspaceSlug), listId, {
      title: formString(form, "title"),
      statusId: statusId || undefined,
      parentTaskId: parentTaskId ?? undefined,
      priority: priorityFrom(form) ?? "none",
      dueDate: formString(form, "dueDate") || null,
    });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: `Created ${task.ref}` };
  });
}

export async function updateTaskAction(
  workspaceSlug: string,
  taskId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const version = Number(formString(form, "version"));
    await updateTask(await actorFor(workspaceSlug), taskId, Number.isInteger(version) ? version : -1, {
      title: formString(form, "title"),
      description: formString(form, "description"),
      statusId: formString(form, "statusId") || undefined,
      priority: priorityFrom(form),
      startDate: formString(form, "startDate"),
      dueDate: formString(form, "dueDate"),
    });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: "Saved" };
  });
}

/** Quick status change from a list row (uses the row's version). */
export async function setTaskStatusAction(
  workspaceSlug: string,
  taskId: string,
  version: number,
  statusId: string,
): Promise<ActionState> {
  return runAction(async () => {
    await updateTask(await actorFor(workspaceSlug), taskId, version, { statusId });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

/** Quick edit of one field from a list row (priority or due date), using the row's version. */
export async function setTaskQuickFieldAction(
  workspaceSlug: string,
  taskId: string,
  version: number,
  patch: { priority?: TaskPriority; dueDate?: string | null },
): Promise<ActionState> {
  return runAction(async () => {
    const clean: { priority?: TaskPriority; dueDate?: string | null } = {};
    if (patch.priority !== undefined) {
      if (!(TASK_PRIORITIES as readonly string[]).includes(patch.priority))
        throw new ValidationError("Pick a priority");
      clean.priority = patch.priority;
    }
    if (patch.dueDate !== undefined) clean.dueDate = patch.dueDate;
    await updateTask(await actorFor(workspaceSlug), taskId, version, clean);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

/** Replaces a task's assignees (the person picker saves on every click). */
export async function setTaskAssigneesAction(
  workspaceSlug: string,
  taskId: string,
  userIds: string[],
): Promise<ActionState> {
  return runAction(async () => {
    await setTaskAssignees(await actorFor(workspaceSlug), taskId, userIds);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

export async function archiveTaskAction(
  workspaceSlug: string,
  taskId: string,
  listId: string,
): Promise<ActionState> {
  const result = await runAction(async () => {
    await setTaskArchived(await actorFor(workspaceSlug), taskId, true);
  });
  if (result?.ok) {
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    redirect(`/w/${workspaceSlug}/l/${listId}`);
  }
  return result;
}

export async function setWatchingAction(
  workspaceSlug: string,
  taskId: string,
  watching: boolean,
): Promise<ActionState> {
  return runAction(async () => {
    await setWatching(await actorFor(workspaceSlug), taskId, watching);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

/** Archive from a list row's menu (stays on the list). */
export async function archiveTaskFromListAction(workspaceSlug: string, taskId: string): Promise<ActionState> {
  return runAction(async () => {
    await setTaskArchived(await actorFor(workspaceSlug), taskId, true);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

/** Permanent delete. From the task page (`returnToList`), goes back to the list afterwards. */
export async function deleteTaskAction(
  workspaceSlug: string,
  taskId: string,
  returnToList: boolean,
): Promise<ActionState> {
  let listId = "";
  const result = await runAction(async () => {
    ({ listId } = await deleteTask(await actorFor(workspaceSlug), taskId));
  });
  if (result?.ok) {
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    if (returnToList) redirect(`/w/${workspaceSlug}/l/${listId}`);
  }
  return result;
}

/** Board drag and drop. */
export async function moveTaskAction(
  workspaceSlug: string,
  taskId: string,
  version: number,
  move: { statusId?: string; afterTaskId?: string | null; beforeTaskId?: string | null },
): Promise<ActionState> {
  return runAction(async () => {
    await moveTask(await actorFor(workspaceSlug), taskId, version, move);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

/** Ctrl+K: tasks matching what was typed (title or KEY-number), most recently updated first. */
export async function quickFindTasksAction(workspaceSlug: string, query: string) {
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  const actor = await actorFor(workspaceSlug);
  const { tasks } = await searchTasks(
    actor,
    { ...EMPTY_FILTER, q },
    { today: await viewerToday(), limit: 8, order: "recent" },
  );
  const exact = q.toUpperCase();
  return tasks
    .map((t) => ({
      ref: t.ref,
      title: t.title,
      where: `${t.projectName} › ${t.listName}`,
      statusName: t.statusName,
      statusColor: t.statusColor,
      closed: t.closed,
    }))
    .sort((a, b) => Number(b.ref === exact) - Number(a.ref === exact));
}

/** List bulk actions: one change to every selected task. The message says what happened. */
export async function bulkTaskAction(
  workspaceSlug: string,
  listId: string,
  taskIds: string[],
  op: BulkOperation,
): Promise<ActionState> {
  return runAction(async () => {
    const { done, skipped, reason } = await bulkUpdateTasks(
      await actorFor(workspaceSlug),
      listId,
      taskIds,
      op,
    );
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    const tasksWord = (n: number) => `${n} ${n === 1 ? "task" : "tasks"}`;
    if (done === 0) return { ok: false, message: reason ?? "Nothing was changed" };
    const verb = op.kind === "delete" ? "Deleted" : op.kind === "archive" ? "Archived" : "Updated";
    return {
      ok: true,
      message: skipped
        ? `${verb} ${tasksWord(done)}. Skipped ${tasksWord(skipped)}: ${reason}`
        : `${verb} ${tasksWord(done)}`,
    };
  });
}
