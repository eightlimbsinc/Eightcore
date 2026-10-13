// Runs every matrix action through the real services, for every role, against Postgres.
// Adding an action to the matrix fails this suite until it gets a probe (or is listed
// as not yet exposed, with a reason).
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PROJECT_ACTIONS,
  PROJECT_ROLES,
  WORKSPACE_ACTIONS,
  WORKSPACE_ROLES,
  type ProjectAction,
  type ProjectRole,
  type WorkspaceAction,
} from "@/server/authz/matrix";
import { canProject, canWorkspace, type ActorContext } from "@/server/authz/policy";
import { ForbiddenError } from "@/server/errors";
import { db } from "@/server/db";
import { workspaceMembers } from "@/server/db/schema";
import {
  changeMemberRole,
  getWorkspace,
  inviteMember,
  listMembers,
  setMemberStatus,
} from "@/modules/workspaces/service";
import {
  createProject,
  getProjectByKey,
  listVisibleProjects,
  setProjectArchived,
  setProjectMember,
  updateProject,
} from "@/modules/projects/service";
import { actorFor, createUser, createWorkspaceWithRoles } from "../support/factories";

type Fixture = Awaited<ReturnType<typeof createWorkspaceWithRoles>> & {
  target: { id: string };
  privateProject: { id: string; key: string };
};

async function fixture(): Promise<Fixture> {
  const ctx = await createWorkspaceWithRoles();
  const target = await createUser({ name: "Target member" });
  await db()
    .insert(workspaceMembers)
    .values({ workspaceId: ctx.workspace.id, userId: target.id, role: "member" });
  const privateProject = await createProject(ctx.actors.owner, {
    name: "Private",
    key: "PRIV",
    visibility: "private",
  });
  return { ...ctx, target, privateProject };
}

/** Each probe performs the action; it throws ForbiddenError when denied. */
const workspaceProbes: Partial<
  Record<WorkspaceAction, (actor: ActorContext, f: Fixture) => Promise<unknown>>
> = {
  "workspace.view": (actor) => getWorkspace(actor),
  "member.view_directory": (actor) => listMembers(actor),
  "member.invite": (actor) => inviteMember(actor, { email: `${randomUUID()}@example.test`, role: "member" }),
  "member.invite_admin": (actor) =>
    inviteMember(actor, { email: `${randomUUID()}@example.test`, role: "admin" }),
  "member.change_role": (actor, f) => changeMemberRole(actor, f.target.id, "guest"),
  "member.manage_owners": (actor, f) => changeMemberRole(actor, f.target.id, "owner"),
  "member.deactivate": (actor, f) => setMemberStatus(actor, f.target.id, "deactivated"),
  "project.create": (actor) => createProject(actor, { name: "New", key: "NEW" }),
  "project.view_all": async (actor, f) => {
    const visible = await listVisibleProjects(actor);
    if (!visible.some((p) => p.id === f.privateProject.id)) throw new ForbiddenError();
  },
};

/** Matrix actions with no service yet. Each needs a probe once its feature ships. */
const notYetExposed: Partial<Record<WorkspaceAction, string>> = {
  "workspace.update_settings": "workspace settings screen arrives in Phase 4",
  "workspace.delete": "workspace deletion arrives in Phase 8",
  "workspace.transfer_ownership": "covered by member.manage_owners until a dedicated flow exists",
  "audit_log.view": "audit log viewer arrives in Phase 4",
};

describe("workspace actions through services", () => {
  it("probes or explicitly defers every workspace action", () => {
    const covered = [...Object.keys(workspaceProbes), ...Object.keys(notYetExposed)].sort();
    expect(covered).toEqual(Object.keys(WORKSPACE_ACTIONS).sort());
  });

  for (const [action, probe] of Object.entries(workspaceProbes) as [
    WorkspaceAction,
    NonNullable<(typeof workspaceProbes)[WorkspaceAction]>,
  ][]) {
    for (const role of WORKSPACE_ROLES) {
      const allowed = canWorkspace(role, action);
      it(`${role} → ${action}: ${allowed ? "allowed" : "denied"}`, async () => {
        const f = await fixture();
        const result = probe(f.actors[role], f);
        if (allowed) await expect(result).resolves.not.toThrow();
        else await expect(result).rejects.toBeInstanceOf(ForbiddenError);
      });
    }
  }
});

const projectProbes: Record<ProjectAction, (actor: ActorContext, f: Fixture) => Promise<unknown>> = {
  "project.view": (actor, f) => getProjectByKey(actor, f.privateProject.key),
  "project.update": (actor, f) => updateProject(actor, f.privateProject.id, { name: "Renamed" }),
  "project.archive": (actor, f) => setProjectArchived(actor, f.privateProject.id, true),
  "project.manage_members": (actor, f) =>
    setProjectMember(actor, f.privateProject.id, { userId: f.users.guest.id, role: "viewer" }),
};

describe("project actions through services", () => {
  it("probes every project action", () => {
    expect(Object.keys(projectProbes).sort()).toEqual(Object.keys(PROJECT_ACTIONS).sort());
  });

  for (const [action, probe] of Object.entries(projectProbes) as [
    ProjectAction,
    (typeof projectProbes)[ProjectAction],
  ][]) {
    for (const projectRole of PROJECT_ROLES) {
      const allowed = canProject(projectRole, action);
      it(`member with project role ${projectRole} → ${action}: ${allowed ? "allowed" : "denied"}`, async () => {
        const f = await fixture();
        await setProjectMember(f.actors.owner, f.privateProject.id, {
          userId: f.target.id,
          role: projectRole as ProjectRole,
        });
        const actor = actorFor(f.target, f.workspace, "member");
        const result = probe(actor, f);
        if (allowed) await expect(result).resolves.not.toThrow();
        else await expect(result).rejects.toBeInstanceOf(ForbiddenError);
      });
    }
  }
});
