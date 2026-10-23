// The permission matrix: the single source of truth for who may do what.
// docs/PERMISSIONS.md §3 describes it; tests/integration and src/server/authz/*.test.ts verify it.

export const WORKSPACE_ROLES = ["owner", "admin", "member", "guest"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PROJECT_ROLES = ["manager", "editor", "commenter", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

/** Actions decided by the caller's workspace role alone. */
export const WORKSPACE_ACTIONS = {
  "workspace.view": ["owner", "admin", "member", "guest"],
  "workspace.update_settings": ["owner", "admin"],
  "workspace.delete": ["owner"],
  "workspace.transfer_ownership": ["owner"],
  "member.view_directory": ["owner", "admin", "member"],
  "member.invite": ["owner", "admin"],
  "member.invite_admin": ["owner", "admin"],
  "member.change_role": ["owner", "admin"],
  "member.manage_owners": ["owner"],
  "member.deactivate": ["owner", "admin"],
  "project.create": ["owner", "admin", "member"],
  "project.view_all": ["owner", "admin"],
  "audit_log.view": ["owner", "admin"],
} as const satisfies Record<string, readonly WorkspaceRole[]>;
export type WorkspaceAction = keyof typeof WORKSPACE_ACTIONS;

/** Actions decided by the caller's *effective* project role. */
export const PROJECT_ACTIONS = {
  "project.view": ["manager", "editor", "commenter", "viewer"],
  "project.update": ["manager"],
  "project.archive": ["manager"],
  "project.manage_members": ["manager"],
  /** Folders and lists, including each list's statuses. */
  "list.manage": ["manager"],
  /** Save a list's view (its default for everyone), unless the view is protected. */
  "view.save": ["manager", "editor"],
  /** Protect or unprotect a list's view, and save a protected one. */
  "view.protect": ["manager"],
  "task.create": ["manager", "editor"],
  "task.update": ["manager", "editor"],
  /** Archive any task. Editors may archive tasks they created (task.archive_own). */
  "task.archive": ["manager"],
  "task.archive_own": ["manager", "editor"],
  /** Permanently delete any task (with its subtasks, comments and files). Editors: their own (task.delete_own). */
  "task.delete": ["manager"],
  "task.delete_own": ["manager", "editor"],
  /** Post comments and replies; edit or delete your own. */
  "comment.create": ["manager", "editor", "commenter"],
  /** Delete anyone's comment. */
  "comment.moderate": ["manager"],
  /** Create, rename, recolour and delete the project's tags (applying tags is task.update). */
  "tag.manage": ["manager", "editor"],
  /** Attach files to your comments (and, with task.update, to the task itself); delete your own. */
  "attachment.upload": ["manager", "editor", "commenter"],
  /** Delete anyone's attachment. */
  "attachment.moderate": ["manager"],
  /** Create, rename and delete custom fields and their dropdown options (setting values is task.update). */
  "custom_field.manage": ["manager"],
} as const satisfies Record<string, readonly ProjectRole[]>;
export type ProjectAction = keyof typeof PROJECT_ACTIONS;

/** Highest project role a guest can hold. */
export const GUEST_MAX_PROJECT_ROLE: ProjectRole = "editor";
/** Project role a member gets on a workspace-visible project without an explicit role. */
export const DEFAULT_MEMBER_PROJECT_ROLE: ProjectRole = "editor";

const PROJECT_ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, commenter: 1, editor: 2, manager: 3 };

export function projectRoleAtMost(role: ProjectRole, max: ProjectRole): ProjectRole {
  return PROJECT_ROLE_RANK[role] > PROJECT_ROLE_RANK[max] ? max : role;
}
