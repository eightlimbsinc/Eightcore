import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  createProject,
  getProjectByKey,
  listProjectMembers,
  listVisibleProjects,
  setProjectArchived,
  setProjectMember,
  updateProject,
} from "@/modules/projects/service";
import { count } from "../support/db";
import { createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const open = await createProject(ctx.actors.owner, { name: "Website", key: "WEB" });
  const secret = await createProject(ctx.actors.owner, {
    name: "Pitch",
    key: "PITCH",
    visibility: "private",
  });
  return { ...ctx, open, secret };
}

describe("project visibility", () => {
  it("shows owners and admins everything, members open projects, guests only shared ones", async () => {
    const { actors } = await setup();
    const keys = async (a: typeof actors.owner) => (await listVisibleProjects(a)).map((p) => p.key);
    expect(await keys(actors.owner)).toEqual(["PITCH", "WEB"]);
    expect(await keys(actors.admin)).toEqual(["PITCH", "WEB"]);
    expect(await keys(actors.member)).toEqual(["WEB"]);
    expect(await keys(actors.guest)).toEqual([]);
  });

  it("returns 404, not 403, for projects the caller can't see", async () => {
    const { actors } = await setup();
    await expect(getProjectByKey(actors.member, "PITCH")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getProjectByKey(actors.guest, "WEB")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("opens a private project to an explicitly added member", async () => {
    const { users, actors, secret } = await setup();
    await setProjectMember(actors.owner, secret.id, { userId: users.member.id, role: "viewer" });
    const project = await getProjectByKey(actors.member, "PITCH");
    expect(project).toMatchObject({ role: "viewer", can: { update: false, manageMembers: false } });
    await expect(updateProject(actors.member, secret.id, { name: "Renamed" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("caps guests at editor", async () => {
    const { users, actors, open } = await setup();
    await setProjectMember(actors.owner, open.id, { userId: users.guest.id, role: "manager" });
    expect((await getProjectByKey(actors.guest, "WEB")).role).toBe("editor");
    expect(
      (await listProjectMembers(actors.owner, open.id)).find((m) => m.userId === users.guest.id)?.role,
    ).toBe("editor");
  });
});

describe("project changes", () => {
  it("lets members create projects but not guests", async () => {
    const { actors } = await setup();
    await createProject(actors.member, { name: "Mine", key: "MINE" });
    await expect(createProject(actors.guest, { name: "No", key: "NO" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("rejects duplicate keys in a workspace", async () => {
    const { actors } = await setup();
    await expect(createProject(actors.owner, { name: "Again", key: "web" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("records only real changes in activity", async () => {
    const { actors, open } = await setup();
    await updateProject(actors.owner, open.id, { name: "Website", description: "" });
    expect(await count("activity_events", "entity_id = $1 and action = 'updated'", [open.id])).toBe(0);
    await updateProject(actors.owner, open.id, { name: "Website 2" });
    expect(await count("activity_events", "entity_id = $1 and action = 'updated'", [open.id])).toBe(1);
  });

  it("only managers archive; archived projects leave the list", async () => {
    const { actors, open } = await setup();
    await expect(setProjectArchived(actors.member, open.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await setProjectArchived(actors.admin, open.id, true);
    expect((await listVisibleProjects(actors.member)).map((p) => p.key)).toEqual([]);
  });

  it("refuses to add someone who isn't an active workspace member", async () => {
    const { actors, open } = await setup();
    const other = await createWorkspaceWithRoles();
    await expect(
      setProjectMember(actors.owner, open.id, { userId: other.users.member.id, role: "editor" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
