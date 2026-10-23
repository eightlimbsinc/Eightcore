import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requireUser } from "@/server/auth/session";
import { resolveActorCached } from "@/server/authz/actor";
import { canWorkspace, type ActorContext } from "@/server/authz/policy";
import { NotFoundError } from "@/server/errors";
import { listVisibleProjects } from "@/modules/projects/service";
import { getSidebarTree } from "@/modules/lists/service";
import { countUnread, listNotifications } from "@/modules/notifications/service";
import {
  getWorkspace,
  listMembers,
  listPendingInvitations,
  listWorkspacesForUser,
  previewInvitation,
} from "./service";

/** Signed-in user + actor for a workspace page. Non-members see a 404. */
export const getWorkspaceContext = cache(async (slug: string) => {
  const user = await requireUser();
  let actor: ActorContext;
  try {
    actor = await resolveActorCached(user.id, slug);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  return { user, actor };
});

/** Everything the workspace shell (sidebar, switcher) needs. */
export const getWorkspaceShell = cache(async (slug: string) => {
  const { user, actor } = await getWorkspaceContext(slug);
  const [workspace, workspaces, projects, unread] = await Promise.all([
    getWorkspace(actor),
    listWorkspacesForUser(user.id),
    listVisibleProjects(actor),
    countUnread(actor),
  ]);
  const tree = await getSidebarTree(
    actor,
    projects.map((p) => p.id),
  );
  return {
    user,
    actor,
    workspace,
    workspaces,
    projects: projects.map((p) => ({ ...p, ...(tree.get(p.id) ?? { folders: [], rootLists: [] }) })),
    unread,
    can: {
      createProject: canWorkspace(actor.workspaceRole, "project.create"),
      viewMembers: canWorkspace(actor.workspaceRole, "member.view_directory"),
    },
  };
});

export async function getMembersPage(slug: string) {
  const { user, actor } = await getWorkspaceContext(slug);
  if (!canWorkspace(actor.workspaceRole, "member.view_directory")) notFound();
  const canInvite = canWorkspace(actor.workspaceRole, "member.invite");
  const [members, invitations] = await Promise.all([
    listMembers(actor),
    canInvite ? listPendingInvitations(actor) : Promise.resolve([]),
  ]);
  return {
    user,
    actor,
    members,
    invitations,
    can: {
      invite: canInvite,
      inviteAdmin: canWorkspace(actor.workspaceRole, "member.invite_admin"),
      changeRole: canWorkspace(actor.workspaceRole, "member.change_role"),
      manageOwners: canWorkspace(actor.workspaceRole, "member.manage_owners"),
      deactivate: canWorkspace(actor.workspaceRole, "member.deactivate"),
    },
  };
}

export async function getInboxPage(slug: string, filter: "all" | "unread") {
  const { user, actor } = await getWorkspaceContext(slug);
  const notifications = await listNotifications(actor, { unreadOnly: filter === "unread" });
  return { user, actor, notifications };
}

export { listWorkspacesForUser, previewInvitation };
