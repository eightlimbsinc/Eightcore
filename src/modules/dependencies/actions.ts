"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { formString, runAction } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { addDependency, removeDependency } from "./service";

async function actorFor(workspaceSlug: string) {
  const user = await requireUser();
  return resolveActor(user.id, workspaceSlug);
}

export async function addDependencyAction(
  workspaceSlug: string,
  taskId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const relation = formString(form, "relation") === "blocking" ? "blocking" : "blocked_by";
    await addDependency(await actorFor(workspaceSlug), taskId, { ref: formString(form, "ref"), relation });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: "Dependency added" };
  });
}

export async function removeDependencyAction(
  workspaceSlug: string,
  blockingTaskId: string,
  blockedTaskId: string,
): Promise<ActionState> {
  return runAction(async () => {
    await removeDependency(await actorFor(workspaceSlug), blockingTaskId, blockedTaskId);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}
