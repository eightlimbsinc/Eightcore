import "server-only";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requireUser } from "@/server/auth/session";
import { resolveActorCached } from "@/server/authz/actor";
import { canProject, canWorkspace, type ActorContext } from "@/server/authz/policy";
import { NotFoundError } from "@/server/errors";
import { listVisibleProjects } from "@/modules/projects/service";
import { getSidebarTree } from "@/modules/lists/service";
import { countUnread, listNotifications } from "@/modules/notifications/service";
import { readFilter } from "@/modules/tasks/filters";
import { searchTasks } from "@/modules/tasks/search";
import { visibleTagNames } from "@/modules/tags/service";
import { viewerTimeZone, viewerToday } from "@/server/today";
import { getDashboard } from "@/modules/dashboard/service";
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
    projects: projects.map((p) => ({
      ...p,
      ...(tree.get(p.id) ?? { folders: [], rootLists: [] }),
      canManageLists: canProject(p.role, "list.manage"),
    })),
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

/** The workspace Tasks page (and "My Work"): filtered tasks across visible projects. */
export async function getTasksPage(slug: string, params: Record<string, string | string[] | undefined>) {
  const { user, actor } = await getWorkspaceContext(slug);
  const filter = readFilter(params);
  const today = await viewerToday();
  const project = await focusProject(actor, params.project);
  const [results, people, tagNames] = await Promise.all([
    searchTasks(actor, filter, { today, projectId: project?.id }),
    canWorkspace(actor.workspaceRole, "member.view_directory")
      ? listMembers(actor).then((ms) =>
          ms.filter((m) => m.status === "active").map((m) => ({ userId: m.userId, name: m.name })),
        )
      : Promise.resolve([]),
    visibleTagNames(actor),
  ]);
  return { user, actor, filter, today, people, tagNames, project, ...results };
}

/** "?project=KEY" → that project, if the actor can see it. */
async function focusProject(actor: ActorContext, key: string | string[] | undefined) {
  if (typeof key !== "string" || !key) return null;
  const projects = await listVisibleProjects(actor);
  const p = projects.find((x) => x.key === key.toUpperCase());
  return p ? { id: p.id, key: p.key, name: p.name } : null;
}

/** The dashboard, for every visible project or one ("?project=KEY"). */
export async function getDashboardPage(slug: string, params: Record<string, string | string[] | undefined>) {
  const { actor } = await getWorkspaceContext(slug);
  const [today, timeZone, projects] = await Promise.all([
    viewerToday(),
    viewerTimeZone(),
    listVisibleProjects(actor),
  ]);
  const project = await focusProject(actor, params.project);
  const data = await getDashboard(actor, { today, timeZone, projectId: project?.id });
  return { actor, today, project, projects: projects.map((p) => ({ key: p.key, name: p.name })), ...data };
}

export { listWorkspacesForUser, previewInvitation };
