import "server-only";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import {
  listStatuses,
  projectMembers,
  projects,
  tags,
  taskAssignees,
  taskLists,
  tasks,
  taskTags,
  users,
} from "@/server/db/schema";
import type { ActorContext } from "@/server/authz/policy";
import { assertId } from "@/server/errors";
import { visibleProjectCondition } from "@/modules/projects/visibility";
import { addDays, weekOf } from "@/modules/tasks/filters";

const WEEKS = 8;

export interface DashboardTotals {
  open: number;
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  noDueDate: number;
  unassigned: number;
  blocked: number;
  doneThisWeek: number;
  createdThisWeek: number;
}
const open = sql`${listStatuses.category} not in ('done', 'cancelled', 'closed')`;
const done = sql`${listStatuses.category} = 'done'`;

/** Live tasks in visible projects (optionally one project), with their status joined. */
function scoped(actor: ActorContext, projectId?: string) {
  return {
    from: <T extends ReturnType<ReturnType<typeof db>["select"]>>(q: T) =>
      q
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .innerJoin(taskLists, eq(taskLists.id, tasks.listId))
        .innerJoin(listStatuses, eq(listStatuses.id, tasks.statusId))
        .leftJoin(
          projectMembers,
          and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actor.userId)),
        ),
    where: (...extra: (SQL | undefined)[]) =>
      and(
        eq(tasks.workspaceId, actor.workspaceId),
        isNull(tasks.archivedAt),
        isNull(taskLists.archivedAt),
        isNull(projects.archivedAt),
        projectId ? eq(projects.id, projectId) : undefined,
        visibleProjectCondition(actor),
        ...extra,
      ),
  };
}

/**
 * Everything the dashboard shows, for the projects the actor can see (or one of them).
 * Dates are the viewer's: `today` and `timeZone` come from their browser.
 */
export async function getDashboard(
  actor: ActorContext,
  options: { today: string; timeZone: string; projectId?: string },
) {
  if (options.projectId) assertId(options.projectId, "Project not found");
  const { today, timeZone } = options;
  const [monday, sunday] = weekOf(today);
  const firstWeek = addDays(monday, -7 * (WEEKS - 1));
  const s = scoped(actor, options.projectId);
  const localDate = (column: SQL | typeof tasks.completedAt) =>
    sql`(${column} at time zone ${timeZone})::date`;
  const count = sql<number>`count(*)::int`;
  const countIf = (cond: SQL) => sql<number>`(count(*) filter (where ${cond}))::int`;

  const [totals, stages, workload, weeks, priorities, topTags] = await Promise.all([
    s
      .from(
        db().select({
          open: countIf(open),
          overdue: countIf(sql`${open} and ${tasks.dueDate} < ${today}`),
          dueToday: countIf(sql`${open} and ${tasks.dueDate} = ${today}`),
          dueThisWeek: countIf(sql`${open} and ${tasks.dueDate} between ${monday} and ${sunday}`),
          noDueDate: countIf(sql`${open} and ${tasks.dueDate} is null`),
          unassigned: countIf(
            sql`${open} and not exists (select 1 from task_assignees a where a.task_id = "tasks"."id")`,
          ),
          blocked: countIf(sql`${open} and exists (
          select 1 from task_dependencies d join tasks b on b.id = d.blocking_task_id
           where d.blocked_task_id = "tasks"."id" and b.completed_at is null and b.archived_at is null)`),
          doneThisWeek: countIf(
            sql`${done} and ${localDate(tasks.completedAt)} between ${monday} and ${sunday}`,
          ),
          createdThisWeek: countIf(
            sql`${localDate(sql`${tasks.createdAt}`)} between ${monday} and ${sunday}`,
          ),
        }),
      )
      .where(s.where()),
    s
      .from(db().select({ category: listStatuses.category, n: count }))
      .where(s.where())
      .groupBy(listStatuses.category),
    s
      .from(
        db().select({
          userId: users.id,
          name: users.name,
          n: count,
          urgentOrHigh: countIf(sql`${tasks.priority} in ('urgent', 'high')`),
          overdue: countIf(sql`${tasks.dueDate} < ${today}`),
        }),
      )
      .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
      .innerJoin(users, eq(users.id, taskAssignees.userId))
      .where(s.where(open))
      .groupBy(users.id, users.name)
      .orderBy(desc(count), users.name)
      .limit(15),
    s
      .from(
        db().select({
          week: sql<string>`date_trunc('week', ${localDate(tasks.completedAt)})::date::text`,
          n: count,
        }),
      )
      .where(s.where(done, sql`${localDate(tasks.completedAt)} >= ${firstWeek}`))
      .groupBy(sql`1`),
    s
      .from(db().select({ priority: tasks.priority, n: count }))
      .where(s.where(open))
      .groupBy(tasks.priority),
    s
      .from(db().select({ name: tags.name, n: count }))
      .innerJoin(taskTags, eq(taskTags.taskId, tasks.id))
      .innerJoin(tags, eq(tags.id, taskTags.tagId))
      .where(s.where(open))
      .groupBy(tags.name)
      .orderBy(desc(count), tags.name)
      .limit(8),
  ]);

  // The shared query helper loses Drizzle's column types, so name the shapes here.
  type Category = (typeof listStatuses.$inferSelect)["category"];
  type Priority = (typeof tasks.$inferSelect)["priority"];
  const stageRows = stages as { category: Category; n: number }[];
  const weekRows = weeks as { week: string; n: number }[];
  const priorityRows = priorities as { priority: Priority; n: number }[];
  const byWeek = new Map(weekRows.map((w) => [w.week, w.n]));
  return {
    totals: totals[0] as unknown as DashboardTotals,
    stages: Object.fromEntries(stageRows.map((r) => [r.category, r.n])) as Partial<Record<Category, number>>,
    workload: workload as {
      userId: string;
      name: string;
      n: number;
      urgentOrHigh: number;
      overdue: number;
    }[],
    completedByWeek: Array.from({ length: WEEKS }, (_, i) => {
      const week = addDays(firstWeek, 7 * i);
      return { week, n: byWeek.get(week) ?? 0 };
    }),
    priorities: Object.fromEntries(priorityRows.map((r) => [r.priority, r.n])) as Partial<
      Record<Priority, number>
    >,
    topTags: topTags as { name: string; n: number }[],
  };
}
