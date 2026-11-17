import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { tasks, taskFieldValues } from "@/server/db/schema";
import { createProject } from "@/modules/projects/service";
import { createList, listStatusesFor } from "@/modules/lists/service";
import { createTask, moveTaskToList, updateTask } from "@/modules/tasks/service";
import { createField, setTaskFieldValues } from "@/modules/fields/service";
import { createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const project = await createProject(ctx.actors.owner, { name: "Website", key: "WEB" });
  const from = await createList(ctx.actors.owner, project.id, { name: "Inbox", template: "simple" });
  const to = await createList(ctx.actors.owner, project.id, { name: "Build", template: "agency" });
  return { ...ctx, project, from, to };
}

const row = async (id: string) => (await db().select().from(tasks).where(eq(tasks.id, id)))[0]!;

describe("moving a task to another list", () => {
  it("moves it with its subtasks, maps statuses and lands at the end", async () => {
    const { actors, from, to } = await setup();
    const fromStatuses = await listStatusesFor(db(), from.id);
    const toStatuses = await listStatusesFor(db(), to.id);
    const existing = await createTask(actors.member, to.id, { title: "Already there" });
    const parent = await createTask(actors.member, from.id, { title: "Parent" });
    const child = await createTask(actors.member, from.id, { title: "Child", parentTaskId: parent.id });
    const done = fromStatuses.find((s) => s.category === "done")!;
    await updateTask(actors.member, parent.id, 1, { statusId: done.id });

    await moveTaskToList(actors.member, parent.id, 2, to.id);
    const [p, c, e] = [await row(parent.id), await row(child.id), await row(existing.id)];
    expect(p.listId).toBe(to.id);
    expect(c.listId).toBe(to.id);
    expect(c.parentTaskId).toBe(parent.id);
    const statusOf = (id: string) => toStatuses.find((s) => s.id === id);
    expect(statusOf(p.statusId)?.category).toBe("done");
    expect(statusOf(c.statusId)).toBeDefined();
    expect(p.position > e.position).toBe(true);
    expect(p.version).toBe(3);
  });

  it("clears values of fields that only belong to the old list", async () => {
    const { actors, project, from, to } = await setup();
    const local = await createField(actors.owner, project.id, {
      name: "Local",
      type: "text",
      listId: from.id,
    });
    const shared = await createField(actors.owner, project.id, { name: "Client", type: "text" });
    const t = await createTask(actors.member, from.id, { title: "Task" });
    await setTaskFieldValues(actors.member, t.id, { [local.id]: "x", [shared.id]: "Blend" });
    await moveTaskToList(actors.member, t.id, (await row(t.id)).version, to.id);
    const values = await db().select().from(taskFieldValues).where(eq(taskFieldValues.taskId, t.id));
    expect(values.map((v) => v.fieldId)).toEqual([shared.id]);
  });

  it("refuses subtasks, stale versions, other projects and viewers", async () => {
    const { actors, from, to } = await setup();
    const other = await createProject(actors.owner, { name: "Other", key: "OTH" });
    const elsewhere = await createList(actors.owner, other.id, { name: "Else", template: "simple" });
    const t = await createTask(actors.member, from.id, { title: "Task" });
    const sub = await createTask(actors.member, from.id, { title: "Sub", parentTaskId: t.id });
    await expect(moveTaskToList(actors.member, sub.id, 1, to.id)).rejects.toThrow(/move with their parent/);
    await expect(moveTaskToList(actors.member, t.id, 99, to.id)).rejects.toThrow(/Someone else/);
    await expect(moveTaskToList(actors.member, t.id, 1, elsewhere.id)).rejects.toThrow(/same project/);
    await expect(moveTaskToList(actors.guest, t.id, 1, to.id)).rejects.toThrow();
    expect((await row(t.id)).listId).toBe(from.id);
  });
});
