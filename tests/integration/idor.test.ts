// Cross-workspace access: an actor in workspace A uses identifiers from workspace B.
// Every attempt must look like "not found" and change nothing.
import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "@/server/errors";
import {
  changeMemberRole,
  inviteMember,
  revokeInvitation,
  setMemberStatus,
} from "@/modules/workspaces/service";
import {
  createProject,
  getProjectByKey,
  listProjectMembers,
  setProjectArchived,
  setProjectMember,
  updateProject,
} from "@/modules/projects/service";
import { adminPool } from "../support/db";
import { createWorkspaceWithRoles } from "../support/factories";

let a: Awaited<ReturnType<typeof createWorkspaceWithRoles>>;
let b: Awaited<ReturnType<typeof createWorkspaceWithRoles>>;
let bProject: { id: string; key: string };
let bInvitation: string;

async function snapshot(): Promise<string> {
  const tables = ["workspace_members", "workspace_invitations", "projects", "project_members"];
  const parts = await Promise.all(
    tables.map(async (t) =>
      JSON.stringify((await adminPool().query(`select * from ${t} order by 1, 2`)).rows),
    ),
  );
  return parts.join("\n");
}

beforeEach(async () => {
  a = await createWorkspaceWithRoles("alpha");
  b = await createWorkspaceWithRoles("beta");
  bProject = await createProject(b.actors.owner, { name: "Beta site", key: "BETA" });
  bInvitation = (await inviteMember(b.actors.owner, { email: "pending@example.test", role: "member" }))
    .invitationId;
});

describe("cross-workspace access as workspace A's owner", () => {
  const attempts: Record<string, () => Promise<unknown>> = {
    "read B's project by key": () => getProjectByKey(a.actors.owner, bProject.key),
    "list B's project members": () => listProjectMembers(a.actors.owner, bProject.id),
    "update B's project": () => updateProject(a.actors.owner, bProject.id, { name: "pwned" }),
    "archive B's project": () => setProjectArchived(a.actors.owner, bProject.id, true),
    "add self to B's project": () =>
      setProjectMember(a.actors.owner, bProject.id, { userId: a.users.owner.id, role: "manager" }),
    "change a B member's role": () => changeMemberRole(a.actors.owner, b.users.member.id, "guest"),
    "deactivate a B member": () => setMemberStatus(a.actors.owner, b.users.member.id, "deactivated"),
    "revoke B's invitation": () => revokeInvitation(a.actors.owner, bInvitation),
  };

  for (const [name, attempt] of Object.entries(attempts)) {
    it(`cannot ${name}`, async () => {
      const before = await snapshot();
      await expect(attempt()).rejects.toBeInstanceOf(NotFoundError);
      expect(await snapshot()).toBe(before);
    });
  }

  it("cannot add a workspace A user to its own project via a forged B project id", async () => {
    const aProject = await createProject(a.actors.owner, { name: "Alpha", key: "ALPHA" });
    await expect(
      setProjectMember(a.actors.owner, aProject.id, { userId: b.users.member.id, role: "viewer" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("malformed identifiers from action arguments", () => {
  it("treats non-UUID ids as not found instead of database errors", async () => {
    for (const attempt of [
      () => updateProject(a.actors.owner, "not-a-uuid", { name: "x" }),
      () =>
        setProjectMember(a.actors.owner, "'; drop table projects; --", {
          userId: a.users.member.id,
          role: "viewer",
        }),
      () => changeMemberRole(a.actors.owner, "123", "guest"),
      () => setMemberStatus(a.actors.owner, "", "deactivated"),
      () => revokeInvitation(a.actors.owner, "../../etc"),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(NotFoundError);
    }
  });
});
