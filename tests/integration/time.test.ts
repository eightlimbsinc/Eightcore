import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { db } from "@/server/db";
import { timeEntries } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { createProject } from "@/modules/projects/service";
import { createList } from "@/modules/lists/service";
import { createTask, getTaskByRef, updateTask } from "@/modules/tasks/service";
import {
  addTimeEntry,
  deleteTimeEntry,
  getRunningTimer,
  getTaskTime,
  startTimer,
  stopTimer,
  timeTotalsForTasks,
  updateTimeEntry,
} from "@/modules/time/service";
import { createWorkspaceWithRoles } from "../support/factories";

async function setup() {
  const ctx = await createWorkspaceWithRoles();
  const project = await createProject(ctx.actors.owner, { name: "Website", key: "WEB" });
  const list = await createList(ctx.actors.owner, project.id, { name: "Build", template: "simple" });
  const a = await createTask(ctx.actors.owner, list.id, { title: "Design" });
  const b = await createTask(ctx.actors.owner, list.id, { title: "Build" });
  return { ...ctx, project, list, a, b };
}

/** Pretend a running timer started `minutes` ago. */
async function backdate(taskId: string, minutes: number) {
  await db()
    .update(timeEntries)
    .set({ startedAt: new Date(Date.now() - minutes * 60_000) })
    .where(eq(timeEntries.taskId, taskId));
}

describe("time tracking", () => {
  it("runs one timer per person: starting another stops the first", async () => {
    const { actors, a, b } = await setup();
    await startTimer(actors.member, a.id);
    await backdate(a.id, 25);
    expect(await getRunningTimer(actors.member)).toMatchObject({ ref: a.ref, title: "Design" });
    await startTimer(actors.member, b.id);
    const timeA = await getTaskTime(actors.member, a.id);
    expect(timeA.myRunning).toBeNull();
    expect(Math.round(timeA.totalSeconds / 60)).toBe(25);
    expect((await getRunningTimer(actors.member))?.ref).toBe(b.ref);

    const stopped = await stopTimer(actors.member);
    expect(stopped?.taskId).toBe(b.id);
    expect(await getRunningTimer(actors.member)).toBeNull();
    expect(await stopTimer(actors.member)).toBeNull();
  });

  it("adds, edits and deletes manual entries, and totals them with running timers", async () => {
    const { actors, a } = await setup();
    const entry = await addTimeEntry(actors.member, a.id, {
      minutes: 90,
      date: "2026-10-01",
      note: "Wireframes",
    });
    await addTimeEntry(actors.owner, a.id, { minutes: 30, date: "2026-10-02" });
    await startTimer(actors.owner, a.id);
    await backdate(a.id, 0);
    let time = await getTaskTime(actors.member, a.id);
    expect(time.entries).toHaveLength(3);
    expect(Math.round(time.totalSeconds / 60)).toBeGreaterThanOrEqual(120);
    expect(time.entries.find((e) => e.id === entry.id)).toMatchObject({ note: "Wireframes", canEdit: true });

    await updateTimeEntry(actors.member, entry.id, { minutes: 60, note: "Wireframes v2" });
    time = await getTaskTime(actors.member, a.id);
    expect(time.entries.find((e) => e.id === entry.id)).toMatchObject({
      seconds: 3600,
      note: "Wireframes v2",
    });
    const totals = await timeTotalsForTasks(db(), [a.id]);
    expect(Math.round(totals.get(a.id)! / 60)).toBeGreaterThanOrEqual(90);

    await deleteTimeEntry(actors.member, entry.id);
    expect((await getTaskTime(actors.member, a.id)).entries).toHaveLength(2);
  });

  it("lets editors change only their own entries; managers change anyone's", async () => {
    const { actors, a } = await setup();
    const ownersEntry = await addTimeEntry(actors.owner, a.id, { minutes: 15, date: "2026-10-01" });
    // The member is an editor on this workspace-visible project.
    await expect(deleteTimeEntry(actors.member, ownersEntry.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getTaskTime(actors.member, a.id)).entries[0]?.canEdit).toBe(false);
    const membersEntry = await addTimeEntry(actors.member, a.id, { minutes: 15, date: "2026-10-01" });
    await deleteTimeEntry(actors.owner, membersEntry.id);
  });

  it("refuses people outside the project or workspace, and bad durations", async () => {
    const { actors, a } = await setup();
    // Guests can't see the project at all.
    await expect(startTimer(actors.guest, a.id)).rejects.toBeInstanceOf(NotFoundError);
    const other = await createWorkspaceWithRoles();
    await expect(getTaskTime(other.actors.owner, a.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(addTimeEntry(actors.owner, a.id, { minutes: 0, date: "2026-10-01" })).rejects.toThrow();
    await expect(
      addTimeEntry(actors.owner, a.id, { minutes: 25 * 60, date: "2026-10-01" }),
    ).rejects.toThrow();
  });

  it("stores a time estimate on the task", async () => {
    const { actors, a } = await setup();
    await updateTask(actors.member, a.id, 1, { timeEstimateMinutes: 150 });
    expect((await getTaskByRef(actors.member, a.ref)).task.timeEstimateMinutes).toBe(150);
    expect((await getTaskTime(actors.member, a.id)).estimateMinutes).toBe(150);
  });
});
