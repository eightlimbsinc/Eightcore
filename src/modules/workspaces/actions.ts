"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { formString, runAction } from "@/server/action";
import { env } from "@/server/env";
import { actionEmail, sendMail } from "@/server/mail";
import { WORKSPACE_ROLES, type WorkspaceRole } from "@/server/authz/matrix";
import type { ActionState } from "@/lib/action-state";
import {
  acceptInvitation,
  changeMemberRole,
  createWorkspace,
  inviteMember,
  revokeInvitation,
  setMemberStatus,
} from "./service";
import { invitableRole } from "./validators";

export async function createWorkspaceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let slug = "";
  const result = await runAction(async () => {
    const user = await requireUser();
    const workspace = await createWorkspace(user.id, {
      name: formString(form, "name"),
      slug: formString(form, "slug"),
    });
    slug = workspace.slug;
  });
  if (result?.ok) redirect(`/w/${slug}`);
  return result;
}

export async function inviteMemberAction(
  workspaceSlug: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const actor = await resolveActor(user.id, workspaceSlug);
    const email = formString(form, "email");
    const role = invitableRole.parse(formString(form, "role"));
    const { token } = await inviteMember(actor, { email, role });
    const url = `${env().BETTER_AUTH_URL}/invite/${token}`;
    await sendMail({
      to: email.trim().toLowerCase(),
      subject: `${user.name} invited you to Eightcore`,
      ...actionEmail({
        heading: "You're invited",
        body: `${user.name} invited you to join their Eightcore workspace as ${role === "admin" ? "an" : "a"} ${role}. The invitation expires in 7 days.`,
        actionLabel: "Accept invitation",
        url,
      }),
    });
    revalidatePath(`/w/${workspaceSlug}/members`);
    return { ok: true, message: `Invitation sent to ${email.trim().toLowerCase()}` };
  });
}

export async function revokeInvitationAction(
  workspaceSlug: string,
  invitationId: string,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    await revokeInvitation(await resolveActor(user.id, workspaceSlug), invitationId);
    revalidatePath(`/w/${workspaceSlug}/members`);
  });
}

export async function changeMemberRoleAction(
  workspaceSlug: string,
  userId: string,
  role: string,
): Promise<ActionState> {
  return runAction(async () => {
    if (!WORKSPACE_ROLES.includes(role as WorkspaceRole)) return { ok: false, message: "Unknown role" };
    const user = await requireUser();
    await changeMemberRole(await resolveActor(user.id, workspaceSlug), userId, role as WorkspaceRole);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

export async function setMemberStatusAction(
  workspaceSlug: string,
  userId: string,
  status: "active" | "deactivated",
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    await setMemberStatus(
      await resolveActor(user.id, workspaceSlug),
      userId,
      status === "active" ? "active" : "deactivated",
    );
    revalidatePath(`/w/${workspaceSlug}/members`);
  });
}

export async function acceptInvitationAction(token: string, _prev: ActionState): Promise<ActionState> {
  let slug = "";
  const result = await runAction(async () => {
    const user = await requireUser();
    slug = (await acceptInvitation(user, token)).workspaceSlug;
  });
  if (result?.ok) redirect(`/w/${slug}`);
  return result;
}
