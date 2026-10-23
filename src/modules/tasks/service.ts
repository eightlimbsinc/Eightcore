import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { db, type DbOrTx } from "@/server/db";
import {
  activityEvents,
  projectMembers,
  projects,
  taskAssignees,
  tasks,
  users,
  workspaceMembers,
} from "@/server/db/schema";
import { canProject, effectiveProjectRole, type ActorContext } from "@/server/authz/policy";
import type { ProjectAction, ProjectRole } from "@/server/authz/matrix";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  assertId,
  pgErrorInfo,
} from "@/server/errors";
import { enqueueOutbox, recordActivity } from "@/modules/activity/service";
import { loadProjectAccess } from "@/modules/projects/service";
import { listStatusesFor, loadListAccess } from "@/modules/lists/service";
import { isClosedCategory } from "@/modules/lists/templates";
import {
  createTaskInput,
  parseTaskRef,
  updateTaskInput,
  type CreateTaskInput,
  type UpdateTaskInput,
} from "./validators";

function assertProject(role: ProjectRole, action: ProjectAction): void {
  if (!canProject(role, action)) throw new ForbiddenError();
}

function mapHierarchyError(error: unknown): never {
  const { constraint } = pgErrorInfo(error);
  if (constraint === "tasks_max_depth")
    throw new ValidationError("Subtasks can be nested at most 5 levels deep");
  if (constraint === "tasks_no_cycles")
    throw new ValidationError("A task can't be placed under its own subtask");
  if (constraint === "tasks_dates_order") {
    throw new ValidationError("The start date must be on or before the due date", {
      dueDate: "Must be on or after the start date",
    });
  }
  throw error;
}

/** A task in the actor's workspace, with list, project and effective role. Invisible → NotFound. */
async function loadTaskAccess(tx: DbOrTx, actor: ActorContext, taskId: string) {
  assertId(taskId, "Task not found");
  const [task] = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, actor.workspaceId)));
  if (!task) throw new NotFoundError("Task not found");
  const { list, project, role } = await loadListAccess(tx, actor, task.listId);
  return { task, list, project, role };
}

/**
 * Users who may be assigned in a project: active workspace members who can see it
 * (owners/admins always; members on workspace-visible projects or when added; guests when added).
 */
async function assignableUserIds(
  tx: DbOrTx,
  actor: ActorContext,
  projectId: string,
  visibility: "workspace" | "private",
) {
  const rows = await tx
    .select({
      userId: workspaceMembers.userId,
      role: workspaceMembers.role,
      explicitRole: projectMembers.role,
    })
    .from(workspaceMembers)
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, workspaceMembers.userId)),
    )
    .where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.status, "active")));
  return new Set(
    rows
      .filter((r) => effectiveProjectRole(r.role, visibility, r.explicitRole) !== null)
      .map((r) => r.userId),
  );
}

export async function listAssignableMembers(actor: ActorContext, projectId: string) {
  const { project } = await loadProjectAccess(db(), actor, { id: projectId });
  const ids = [...(await assignableUserIds(db(), actor, projectId, project.visibility))];
  if (ids.length === 0) return [];
  return db()
    .select({ userId: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, ids))
    .orderBy(asc(users.name));
}

async function setAssigneesInTx(
  tx: DbOrTx,
  actor: ActorContext,
  task: { id: string; projectId: string },
  visibility: "workspace" | "private",
  userIds: string[],
) {
  const wanted = [...new Set(userIds)];
  wanted.forEach((id) => assertId(id, "Member not found"));
  const allowed = await assignableUserIds(tx, actor, task.projectId, visibility);
  if (wanted.some((id) => !allowed.has(id)))
    throw new NotFoundError("One of those people can't be assigned to this project");
  const current = (
    await tx
      .select({ userId: taskAssignees.userId })
      .from(taskAssignees)
      .where(eq(taskAssignees.taskId, task.id))
  ).map((r) => r.userId);
  const added = wanted.filter((id) => !current.includes(id));
  const removed = current.filter((id) => !wanted.includes(id));
  if (removed.length) {
    await tx
      .delete(taskAssignees)
      .where(and(eq(taskAssignees.taskId, task.id), inArray(taskAssignees.userId, removed)));
  }
  if (added.length) {
    await tx.insert(taskAssignees).values(
      added.map((userId) => ({
        workspaceId: actor.workspaceId,
        taskId: task.id,
        userId,
        assignedBy: actor.userId,
      })),
    );
  }
  return { added, removed };
}

// ── Create ────────────────────────────────────────────────────────────────────────────────

export async function createTask(actor: ActorContext, listId: string, raw: CreateTaskInput) {
  const input = createTaskInput.parse(raw);
  try {
    return await db().transaction(async (tx) => {
      const { list, project, role } = await loadListAccess(tx, actor, listId);
      assertProject(role, "task.create");
      if (list.archivedAt) throw new ConflictError("This list is archived");

      const statuses = await listStatusesFor(tx, listId);
      const status = input.statusId ? statuses.find((s) => s.id === input.statusId) : statuses[0];
      if (!status) throw new NotFoundError("Status not found in this list");

      if (input.parentTaskId) {
        const [parent] = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.id, input.parentTaskId), eq(tasks.listId, listId), isNull(tasks.archivedAt)));
        if (!parent) throw new NotFoundError("Parent task not found in this list");
      }

      // Next KEY-number, under the project row's lock.
      const [counter] = await tx
        .update(projects)
        .set({ nextTaskNumber: sql`${projects.nextTaskNumber} + 1` })
        .where(eq(projects.id, project.id))
        .returning({ number: sql<number>`${projects.nextTaskNumber} - 1` });

      const siblings = input.parentTaskId
        ? eq(tasks.parentTaskId, input.parentTaskId)
        : and(eq(tasks.listId, listId), isNull(tasks.parentTaskId));
      const [last] = await tx
        .select({ position: tasks.position })
        .from(tasks)
        .where(siblings)
        .orderBy(desc(tasks.position))
        .limit(1);

      const [task] = await tx
        .insert(tasks)
        .values({
          workspaceId: actor.workspaceId,
          projectId: project.id,
          listId,
          statusId: status.id,
          parentTaskId: input.parentTaskId ?? null,
          number: counter!.number,
          title: input.title,
          priority: input.priority,
          startDate: input.startDate ?? null,
          dueDate: input.dueDate ?? null,
          position: generateKeyBetween(last?.position ?? null, null),
          createdBy: actor.userId,
          completedAt: isClosedCategory(status.category) ? new Date() : null,
        })
        .returning({ id: tasks.id, number: tasks.number });

      if (input.assigneeIds.length) {
        await setAssigneesInTx(
          tx,
          actor,
          { id: task!.id, projectId: project.id },
          project.visibility,
          input.assigneeIds,
        );
      }
      await recordActivity(tx, actor, {
        entityType: "task",
        entityId: task!.id,
        action: "created",
        metadata: { title: input.title, status: status.name, parentTaskId: input.parentTaskId ?? null },
      });
      await enqueueOutbox(tx, actor.workspaceId, "task.created", { taskId: task!.id, listId });
      return { id: task!.id, number: task!.number, ref: `${project.key}-${task!.number}` };
    });
  } catch (error) {
    mapHierarchyError(error);
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────────────────

async function assigneesFor(tx: DbOrTx, taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, { userId: string; name: string }[]>();
  const rows = await tx
    .select({ taskId: taskAssignees.taskId, userId: users.id, name: users.name })
    .from(taskAssignees)
    .innerJoin(users, eq(users.id, taskAssignees.userId))
    .where(inArray(taskAssignees.taskId, taskIds))
    .orderBy(asc(users.name));
  const map = new Map<string, { userId: string; name: string }[]>();
  for (const r of rows) map.set(r.taskId, [...(map.get(r.taskId) ?? []), { userId: r.userId, name: r.name }]);
  return map;
}

const taskSummaryColumns = {
  id: tasks.id,
  number: tasks.number,
  title: tasks.title,
  statusId: tasks.statusId,
  priority: tasks.priority,
  startDate: tasks.startDate,
  dueDate: tasks.dueDate,
  position: tasks.position,
  completedAt: tasks.completedAt,
  version: tasks.version,
  // Correlated subquery: the outer table must be named explicitly ("tasks"."id"); an
  // interpolated column renders unqualified and would bind to the inner alias.
  subtaskCount: sql<number>`(select count(*)::int from ${tasks} c where c.parent_task_id = "tasks"."id" and c.archived_at is null)`,
};

/** Top-level tasks of a list, each with assignees and subtask count, in list order. */
export async function listTasks(actor: ActorContext, listId: string) {
  await loadListAccess(db(), actor, listId);
  const rows = await db()
    .select(taskSummaryColumns)
    .from(tasks)
    .where(and(eq(tasks.listId, listId), isNull(tasks.parentTaskId), isNull(tasks.archivedAt)))
    .orderBy(asc(tasks.position));
  const assignees = await assigneesFor(
    db(),
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, assignees: assignees.get(r.id) ?? [] }));
}

/** Full task detail by its reference ("WEB-12"). */
export async function getTaskByRef(actor: ActorContext, ref: string) {
  const parsed = parseTaskRef(ref);
  if (!parsed) throw new NotFoundError("Task not found");
  const { project, role } = await loadProjectAccess(db(), actor, { key: parsed.key });
  const [row] = await db()
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), eq(tasks.number, parsed.number)));
  if (!row) throw new NotFoundError("Task not found");
  const { task, list } = await loadTaskAccess(db(), actor, row.id);

  const [statuses, assigneeMap, subtaskRows, parent, activity, assignable] = await Promise.all([
    listStatusesFor(db(), list.id),
    assigneesFor(db(), [task.id]),
    db()
      .select(taskSummaryColumns)
      .from(tasks)
      .where(and(eq(tasks.parentTaskId, task.id), isNull(tasks.archivedAt)))
      .orderBy(asc(tasks.position)),
    task.parentTaskId
      ? db()
          .select({ number: tasks.number, title: tasks.title })
          .from(tasks)
          .where(eq(tasks.id, task.parentTaskId))
      : Promise.resolve([]),
    listTaskActivity(db(), actor, task.id),
    listAssignableMembers(actor, project.id),
  ]);
  const subtaskAssignees = await assigneesFor(
    db(),
    subtaskRows.map((s) => s.id),
  );
  const isCreator = task.createdBy === actor.userId;
  return {
    task,
    project: { id: project.id, key: project.key, name: project.name },
    list: { id: list.id, name: list.name },
    parent: parent[0] ? { ...parent[0], ref: `${project.key}-${parent[0].number}` } : null,
    statuses,
    assignees: assigneeMap.get(task.id) ?? [],
    assignable,
    subtasks: subtaskRows.map((s) => ({
      ...s,
      ref: `${project.key}-${s.number}`,
      assignees: subtaskAssignees.get(s.id) ?? [],
    })),
    activity,
    can: {
      update: canProject(role, "task.update"),
      createSubtask: canProject(role, "task.create"),
      archive: canProject(role, "task.archive") || (isCreator && canProject(role, "task.archive_own")),
    },
  };
}

export async function listTaskActivity(tx: DbOrTx, actor: ActorContext, taskId: string) {
  return tx
    .select({
      id: activityEvents.id,
      action: activityEvents.action,
      changes: activityEvents.changes,
      metadata: activityEvents.metadata,
      createdAt: activityEvents.createdAt,
      actorName: users.name,
      actorKind: activityEvents.actorKind,
    })
    .from(activityEvents)
    .leftJoin(users, eq(users.id, activityEvents.actorId))
    .where(
      and(
        eq(activityEvents.workspaceId, actor.workspaceId),
        eq(activityEvents.entityType, "task"),
        eq(activityEvents.entityId, taskId),
      ),
    )
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
    .limit(100);
}

// ── Update ────────────────────────────────────────────────────────────────────────────────

/**
 * Updates task fields. `expectedVersion` is the version the editor loaded; if someone saved
 * in between, nothing changes and a ConflictError asks the user to review and retry.
 */
export async function updateTask(
  actor: ActorContext,
  taskId: string,
  expectedVersion: number,
  raw: UpdateTaskInput,
) {
  const input = updateTaskInput.parse(raw);
  try {
    return await db().transaction(async (tx) => {
      const { task, list, role } = await loadTaskAccess(tx, actor, taskId);
      assertProject(role, "task.update");
      if (task.version !== expectedVersion) {
        throw new ConflictError(
          "Someone else changed this task. Reload to see their changes, then try again.",
        );
      }
      const statuses = await listStatusesFor(tx, list.id);
      const changes: Record<string, [unknown, unknown]> = {};
      const set: Partial<typeof tasks.$inferInsert> = {};

      for (const field of ["title", "description", "priority", "startDate", "dueDate"] as const) {
        const next = input[field];
        if (next !== undefined && next !== task[field]) {
          changes[field] = [task[field], next];
          (set as Record<string, unknown>)[field] = next;
        }
      }
      if (input.statusId !== undefined && input.statusId !== task.statusId) {
        const from = statuses.find((s) => s.id === task.statusId);
        const to = statuses.find((s) => s.id === input.statusId);
        if (!to) throw new NotFoundError("Status not found in this list");
        changes.status = [from?.name ?? null, to.name];
        set.statusId = to.id;
        const wasClosed = from ? isClosedCategory(from.category) : false;
        if (isClosedCategory(to.category) && !wasClosed) set.completedAt = new Date();
        if (!isClosedCategory(to.category)) set.completedAt = null;
      }
      if (Object.keys(changes).length === 0) return { version: task.version };

      const [updated] = await tx
        .update(tasks)
        .set({ ...set, version: sql`${tasks.version} + 1` })
        .where(and(eq(tasks.id, taskId), eq(tasks.version, expectedVersion)))
        .returning({ version: tasks.version });
      if (!updated)
        throw new ConflictError(
          "Someone else changed this task. Reload to see their changes, then try again.",
        );

      await recordActivity(tx, actor, { entityType: "task", entityId: taskId, action: "updated", changes });
      await enqueueOutbox(tx, actor.workspaceId, "task.updated", { taskId, fields: Object.keys(changes) });
      return { version: updated.version };
    });
  } catch (error) {
    mapHierarchyError(error);
  }
}

export async function setTaskAssignees(actor: ActorContext, taskId: string, userIds: string[]) {
  await db().transaction(async (tx) => {
    const { task, project, role } = await loadTaskAccess(tx, actor, taskId);
    assertProject(role, "task.update");
    const { added, removed } = await setAssigneesInTx(tx, actor, task, project.visibility, userIds);
    if (!added.length && !removed.length) return;
    await tx
      .update(tasks)
      .set({ version: sql`${tasks.version} + 1` })
      .where(eq(tasks.id, taskId));
    await recordActivity(tx, actor, {
      entityType: "task",
      entityId: taskId,
      action: "assignees_changed",
      metadata: { added, removed },
    });
    await enqueueOutbox(tx, actor.workspaceId, "task.assignees_changed", { taskId, added, removed });
  });
}

export async function setTaskArchived(actor: ActorContext, taskId: string, archived: boolean) {
  await db().transaction(async (tx) => {
    const { task, role } = await loadTaskAccess(tx, actor, taskId);
    const allowed =
      canProject(role, "task.archive") ||
      (task.createdBy === actor.userId && canProject(role, "task.archive_own"));
    if (!allowed) throw new ForbiddenError();
    if (Boolean(task.archivedAt) === archived) return;
    await tx
      .update(tasks)
      .set({ archivedAt: archived ? new Date() : null, version: sql`${tasks.version} + 1` })
      .where(eq(tasks.id, taskId));
    await recordActivity(tx, actor, {
      entityType: "task",
      entityId: taskId,
      action: archived ? "archived" : "restored",
    });
  });
}
