"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { runAction } from "@/server/action";
import { env } from "@/server/env";
import type { ActionState } from "@/lib/action-state";
import {
  createInboundHook,
  createWebhookEndpoint,
  deleteInboundHook,
  deleteWebhookEndpoint,
  retryWebhookDelivery,
  setWebhookEndpointEnabled,
} from "./service";

async function actorFor(workspaceSlug: string) {
  const user = await requireUser();
  return resolveActor(user.id, workspaceSlug);
}
const refresh = (slug: string) => revalidatePath(`/w/${slug}/integrations`);

/** The secret comes back once, in the message, for the screen to show. */
export async function createWebhookEndpointAction(
  workspaceSlug: string,
  input: { name: string; url: string; events: string[]; projectId: string | null },
): Promise<ActionState> {
  return runAction(async () => {
    const { secret } = await createWebhookEndpoint(await actorFor(workspaceSlug), {
      ...input,
      events: input.events as never,
    });
    refresh(workspaceSlug);
    return { ok: true, message: secret };
  });
}

export async function setWebhookEndpointEnabledAction(workspaceSlug: string, id: string, enabled: boolean) {
  return runAction(async () => {
    await setWebhookEndpointEnabled(await actorFor(workspaceSlug), id, enabled);
    refresh(workspaceSlug);
  });
}

export async function deleteWebhookEndpointAction(workspaceSlug: string, id: string) {
  return runAction(async () => {
    await deleteWebhookEndpoint(await actorFor(workspaceSlug), id);
    refresh(workspaceSlug);
  });
}

export async function retryWebhookDeliveryAction(workspaceSlug: string, id: number) {
  return runAction(async () => {
    await retryWebhookDelivery(await actorFor(workspaceSlug), id);
    refresh(workspaceSlug);
  });
}

/** The full address comes back once, in the message. */
export async function createInboundHookAction(workspaceSlug: string, name: string): Promise<ActionState> {
  return runAction(async () => {
    const { token } = await createInboundHook(await actorFor(workspaceSlug), name);
    refresh(workspaceSlug);
    return { ok: true, message: new URL(`/api/hooks/${token}`, env().BETTER_AUTH_URL).toString() };
  });
}

export async function deleteInboundHookAction(workspaceSlug: string, id: string) {
  return runAction(async () => {
    await deleteInboundHook(await actorFor(workspaceSlug), id);
    refresh(workspaceSlug);
  });
}
