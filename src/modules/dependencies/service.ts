import "server-only";
import { aliasedTable, and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type DbOrTx } from "@/server/db";
import { listStatuses, projectMembers, projects, taskDependencies, tasks } from "@/server/db/schema";
import { canProject, type ActorContext } from "@/server/authz/policy";
import { ForbiddenError, NotFoundError, ValidationError, assertId, pgErrorInfo } from "@/server/errors";
import { recordActivity } from "@/modules/activity/service";
import { loadProjectAccess } from "@/modules/projects/service";
import { visibleProjectCondition } from "@/modules/projects/visibility";
import { loadTaskAccess } from "@/modules/tasks/service";
import { parseTaskRef } from "@/modules/tasks/validators";

export type Relation = "blocked_by" | "blocking";

/** A visible task by its reference ("WEB-12"); anything else is NotFound. */
async function loadTaskByRef(tx: DbOrTx, actor: ActorContext, ref: string) {
  const parsed = parseTaskRef(ref);
  if (!parsed) throw new ValidationError("Enter a task reference like WEB-12", { ref: "Use KEY-number" });
  const missing = () => new NotFoundError(`No task ${parsed.key}-${parsed.number} that you can see`);
  const { project } = await loadProjectAccess(tx, actor, { key: parsed.key }).catch((error: unknown) => {
    throw error instanceof NotFoundError ? missing() : error;
  });
  const [row] = await tx
    .select({ id: tasks.id, archivedAt: tasks.archivedAt })
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), eq(tasks.number, parsed.number)));
  if (!row || row.archivedAt) throw missing();
  return { id: row.id, ref: `${project.key}-${parsed.number}` };
}

async function refOf(tx: DbOrTx, taskId: string) {
  const [row] = await tx
    .select({ key: projects.key, number: tasks.number })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(eq(tasks.id, taskId));
  return row ? `${row.key}-${row.number}` : "";
}

/** One workspace's dependency changes run one at a time, so concurrent links can't form a loop. */
async function lockDependencies(tx: DbOrTx, workspaceId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`eightcore:deps:${workspaceId}`}))`);
}

/**
 * Links this task to another one. "blocked_by": the other task must be finished first;
 * "blocking": this one must be finished before the other. Needs task.update on this task
 * and visibility of the other.
 */
export async function addDependency(
  actor: ActorContext,
  taskId: string,
  raw: { ref: string; relation: Relation },
) {
  if (raw.relation !== "blocked_by" && raw.relation !== "blocking")
    throw new ValidationError("Pick a relation");
  try {
    await db().transaction(async (tx) => {
      const { task, role } = await loadTaskAccess(tx, actor, taskId);
      if (!canProject(role, "task.update")) throw new ForbiddenError();
      const other = await loadTaskByRef(tx, actor, raw.ref);
      if (other.id === task.id)
        throw new ValidationError("A task can't depend on itself", { ref: "Pick another task" });
      const [blockingTaskId, blockedTaskId] =
        raw.relation === "blocked_by" ? [other.id, task.id] : [task.id, other.id];

      await lockDependencies(tx, actor.workspaceId);
      await tx
        .insert(taskDependencies)
        .values({ workspaceId: actor.workspaceId, blockingTaskId, blockedTaskId, createdBy: actor.userId });

      const thisRef = await refOf(tx, task.id);
      const metadata = {
        blocking: raw.relation === "blocked_by" ? other.ref : thisRef,
        blocked: raw.relation === "blocked_by" ? thisRef : other.ref,
      };
      for (const id of [task.id, other.id]) {
        await recordActivity(tx, actor, {
          entityType: "task",
          entityId: id,
          action: "dependency_added",
          metadata,
        });
      }
    });
  } catch (error) {
    const { code, constraint } = pgErrorInfo(error);
    if (constraint === "task_dependencies_no_cycles") {
      throw new ValidationError("That would make the tasks wait on each other in a loop", {
        ref: "Creates a loop",
      });
    }
    if (code === "23505")
      throw new ValidationError("These tasks are already linked", { ref: "Already linked" });
    throw error;
  }
}

/** Removes a link. Needs task.update on either of the two tasks (and sight of it). */
export async function removeDependency(actor: ActorContext, blockingTaskId: string, blockedTaskId: string) {
  assertId(blockingTaskId, "Dependency not found");
  assertId(blockedTaskId, "Dependency not found");
  await db().transaction(async (tx) => {
    const roles = await Promise.all(
      [blockingTaskId, blockedTaskId].map((id) =>
        loadTaskAccess(tx, actor, id).then(
          (a) => a.role,
          (error: unknown) => {
            if (error instanceof NotFoundError) return null;
            throw error;
          },
        ),
      ),
    );
    if (roles.every((r) => r === null)) throw new NotFoundError("Dependency not found");
    if (!roles.some((r) => r && canProject(r, "task.update"))) throw new ForbiddenError();
    await lockDependencies(tx, actor.workspaceId);
    const removed = await tx
      .delete(taskDependencies)
      .where(
        and(
          eq(taskDependencies.workspaceId, actor.workspaceId),
          eq(taskDependencies.blockingTaskId, blockingTaskId),
          eq(taskDependencies.blockedTaskId, blockedTaskId),
        ),
      )
      .returning({ blockedTaskId: taskDependencies.blockedTaskId });
    if (!removed.length) throw new NotFoundError("Dependency not found");
    const metadata = { blocking: await refOf(tx, blockingTaskId), blocked: await refOf(tx, blockedTaskId) };
    for (const id of [blockingTaskId, blockedTaskId]) {
      await recordActivity(tx, actor, {
        entityType: "task",
        entityId: id,
        action: "dependency_removed",
        metadata,
      });
    }
  });
}

const other = aliasedTable(tasks, "other_task");

/** Linked tasks the actor can see, each with its status, for a task the actor can already see. */
async function linked(tx: DbOrTx, actor: ActorContext, taskId: string, direction: Relation) {
  const joinOn =
    direction === "blocked_by"
      ? and(eq(taskDependencies.blockedTaskId, taskId), eq(other.id, taskDependencies.blockingTaskId))
      : and(eq(taskDependencies.blockingTaskId, taskId), eq(other.id, taskDependencies.blockedTaskId));
  const rows = await tx
    .select({
      id: other.id,
      number: other.number,
      title: other.title,
      completedAt: other.completedAt,
      projectKey: projects.key,
      statusName: listStatuses.name,
      statusColor: listStatuses.color,
    })
    .from(taskDependencies)
    .innerJoin(other, joinOn)
    .innerJoin(projects, eq(projects.id, other.projectId))
    .innerJoin(listStatuses, eq(listStatuses.id, other.statusId))
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actor.userId)),
    )
    .where(
      and(
        eq(taskDependencies.workspaceId, actor.workspaceId),
        isNull(other.archivedAt),
        visibleProjectCondition(actor),
      ),
    )
    .orderBy(asc(projects.key), asc(other.number));
  return rows.map((r) => ({ ...r, ref: `${r.projectKey}-${r.number}`, done: r.completedAt !== null }));
}

export async function getTaskDependencies(actor: ActorContext, taskId: string) {
  const { role } = await loadTaskAccess(db(), actor, taskId);
  const [blockedBy, blocking] = await Promise.all([
    linked(db(), actor, taskId, "blocked_by"),
    linked(db(), actor, taskId, "blocking"),
  ]);
  return {
    blockedBy,
    blocking,
    openBlockers: blockedBy.filter((t) => !t.done).length,
    canEdit: canProject(role, "task.update"),
  };
}

/** For list rows: how many unfinished, visible tasks block each task. */
export async function openBlockerCounts(tx: DbOrTx, actor: ActorContext, taskIds: string[]) {
  const counts = new Map<string, number>();
  if (!taskIds.length) return counts;
  const rows = await tx
    .select({ taskId: taskDependencies.blockedTaskId, n: sql<number>`count(*)::int` })
    .from(taskDependencies)
    .innerJoin(other, eq(other.id, taskDependencies.blockingTaskId))
    .innerJoin(projects, eq(projects.id, other.projectId))
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actor.userId)),
    )
    .where(
      and(
        inArray(taskDependencies.blockedTaskId, taskIds),
        isNull(other.completedAt),
        isNull(other.archivedAt),
        visibleProjectCondition(actor),
      ),
    )
    .groupBy(taskDependencies.blockedTaskId);
  for (const r of rows) counts.set(r.taskId, r.n);
  return counts;
}
