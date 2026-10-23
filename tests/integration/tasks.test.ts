import { describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { db } from "@/server/db";
import { createProject, setProjectMember } from "@/modules/projects/service";
import { createList, listStatusesFor } from "@/modules/lists/service";
import {
  createTask,
  getTaskByRef,
  listAssignableMembers,
  listTasks,
  setTaskArchived,
  setTaskAssignees,
  updateTask,
} from "@/modules/tasks/service";
import { adminPool } from "../support/db";
import { actorFor, createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const project = await createProject(ctx.actors.owner, { name: "Website", key: "WEB" });
  const list = await createList(ctx.actors.owner, project.id, { name: "Build", template: "simple" });
  const statuses = await listStatusesFor(db(), list.id);
  return { ...ctx, project, list, statuses };
}

describe("creating tasks", () => {
  it("numbers tasks per project and defaults to the list's first status", async () => {
    const { actors, list, statuses } = await setup();
    const a = await createTask(actors.member, list.id, { title: "First" });
    const b = await createTask(actors.member, list.id, { title: "Second" });
    expect([a.ref, b.ref]).toEqual(["WEB-1", "WEB-2"]);
    const other = await createProject(actors.owner, { name: "Ops", key: "OPS" });
    const otherList = await createList(actors.owner, other.id, { name: "L" });
    expect((await createTask(actors.member, otherList.id, { title: "Elsewhere" })).ref).toBe("OPS-1");
    expect((await getTaskByRef(actors.member, a.ref)).task.statusId).toBe(statuses[0]!.id);
    expect((await listTasks(actors.member, list.id)).map((t) => t.title)).toEqual(["First", "Second"]);
  });

  it("refuses a status from another list", async () => {
    const { actors, project, list } = await setup();
    const other = await createList(actors.owner, project.id, { name: "Other" });
    const [foreign] = await listStatusesFor(db(), other.id);
    await expect(
      createTask(actors.member, list.id, { title: "X", statusId: foreign!.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("enforces status ownership in the database too", async () => {
    const { actors, project, list } = await setup();
    const other = await createList(actors.owner, project.id, { name: "Other" });
    const [foreign] = await listStatusesFor(db(), other.id);
    const task = await createTask(actors.member, list.id, { title: "X" });
    await expect(
      adminPool().query("update tasks set status_id = $1 where id = $2", [foreign!.id, task.id]),
    ).rejects.toMatchObject({ code: "23503", constraint: "tasks_status_fk" });
  });
});

describe("subtasks", () => {
  it("nests subtasks, counts them, and links back to the parent", async () => {
    const { actors, list } = await setup();
    const parent = await createTask(actors.member, list.id, { title: "Parent" });
    await createTask(actors.member, list.id, { title: "Child A", parentTaskId: parent.id });
    await createTask(actors.member, list.id, { title: "Child B", parentTaskId: parent.id });
    const rows = await listTasks(actors.member, list.id);
    expect(rows.find((r) => r.parentTaskId === null)).toMatchObject({ title: "Parent", subtaskCount: 2 });
    // The list includes subtasks, pointing at their parent, so the list view can expand them.
    expect(rows.filter((r) => r.parentTaskId === parent.id).map((r) => r.title)).toEqual([
      "Child A",
      "Child B",
    ]);
    const detail = await getTaskByRef(actors.member, parent.ref);
    expect(detail.subtasks.map((s) => s.title)).toEqual(["Child A", "Child B"]);
    const child = await getTaskByRef(actors.member, detail.subtasks[0]!.ref);
    expect(child.parent?.ref).toBe(parent.ref);
  });

  it("leaves out subtasks of an archived parent", async () => {
    const { actors, list } = await setup();
    const parent = await createTask(actors.member, list.id, { title: "Parent" });
    const child = await createTask(actors.member, list.id, { title: "Child", parentTaskId: parent.id });
    await createTask(actors.member, list.id, { title: "Grandchild", parentTaskId: child.id });
    await setTaskArchived(actors.member, parent.id, true);
    expect(await listTasks(actors.member, list.id)).toEqual([]);
  });

  it("allows at most 5 levels below a top-level task", async () => {
    const { actors, list } = await setup();
    let parentId = (await createTask(actors.member, list.id, { title: "Level 0" })).id;
    for (let level = 1; level <= 5; level++) {
      parentId = (
        await createTask(actors.member, list.id, { title: `Level ${level}`, parentTaskId: parentId })
      ).id;
    }
    await expect(
      createTask(actors.member, list.id, { title: "Level 6", parentTaskId: parentId }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses cycles at the database level", async () => {
    const { actors, list } = await setup();
    const a = await createTask(actors.member, list.id, { title: "A" });
    const b = await createTask(actors.member, list.id, { title: "B", parentTaskId: a.id });
    await expect(
      adminPool().query("update tasks set parent_task_id = $1 where id = $2", [b.id, a.id]),
    ).rejects.toMatchObject({
      constraint: "tasks_no_cycles",
    });
  });

  it("keeps subtasks in their parent's list", async () => {
    const { actors, project, list } = await setup();
    const parent = await createTask(actors.member, list.id, { title: "Parent" });
    const other = await createList(actors.owner, project.id, { name: "Other" });
    await expect(
      createTask(actors.member, other.id, { title: "X", parentTaskId: parent.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("updating tasks", () => {
  it("records changes, tracks completion, and bumps the version", async () => {
    const { actors, list, statuses } = await setup();
    const task = await createTask(actors.member, list.id, { title: "Draft" });
    const done = statuses.find((s) => s.category === "done")!;
    const { version } = await updateTask(actors.member, task.id, 1, {
      title: "Final",
      statusId: done.id,
      priority: "high",
      dueDate: "2026-11-30",
    });
    expect(version).toBe(2);
    const detail = await getTaskByRef(actors.member, task.ref);
    expect(detail.task).toMatchObject({ title: "Final", priority: "high", dueDate: "2026-11-30" });
    expect(detail.task.completedAt).not.toBeNull();
    const updated = detail.activity.find((a) => a.action === "updated");
    expect(updated?.changes).toMatchObject({ status: ["To Do", "Done"], title: ["Draft", "Final"] });

    await updateTask(actors.member, task.id, 2, { statusId: statuses[0]!.id });
    expect((await getTaskByRef(actors.member, task.ref)).task.completedAt).toBeNull();
  });

  it("rejects a stale version instead of overwriting someone else's change", async () => {
    const { actors, list } = await setup();
    const task = await createTask(actors.member, list.id, { title: "Draft" });
    await updateTask(actors.admin, task.id, 1, { title: "Admin's edit" });
    await expect(updateTask(actors.member, task.id, 1, { title: "Member's edit" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await getTaskByRef(actors.member, task.ref)).task.title).toBe("Admin's edit");
  });

  it("validates date order", async () => {
    const { actors, list } = await setup();
    const task = await createTask(actors.member, list.id, { title: "T", dueDate: "2026-11-01" });
    await expect(updateTask(actors.member, task.id, 1, { startDate: "2026-12-01" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("assignees", () => {
  it("assigns several people who can see the project", async () => {
    const { actors, users, list } = await setup();
    const task = await createTask(actors.member, list.id, { title: "T" });
    await setTaskAssignees(actors.member, task.id, [users.member.id, users.admin.id]);
    expect((await getTaskByRef(actors.member, task.ref)).assignees.map((a) => a.userId).sort()).toEqual(
      [users.member.id, users.admin.id].sort(),
    );
    await setTaskAssignees(actors.member, task.id, [users.admin.id]);
    expect((await getTaskByRef(actors.member, task.ref)).assignees.map((a) => a.userId)).toEqual([
      users.admin.id,
    ]);
  });

  it("refuses people who can't see the project, or from another workspace", async () => {
    const { actors, users, project, list } = await setup();
    const task = await createTask(actors.member, list.id, { title: "T" });
    await expect(setTaskAssignees(actors.member, task.id, [users.guest.id])).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const other = await createWorkspaceWithRoles();
    await expect(setTaskAssignees(actors.member, task.id, [other.users.member.id])).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await setProjectMember(actors.owner, project.id, { userId: users.guest.id, role: "commenter" });
    await setTaskAssignees(actors.member, task.id, [users.guest.id]);
    expect((await listAssignableMembers(actors.member, project.id)).map((m) => m.userId)).toContain(
      users.guest.id,
    );
  });
});

describe("task permissions", () => {
  it("lets viewers read but not edit, and editors archive only their own tasks", async () => {
    const { actors, users, workspace, project, list } = await setup();
    const ownersTask = await createTask(actors.owner, list.id, { title: "Owner's" });
    const membersTask = await createTask(actors.member, list.id, { title: "Member's" });
    await expect(setTaskArchived(actors.member, ownersTask.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await setTaskArchived(actors.member, membersTask.id, true);
    expect((await listTasks(actors.member, list.id)).map((t) => t.title)).toEqual(["Owner's"]);

    await setProjectMember(actors.owner, project.id, { userId: users.guest.id, role: "viewer" });
    const guest = actorFor(users.guest, workspace, "guest");
    expect((await getTaskByRef(guest, ownersTask.ref)).can).toMatchObject({ update: false, archive: false });
    await expect(updateTask(guest, ownersTask.id, 1, { title: "Nope" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(createTask(guest, list.id, { title: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns 404 for tasks in projects the caller can't see", async () => {
    const { actors } = await setup();
    const secret = await createProject(actors.owner, { name: "Secret", key: "SEC", visibility: "private" });
    const list = await createList(actors.owner, secret.id, { name: "L" });
    const task = await createTask(actors.owner, list.id, { title: "Hidden" });
    await expect(getTaskByRef(actors.member, task.ref)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateTask(actors.member, task.id, 1, { title: "x" })).rejects.toBeInstanceOf(NotFoundError);
    const other = await createWorkspaceWithRoles();
    await expect(getTaskByRef(other.actors.owner, task.ref)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getTaskByRef(actors.owner, "garbage")).rejects.toBeInstanceOf(NotFoundError);
  });
});
