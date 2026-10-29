import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/server/db";
import { projects, tasks, timeEntries, users } from "@/server/db/schema";
import { canProject, type ActorContext } from "@/server/authz/policy";
import { ForbiddenError, NotFoundError, assertId } from "@/server/errors";
import { recordActivity } from "@/modules/activity/service";
import { loadTaskAccess } from "@/modules/tasks/service";

/** Longest single entry: a week (a timer left running over a weekend still fits). */
const MAX_SECONDS = 7 * 24 * 3600;

const manualEntryInput = z.object({
  minutes: z
    .number()
    .int()
    .min(1, "Enter a time of at least 1 minute")
    .max(24 * 60, "One entry can be at most 24 hours"),
  /** The day the work was done (YYYY-MM-DD). */
  date: z.iso.date({ message: "Use a valid date" }),
  note: z.string().trim().max(500, "Use at most 500 characters").default(""),
});
export type ManualEntryInput = z.input<typeof manualEntryInput>;

const entryUpdate = z.object({
  minutes: manualEntryInput.shape.minutes.optional(),
  date: manualEntryInput.shape.date.optional(),
  note: manualEntryInput.shape.note.optional(),
});

/** Seconds from `start` to now, capped. */
const elapsed = (start: Date) =>
  Math.min(MAX_SECONDS, Math.max(0, Math.round((Date.now() - start.getTime()) / 1000)));

/** Noon UTC on that day, so the day doesn't shift in any time zone. */
const dayStart = (date: string) => new Date(`${date}T12:00:00Z`);

function assertTrack(role: Parameters<typeof canProject>[0]) {
  if (!canProject(role, "time.track")) throw new ForbiddenError();
}

/** Stops the actor's running timer (on any task), if there is one. */
async function stopRunning(tx: DbOrTx, actor: ActorContext) {
  const [running] = await tx
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, actor.userId), isNull(timeEntries.endedAt)))
    .for("update");
  if (!running) return null;
  const seconds = elapsed(running.startedAt);
  await tx
    .update(timeEntries)
    .set({ endedAt: new Date(), durationSeconds: seconds })
    .where(eq(timeEntries.id, running.id));
  await recordActivity(tx, actor, {
    entityType: "task",
    entityId: running.taskId,
    action: "time_logged",
    metadata: { minutes: Math.floor(seconds / 60), source: "timer" },
  });
  return { ...running, durationSeconds: seconds };
}

/** Starts a timer on a task (stopping the actor's other timer first). */
export async function startTimer(actor: ActorContext, taskId: string) {
  return db().transaction(async (tx) => {
    const { role } = await loadTaskAccess(tx, actor, taskId);
    assertTrack(role);
    await stopRunning(tx, actor);
    const [entry] = await tx
      .insert(timeEntries)
      .values({
        workspaceId: actor.workspaceId,
        taskId,
        userId: actor.userId,
        startedAt: new Date(),
        source: "timer",
      })
      .returning({ id: timeEntries.id, startedAt: timeEntries.startedAt });
    return entry!;
  });
}

/** Stops the actor's running timer, wherever it is. Returns what was logged (or null). */
export async function stopTimer(actor: ActorContext) {
  return db().transaction(async (tx) => {
    const stopped = await stopRunning(tx, actor);
    return stopped ? { taskId: stopped.taskId, seconds: stopped.durationSeconds } : null;
  });
}

/** Time typed in afterwards ("1h 30m on Aug 7"). */
export async function addTimeEntry(actor: ActorContext, taskId: string, raw: ManualEntryInput) {
  const input = manualEntryInput.parse(raw);
  return db().transaction(async (tx) => {
    const { role } = await loadTaskAccess(tx, actor, taskId);
    assertTrack(role);
    const startedAt = dayStart(input.date);
    const [entry] = await tx
      .insert(timeEntries)
      .values({
        workspaceId: actor.workspaceId,
        taskId,
        userId: actor.userId,
        startedAt,
        endedAt: new Date(startedAt.getTime() + input.minutes * 60_000),
        durationSeconds: input.minutes * 60,
        note: input.note,
        source: "manual",
      })
      .returning({ id: timeEntries.id });
    await recordActivity(tx, actor, {
      entityType: "task",
      entityId: taskId,
      action: "time_logged",
      metadata: { minutes: input.minutes, date: input.date, source: "manual" },
    });
    return entry!;
  });
}

/** An entry the actor may change: their own (with time.track) or anyone's (time.manage). */
async function loadEntry(tx: DbOrTx, actor: ActorContext, entryId: string) {
  assertId(entryId, "Time entry not found");
  const [entry] = await tx
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.id, entryId), eq(timeEntries.workspaceId, actor.workspaceId)));
  if (!entry) throw new NotFoundError("Time entry not found");
  const { role } = await loadTaskAccess(tx, actor, entry.taskId);
  const own = entry.userId === actor.userId;
  if (!(own ? canProject(role, "time.track") : canProject(role, "time.manage"))) throw new ForbiddenError();
  return entry;
}

export async function updateTimeEntry(
  actor: ActorContext,
  entryId: string,
  raw: z.input<typeof entryUpdate>,
) {
  const input = entryUpdate.parse(raw);
  await db().transaction(async (tx) => {
    const entry = await loadEntry(tx, actor, entryId);
    const running = entry.endedAt === null;
    const startedAt = input.date && !running ? dayStart(input.date) : entry.startedAt;
    const seconds = input.minutes !== undefined && !running ? input.minutes * 60 : entry.durationSeconds;
    await tx
      .update(timeEntries)
      .set({
        note: input.note ?? entry.note,
        startedAt,
        durationSeconds: seconds,
        endedAt: running ? null : new Date(startedAt.getTime() + seconds * 1000),
      })
      .where(eq(timeEntries.id, entryId));
  });
}

export async function deleteTimeEntry(actor: ActorContext, entryId: string) {
  await db().transaction(async (tx) => {
    const entry = await loadEntry(tx, actor, entryId);
    await tx.delete(timeEntries).where(eq(timeEntries.id, entryId));
    await recordActivity(tx, actor, {
      entityType: "task",
      entityId: entry.taskId,
      action: "time_removed",
      metadata: { minutes: Math.floor(entry.durationSeconds / 60) },
    });
  });
}

/** A task's time: entries (newest first), total seconds (running timers count so far), permissions. */
export async function getTaskTime(actor: ActorContext, taskId: string) {
  const { task, role } = await loadTaskAccess(db(), actor, taskId);
  const rows = await db()
    .select({
      id: timeEntries.id,
      userId: timeEntries.userId,
      userName: users.name,
      startedAt: timeEntries.startedAt,
      endedAt: timeEntries.endedAt,
      durationSeconds: timeEntries.durationSeconds,
      note: timeEntries.note,
      source: timeEntries.source,
    })
    .from(timeEntries)
    .innerJoin(users, eq(users.id, timeEntries.userId))
    .where(eq(timeEntries.taskId, taskId))
    .orderBy(desc(timeEntries.startedAt))
    .limit(200);
  const canManage = canProject(role, "time.manage");
  const canTrack = canProject(role, "time.track");
  const entries = rows.map((r) => ({
    ...r,
    running: r.endedAt === null,
    seconds: r.endedAt === null ? elapsed(r.startedAt) : r.durationSeconds,
    canEdit: r.userId === actor.userId ? canTrack : canManage,
  }));
  return {
    entries,
    totalSeconds: entries.reduce((n, e) => n + e.seconds, 0),
    estimateMinutes: task.timeEstimateMinutes,
    myRunning: entries.find((e) => e.running && e.userId === actor.userId) ?? null,
    can: { track: canTrack, manage: canManage },
  };
}

/** The actor's running timer in this workspace (for the sidebar), with its task. */
export async function getRunningTimer(actor: ActorContext) {
  const [row] = await db()
    .select({
      taskId: timeEntries.taskId,
      startedAt: timeEntries.startedAt,
      title: tasks.title,
      number: tasks.number,
      projectKey: projects.key,
    })
    .from(timeEntries)
    .innerJoin(tasks, eq(tasks.id, timeEntries.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(
      and(
        eq(timeEntries.userId, actor.userId),
        eq(timeEntries.workspaceId, actor.workspaceId),
        isNull(timeEntries.endedAt),
      ),
    );
  return row
    ? {
        taskId: row.taskId,
        ref: `${row.projectKey}-${row.number}`,
        title: row.title,
        startedAt: row.startedAt,
      }
    : null;
}

/** Total tracked seconds per task (running timers count so far). Ids must already be visible. */
export async function timeTotalsForTasks(tx: DbOrTx, taskIds: string[]) {
  const totals = new Map<string, number>();
  if (!taskIds.length) return totals;
  const rows = await tx
    .select({
      taskId: timeEntries.taskId,
      seconds: sql<number>`sum(case when ${timeEntries.endedAt} is null
        then least(${MAX_SECONDS}, extract(epoch from now() - ${timeEntries.startedAt}))
        else ${timeEntries.durationSeconds} end)::int`,
    })
    .from(timeEntries)
    .where(inArray(timeEntries.taskId, taskIds))
    .groupBy(timeEntries.taskId);
  for (const r of rows) totals.set(r.taskId, Number(r.seconds));
  return totals;
}
