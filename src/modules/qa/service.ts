import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/server/db";
import { qaCycles, users } from "@/server/db/schema";
import { canProject, type ActorContext } from "@/server/authz/policy";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  assertId,
  pgErrorInfo,
} from "@/server/errors";
import { enqueueOutbox, recordActivity } from "@/modules/activity/service";
import { loadTaskAccess } from "@/modules/tasks/service";
import {
  attachmentsForTask,
  discardUploads,
  insertAttachmentsInTx,
  storeUploads,
  type IncomingFile,
} from "@/modules/attachments/service";

const startInput = z.object({
  environmentUrl: z.string().trim().max(2000).default(""),
  buildRef: z.string().trim().max(200).default(""),
});
const concludeInput = z.object({
  result: z.enum(["pass", "fail"]),
  summary: z.string().trim().max(10_000).default(""),
});

export type QaResult = "pending" | "pass" | "fail";

function assertConduct(role: Parameters<typeof canProject>[0]) {
  if (!canProject(role, "qa.conduct")) throw new ForbiddenError();
}

function lockedError(error: unknown): never {
  const { constraint } = pgErrorInfo(error);
  if (constraint === "qa_cycles_concluded_locked")
    throw new ConflictError("That QA round is already concluded.");
  if (constraint === "qa_cycles_one_pending_uq")
    throw new ConflictError("A QA round is already open on this task.");
  throw error;
}

/** Opens round N+1 on a task (inside the caller's transaction). */
export async function startQaCycleInTx(
  tx: DbOrTx,
  actor: ActorContext,
  taskId: string,
  details: { environmentUrl?: string; buildRef?: string } = {},
) {
  const [{ next }] = (await tx
    .select({ next: sql<number>`coalesce(max(${qaCycles.cycleNumber}), 0) + 1` })
    .from(qaCycles)
    .where(eq(qaCycles.taskId, taskId))) as [{ next: number }];
  const [row] = await tx
    .insert(qaCycles)
    .values({
      workspaceId: actor.workspaceId,
      taskId,
      cycleNumber: Number(next),
      environmentUrl: details.environmentUrl ?? "",
      buildRef: details.buildRef ?? "",
      startedBy: actor.userId,
    })
    .returning({ id: qaCycles.id, cycleNumber: qaCycles.cycleNumber });
  await recordActivity(tx, actor, {
    entityType: "task",
    entityId: taskId,
    action: "qa_started",
    metadata: { cycle: row!.cycleNumber },
  });
  return row!;
}

/**
 * Concludes the task's open round as pass or fail (inside the caller's transaction). With no
 * open round, one is opened and concluded at once, so every result is on record.
 */
export async function concludeQaCycleInTx(
  tx: DbOrTx,
  actor: ActorContext,
  taskId: string,
  result: "pass" | "fail",
  summary: string,
) {
  let [open] = await tx
    .select({ id: qaCycles.id, cycleNumber: qaCycles.cycleNumber })
    .from(qaCycles)
    .where(and(eq(qaCycles.taskId, taskId), eq(qaCycles.result, "pending")))
    .for("update");
  open ??= await startQaCycleInTx(tx, actor, taskId);
  await tx
    .update(qaCycles)
    .set({ result, summary: summary.trim(), concludedBy: actor.userId, concludedAt: new Date() })
    .where(eq(qaCycles.id, open.id));
  await recordActivity(tx, actor, {
    entityType: "task",
    entityId: taskId,
    action: "qa_concluded",
    metadata: { cycle: open.cycleNumber, result },
  });
  await enqueueOutbox(tx, actor.workspaceId, "qa.concluded", { taskId, cycle: open.cycleNumber, result });
  return open;
}

/** "Start QA round" on the task. */
export async function startQaCycle(
  actor: ActorContext,
  taskId: string,
  raw: z.input<typeof startInput> = {},
) {
  const input = startInput.parse(raw);
  try {
    return await db().transaction(async (tx) => {
      const { role } = await loadTaskAccess(tx, actor, taskId);
      assertConduct(role);
      return startQaCycleInTx(tx, actor, taskId, input);
    });
  } catch (error) {
    lockedError(error);
  }
}

/** Pass or fail the open round. Failing needs a note saying what's wrong. */
export async function concludeQaCycle(
  actor: ActorContext,
  taskId: string,
  raw: z.input<typeof concludeInput>,
) {
  const input = concludeInput.parse(raw);
  if (input.result === "fail" && !input.summary) {
    throw new ValidationError("Say what failed", { summary: "Required when failing" });
  }
  try {
    return await db().transaction(async (tx) => {
      const { role } = await loadTaskAccess(tx, actor, taskId);
      assertConduct(role);
      return concludeQaCycleInTx(tx, actor, taskId, input.result, input.summary);
    });
  } catch (error) {
    lockedError(error);
  }
}

/** Environment and build of the open round (concluded rounds are locked). */
export async function updateQaCycle(actor: ActorContext, cycleId: string, raw: z.input<typeof startInput>) {
  const input = startInput.parse(raw);
  assertId(cycleId, "QA round not found");
  try {
    await db().transaction(async (tx) => {
      const [cycle] = await tx
        .select({ taskId: qaCycles.taskId })
        .from(qaCycles)
        .where(and(eq(qaCycles.id, cycleId), eq(qaCycles.workspaceId, actor.workspaceId)));
      if (!cycle) throw new NotFoundError("QA round not found");
      const { role } = await loadTaskAccess(tx, actor, cycle.taskId);
      assertConduct(role);
      await tx.update(qaCycles).set(input).where(eq(qaCycles.id, cycleId));
    });
  } catch (error) {
    lockedError(error);
  }
}

/** Screenshots, recordings or logs for the open round. */
export async function addQaEvidence(actor: ActorContext, cycleId: string, files: IncomingFile[]) {
  assertId(cycleId, "QA round not found");
  const [cycle] = await db()
    .select({ taskId: qaCycles.taskId, result: qaCycles.result })
    .from(qaCycles)
    .where(and(eq(qaCycles.id, cycleId), eq(qaCycles.workspaceId, actor.workspaceId)));
  if (!cycle) throw new NotFoundError("QA round not found");
  const { role } = await loadTaskAccess(db(), actor, cycle.taskId);
  assertConduct(role);
  if (cycle.result !== "pending") throw new ConflictError("That QA round is already concluded.");
  const uploads = await storeUploads(actor, files);
  if (!uploads.length) throw new ValidationError("Choose a file to attach");
  try {
    return await db().transaction((tx) =>
      insertAttachmentsInTx(tx, actor, cycle.taskId, null, uploads, cycleId),
    );
  } catch (error) {
    await discardUploads(uploads);
    throw error;
  }
}

/** A task's QA rounds, newest first, with their evidence. */
export async function listQaCycles(actor: ActorContext, taskId: string) {
  const { role } = await loadTaskAccess(db(), actor, taskId);
  const [rounds, files] = await Promise.all([
    db()
      .select({
        id: qaCycles.id,
        cycleNumber: qaCycles.cycleNumber,
        result: qaCycles.result,
        environmentUrl: qaCycles.environmentUrl,
        buildRef: qaCycles.buildRef,
        summary: qaCycles.summary,
        startedAt: qaCycles.startedAt,
        concludedAt: qaCycles.concludedAt,
        startedBy: qaCycles.startedBy,
        concludedBy: qaCycles.concludedBy,
      })
      .from(qaCycles)
      .where(eq(qaCycles.taskId, taskId))
      .orderBy(desc(qaCycles.cycleNumber)),
    attachmentsForTask(db(), taskId),
  ]);
  const people = new Map(
    (
      await db()
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(
          sql`${users.id} in (select started_by from qa_cycles where task_id = ${taskId}
                          union select concluded_by from qa_cycles where task_id = ${taskId})`,
        )
    ).map((u) => [u.id, u.name]),
  );
  return {
    rounds: rounds.map((r) => ({
      ...r,
      result: r.result as QaResult,
      startedByName: people.get(r.startedBy) ?? "Someone",
      concludedByName: r.concludedBy ? (people.get(r.concludedBy) ?? "Someone") : null,
      evidence: files.filter((f) => f.qaCycleId === r.id),
    })),
    can: { conduct: canProject(role, "qa.conduct") },
  };
}
