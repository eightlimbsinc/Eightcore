"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { runAction } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { parseTaskRef } from "@/modules/tasks/validators";
import { markNotificationsRead } from "./service";

async function actorFor(workspaceSlug: string) {
  const user = await requireUser();
  return resolveActor(user.id, workspaceSlug);
}

export async function markAllReadAction(workspaceSlug: string): Promise<ActionState> {
  return runAction(async () => {
    await markNotificationsRead(await actorFor(workspaceSlug));
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

/** Marks one notification read and opens its task. */
export async function openNotificationAction(workspaceSlug: string, notificationId: string, taskRef: string) {
  await markNotificationsRead(await actorFor(workspaceSlug), [notificationId]);
  revalidatePath(`/w/${workspaceSlug}`, "layout");
  const ref = parseTaskRef(taskRef);
  redirect(ref ? `/w/${workspaceSlug}/t/${ref.key}-${ref.number}` : `/w/${workspaceSlug}/inbox`);
}
