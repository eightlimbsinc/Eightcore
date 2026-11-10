// Members on an allowed email domain may invite guests (only guests); owners and admins always can.
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { ForbiddenError } from "@/server/errors";
import { workspaceMembers } from "@/server/db/schema";
import { canInviteGuests, inviteMember, setGuestInviterDomains } from "@/modules/workspaces/service";
import { createProject, setProjectMember } from "@/modules/projects/service";
import { createList } from "@/modules/lists/service";
import { getListSharing, inviteGuestToList } from "@/modules/projects/sharing";
import { actorFor, createUser, createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const staff = await createUser({ email: "edward@8limbsinc.net" });
  await db()
    .insert(workspaceMembers)
    .values({ workspaceId: ctx.workspace.id, userId: staff.id, role: "member" });
  return { ...ctx, staff: actorFor(staff, ctx.workspace, "member"), staffId: staff.id };
}

describe("who can invite guests", () => {
  it("members can't, until their email domain is allowed; then guests only", async () => {
    const { actors, staff } = await setup();
    expect(await canInviteGuests(staff)).toBe(false);
    await expect(
      inviteMember(staff, { email: "client@blend360.test", role: "guest" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setGuestInviterDomains(actors.member, ["8limbsinc.net"])).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(setGuestInviterDomains(actors.owner, ["not a domain"])).rejects.toThrow();

    expect(await setGuestInviterDomains(actors.admin, ["@8LimbsInc.net", "8limbsinc.net"])).toEqual([
      "8limbsinc.net",
    ]);
    expect(await canInviteGuests(staff)).toBe(true);
    await expect(inviteMember(staff, { email: "client@blend360.test", role: "guest" })).resolves.toBeTruthy();
    await expect(inviteMember(staff, { email: "new@8limbsinc.net", role: "member" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // A member on another domain (the factory's) still can't; guests never can.
    expect(await canInviteGuests(actors.member)).toBe(false);
    expect(await canInviteGuests(actors.guest)).toBe(false);
    expect(await canInviteGuests(actors.owner)).toBe(true);
  });

  it("a project manager on the allowed domain can invite a guest straight to a list", async () => {
    const { actors, staff, staffId } = await setup();
    await setGuestInviterDomains(actors.owner, ["8limbsinc.net"]);
    const project = await createProject(actors.owner, { name: "Blend", key: "BLD" });
    const list = await createList(actors.owner, project.id, { name: "Website", template: "simple" });
    await setProjectMember(actors.owner, project.id, { userId: staffId, role: "manager" });
    expect((await getListSharing(staff, list.id)).canInvite).toBe(true);
    const { token } = await inviteGuestToList(staff, list.id, {
      email: "sofia@blend360.test",
      role: "commenter",
    });
    expect(token).toBeTruthy();
  });
});
