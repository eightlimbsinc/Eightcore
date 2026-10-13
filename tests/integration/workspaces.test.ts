import { describe, expect, it } from "vitest";
import { resolveActor } from "@/server/authz/actor";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  acceptInvitation,
  changeMemberRole,
  createWorkspace,
  inviteMember,
  listMembers,
  listWorkspacesForUser,
  previewInvitation,
  revokeInvitation,
  setMemberStatus,
} from "@/modules/workspaces/service";
import { createProject, listVisibleProjects, setProjectMember } from "@/modules/projects/service";
import { adminPool, count } from "../support/db";
import { createUser, createWorkspaceWithRoles } from "../support/factories";

describe("createWorkspace", () => {
  it("makes the creator the owner and records history in the same transaction", async () => {
    const user = await createUser();
    const ws = await createWorkspace(user.id, { name: "Acme", slug: "acme" });
    const actor = await resolveActor(user.id, "acme");
    expect(actor).toMatchObject({ workspaceId: ws.id, workspaceRole: "owner" });
    expect(await count("activity_events", "workspace_id = $1 and action = 'created'", [ws.id])).toBe(1);
    expect(await count("audit_log", "workspace_id = $1 and event = 'workspace.created'", [ws.id])).toBe(1);
    expect(await count("outbox_events", "workspace_id = $1", [ws.id])).toBe(1);
  });

  it("rejects a taken slug with a field error", async () => {
    const user = await createUser();
    await createWorkspace(user.id, { name: "Acme", slug: "acme" });
    await expect(createWorkspace(user.id, { name: "Acme 2", slug: "acme" })).rejects.toMatchObject({
      fieldErrors: { slug: expect.any(String) },
    });
  });

  it("lists only workspaces the user actively belongs to", async () => {
    const { users, actors } = await createWorkspaceWithRoles("alpha");
    await createWorkspaceWithRoles("beta");
    expect((await listWorkspacesForUser(users.member.id)).map((w) => w.slug)).toEqual(["alpha"]);
    await setMemberStatus(actors.owner, users.member.id, "deactivated");
    expect(await listWorkspacesForUser(users.member.id)).toEqual([]);
  });
});

describe("resolveActor", () => {
  it("returns NotFound for non-members and deactivated members", async () => {
    const { users, actors } = await createWorkspaceWithRoles("alpha");
    const outsider = await createUser();
    await expect(resolveActor(outsider.id, "alpha")).rejects.toBeInstanceOf(NotFoundError);
    await expect(resolveActor(users.member.id, "does-not-exist")).rejects.toBeInstanceOf(NotFoundError);
    await setMemberStatus(actors.owner, users.member.id, "deactivated");
    await expect(resolveActor(users.member.id, "alpha")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("picks up a role change on the next resolution", async () => {
    const { users, actors } = await createWorkspaceWithRoles("alpha");
    await changeMemberRole(actors.owner, users.admin.id, "member");
    expect((await resolveActor(users.admin.id, "alpha")).workspaceRole).toBe("member");
  });
});

describe("member management", () => {
  it("lets admins change member roles but not touch owners", async () => {
    const { users, actors } = await createWorkspaceWithRoles();
    await changeMemberRole(actors.admin, users.member.id, "guest");
    await expect(changeMemberRole(actors.admin, users.owner.id, "member")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(changeMemberRole(actors.admin, users.member.id, "owner")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(setMemberStatus(actors.admin, users.owner.id, "deactivated")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("never leaves a workspace without an active owner", async () => {
    const { users, actors } = await createWorkspaceWithRoles();
    await expect(changeMemberRole(actors.owner, users.owner.id, "admin")).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(setMemberStatus(actors.owner, users.owner.id, "deactivated")).rejects.toBeInstanceOf(
      ConflictError,
    );
    // With a second owner, the first can step down.
    await changeMemberRole(actors.owner, users.admin.id, "owner");
    await changeMemberRole(actors.owner, users.owner.id, "admin");
  });

  it("removes explicit project access when a member is deactivated", async () => {
    const { users, actors } = await createWorkspaceWithRoles();
    const project = await createProject(actors.owner, { name: "Secret", key: "SEC", visibility: "private" });
    await setProjectMember(actors.owner, project.id, { userId: users.member.id, role: "editor" });
    await setMemberStatus(actors.owner, users.member.id, "deactivated");
    expect(await count("project_members", "user_id = $1", [users.member.id])).toBe(0);
    await setMemberStatus(actors.owner, users.member.id, "active");
    expect((await listVisibleProjects(actors.member)).map((p) => p.key)).toEqual([]);
  });

  it("hides the member directory from guests", async () => {
    const { actors } = await createWorkspaceWithRoles();
    await expect(listMembers(actors.guest)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listMembers(actors.member)).toHaveLength(4);
  });
});

describe("invitations", () => {
  it("lets an invited user with the matching verified email join with the invited role", async () => {
    const { workspace, actors } = await createWorkspaceWithRoles("alpha");
    const { token } = await inviteMember(actors.admin, { email: "New.Person@Example.test", role: "member" });
    expect(await previewInvitation(token)).toMatchObject({
      status: "valid",
      email: "new.person@example.test",
      role: "member",
    });

    const invitee = await createUser({ email: "new.person@example.test" });
    const result = await acceptInvitation(invitee, token);
    expect(result.workspaceSlug).toBe(workspace.slug);
    expect((await resolveActor(invitee.id, "alpha")).workspaceRole).toBe("member");
    // Single use.
    expect(await previewInvitation(token)).toEqual({ status: "invalid" });
    await expect(acceptInvitation(invitee, token)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("stores only a hash of the token", async () => {
    const { actors } = await createWorkspaceWithRoles();
    const { token } = await inviteMember(actors.owner, { email: "x@example.test", role: "guest" });
    expect(await count("workspace_invitations", "token_hash = $1", [token])).toBe(0);
  });

  it("rejects a different email, an unverified email, and expired or revoked invitations", async () => {
    const { actors } = await createWorkspaceWithRoles();
    const { token } = await inviteMember(actors.owner, { email: "right@example.test", role: "member" });
    const wrong = await createUser({ email: "wrong@example.test" });
    await expect(acceptInvitation(wrong, token)).rejects.toBeInstanceOf(ValidationError);
    const unverified = await createUser({ email: "right@example.test", emailVerified: false });
    await expect(acceptInvitation(unverified, token)).rejects.toBeInstanceOf(ValidationError);

    const second = await inviteMember(actors.owner, { email: "late@example.test", role: "member" });
    await adminPool().query(
      "update workspace_invitations set expires_at = now() - interval '1 second' where id = $1",
      [second.invitationId],
    );
    const late = await createUser({ email: "late@example.test" });
    await expect(acceptInvitation(late, second.token)).rejects.toBeInstanceOf(NotFoundError);

    const third = await inviteMember(actors.owner, { email: "revoked@example.test", role: "member" });
    await revokeInvitation(actors.owner, third.invitationId);
    const revoked = await createUser({ email: "revoked@example.test" });
    await expect(acceptInvitation(revoked, third.token)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects duplicates and existing members", async () => {
    const { users, actors } = await createWorkspaceWithRoles();
    await inviteMember(actors.owner, { email: "dup@example.test", role: "member" });
    await expect(
      inviteMember(actors.owner, { email: "DUP@example.test", role: "guest" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      inviteMember(actors.owner, { email: users.member.email, role: "guest" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("cannot invite owners", async () => {
    const { actors } = await createWorkspaceWithRoles();
    // @ts-expect-error owner is not an invitable role
    await expect(inviteMember(actors.owner, { email: "o@example.test", role: "owner" })).rejects.toThrow();
  });
});
