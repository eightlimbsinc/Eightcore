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
  timeEntries,
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
        visibleProjectCondition(actor, tasks.listId),
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

  const [totals, stages, workload, weeks, priorities, topTags, timeThisWeek] = await Promise.all([
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
    // Time tracked this week per person (on visible tasks; a running timer counts so far).
    s
      .from(
        db().select({
          userId: users.id,
          name: users.name,
          seconds: sql<number>`sum(case when ${timeEntries.endedAt} is null
            then least(604800, extract(epoch from now() - ${timeEntries.startedAt}))
            else ${timeEntries.durationSeconds} end)::int`,
        }),
      )
      .innerJoin(timeEntries, eq(timeEntries.taskId, tasks.id))
      .innerJoin(users, eq(users.id, timeEntries.userId))
      .where(s.where(sql`${localDate(sql`${timeEntries.startedAt}`)} between ${monday} and ${sunday}`))
      .groupBy(users.id, users.name)
      .orderBy(desc(sql`3`), users.name)
      .limit(15),
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
    timeThisWeek: (timeThisWeek as { userId: string; name: string; seconds: number }[]).map((r) => ({
      ...r,
      seconds: Number(r.seconds),
    })),
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

/** How far back the flow report looks. */
export const FLOW_DAYS = 90;

export interface FlowReport {
  /** The period covered, in days. */
  days: number;
  /** Per status reached in the period: how long tasks stayed (hours). Ongoing stays count up to now. */
  timeInStatus: { name: string; category: string; stays: number; medianHours: number; avgHours: number }[];
  /** Tasks finished in the period: start of work → done, and created → done (hours). */
  cycle: {
    done: number;
    medianCycleHours: number | null;
    p85CycleHours: number | null;
    medianLeadHours: number | null;
  };
  /** Open tasks that have been in their current status longest. */
  stuck: { ref: string; title: string; statusName: string; hours: number }[];
}

/**
 * Status history for the dashboard: time in each status, cycle and lead times, and work
 * sitting still. Same scope as getDashboard (visible projects, optionally one).
 */
export async function getFlowReport(
  actor: ActorContext,
  options: { projectId?: string },
): Promise<FlowReport> {
  if (options.projectId) assertId(options.projectId, "Project not found");
  const s = scoped(actor, options.projectId);
  // Visible, live tasks (any status) in scope.
  const visible = s.from(db().select({ id: tasks.id })).where(s.where());
  const since = sql`now() - make_interval(days => ${FLOW_DAYS})`;
  const hours = (a: SQL, b: SQL) => sql`extract(epoch from (${b} - ${a})) / 3600`;

  const [inStatus, cycle, stuck] = await Promise.all([
    db().execute<{
      name: string;
      category: string;
      stays: number;
      median_hours: number;
      avg_hours: number;
    }>(sql`
      with v as (${visible}),
      h as (
        select c.task_id, c.to_name, c.to_category, c.changed_at,
               coalesce(lead(c.changed_at) over (partition by c.task_id order by c.changed_at), now()) as left_at
          from task_status_changes c
         where c.task_id in (select id from v)
      )
      select to_name as name, to_category::text as category, count(*)::int as stays,
             percentile_cont(0.5) within group (order by ${hours(sql`changed_at`, sql`left_at`)})::float as median_hours,
             avg(${hours(sql`changed_at`, sql`left_at`)})::float as avg_hours
        from h
       where left_at >= ${since} and to_category not in ('done', 'cancelled', 'closed')
       group by to_name, to_category
       order by avg(${hours(sql`changed_at`, sql`left_at`)}) desc
       limit 15`),
    db().execute<{
      done: number;
      median_cycle: number | null;
      p85_cycle: number | null;
      median_lead: number | null;
    }>(sql`
      with v as (${visible}),
      finished as (
        select t.id, t.created_at, t.completed_at,
               (select min(c.changed_at) from task_status_changes c
                 where c.task_id = t.id and c.to_category in ('active', 'review')) as started_at
          from tasks t
          join list_statuses st on st.id = t.status_id
         where t.id in (select id from v) and st.category = 'done' and t.completed_at >= ${since}
      )
      select count(*)::int as done,
             (percentile_cont(0.5) within group (order by ${hours(sql`coalesce(started_at, created_at)`, sql`completed_at`)}))::float as median_cycle,
             (percentile_cont(0.85) within group (order by ${hours(sql`coalesce(started_at, created_at)`, sql`completed_at`)}))::float as p85_cycle,
             (percentile_cont(0.5) within group (order by ${hours(sql`created_at`, sql`completed_at`)}))::float as median_lead
        from finished`),
    db().execute<{ ref: string; title: string; status_name: string; hours: number }>(sql`
      with v as (${visible})
      select p.key || '-' || t.number as ref, t.title, st.name as status_name,
             ${hours(sql`coalesce((select max(c.changed_at) from task_status_changes c where c.task_id = t.id), t.created_at)`, sql`now()`)}::float as hours
        from tasks t
        join projects p on p.id = t.project_id
        join list_statuses st on st.id = t.status_id
       where t.id in (select id from v) and t.parent_task_id is null
         and st.category not in ('done', 'cancelled', 'closed', 'backlog')
       order by hours desc
       limit 8`),
  ]);
  const c = cycle.rows[0];
  return {
    days: FLOW_DAYS,
    timeInStatus: inStatus.rows.map((r) => ({
      name: r.name,
      category: r.category,
      stays: Number(r.stays),
      medianHours: Number(r.median_hours),
      avgHours: Number(r.avg_hours),
    })),
    cycle: {
      done: Number(c?.done ?? 0),
      medianCycleHours: c?.median_cycle ?? null,
      p85CycleHours: c?.p85_cycle ?? null,
      medianLeadHours: c?.median_lead ?? null,
    },
    stuck: stuck.rows.map((r) => ({
      ref: r.ref,
      title: r.title,
      statusName: r.status_name,
      hours: Number(r.hours),
    })),
  };
}

export interface QaReport {
  passed: number;
  failed: number;
  /** Of tasks whose first round concluded in the period: share that passed it. Null when none. */
  firstTimePassRate: number | null;
  /** Tasks with the most failed rounds in the period. */
  mostFailed: { ref: string; title: string; fails: number; rounds: number }[];
}

/** QA results over the flow period, in the same scope as the dashboard. */
export async function getQaReport(actor: ActorContext, options: { projectId?: string }): Promise<QaReport> {
  if (options.projectId) assertId(options.projectId, "Project not found");
  const s = scoped(actor, options.projectId);
  const visible = s.from(db().select({ id: tasks.id })).where(s.where());
  const since = sql`now() - make_interval(days => ${FLOW_DAYS})`;
  const [totals, worst] = await Promise.all([
    db().execute<{ passed: number; failed: number; first_total: number; first_passed: number }>(sql`
      with v as (${visible})
      select count(*) filter (where q.result = 'pass')::int as passed,
             count(*) filter (where q.result = 'fail')::int as failed,
             count(*) filter (where q.cycle_number = 1)::int as first_total,
             count(*) filter (where q.cycle_number = 1 and q.result = 'pass')::int as first_passed
        from qa_cycles q
       where q.task_id in (select id from v) and q.result <> 'pending' and q.concluded_at >= ${since}`),
    db().execute<{ ref: string; title: string; fails: number; rounds: number }>(sql`
      with v as (${visible})
      select p.key || '-' || t.number as ref, t.title,
             count(*) filter (where q.result = 'fail')::int as fails, count(*)::int as rounds
        from qa_cycles q
        join tasks t on t.id = q.task_id
        join projects p on p.id = t.project_id
       where q.task_id in (select id from v) and q.result <> 'pending' and q.concluded_at >= ${since}
       group by p.key, t.number, t.title
      having count(*) filter (where q.result = 'fail') > 0
       order by fails desc, rounds desc
       limit 6`),
  ]);
  const t = totals.rows[0];
  const firstTotal = Number(t?.first_total ?? 0);
  return {
    passed: Number(t?.passed ?? 0),
    failed: Number(t?.failed ?? 0),
    firstTimePassRate: firstTotal ? Number(t?.first_passed ?? 0) / firstTotal : null,
    mostFailed: worst.rows.map((r) => ({
      ref: r.ref,
      title: r.title,
      fails: Number(r.fails),
      rounds: Number(r.rounds),
    })),
  };
}
