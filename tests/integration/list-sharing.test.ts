// A list's Share & permissions: add, change and remove guests; invite a new guest to the list.
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { projectMembers } from "@/server/db/schema";
import { createProject, setProjectMember } from "@/modules/projects/service";
import { createList, getProjectTree } from "@/modules/lists/service";
import { listTasks } from "@/modules/tasks/service";
import { acceptInvitation } from "@/modules/workspaces/service";
import { resolveActor } from "@/server/authz/actor";
import {
  getListSharing,
  inviteGuestToList,
  shareListWithGuest,
  unshareListFromGuest,
} from "@/modules/projects/sharing";
import { createUser, createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const project = await createProject(ctx.actors.owner, { name: "Blend", key: "BLD" });
  const website = await createList(ctx.actors.owner, project.id, { name: "Website", template: "simple" });
  const podcasts = await createList(ctx.actors.owner, project.id, { name: "Podcasts", template: "simple" });
  return { ...ctx, project, website, podcasts };
}
const membership = async (projectId: string, userId: string) =>
  (
    await db()
      .select({ role: projectMembers.role, listIds: projectMembers.listIds })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
  )[0];

describe("list sharing", () => {
  it("shares a list with a guest, changes their access, and takes it away", async () => {
    const { actors, users, project, website, podcasts } = await setup();
    let sharing = await getListSharing(actors.owner, website.id);
    expect(sharing.guests).toEqual([]);
    expect(sharing.candidates.map((c) => c.userId)).toEqual([users.guest.id]);

    await shareListWithGuest(actors.owner, website.id, { userId: users.guest.id, role: "commenter" });
    expect(await membership(project.id, users.guest.id)).toEqual({
      role: "commenter",
      listIds: [website.id],
    });
    expect((await getProjectTree(actors.guest, project.id)).rootLists.map((l) => l.name)).toEqual([
      "Website",
    ]);
    await expect(listTasks(actors.guest, podcasts.id)).rejects.toBeInstanceOf(NotFoundError);

    // A second list adds to the first; the role follows the latest choice.
    await shareListWithGuest(actors.owner, podcasts.id, { userId: users.guest.id, role: "editor" });
    expect(await membership(project.id, users.guest.id)).toEqual({
      role: "editor",
      listIds: [website.id, podcasts.id],
    });
    sharing = await getListSharing(actors.owner, website.id);
    expect(sharing.guests).toMatchObject([{ userId: users.guest.id, role: "editor", scope: "list" }]);

    await unshareListFromGuest(actors.owner, website.id, users.guest.id);
    expect((await membership(project.id, users.guest.id))?.listIds).toEqual([podcasts.id]);
    await unshareListFromGuest(actors.owner, podcasts.id, users.guest.id);
    expect(await membership(project.id, users.guest.id)).toBeUndefined(); // no lists left: off the project
  });

  it("a whole-project guest keeps the other lists when one is unshared", async () => {
    const { actors, users, project, website, podcasts } = await setup();
    await setProjectMember(actors.owner, project.id, {
      userId: users.guest.id,
      role: "viewer",
      listIds: null,
    });
    expect((await getListSharing(actors.owner, website.id)).guests[0]?.scope).toBe("project");
    await unshareListFromGuest(actors.owner, website.id, users.guest.id);
    expect((await membership(project.id, users.guest.id))?.listIds).toEqual([podcasts.id]);
  });

  it("only guests, only by project managers", async () => {
    const { actors, users, website } = await setup();
    await expect(
      shareListWithGuest(actors.owner, website.id, { userId: users.member.id, role: "viewer" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(getListSharing(actors.member, website.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      shareListWithGuest(actors.member, website.id, { userId: users.guest.id, role: "viewer" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      inviteGuestToList(actors.owner, website.id, { email: users.member.email, role: "viewer" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("invites a new guest straight to a list; accepting gives exactly those lists", async () => {
    const { actors, workspace, project, website, podcasts } = await setup();
    const first = await inviteGuestToList(actors.owner, website.id, {
      email: "Sofia@Blend360.test",
      role: "commenter",
    });
    expect(first.token).toBeTruthy();
    // Invited again from another list: no second invitation, the list is added to the first.
    const again = await inviteGuestToList(actors.owner, podcasts.id, {
      email: "sofia@blend360.test",
      role: "commenter",
    });
    expect(again.token).toBeNull();
    expect((await getListSharing(actors.owner, podcasts.id)).pending.map((p) => p.email)).toEqual([
      "sofia@blend360.test",
    ]);

    const sofia = await createUser({ email: "sofia@blend360.test" });
    await acceptInvitation(sofia, first.token!);
    const actor = await resolveActor(sofia.id, workspace.slug);
    expect(actor.workspaceRole).toBe("guest");
    expect(await membership(project.id, sofia.id)).toEqual({
      role: "commenter",
      listIds: [website.id, podcasts.id],
    });
    expect((await getProjectTree(actor, project.id)).rootLists.map((l) => l.name).sort()).toEqual([
      "Podcasts",
      "Website",
    ]);
  });
});
