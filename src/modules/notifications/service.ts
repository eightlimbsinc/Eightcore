import "server-only";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "@/server/db";
import { notifications, projectMembers, projects, tasks, taskWatchers, users } from "@/server/db/schema";
import type { ActorContext } from "@/server/authz/policy";
import { visibleProjectCondition } from "@/modules/projects/visibility";
import { assertId } from "@/server/errors";

export type NotificationType = (typeof notifications.$inferInsert)["type"];

// ── Watchers ──────────────────────────────────────────────────────────────────────────────

/** Adds watchers (already-watching users are left as they are). Call inside the change's transaction. */
export async function addWatchersInTx(tx: DbOrTx, actor: ActorContext, taskId: string, userIds: string[]) {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  await tx
    .insert(taskWatchers)
    .values(unique.map((userId) => ({ workspaceId: actor.workspaceId, taskId, userId })))
    .onConflictDoNothing();
}

export async function watcherIds(tx: DbOrTx, taskId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: taskWatchers.userId })
    .from(taskWatchers)
    .where(eq(taskWatchers.taskId, taskId));
  return rows.map((r) => r.userId);
}

export async function listWatchers(tx: DbOrTx, taskId: string) {
  return tx
    .select({ userId: users.id, name: users.name })
    .from(taskWatchers)
    .innerJoin(users, eq(users.id, taskWatchers.userId))
    .where(eq(taskWatchers.taskId, taskId))
    .orderBy(users.name);
}

// ── Sending ───────────────────────────────────────────────────────────────────────────────

/**
 * Notifies people about a task change, inside the change's transaction. The actor never
 * notifies themselves, and only people in `allowed` (those who can currently see the
 * project) receive anything.
 */
export async function notifyInTx(
  tx: DbOrTx,
  actor: ActorContext,
  input: {
    taskId: string;
    type: NotificationType;
    userIds: Iterable<string>;
    allowed: Set<string>;
    data?: Record<string, unknown>;
  },
) {
  // Bulk imports don't notify anyone (a CSV of 60 tasks would flood people's inboxes).
  if (actor.actorKind === "import") return [];
  const recipients = [...new Set(input.userIds)].filter((id) => id !== actor.userId && input.allowed.has(id));
  if (!recipients.length) return [];
  await tx.insert(notifications).values(
    recipients.map((userId) => ({
      workspaceId: actor.workspaceId,
      userId,
      type: input.type,
      taskId: input.taskId,
      actorId: actor.actorKind === "user" ? actor.userId : null,
      data: input.data ?? {},
    })),
  );
  return recipients;
}

// ── Inbox ─────────────────────────────────────────────────────────────────────────────────

const INBOX_LIMIT = 100;

/**
 * The actor's notifications in this workspace, newest first. Notifications about projects
 * they can no longer see are left out (the task title would otherwise leak).
 */
export async function listNotifications(actor: ActorContext, options: { unreadOnly?: boolean } = {}) {
  const rows = await db()
    .select({
      id: notifications.id,
      type: notifications.type,
      data: notifications.data,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      actorName: users.name,
      taskNumber: tasks.number,
      taskTitle: tasks.title,
      taskArchivedAt: tasks.archivedAt,
      projectKey: projects.key,
      projectName: projects.name,
    })
    .from(notifications)
    .innerJoin(tasks, eq(tasks.id, notifications.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actor.userId)),
    )
    .leftJoin(users, eq(users.id, notifications.actorId))
    .where(
      and(
        eq(notifications.userId, actor.userId),
        eq(notifications.workspaceId, actor.workspaceId),
        options.unreadOnly ? isNull(notifications.readAt) : undefined,
        visibleProjectCondition(actor),
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(INBOX_LIMIT);
  return rows.map((r) => ({ ...r, taskRef: `${r.projectKey}-${r.taskNumber}` }));
}

/** Unread count for the sidebar badge (capped; the badge shows "99+"). */
export async function countUnread(actor: ActorContext): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(notifications)
    .innerJoin(tasks, eq(tasks.id, notifications.taskId))
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actor.userId)),
    )
    .where(
      and(
        eq(notifications.userId, actor.userId),
        eq(notifications.workspaceId, actor.workspaceId),
        isNull(notifications.readAt),
        visibleProjectCondition(actor),
      ),
    );
  return row?.n ?? 0;
}

/** Marks notifications read. With no ids, marks everything in this workspace. */
export async function markNotificationsRead(actor: ActorContext, ids?: string[]) {
  ids?.forEach((id) => assertId(id, "Notification not found"));
  if (ids && ids.length === 0) return;
  await db()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, actor.userId),
        eq(notifications.workspaceId, actor.workspaceId),
        isNull(notifications.readAt),
        ids ? inArray(notifications.id, ids) : undefined,
      ),
    );
}

/** Marks the actor's notifications about one task read (when they open it from the inbox). */
export async function markTaskNotificationsRead(actor: ActorContext, taskId: string) {
  assertId(taskId, "Task not found");
  await db()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, actor.userId),
        eq(notifications.workspaceId, actor.workspaceId),
        eq(notifications.taskId, taskId),
        isNull(notifications.readAt),
      ),
    );
}
