import "server-only";
import { and, eq, isNotNull, isNull, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { projectMembers, projects } from "@/server/db/schema";
import type { ActorContext } from "@/server/authz/policy";

/**
 * SQL twin of effectiveProjectRole() !== null (and, for guests, canSeeList()). Use with
 * `projects` joined and `project_members` left-joined on (project_id, user_id = actor).
 *
 * `listColumn` is the list each row belongs to (e.g. `tasks.listId`): guests limited to some
 * lists only see rows in those. Pass `null` only for project-level rows (tags, fields).
 */
export function visibleProjectCondition(
  actor: ActorContext,
  listColumn: AnyColumn | SQL | null,
): SQL | undefined {
  switch (actor.workspaceRole) {
    case "owner":
    case "admin":
      return undefined;
    case "member":
      return or(isNotNull(projectMembers.userId), eq(projects.visibility, "workspace"));
    case "guest":
      return and(
        isNotNull(projectMembers.userId),
        listColumn
          ? or(isNull(projectMembers.listIds), sql`${listColumn} = any(${projectMembers.listIds})`)
          : undefined,
      );
  }
}
