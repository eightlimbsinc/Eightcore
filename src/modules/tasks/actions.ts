"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { formString, runAction } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { createTask, setTaskArchived, setTaskAssignees, setWatching, updateTask } from "./service";
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
