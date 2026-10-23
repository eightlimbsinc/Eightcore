# Eightcore — Permissions

Status: **implemented in Phase 2** for the workspace and project actions below (`src/server/authz/matrix.ts` is the source of truth). Task, comment, and attachment actions arrive with their features in Phase 3. Last updated 2026-10-13.

## 1. Principles

1. **Server-side only.** Hiding a button in the UI is a convenience, never a control. Every service function asserts its permission.
2. **Deny by default.** An action not granted in the matrix is denied.
3. **Workspace isolation is absolute.** No role in workspace A grants anything in workspace B. Enforced in code *and* by composite foreign keys.
4. **Don't leak existence.** A resource outside the caller's visibility returns **404**. A visible resource the caller cannot modify returns **403**.
5. **Least privilege for automation.** Automations and integrations act with explicitly scoped rights and are attributed in activity history.
6. **One source of truth.** The permission matrix is a typed constant in code. Tests and documentation are generated from it, so they cannot drift.

## 2. Roles

### Workspace roles (`workspace_members.role`)

| Role | Summary |
|---|---|
| **Owner** | Everything, including billing-free "danger zone" actions: delete workspace, transfer ownership, manage owners. At least one owner must exist |
| **Admin** | Manage members (except owners), all projects including private ones, workflows, custom fields, automations, integrations, imports |
| **Member** | Create projects. See all `workspace`-visibility projects. Work inside projects according to their project role |
| **Guest** | Sees **only** projects or lists explicitly shared with them. Cannot see the member directory beyond collaborators on shared items. Cannot create projects |

### Project roles (`project_members.role`, or list shares for guests)

| Role | Summary |
|---|---|
| **Manager** | Project settings, lists, folders, members, workflow assignment, project-scoped automations |
| **Editor** | Create, edit, and move tasks. Comment. Upload |
| **Commenter** | View, comment, upload attachments to comments |
| **Viewer** | Read only |

**Effective project role**:

- Owner/Admin → Manager on every project.
- Member on a `workspace`-visibility project → explicit project role if set, otherwise **Editor** (workspace default, configurable).
- Member on a `private` project → explicit project role or **no access**.
- Guest → explicit project role or list share, otherwise **no access**. Maximum for guests: Editor (configurable down to Commenter).

## 3. Permission matrix (initial)

✅ allowed · ◐ own items only · ❌ denied. Project-scoped rows use the **effective project role**.

### Workspace-level

| Action | Owner | Admin | Member | Guest |
|---|---|---|---|---|
| `workspace.view` | ✅ | ✅ | ✅ | ✅ |
| `workspace.update_settings` | ✅ | ✅ | ❌ | ❌ |
| `workspace.delete` / `transfer_ownership` | ✅ | ❌ | ❌ | ❌ |
| `member.invite` (as member/guest) | ✅ | ✅ | ❌ (configurable) | ❌ |
| `member.invite_admin` / change role to admin | ✅ | ✅ | ❌ | ❌ |
| `member.change_role` of an owner | ✅ | ❌ | ❌ | ❌ |
| `member.deactivate` | ✅ | ✅ (not owners) | ❌ | ❌ |
| `project.create` | ✅ | ✅ | ✅ | ❌ |
| `workflow.manage` | ✅ | ✅ | ❌ | ❌ |
| `custom_field.manage` (workspace scope) | ✅ | ✅ | ❌ | ❌ |
| `automation.manage` (workspace scope) | ✅ | ✅ | ❌ | ❌ |
| `integration.manage` | ✅ | ✅ | ❌ | ❌ |
| `import.run` (inventory/dry-run/staging) | ✅ | ✅ | ❌ | ❌ |
| `import.run_final` (production) | ✅ (+ recorded approval) | ❌ | ❌ | ❌ |
| `audit_log.view` | ✅ | ✅ | ❌ | ❌ |
| `report.view_workspace` | ✅ | ✅ | ✅ | ❌ |
| `export.workspace` | ✅ | ❌ | ❌ | ❌ |

### Project-level (by effective project role)

| Action | Manager | Editor | Commenter | Viewer |
|---|---|---|---|---|
| `project.view` / `task.view` | ✅ | ✅ | ✅ | ✅ |
| `project.update` / archive / manage members | ✅ | ❌ | ❌ | ❌ |
| `list.create` / `update` / `archive`, `folder.*` | ✅ | ❌ | ❌ | ❌ |
| `task.create` / `task.update` / `task.move` | ✅ | ✅ | ❌ | ❌ |
| `task.change_status` | ✅ | ✅ (subject to workflow `min_project_role`) | ❌ | ❌ |
| `task.assign` | ✅ | ✅ | ❌ | ❌ |
| `task.archive` / `task.delete` | ✅ | ◐ (tasks they created) | ❌ | ❌ |
| `task.restore` (from trash) | ✅ | ❌ | ❌ | ❌ |
| `comment.create` | ✅ | ✅ | ✅ | ❌ |
| `tag.manage` (create, rename, recolour, delete project tags; applying tags is `task.update`) | ✅ | ✅ | ❌ | ❌ |
| Watch / unwatch a task | ✅ | ✅ | ✅ | ✅ |
| `comment.update` / `comment.delete` | ◐ + delete any | ◐ | ◐ | ❌ |
| `attachment.upload` | ✅ | ✅ | ✅ (on comments; on the task itself also needs `task.update`) | ❌ |
| `attachment.download` | ✅ | ✅ | ✅ | ✅ |
| `attachment.delete` | ✅ | ◐ | ◐ | ❌ |
| `qa_cycle.conclude` | ✅ | ✅ | ❌ | ❌ |
| `custom_field.manage` (project/list scope) | ✅ | ❌ | ❌ | ❌ |
| `automation.manage` (project scope) | ✅ | ❌ | ❌ | ❌ |
| `saved_view.create_shared` | ✅ | ✅ | ❌ | ❌ |

Workflow transitions add a further check: `workflow_transitions.min_project_role` (e.g. only Manager may move *Final Review → Push to Production*), `require_comment`, and `required_field_ids`.

## 4. Implementation

```ts
// src/server/authz/policy.ts (sketch)
export type Action = keyof typeof MATRIX;           // "task.update" | ...
export interface ActorContext { userId: string; workspaceId: string; workspaceRole: WorkspaceRole; requestId: string; actorKind: "user" | "automation" | "import" | "integration"; }

export async function assert(ctx: ActorContext, action: Action, resource?: ResourceRef): Promise<void>;
export async function can(ctx: ActorContext, action: Action, resource?: ResourceRef): Promise<boolean>;
// Throws NotFoundError when the resource is invisible to ctx, ForbiddenError when visible but not allowed.
```

- `resolveActor(session, workspaceSlug)` builds `ActorContext` once per request. A non-member gets `NotFoundError`.
- Effective project roles are loaded in a single query per request and memoized (`React.cache`).
- List queries apply a **visibility predicate** (`visibleProjectIds(ctx)`) in SQL, so they never filter in memory after fetching.
- `can()` results are also passed to the UI to hide controls. That is UX only.
- Deactivating a member deletes their sessions for that workspace context and removes them from `project_members`. Their historical rows stay.

### Automations and integrations

- **Automation rules** run as `actorKind = "automation"`, with the rights of `run_as_user_id` (the creator by default) **re-checked at run time**. If the creator lost access, the run is `skipped` with a reason.
- **Incoming webhooks** (Make.com) map to a service identity scoped to one workspace and an allowlist of actions (`task.create`, `task.update`, `comment.create`) on selected projects.
- **Import jobs** run as `actorKind = "import"` and can only write into the workspace that owns the job.

## 5. Protected file access

- Files are served only by `GET /w/[slug]/files/[attachmentId]`. That route resolves the actor from the session and the workspace slug, loads the attachment by ID **and** `workspace_id`, then requires the parent task to be visible (`attachment.download` = `project.view`). Anything else is a 404.
- The stored MIME type comes from the file's content (`file-type` signatures, else `text/plain` for valid UTF-8 text, else `application/octet-stream`), never from the browser. Only PNG, JPEG, GIF, WebP and PDF are shown inline; everything else downloads. Locally streamed files carry `X-Content-Type-Options: nosniff` and a sandboxed CSP.
- Storage keys are random (`ws/<workspaceId>/<uuid>`), never guessable, and never returned to the client.
- Local storage lives outside `public/`, so Next.js never serves it statically.
- S3-compatible storage (Supabase Storage on the test deployment): the route answers with a redirect to a presigned URL valid for 5 minutes, generated only after the same check. The bucket is private.
- Notifications are filtered by the same visibility rule when listed, so losing access to a project also hides its notifications.

## 6. Defence-in-depth: Postgres row-level security (optional, Phase 8)

Composite FKs already prevent cross-workspace *references*. RLS would also prevent cross-workspace *reads* if a query forgot its `workspace_id` filter. The plan: `SET LOCAL app.workspace_id = ...` per transaction, policies `USING (workspace_id = current_setting('app.workspace_id')::uuid)`, and `FORCE ROW LEVEL SECURITY` on workspace-owned tables. It is deferred because it complicates connection pooling and migrations. The decision is revisited after the permission test suite exists. RLS is free, built into Postgres.

## 7. Testing requirements (mandatory)

1. **Matrix tests (generated).** For every action × role, an integration test asserts allow or deny against a real Postgres. The suite fails if a new action is added without matrix coverage.
2. **IDOR tests.** For every mutation and read endpoint: actor in workspace A, resource ID from workspace B → 404, with no row changed.
3. **Guest scoping.** A guest sees only shared projects or lists. Search, My Work, notifications, and calendar never return unshared tasks.
4. **Private project tests.** A member without a project role gets 404 on every route touching the project.
5. **DB-level tests.** Direct inserts that violate composite FKs (cross-workspace assignee, parent, status, tag) fail at the database.
6. **Session tests.** Revoked or expired sessions are rejected. A role downgrade takes effect on the next request.
7. **File tests.** Unauthorized download → 404. Path traversal attempts are rejected. Stored keys are never returned in responses.

See `TESTING_STRATEGY.md` for tooling.
