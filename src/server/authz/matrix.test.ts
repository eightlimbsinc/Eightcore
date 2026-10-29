// Hand-written expectations for every action × role. Deliberately *not* derived from the
// matrix: changing a permission must change this file too, and a new action without
// expectations fails the "covers every action" tests.
import { describe, expect, it } from "vitest";
import {
  PROJECT_ACTIONS,
  PROJECT_ROLES,
  WORKSPACE_ACTIONS,
  WORKSPACE_ROLES,
  type ProjectAction,
  type ProjectRole,
  type WorkspaceAction,
  type WorkspaceRole,
} from "./matrix";
import { canProject, canWorkspace } from "./policy";

type Row<R extends string> = Record<R, boolean>;
const Y = true;
const N = false;

const workspaceExpectations: Record<WorkspaceAction, Row<WorkspaceRole>> = {
  "workspace.view": { owner: Y, admin: Y, member: Y, guest: Y },
  "workspace.update_settings": { owner: Y, admin: Y, member: N, guest: N },
  "workspace.delete": { owner: Y, admin: N, member: N, guest: N },
  "workspace.transfer_ownership": { owner: Y, admin: N, member: N, guest: N },
  "member.view_directory": { owner: Y, admin: Y, member: Y, guest: N },
  "member.invite": { owner: Y, admin: Y, member: N, guest: N },
  "member.invite_admin": { owner: Y, admin: Y, member: N, guest: N },
  "member.change_role": { owner: Y, admin: Y, member: N, guest: N },
  "member.manage_owners": { owner: Y, admin: N, member: N, guest: N },
  "member.deactivate": { owner: Y, admin: Y, member: N, guest: N },
  "project.create": { owner: Y, admin: Y, member: Y, guest: N },
  "project.view_all": { owner: Y, admin: Y, member: N, guest: N },
  "audit_log.view": { owner: Y, admin: Y, member: N, guest: N },
};

const projectExpectations: Record<ProjectAction, Row<ProjectRole>> = {
  "project.view": { manager: Y, editor: Y, commenter: Y, viewer: Y },
  "project.update": { manager: Y, editor: N, commenter: N, viewer: N },
  "project.archive": { manager: Y, editor: N, commenter: N, viewer: N },
  "project.manage_members": { manager: Y, editor: N, commenter: N, viewer: N },
  "list.manage": { manager: Y, editor: N, commenter: N, viewer: N },
  "view.save": { manager: Y, editor: Y, commenter: N, viewer: N },
  "view.protect": { manager: Y, editor: N, commenter: N, viewer: N },
  "task.create": { manager: Y, editor: Y, commenter: N, viewer: N },
  "task.update": { manager: Y, editor: Y, commenter: N, viewer: N },
  "task.archive": { manager: Y, editor: N, commenter: N, viewer: N },
  "task.archive_own": { manager: Y, editor: Y, commenter: N, viewer: N },
  "task.delete": { manager: Y, editor: N, commenter: N, viewer: N },
  "task.delete_own": { manager: Y, editor: Y, commenter: N, viewer: N },
  "comment.create": { manager: Y, editor: Y, commenter: Y, viewer: N },
  "comment.moderate": { manager: Y, editor: N, commenter: N, viewer: N },
  "tag.manage": { manager: Y, editor: Y, commenter: N, viewer: N },
  "attachment.upload": { manager: Y, editor: Y, commenter: Y, viewer: N },
  "attachment.moderate": { manager: Y, editor: N, commenter: N, viewer: N },
  "custom_field.manage": { manager: Y, editor: N, commenter: N, viewer: N },
  "time.track": { manager: Y, editor: Y, commenter: N, viewer: N },
  "time.manage": { manager: Y, editor: N, commenter: N, viewer: N },
};

describe("workspace permission matrix", () => {
  it("has expectations for exactly the actions in the matrix", () => {
    expect(Object.keys(workspaceExpectations).sort()).toEqual(Object.keys(WORKSPACE_ACTIONS).sort());
  });

  for (const action of Object.keys(workspaceExpectations) as WorkspaceAction[]) {
    for (const role of WORKSPACE_ROLES) {
      const expected = workspaceExpectations[action][role];
      it(`${role} ${expected ? "may" : "may not"} ${action}`, () => {
        expect(canWorkspace(role, action)).toBe(expected);
      });
    }
  }
});

describe("project permission matrix", () => {
  it("has expectations for exactly the actions in the matrix", () => {
    expect(Object.keys(projectExpectations).sort()).toEqual(Object.keys(PROJECT_ACTIONS).sort());
  });

  for (const action of Object.keys(projectExpectations) as ProjectAction[]) {
    for (const role of PROJECT_ROLES) {
      const expected = projectExpectations[action][role];
      it(`${role} ${expected ? "may" : "may not"} ${action}`, () => {
        expect(canProject(role, action)).toBe(expected);
      });
    }
    it(`nobody without project access may ${action}`, () => {
      expect(canProject(null, action)).toBe(false);
    });
  }
});
