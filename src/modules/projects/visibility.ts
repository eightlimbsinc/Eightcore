import "server-only";
import { eq, isNotNull, or, type SQL } from "drizzle-orm";
import { projectMembers, projects } from "@/server/db/schema";
import type { ActorContext } from "@/server/authz/policy";

/**
 * SQL twin of effectiveProjectRole() !== null. Use with `projects` joined and
 * `project_members` left-joined on (project_id, user_id = actor).
 */
export function visibleProjectCondition(actor: ActorContext): SQL | undefined {
  switch (actor.workspaceRole) {
    case "owner":
    case "admin":
      return undefined;
    case "member":
      return or(isNotNull(projectMembers.userId), eq(projects.visibility, "workspace"));
    case "guest":
      return isNotNull(projectMembers.userId);
  }
}
