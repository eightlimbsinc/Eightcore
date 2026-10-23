// Dashboard numbers (Phase 4).
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createProject } from "@/modules/projects/service";
import { createList, listStatusesFor } from "@/modules/lists/service";
import { createTask, getTaskByRef, updateTask } from "@/modules/tasks/service";
import { createTag, setTaskTags } from "@/modules/tags/service";
import { addDependency } from "@/modules/dependencies/service";
import { getDashboard } from "@/modules/dashboard/service";
import { adminPool } from "../support/db";
import { createWorkspaceWithRoles } from "../support/factories";

const TODAY = "2026-10-21"; // Wednesday; week is Oct 19-25

describe("dashboard", () => {
  it("counts open work, due buckets, workload, tags and completions", async () => {
    const { actors, users } = await createWorkspaceWithRoles();
    const web = await createProject(actors.owner, { name: "Website", key: "WEB" });
    const list = await createList(actors.owner, web.id, { name: "Build", template: "simple" });
    const statuses = await listStatusesFor(db(), list.id);
    const doneStatus = statuses.find((s) => s.category === "done")!;
    const inProgress = statuses.find((s) => s.category === "active")!;

    const a = await createTask(actors.owner, list.id, {
      title: "A",
      dueDate: "2026-10-20",
      priority: "high",
      assigneeIds: [users.member.id],
    });
    const b = await createTask(actors.owner, list.id, {
      title: "B",
      dueDate: "2026-10-21",
      assigneeIds: [users.member.id],
    });
    await createTask(actors.owner, list.id, { title: "C", dueDate: "2026-10-24", statusId: inProgress.id });
    const d = await createTask(actors.owner, list.id, { title: "D" });
    const bug = await createTag(actors.owner, web.id, { name: "Bug" });
    await setTaskTags(actors.owner, a.id, [bug.id]);
    await addDependency(actors.owner, d.id, { ref: b.ref, relation: "blocked_by" });
    // One finished this week, one finished three weeks ago.
    const { task } = await getTaskByRef(actors.owner, b.ref);
    await updateTask(actors.owner, b.id, task.version, { statusId: doneStatus.id });
    const old = await createTask(actors.owner, list.id, { title: "Old", statusId: doneStatus.id });
    await adminPool().query("update tasks set completed_at = '2026-10-01T12:00:00Z' where id = $1", [old.id]);
    await adminPool().query("update tasks set completed_at = '2026-10-21T03:00:00Z' where id = $1", [b.id]);

    const dash = await getDashboard(actors.owner, { today: TODAY, timeZone: "UTC" });
    expect(dash.totals).toMatchObject({
      open: 3,
      overdue: 1,
      dueToday: 0, // B was due today but is finished
      dueThisWeek: 2,
      noDueDate: 1,
      unassigned: 2,
      blocked: 0, // D's blocker B is finished
      doneThisWeek: 1,
    });
    expect(dash.stages).toMatchObject({ unstarted: 2, active: 1, done: 2 });
    expect(dash.workload).toEqual([
      { userId: users.member.id, name: users.member.name, n: 1, urgentOrHigh: 1, overdue: 1 },
    ]);
    expect(dash.priorities).toMatchObject({ high: 1, none: 2 });
    expect(dash.topTags).toEqual([{ name: "Bug", n: 1 }]);
    expect(dash.completedByWeek).toHaveLength(8);
    expect(dash.completedByWeek.at(-1)).toEqual({ week: "2026-10-19", n: 1 });
    expect(dash.completedByWeek.find((w) => w.week === "2026-09-28")?.n).toBe(1);

    // In Manila, 2026-10-20T20:00Z is already Wednesday the 21st: still this week either way,
    // but a completion at 2026-10-18T20:00Z moves from last week (UTC) into this week (Manila).
    await adminPool().query("update tasks set completed_at = '2026-10-18T20:00:00Z' where id = $1", [b.id]);
    expect((await getDashboard(actors.owner, { today: TODAY, timeZone: "UTC" })).totals.doneThisWeek).toBe(0);
    expect(
      (await getDashboard(actors.owner, { today: TODAY, timeZone: "Asia/Manila" })).totals.doneThisWeek,
    ).toBe(1);
  });

  it("only counts projects the viewer can see, and can focus on one project", async () => {
    const { actors } = await createWorkspaceWithRoles();
    const open = await createProject(actors.owner, { name: "Open", key: "OPN" });
    const secret = await createProject(actors.owner, { name: "Secret", key: "SEC", visibility: "private" });
    for (const p of [open, secret]) {
      const list = await createList(actors.owner, p.id, { name: "L" });
      await createTask(actors.owner, list.id, { title: "T" });
    }
    expect((await getDashboard(actors.owner, { today: TODAY, timeZone: "UTC" })).totals.open).toBe(2);
    expect((await getDashboard(actors.member, { today: TODAY, timeZone: "UTC" })).totals.open).toBe(1);
    expect((await getDashboard(actors.guest, { today: TODAY, timeZone: "UTC" })).totals.open).toBe(0);
    expect(
      (await getDashboard(actors.owner, { today: TODAY, timeZone: "UTC", projectId: secret.id })).totals.open,
    ).toBe(1);
    expect(
      (await getDashboard(actors.member, { today: TODAY, timeZone: "UTC", projectId: secret.id })).totals
        .open,
    ).toBe(0);
  });
});
