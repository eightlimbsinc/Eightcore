import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createProject, setProjectMember } from "@/modules/projects/service";
import {
  addStatus,
  createFolder,
  createList,
  deleteFolder,
  deleteStatus,
  getList,
  getProjectTree,
  listStatusesFor,
  moveStatus,
  saveListView,
  setListViewProtected,
  updateStatus,
} from "@/modules/lists/service";
import { createTask, getTaskByRef } from "@/modules/tasks/service";
import { db } from "@/server/db";
import { createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const project = await createProject(ctx.actors.owner, { name: "Website", key: "WEB" });
  return { ...ctx, project };
}

const names = async (listId: string) => (await listStatusesFor(db(), listId)).map((s) => s.name);

describe("lists and their statuses", () => {
  it("seeds statuses from the chosen template, in order", async () => {
    const { actors, project } = await setup();
    const agency = await createList(actors.owner, project.id, { name: "Build", template: "agency" });
    const simple = await createList(actors.owner, project.id, { name: "Admin", template: "simple" });
    expect(await names(agency.id)).toEqual([
      "Backlog",
      "To Do",
      "Ready for Dev",
      "In Development",
      "Ready to Test",
      "Testing in Staging",
      "Final Review",
      "Push to Production",
      "Accepted",
      "Cancelled",
    ]);
    expect(await names(simple.id)).toEqual(["To Do", "In Progress", "Done"]);
  });

  it("customises each list's statuses independently", async () => {
    const { actors, project } = await setup();
    const a = await createList(actors.owner, project.id, { name: "A", template: "simple" });
    const b = await createList(actors.owner, project.id, { name: "B", template: "simple" });
    const [todoA] = await listStatusesFor(db(), a.id);
    await updateStatus(actors.owner, todoA!.id, { name: "Inbox", category: "backlog", color: "#112233" });
    await addStatus(actors.owner, a.id, { name: "Blocked", category: "active", color: "#EF4444" });
    expect(await names(a.id)).toEqual(["Inbox", "In Progress", "Done", "Blocked"]);
    expect(await names(b.id)).toEqual(["To Do", "In Progress", "Done"]);
  });

  it("rejects duplicate names within a list, case-insensitively", async () => {
    const { actors, project } = await setup();
    const list = await createList(actors.owner, project.id, { name: "A", template: "simple" });
    await expect(
      addStatus(actors.owner, list.id, { name: "done", category: "done", color: "#000000" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("reorders statuses", async () => {
    const { actors, project } = await setup();
    const list = await createList(actors.owner, project.id, { name: "A", template: "simple" });
    const statuses = await listStatusesFor(db(), list.id);
    await moveStatus(actors.owner, statuses[2]!.id, "up");
    expect(await names(list.id)).toEqual(["To Do", "Done", "In Progress"]);
    await moveStatus(actors.owner, statuses[2]!.id, "up");
    expect(await names(list.id)).toEqual(["Done", "To Do", "In Progress"]);
    await moveStatus(actors.owner, statuses[2]!.id, "up"); // already first: no-op
    expect(await names(list.id)).toEqual(["Done", "To Do", "In Progress"]);
    await moveStatus(actors.owner, statuses[0]!.id, "down");
    expect(await names(list.id)).toEqual(["Done", "In Progress", "To Do"]);
  });

  it("moves tasks to a replacement when a status is deleted, and keeps at least one status", async () => {
    const { actors, project } = await setup();
    const list = await createList(actors.owner, project.id, { name: "A", template: "simple" });
    const [todo, doing, done] = await listStatusesFor(db(), list.id);
    const task = await createTask(actors.owner, list.id, { title: "Ship it", statusId: todo!.id });
    await deleteStatus(actors.owner, todo!.id, done!.id);
    const detail = await getTaskByRef(actors.owner, task.ref);
    expect(detail.task.statusId).toBe(done!.id);
    expect(detail.task.completedAt).not.toBeNull();
    await deleteStatus(actors.owner, doing!.id, done!.id);
    await expect(deleteStatus(actors.owner, done!.id, done!.id)).rejects.toBeInstanceOf(ValidationError);
    const other = await createList(actors.owner, project.id, { name: "B", template: "simple" });
    const [otherStatus] = await listStatusesFor(db(), other.id);
    await expect(deleteStatus(actors.owner, done!.id, otherStatus!.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("marks tasks finished when their status's category becomes done", async () => {
    const { actors, project } = await setup();
    const list = await createList(actors.owner, project.id, { name: "A", template: "simple" });
    const [, doing] = await listStatusesFor(db(), list.id);
    const task = await createTask(actors.owner, list.id, { title: "T", statusId: doing!.id });
    await updateStatus(actors.owner, doing!.id, { name: "Shipped", category: "done", color: "#22C55E" });
    expect((await getTaskByRef(actors.owner, task.ref)).task.completedAt).not.toBeNull();
  });
});

describe("folders", () => {
  it("groups lists, and deleting a folder moves its lists to the project root", async () => {
    const { actors, project } = await setup();
    const folder = await createFolder(actors.owner, project.id, { name: "Phase 1" });
    const inFolder = await createList(actors.owner, project.id, { name: "Design", folderId: folder.id });
    await createList(actors.owner, project.id, { name: "Ops" });
    let tree = await getProjectTree(actors.owner, project.id);
    expect(tree.folders.map((f) => [f.name, f.lists.map((l) => l.name)])).toEqual([["Phase 1", ["Design"]]]);
    expect(tree.rootLists.map((l) => l.name)).toEqual(["Ops"]);
    await deleteFolder(actors.owner, folder.id);
    tree = await getProjectTree(actors.owner, project.id);
    expect(tree.folders).toEqual([]);
    expect(tree.rootLists.map((l) => l.id)).toContain(inFolder.id);
  });

  it("refuses a folder from another project", async () => {
    const { actors, project } = await setup();
    const other = await createProject(actors.owner, { name: "Other", key: "OTH" });
    const folder = await createFolder(actors.owner, other.id, { name: "Elsewhere" });
    await expect(
      createList(actors.owner, project.id, { name: "X", folderId: folder.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("list permissions", () => {
  it("lets only managers manage lists and statuses", async () => {
    const { actors, project, users } = await setup();
    await expect(createList(actors.member, project.id, { name: "Nope" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const list = await createList(actors.admin, project.id, { name: "Yes" });
    await expect(
      addStatus(actors.member, list.id, { name: "X", category: "active", color: "#000000" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await setProjectMember(actors.owner, project.id, { userId: users.member.id, role: "manager" });
    await addStatus(actors.member, list.id, { name: "X", category: "active", color: "#000000" });
  });

  it("hides lists of private projects and other workspaces (404)", async () => {
    const { actors } = await setup();
    const secret = await createProject(actors.owner, { name: "Secret", key: "SEC", visibility: "private" });
    const list = await createList(actors.owner, secret.id, { name: "Hidden" });
    await expect(getList(actors.member, list.id)).rejects.toBeInstanceOf(NotFoundError);
    const other = await createWorkspaceWithRoles();
    await expect(getList(other.actors.owner, list.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getList(other.actors.owner, "not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("saved list views", () => {
  it("saves a view for everyone; once protected, only managers can change it", async () => {
    const { actors, project } = await setup();
    const list = await createList(actors.owner, project.id, { name: "Build" });
    // The member is an editor on this workspace-visible project.
    await saveListView(actors.member, list.id, { order: "desc", subtasks: "expanded", junk: 1 });
    expect((await getList(actors.owner, list.id)).view).toEqual({
      order: "desc",
      subtasks: "expanded",
      closed: "show",
    });

    await expect(setListViewProtected(actors.member, list.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await setListViewProtected(actors.owner, list.id, true);
    await expect(saveListView(actors.member, list.id, { order: "asc" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await getList(actors.member, list.id)).can.saveView).toBe(false);
    await saveListView(actors.owner, list.id, { closed: "hide" });
    expect((await getList(actors.member, list.id)).view).toEqual({
      order: "asc",
      subtasks: "collapsed",
      closed: "hide",
    });
  });
});
