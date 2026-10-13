// Pure authorization decisions. No I/O here, so every rule is unit-testable.
import { ForbiddenError } from "@/server/errors";
import {
  DEFAULT_MEMBER_PROJECT_ROLE,
  GUEST_MAX_PROJECT_ROLE,
  PROJECT_ACTIONS,
  WORKSPACE_ACTIONS,
  projectRoleAtMost,
  type ProjectAction,
  type ProjectRole,
  type WorkspaceAction,
  type WorkspaceRole,
} from "./matrix";

export interface ActorContext {
  userId: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceRole: WorkspaceRole;
  actorKind: "user" | "automation" | "import" | "integration" | "system";
  requestId?: string;
}

export function canWorkspace(role: WorkspaceRole, action: WorkspaceAction): boolean {
  return (WORKSPACE_ACTIONS[action] as readonly WorkspaceRole[]).includes(role);
}

export function assertWorkspace(actor: ActorContext, action: WorkspaceAction): void {
  if (!canWorkspace(actor.workspaceRole, action)) throw new ForbiddenError();
}

/**
 * The project role a workspace member effectively holds (docs/PERMISSIONS.md §2).
 * `null` means the project is invisible to them.
 */
export function effectiveProjectRole(
  workspaceRole: WorkspaceRole,
  visibility: "workspace" | "private",
  explicitRole: ProjectRole | null,
): ProjectRole | null {
  switch (workspaceRole) {
    case "owner":
    case "admin":
      return "manager";
    case "member":
      if (explicitRole) return explicitRole;
      return visibility === "workspace" ? DEFAULT_MEMBER_PROJECT_ROLE : null;
    case "guest":
      return explicitRole ? projectRoleAtMost(explicitRole, GUEST_MAX_PROJECT_ROLE) : null;
  }
}

export function canProject(role: ProjectRole | null, action: ProjectAction): boolean {
  return role !== null && (PROJECT_ACTIONS[action] as readonly ProjectRole[]).includes(role);
}
