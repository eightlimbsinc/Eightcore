"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { runAction } from "@/server/action";
import { env } from "@/server/env";
import { actionEmail, sendMail } from "@/server/mail";
import { DomainError } from "@/server/errors";
import type { ActionState } from "@/lib/action-state";
import { getListSharing, inviteGuestToList, shareListWithGuest, unshareListFromGuest } from "./sharing";

async function actorFor(workspaceSlug: string) {
  const user = await requireUser();
  return { user, actor: await resolveActor(user.id, workspaceSlug) };
}

export type ListSharing = Awaited<ReturnType<typeof getListSharing>>;

/** For the Share dialog: null with a message when the person can't manage sharing here. */
export async function listSharingAction(
  workspaceSlug: string,
  listId: string,
): Promise<{ ok: true; sharing: ListSharing } | { ok: false; message: string }> {
  try {
    const { actor } = await actorFor(workspaceSlug);
    return { ok: true, sharing: await getListSharing(actor, listId) };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, message: error.message };
    throw error;
  }
}

export async function shareListAction(
  workspaceSlug: string,
  listId: string,
  userId: string,
  role: string,
): Promise<ActionState> {
  return runAction(async () => {
    const { actor } = await actorFor(workspaceSlug);
    await shareListWithGuest(actor, listId, { userId, role });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

export async function unshareListAction(
  workspaceSlug: string,
  listId: string,
  userId: string,
): Promise<ActionState> {
  return runAction(async () => {
    const { actor } = await actorFor(workspaceSlug);
    await unshareListFromGuest(actor, listId, userId);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

/** Invites a new guest to this list (they get an email; access starts when they accept). */
export async function inviteGuestToListAction(
  workspaceSlug: string,
  listId: string,
  email: string,
  role: string,
): Promise<ActionState> {
  return runAction(async () => {
    const { user, actor } = await actorFor(workspaceSlug);
    const sharing = await getListSharing(actor, listId);
    const result = await inviteGuestToList(actor, listId, { email, role });
    if (result.token) {
      await sendMail({
        to: result.email,
        subject: `${user.name} shared “${sharing.list.name}” with you on Eightcore`,
        ...actionEmail({
          heading: "You're invited",
          body: `${user.name} invited you as a guest to see “${sharing.list.name}” in ${sharing.project.name}. The invitation expires in 7 days.`,
          actionLabel: "Accept invitation",
          url: `${env().BETTER_AUTH_URL}/invite/${result.token}`,
        }),
      });
    }
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return {
      ok: true,
      message: result.token
        ? `Invitation sent to ${result.email}`
        : `${result.email} will see this list too (already invited or a guest)`,
    };
  });
}
