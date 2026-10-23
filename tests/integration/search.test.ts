// Workspace-wide task search with filters (Phase 4).
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createProject, updateProject } from "@/modules/projects/service";
import { createList, listStatusesFor } from "@/modules/lists/service";
import { createTask, getTaskByRef, updateTask } from "@/modules/tasks/service";
import { createTag, setTaskTags } from "@/modules/tags/service";
import { addDependency } from "@/modules/dependencies/service";
import { EMPTY_FILTER, type TaskFilter } from "@/modules/tasks/filters";
import { searchTasks } from "@/modules/tasks/search";
import { createWorkspaceWithRoles } from "../support/factories";

const TODAY = "2026-10-21"; // Wednesday
const f = (over: Partial<TaskFilter>): TaskFilter => ({ ...EMPTY_FILTER, ...over });

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const web = await createProject(ctx.actors.owner, { name: "Website", key: "WEB" });
  const list = await createList(ctx.actors.owner, web.id, { name: "Build", template: "simple" });
  const statuses = await listStatusesFor(db(), list.id);
  const mk = (
    title: string,
    extra: Parameters<typeof createTask>[2] extends infer T ? Partial<T> : never = {},
  ) => createTask(ctx.actors.owner, list.id, { title, ...extra });
  const overdue = await mk("Fix hero", {
    dueDate: "2026-10-20",
    priority: "high",
    assigneeIds: [ctx.users.member.id],
  });
  const thisWeek = await mk("Write copy", { dueDate: "2026-10-24", priority: "low" });
  const nextWeek = await mk("Launch", { dueDate: "2026-10-27" });
  const undated = await mk("Backlog idea");
  return { ...ctx, web, list, statuses, overdue, thisWeek, nextWeek, undated };
}

const titles = async (...args: Parameters<typeof searchTasks>) =>
  (await searchTasks(...args)).tasks.map((t) => t.title);

describe("task search", () => {
  it("filters by due date, assignee, priority, text and orders by due date", async () => {
    const { actors } = await setup();
    const opt = { today: TODAY };
    expect(await titles(actors.owner, f({}), opt)).toEqual([
      "Fix hero",
      "Write copy",
      "Launch",
      "Backlog idea",
    ]);
    expect(await titles(actors.owner, f({ due: ["overdue"] }), opt)).toEqual(["Fix hero"]);
    // "This week" is Monday to Sunday, so it includes Tuesday's overdue task too.
    expect(await titles(actors.owner, f({ due: ["week"] }), opt)).toEqual(["Fix hero", "Write copy"]);
    expect(await titles(actors.owner, f({ due: ["next_week", "none"] }), opt)).toEqual([
      "Launch",
      "Backlog idea",
    ]);
    expect(await titles(actors.member, f({ assignees: ["me"] }), opt)).toEqual(["Fix hero"]);
    expect(await titles(actors.owner, f({ assignees: ["none"] }), opt)).toHaveLength(3);
    expect(await titles(actors.owner, f({ priorities: ["high", "low"] }), opt)).toEqual([
      "Fix hero",
      "Write copy",
    ]);
    expect(await titles(actors.owner, f({ q: "web-3" }), opt)).toEqual(["Launch"]);
    expect(await titles(actors.owner, f({ q: "copy WRITE" }), opt)).toEqual(["Write copy"]);
    // LIKE wildcards in the search box are literal.
    expect(await titles(actors.owner, f({ q: "%" }), opt)).toEqual([]);
  });

  it("filters by tags, open/closed and blocked; overdue ignores finished tasks", async () => {
    const { actors, web, statuses, overdue, thisWeek, nextWeek } = await setup();
    const bug = await createTag(actors.owner, web.id, { name: "Bug" });
    await setTaskTags(actors.owner, thisWeek.id, [bug.id]);
    expect(await titles(actors.owner, f({ tags: ["bug"] }), { today: TODAY })).toEqual(["Write copy"]);

    await addDependency(actors.owner, nextWeek.id, { ref: thisWeek.ref, relation: "blocked_by" });
    expect(await titles(actors.owner, f({ blocked: true }), { today: TODAY })).toEqual(["Launch"]);

    const done = statuses.find((s) => s.category === "done")!;
    const { task } = await getTaskByRef(actors.owner, overdue.ref);
    await updateTask(actors.owner, overdue.id, task.version, { statusId: done.id });
    expect(await titles(actors.owner, f({ due: ["overdue"] }), { today: TODAY })).toEqual([]);
    expect(await titles(actors.owner, f({ state: "closed" }), { today: TODAY })).toEqual(["Fix hero"]);
    expect(await titles(actors.owner, f({ state: "open" }), { today: TODAY })).toHaveLength(3);
  });

  it("only returns tasks in projects the actor can see", async () => {
    const { actors, web } = await setup();
    const secret = await createProject(actors.owner, { name: "Secret", key: "SEC", visibility: "private" });
    const secretList = await createList(actors.owner, secret.id, { name: "L" });
    await createTask(actors.owner, secretList.id, { title: "Hidden plan" });
    expect(await titles(actors.owner, f({ q: "hidden" }), { today: TODAY })).toEqual(["Hidden plan"]);
    expect(await titles(actors.member, f({ q: "hidden" }), { today: TODAY })).toEqual([]);
    expect(await titles(actors.guest, f({}), { today: TODAY })).toEqual([]);
    await updateProject(actors.owner, web.id, { visibility: "private" });
    expect(await titles(actors.member, f({}), { today: TODAY })).toEqual([]);
    const other = await createWorkspaceWithRoles();
    expect(await titles(other.actors.owner, f({}), { today: TODAY })).toEqual([]);
  });
});
