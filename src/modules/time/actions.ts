"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { formString, runAction } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { parseDuration } from "@/lib/time-format";
import { ValidationError } from "@/server/errors";
import { updateTask } from "@/modules/tasks/service";
import { addTimeEntry, deleteTimeEntry, startTimer, stopTimer, updateTimeEntry } from "./service";

async function actorFor(workspaceSlug: string) {
  const user = await requireUser();
  return resolveActor(user.id, workspaceSlug);
}

function minutesFrom(text: string, field = "duration"): number {
  const minutes = parseDuration(text);
  if (minutes === null || minutes < 1) {
    throw new ValidationError("Enter a time like 1h 30m, 90m or 1:30", { [field]: "Not a time" });
  }
  return minutes;
}

export async function startTimerAction(workspaceSlug: string, taskId: string): Promise<ActionState> {
  return runAction(async () => {
    await startTimer(await actorFor(workspaceSlug), taskId);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

export async function stopTimerAction(workspaceSlug: string): Promise<ActionState> {
  return runAction(async () => {
    await stopTimer(await actorFor(workspaceSlug));
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

/** "Add time": duration as typed, the day, an optional note. */
export async function addTimeEntryAction(
  workspaceSlug: string,
  taskId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const minutes = minutesFrom(formString(form, "duration"));
    await addTimeEntry(await actorFor(workspaceSlug), taskId, {
      minutes,
      date: formString(form, "date"),
      note: formString(form, "note"),
    });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: "Time added" };
  });
}

export async function updateTimeEntryAction(
  workspaceSlug: string,
  entryId: string,
  patch: { duration?: string; note?: string },
): Promise<ActionState> {
  return runAction(async () => {
    await updateTimeEntry(await actorFor(workspaceSlug), entryId, {
      minutes: patch.duration !== undefined ? minutesFrom(patch.duration) : undefined,
      note: patch.note,
    });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

export async function deleteTimeEntryAction(workspaceSlug: string, entryId: string): Promise<ActionState> {
  return runAction(async () => {
    await deleteTimeEntry(await actorFor(workspaceSlug), entryId);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

/** The task's time estimate, typed like a duration; empty clears it. */
export async function setTimeEstimateAction(
  workspaceSlug: string,
  taskId: string,
  version: number,
  text: string,
): Promise<ActionState> {
  return runAction(async () => {
    const minutes = text.trim() ? minutesFrom(text, "estimate") : null;
    await updateTask(await actorFor(workspaceSlug), taskId, version, { timeEstimateMinutes: minutes });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}
