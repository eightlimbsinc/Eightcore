import { describe, expect, it } from "vitest";
import { ValidationError } from "@/server/errors";
import { db } from "@/server/db";
import { createProject } from "@/modules/projects/service";
import { createList, listStatusesFor } from "@/modules/lists/service";
import { createTask, getTaskByRef, listTasks, updateTask } from "@/modules/tasks/service";
import { BULK_LIMIT, bulkUpdateTasks } from "@/modules/tasks/bulk";
import { createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const project = await createProject(ctx.actors.owner, { name: "Website", key: "WEB" });
  const list = await createList(ctx.actors.owner, project.id, { name: "Build", template: "simple" });
  const statuses = await listStatusesFor(db(), list.id);
  const a = await createTask(ctx.actors.owner, list.id, { title: "A" });
  const b = await createTask(ctx.actors.member, list.id, { title: "B" });
  return { ...ctx, project, list, statuses, a, b };
}

describe("bulk task actions", () => {
  it("sets status, priority, due date and assignees on every selected task", async () => {
    const { actors, users, list, statuses, a, b } = await setup();
    const done = statuses.at(-1)!;
    const ids = [a.id, b.id];
    expect(await bulkUpdateTasks(actors.member, list.id, ids, { kind: "status", statusId: done.id })).toEqual({
      done: 2,
      skipped: 0,
    });
    await bulkUpdateTasks(actors.member, list.id, ids, { kind: "priority", priority: "high" });
    await bulkUpdateTasks(actors.member, list.id, ids, { kind: "dueDate", dueDate: "2026-11-02" });
    await bulkUpdateTasks(actors.member, list.id, ids, { kind: "assign", userId: users.member.id });
    // Assigning again keeps existing assignees and adds the new person once.
    await bulkUpdateTasks(actors.member, list.id, ids, { kind: "assign", userId: users.owner.id });
    for (const ref of [a.ref, b.ref]) {
      const { task, assignees } = await getTaskByRef(actors.member, ref);
      expect(task).toMatchObject({ statusId: done.id, priority: "high", dueDate: "2026-11-02" });
      expect(task.completedAt).not.toBeNull();
      expect(assignees.map((p) => p.userId).sort()).toEqual([users.member.id, users.owner.id].sort());
    }
    await bulkUpdateTasks(actors.member, list.id, ids, { kind: "unassign" });
    expect((await getTaskByRef(actors.member, a.ref)).assignees).toEqual([]);
  });

  it("skips tasks the actor may not change and says why", async () => {
    const { actors, list, a, b } = await setup();
    // Editors archive only their own tasks: B is the member's, A is the owner's.
    const result = await bulkUpdateTasks(actors.member, list.id, [a.id, b.id], { kind: "archive" });
    expect(result).toMatchObject({ done: 1, skipped: 1, reason: expect.stringMatching(/permission/) });
    expect((await listTasks(actors.member, list.id)).map((t) => t.title)).toEqual(["A"]);
  });

  it("skips a task whose start date is after the new due date", async () => {
    const { actors, list, a, b } = await setup();
    await updateTask(actors.owner, a.id, 1, { startDate: "2026-12-01" });
    const result = await bulkUpdateTasks(actors.owner, list.id, [a.id, b.id], {
      kind: "dueDate",
      dueDate: "2026-11-01",
    });
    expect(result).toMatchObject({ done: 1, skipped: 1, reason: expect.stringMatching(/start date/) });
  });

  it("deletes parents with their selected subtasks", async () => {
    const { actors, list, a, b } = await setup();
    const child = await createTask(actors.owner, list.id, { title: "Child", parentTaskId: a.id });
    const result = await bulkUpdateTasks(actors.owner, list.id, [child.id, a.id, b.id], { kind: "delete" });
    expect(result).toEqual({ done: 3, skipped: 0 });
    expect(await listTasks(actors.owner, list.id)).toEqual([]);
  });

  it("ignores tasks from other lists, projects or workspaces", async () => {
    const { actors, project, list, a } = await setup();
    const other = await createList(actors.owner, project.id, { name: "Other" });
    const elsewhere = await createTask(actors.owner, other.id, { title: "Elsewhere" });
    const foreign = await setup();
    const result = await bulkUpdateTasks(actors.owner, list.id, [a.id, elsewhere.id, foreign.a.id], {
      kind: "priority",
      priority: "urgent",
    });
    expect(result).toMatchObject({ done: 1, skipped: 2 });
    expect((await getTaskByRef(actors.owner, elsewhere.ref)).task.priority).toBe("none");
    expect((await getTaskByRef(foreign.actors.owner, foreign.a.ref)).task.priority).toBe("none");
  });

  it("refuses viewers, empty and oversized selections", async () => {
    const { actors, list, a } = await setup();
    // Guests can't see the (workspace-visible) project's tasks to change them.
    const asGuest = await bulkUpdateTasks(actors.guest, list.id, [a.id], { kind: "priority", priority: "low" });
    expect(asGuest.done).toBe(0);
    await expect(bulkUpdateTasks(actors.owner, list.id, [], { kind: "archive" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const many = Array.from({ length: BULK_LIMIT + 1 }, () => crypto.randomUUID());
    await expect(bulkUpdateTasks(actors.owner, list.id, many, { kind: "archive" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
