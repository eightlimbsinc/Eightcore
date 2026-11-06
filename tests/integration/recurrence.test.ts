import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createProject } from "@/modules/projects/service";
import { createList, listStatusesFor } from "@/modules/lists/service";
import {
  createTask,
  getTaskByRef,
  listTasks,
  moveTask,
  setTaskAssignees,
  updateTask,
} from "@/modules/tasks/service";
import { createTag, setTaskTags } from "@/modules/tags/service";
import { createField, setTaskFieldValues, getTaskFields } from "@/modules/fields/service";
import { createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const project = await createProject(ctx.actors.owner, { name: "Website", key: "WEB" });
  const list = await createList(ctx.actors.owner, project.id, { name: "Ops", template: "agency" });
  const statuses = await listStatusesFor(db(), list.id);
  const s = (name: string) => statuses.find((x) => x.name === name)!;
  return { ...ctx, project, list, s };
}

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe("repeating tasks", () => {
  it("creates the next occurrence when one is done, with everything copied and dates moved on", async () => {
    const { actors, users, project, list, s } = await setup();
    const due = future(3);
    const t = await createTask(actors.member, list.id, {
      title: "Weekly report",
      description: "Send numbers",
      priority: "high",
      dueDate: due,
      startDate: future(1),
    });
    await setTaskAssignees(actors.member, t.id, [users.member.id]);
    const tag = await createTag(actors.owner, project.id, { name: "Ops" });
    await setTaskTags(actors.member, t.id, [tag.id]);
    const field = await createField(actors.owner, project.id, { name: "Client", type: "text" });
    await setTaskFieldValues(actors.member, t.id, { [field.id]: "Blend360" });
    let { task } = await getTaskByRef(actors.member, t.ref);
    await updateTask(actors.member, t.id, task.version, { recurrence: { freq: "weekly" } });
    ({ task } = await getTaskByRef(actors.member, t.ref));
    await updateTask(actors.member, t.id, task.version, { statusId: s("Accepted").id });

    const all = await listTasks(actors.member, list.id);
    const next = all.find((x) => x.id !== t.id)!;
    expect(next).toMatchObject({
      title: "Weekly report",
      priority: "high",
      statusId: s("Backlog").id,
      dueDate: future(10),
      startDate: future(8),
    });
    const copy = await getTaskByRef(actors.member, `WEB-${next.number}`);
    expect(copy.task.description).toBe("Send numbers");
    expect(copy.task.recurrence).toMatchObject({ freq: "weekly" });
    expect(copy.assignees.map((a) => a.userId)).toEqual([users.member.id]);
    expect((await getTaskFields(actors.member, next.id)).fields.find((f) => f.name === "Client")?.value).toBe(
      "Blend360",
    );
    // The old one no longer repeats: reopening and closing it again makes nothing new.
    ({ task } = await getTaskByRef(actors.member, t.ref));
    expect(task.recurrence).toBeNull();
    await updateTask(actors.member, t.id, task.version, { statusId: s("To Do").id });
    ({ task } = await getTaskByRef(actors.member, t.ref));
    await updateTask(actors.member, t.id, task.version, { statusId: s("Accepted").id });
    expect(await listTasks(actors.member, list.id)).toHaveLength(2);
  });

  it("repeats from the board too, but not when cancelled", async () => {
    const { actors, list, s } = await setup();
    const a = await createTask(actors.member, list.id, { title: "Daily standup", dueDate: future(0) });
    await updateTask(actors.member, a.id, 1, { recurrence: { freq: "daily", weekdaysOnly: true } });
    await moveTask(actors.member, a.id, 2, { statusId: s("Accepted").id });
    expect((await listTasks(actors.member, list.id)).map((t) => t.title)).toEqual([
      "Daily standup",
      "Daily standup",
    ]);

    const b = await createTask(actors.member, list.id, { title: "Monthly invoice" });
    await updateTask(actors.member, b.id, 1, { recurrence: { freq: "monthly" } });
    await updateTask(actors.member, b.id, 2, { statusId: s("Cancelled").id });
    expect(
      (await listTasks(actors.member, list.id)).filter((t) => t.title === "Monthly invoice"),
    ).toHaveLength(1);
  });

  it("gives an undated repeating task the next date after today", async () => {
    const { actors, list, s } = await setup();
    const t = await createTask(actors.member, list.id, { title: "Backups check" });
    await updateTask(actors.member, t.id, 1, { recurrence: { freq: "daily", interval: 2 } });
    await updateTask(actors.member, t.id, 2, { statusId: s("Accepted").id });
    const next = (await listTasks(actors.member, list.id)).find((x) => x.id !== t.id)!;
    expect(next.dueDate).toBe(future(2));
  });
});
