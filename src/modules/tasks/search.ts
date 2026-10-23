import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db";
import { listStatuses, projectMembers, projects, taskLists, tasks } from "@/server/db/schema";
import type { ActorContext } from "@/server/authz/policy";
import { assertId } from "@/server/errors";
import { visibleProjectCondition } from "@/modules/projects/visibility";
import { tagsForTasks } from "@/modules/tags/service";
import { dueRange, type TaskFilter } from "./filters";

const CLOSED = ["done", "cancelled"] as const;
export const SEARCH_LIMIT = 300;

/** SQL conditions for a filter. Correlated subqueries name the outer table as "tasks". */
function filterConditions(filter: TaskFilter, ctx: { userId: string; today: string }): SQL[] {
  const where: SQL[] = [];
  if (filter.state === "open") where.push(notInArray(listStatuses.category, [...CLOSED]));
  if (filter.state === "closed") where.push(inArray(listStatuses.category, [...CLOSED]));
  if (filter.priorities.length) where.push(inArray(tasks.priority, filter.priorities));
  if (filter.assignees.length) {
    const ids = filter.assignees.filter((a) => a !== "none").map((a) => (a === "me" ? ctx.userId : a));
    ids.forEach((id) => assertId(id, "Member not found"));
    const parts: SQL[] = [];
    if (ids.length) {
      parts.push(
        sql`exists (select 1 from task_assignees a where a.task_id = "tasks"."id" and a.user_id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}))`,
      );
    }
    if (filter.assignees.includes("none")) {
      parts.push(sql`not exists (select 1 from task_assignees a where a.task_id = "tasks"."id")`);
    }
    where.push(or(...parts)!);
  }
  if (filter.tags.length) {
    where.push(sql`exists (
      select 1 from task_tags tt join tags g on g.id = tt.tag_id
       where tt.task_id = "tasks"."id"
         and lower(g.name) in (${sql.join(
           filter.tags.map((t) => sql`${t.toLowerCase()}`),
           sql`, `,
         )}))`);
  }
  if (filter.due.length) {
    const parts = filter.due.map((d) => {
      const range = dueRange(d, ctx.today);
      if (range.none) return sql`${tasks.dueDate} is null`;
      const bits: SQL[] = [sql`${tasks.dueDate} is not null`];
      if (range.from) bits.push(sql`${tasks.dueDate} >= ${range.from}`);
      if (range.to) bits.push(sql`${tasks.dueDate} <= ${range.to}`);
      if (d === "overdue") bits.push(notInArray(listStatuses.category, [...CLOSED]));
      return and(...bits)!;
    });
    where.push(or(...parts)!);
  }
  if (filter.q) {
    for (const word of filter.q.split(/\s+/).filter(Boolean).slice(0, 8)) {
      const like = `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where.push(
        or(ilike(tasks.title, like), sql`(${projects.key} || '-' || ${tasks.number}) ilike ${like}`)!,
      );
    }
  }
  if (filter.blocked) {
    where.push(sql`exists (
      select 1 from task_dependencies d join tasks b on b.id = d.blocking_task_id
       where d.blocked_task_id = "tasks"."id" and b.completed_at is null and b.archived_at is null)`);
  }
  return where;
}

/**
 * Tasks across every project the actor can see (or one project), matching a filter.
 * Ordered by due date (undated last), then priority. At most SEARCH_LIMIT rows.
 */
export async function searchTasks(
  actor: ActorContext,
  filter: TaskFilter,
  options: { today: string; projectId?: string; limit?: number; order?: "due" | "recent" },
) {
  if (options.projectId) assertId(options.projectId, "Project not found");
  const where = and(
    eq(tasks.workspaceId, actor.workspaceId),
    isNull(tasks.archivedAt),
    isNull(taskLists.archivedAt),
    isNull(projects.archivedAt),
    options.projectId ? eq(projects.id, options.projectId) : undefined,
    visibleProjectCondition(actor),
    ...filterConditions(filter, { userId: actor.userId, today: options.today }),
  );
  const rows = await db()
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      completedAt: tasks.completedAt,
      parentTaskId: tasks.parentTaskId,
      projectKey: projects.key,
      projectName: projects.name,
      listId: taskLists.id,
      listName: taskLists.name,
      statusName: listStatuses.name,
      statusColor: listStatuses.color,
      statusCategory: listStatuses.category,
      assignees: sql<{ userId: string; name: string }[]>`coalesce((
        select json_agg(json_build_object('userId', u.id, 'name', u.name) order by u.name)
          from task_assignees a join users u on u.id = a.user_id where a.task_id = "tasks"."id"), '[]'::json)`,
      total: sql<number>`count(*) over ()::int`,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(taskLists, eq(taskLists.id, tasks.listId))
    .innerJoin(listStatuses, eq(listStatuses.id, tasks.statusId))
    .leftJoin(
      projectMembers,
      and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, actor.userId)),
    )
    .where(where)
    .orderBy(
      ...(options.order === "recent"
        ? [desc(tasks.updatedAt)]
        : [
            sql`${tasks.dueDate} asc nulls last`,
            sql`array_position(array['urgent','high','normal','low','none']::text[], ${tasks.priority}::text)`,
            asc(projects.key),
            asc(tasks.number),
          ]),
    )
    .limit(Math.min(options.limit ?? SEARCH_LIMIT, SEARCH_LIMIT));
  const tags = await tagsForTasks(
    db(),
    rows.map((r) => r.id),
  );
  return {
    total: rows[0]?.total ?? 0,
    tasks: rows.map(({ total: _total, ...r }) => ({
      ...r,
      ref: `${r.projectKey}-${r.number}`,
      closed: (CLOSED as readonly string[]).includes(r.statusCategory),
      tags: tags.get(r.id) ?? [],
    })),
  };
}
