import { describe, expect, it } from "vitest";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { taskStatusChanges, tasks } from "@/server/db/schema";
import { createProject } from "@/modules/projects/service";
import { createList, deleteStatus, listStatusesFor } from "@/modules/lists/service";
import { createTask, moveTask, updateTask } from "@/modules/tasks/service";
import { bulkUpdateTasks } from "@/modules/tasks/bulk";
import { applyStatusTemplate } from "@/modules/lists/status-templates";
import { getFlowReport } from "@/modules/dashboard/service";
import { createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const project = await createProject(ctx.actors.owner, { name: "Website", key: "WEB" });
  const list = await createList(ctx.actors.owner, project.id, { name: "Build", template: "simple" });
  const [todo, doing, done] = await listStatusesFor(db(), list.id);
  return { ...ctx, project, list, todo: todo!, doing: doing!, done: done! };
}

const history = async (taskId: string) =>
  (
    await db()
      .select({ from: taskStatusChanges.fromName, to: taskStatusChanges.toName })
      .from(taskStatusChanges)
      .where(eq(taskStatusChanges.taskId, taskId))
      .orderBy(asc(taskStatusChanges.changedAt))
  ).map((r) => `${r.from ?? "∅"}→${r.to}`);

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

describe("status history", () => {
  it("records every way a status changes", async () => {
    const { actors, list, todo, doing, done } = await setup();
    const a = await createTask(actors.member, list.id, { title: "A" });
    await updateTask(actors.member, a.id, 1, { statusId: doing.id });
    await moveTask(actors.member, a.id, 2, { statusId: done.id });
    const b = await createTask(actors.owner, list.id, { title: "B" });
    await bulkUpdateTasks(actors.owner, list.id, [b.id], { kind: "status", statusId: doing.id });
    expect(await history(a.id)).toEqual(["∅→To Do", "To Do→In Progress", "In Progress→Done"]);
    expect(await history(b.id)).toEqual(["∅→To Do", "To Do→In Progress"]);

    // Deleting a status moves its tasks (and records it); so does applying a template.
    await deleteStatus(actors.owner, doing.id, todo.id);
    expect((await history(b.id)).at(-1)).toBe("In Progress→To Do");
    await applyStatusTemplate(actors.owner, list.id, { builtin: "agency" });
    // "To Do" and "Done" don't exist in agency except To Do: B stays; A (Done) moves to Accepted.
    expect((await history(a.id)).at(-1)).toBe("Done→Accepted");
  });
});

describe("flow report", () => {
  it("measures time in status, cycle and lead time, and stuck work", async () => {
    const { actors, project, list, doing, done } = await setup();
    const a = await createTask(actors.owner, list.id, { title: "Shipped" });
    await updateTask(actors.owner, a.id, 1, { statusId: doing.id });
    await updateTask(actors.owner, a.id, 2, { statusId: done.id });
    const b = await createTask(actors.owner, list.id, { title: "Stuck" });
    await updateTask(actors.owner, b.id, 1, { statusId: doing.id });

    // A: created 10 days ago, started 6 days ago, done 1 day ago. B: in progress for 3 days.
    const rows = await db()
      .select()
      .from(taskStatusChanges)
      .where(inArray(taskStatusChanges.taskId, [a.id, b.id]));
    for (const r of rows) {
      const at =
        r.taskId === a.id
          ? r.toName === "To Do"
            ? daysAgo(10)
            : r.toName === "In Progress"
              ? daysAgo(6)
              : daysAgo(1)
          : r.toName === "To Do"
            ? daysAgo(5)
            : daysAgo(3);
      await db().update(taskStatusChanges).set({ changedAt: at }).where(eq(taskStatusChanges.id, r.id));
    }
    await db()
      .update(tasks)
      .set({ createdAt: daysAgo(10), completedAt: daysAgo(1) })
      .where(eq(tasks.id, a.id));
    await db()
      .update(tasks)
      .set({ createdAt: daysAgo(5) })
      .where(eq(tasks.id, b.id));

    const report = await getFlowReport(actors.owner, { projectId: project.id });
    const stay = (name: string) => report.timeInStatus.find((s) => s.name === name)!;
    expect(stay("To Do").stays).toBe(2);
    expect(Math.round(stay("To Do").avgHours / 24)).toBe(3); // 4 days (A) and 2 days (B)
    expect(stay("In Progress").stays).toBe(2);
    expect(Math.round(stay("In Progress").avgHours / 24)).toBe(4); // 5 days (A) and 3 so far (B)
    expect(report.cycle.done).toBe(1);
    expect(Math.round(report.cycle.medianCycleHours! / 24)).toBe(5);
    expect(Math.round(report.cycle.medianLeadHours! / 24)).toBe(9);
    expect(report.stuck[0]).toMatchObject({ title: "Stuck", statusName: "In Progress" });
    expect(Math.round(report.stuck[0]!.hours / 24)).toBe(3);
  });

  it("only reports on projects the viewer can see", async () => {
    const { actors } = await setup();
    const secret = await createProject(actors.owner, { name: "Secret", key: "SEC", visibility: "private" });
    const list = await createList(actors.owner, secret.id, { name: "L", template: "simple" });
    const [, doing] = await listStatusesFor(db(), list.id);
    const t = await createTask(actors.owner, list.id, { title: "Hidden work" });
    await updateTask(actors.owner, t.id, 1, { statusId: doing!.id });
    expect((await getFlowReport(actors.member, {})).stuck.map((s) => s.title)).not.toContain("Hidden work");
    expect((await getFlowReport(actors.owner, {})).stuck.map((s) => s.title)).toContain("Hidden work");
  });
});
