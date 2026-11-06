"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { runAction } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import type { AutomationInput } from "./rules";
import { deleteAutomation, saveAutomation, setAutomationEnabled } from "./service";

async function actorFor(workspaceSlug: string) {
  const user = await requireUser();
  return resolveActor(user.id, workspaceSlug);
}

export async function saveAutomationAction(
  workspaceSlug: string,
  projectId: string,
  input: AutomationInput,
  automationId?: string,
): Promise<ActionState> {
  return runAction(async () => {
    await saveAutomation(await actorFor(workspaceSlug), projectId, input, automationId);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: "Saved" };
  });
}

export async function setAutomationEnabledAction(
  workspaceSlug: string,
  automationId: string,
  enabled: boolean,
): Promise<ActionState> {
  return runAction(async () => {
    await setAutomationEnabled(await actorFor(workspaceSlug), automationId, enabled);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

export async function deleteAutomationAction(
  workspaceSlug: string,
  automationId: string,
): Promise<ActionState> {
  return runAction(async () => {
    await deleteAutomation(await actorFor(workspaceSlug), automationId);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}
