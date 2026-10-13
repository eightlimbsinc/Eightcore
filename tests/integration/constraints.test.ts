// Database-level guarantees that hold even if application code is wrong.
// These run as the *app* role, exactly like the running application.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject } from "@/modules/projects/service";
import { TEST_DATABASE_URL } from "../support/test-db-urls";
import { createUser, createWorkspaceWithRoles } from "../support/factories";

let app: pg.Pool;
beforeAll(() => {
  app = new pg.Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
});
afterAll(async () => {
  await app.end();
});

async function sqlError(text: string, params: unknown[] = []) {
  try {
    await app.query(text, params);
  } catch (error) {
    return error as { code: string; constraint?: string };
  }
  throw new Error(`expected failure: ${text}`);
}

describe("workspace isolation in the schema", () => {
  it("refuses project membership for a user from another workspace", async () => {
    const a = await createWorkspaceWithRoles("alpha");
    const b = await createWorkspaceWithRoles("beta");
    const project = await createProject(a.actors.owner, { name: "Alpha", key: "ALPHA" });
    const err = await sqlError(
      "insert into project_members (workspace_id, project_id, user_id, role) values ($1, $2, $3, 'editor')",
      [a.workspace.id, project.id, b.users.member.id],
    );
    expect(err).toMatchObject({ code: "23503", constraint: "project_members_member_fk" });
  });

  it("refuses a project membership row that claims the wrong workspace", async () => {
    const a = await createWorkspaceWithRoles("alpha");
    const b = await createWorkspaceWithRoles("beta");
    const project = await createProject(a.actors.owner, { name: "Alpha", key: "ALPHA" });
    const err = await sqlError(
      "insert into project_members (workspace_id, project_id, user_id, role) values ($1, $2, $3, 'editor')",
      [b.workspace.id, project.id, b.users.member.id],
    );
    expect(err).toMatchObject({ code: "23503", constraint: "project_members_project_fk" });
  });
});

describe("check constraints", () => {
  it("rejects malformed slugs and project keys", async () => {
    const user = await createUser();
    expect(
      await sqlError("insert into workspaces (name, slug, created_by) values ('x', 'Bad Slug', $1)", [
        user.id,
      ]),
    ).toMatchObject({ code: "23514", constraint: "workspaces_slug_format" });
    const a = await createWorkspaceWithRoles();
    expect(
      await sqlError(
        "insert into projects (workspace_id, name, key, created_by) values ($1, 'x', 'bad', $2)",
        [a.workspace.id, user.id],
      ),
    ).toMatchObject({ code: "23514", constraint: "projects_key_format" });
  });

  it("rejects owner invitations", async () => {
    const a = await createWorkspaceWithRoles();
    expect(
      await sqlError(
        "insert into workspace_invitations (workspace_id, email, role, token_hash, invited_by, expires_at) values ($1, 'x@y.z', 'owner', 'h', $2, now())",
        [a.workspace.id, a.users.owner.id],
      ),
    ).toMatchObject({ code: "23514" });
  });
});

describe("app role privileges", () => {
  it("cannot rewrite or delete history", async () => {
    await createWorkspaceWithRoles();
    for (const statement of [
      "update activity_events set action = 'tampered'",
      "delete from activity_events",
      "update audit_log set event = 'tampered'",
      "delete from audit_log",
      "truncate audit_log",
    ]) {
      expect(await sqlError(statement)).toMatchObject({ code: "42501" });
    }
  });

  it("cannot change the schema", async () => {
    expect(await sqlError("create table hacked (id int)")).toMatchObject({ code: "42501" });
    expect(await sqlError("alter table users add column hacked int")).toMatchObject({ code: "42501" });
    expect(await sqlError("drop table users")).toMatchObject({ code: "42501" });
  });
});
