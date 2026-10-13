# Eightcore — Product Requirements

> **Eightcore — the operating system for modern agency operations.**
> Internal product for 8limbs Inc. Status: Phase 1 (architecture discovery). Last updated 2026-10-13.

## 1. Purpose

Eightcore replaces ClickUp as 8limbs Inc.'s system of record for agency delivery work: planning, building, QA, deployment, and client acceptance. ClickUp is a **migration source**, not a long-term dependency. When cutover is complete, the Eightcore PostgreSQL database is the only source of truth.

## 2. Goals and non-goals

### Goals

1. Feature parity with how the agency *actually uses* ClickUp today (confirmed during the Phase 7 discovery inventory). Parity with the whole ClickUp product is not a goal.
2. Model agency-specific delivery workflows (dev → QA → deploy → acceptance) with server-enforced transitions and a QA history that is never lost.
3. A premium, fast, keyboard-friendly interface with an original visual identity.
4. Zero required recurring infrastructure cost for development. Self-hostable in production.
5. Security first: server-side authorization, auditability, automated permission tests.

### Non-goals (for now)

- A multi-tenant SaaS sold to outside customers. The design keeps workspaces isolated, so this stays possible later, but billing, signup funnels, and tenant administration are out of scope.
- Native mobile apps. The responsive web app is the mobile story.
- Docs, whiteboards, chat, goals, and time-billing modules. Re-evaluate after cutover.
- AI features that need a paid runtime API (see `COST_AND_LICENSES.md`).
- Recreating ClickUp's own automations one for one. Eightcore has its own automation engine, and rules are recreated deliberately.

## 3. Users and personas

| Persona | Typical role | Needs |
|---|---|---|
| Agency owner / ops lead | Workspace Owner/Admin | Portfolio overview, dashboards, permission control, integrations |
| Project manager | Admin or Member + Project Manager role | Create projects and lists, assign work, manage workflow, track deadlines |
| Developer | Member | My Work view, fast status changes, links to Figma, branches, and environments |
| QA tester | Member | Testing queue, pass/fail with evidence, retest history |
| Designer | Member | Figma references on tasks, design review states |
| Client / contractor | Guest | See and comment only on explicitly shared projects or lists |

## 4. Functional requirements

Priority: **P0** = required for cutover, **P1** = shortly after cutover, **P2** = later.

### 4.1 Workspaces and access

| ID | Requirement | Priority |
|---|---|---|
| WS-1 | A user can belong to multiple workspaces and switch between them with a workspace switcher | P0 |
| WS-2 | Workspace roles: Owner, Admin, Member, Guest (see `PERMISSIONS.md`) | P0 |
| WS-3 | Invite users by email with a role. Invitations expire and are single-use | P0 |
| WS-4 | Remove or deactivate members. Their history is preserved and attributed | P0 |
| WS-5 | Private projects, visible only to explicit project members and workspace admins | P0 |

### 4.2 Hierarchy: projects, folders, lists

| ID | Requirement | Priority |
|---|---|---|
| H-1 | Workspace → Project → (optional Folder) → List → Task → Subtask | P0 |
| H-2 | Create, rename, reorder, archive, and restore projects, folders, and lists | P0 |
| H-3 | Each list uses one workflow (a set of statuses), inherited from the project by default | P0 |
| H-4 | Move tasks between lists, remapping statuses when the workflows differ | P1 |

> Mapping to ClickUp: ClickUp Space → Eightcore Project, Folder → Folder, List → List. See `MIGRATION_PLAN.md`.

### 4.3 Tasks

| ID | Requirement | Priority |
|---|---|---|
| T-1 | Create, edit, archive, delete (soft), and restore tasks | P0 |
| T-2 | Nested subtasks (configurable depth, default max 5). The server prevents cycles | P0 |
| T-3 | Multiple assignees per task. Watchers | P0 |
| T-4 | Status (from the list workflow), priority (Urgent/High/Normal/Low/None), start date, due date (optional time) | P0 |
| T-5 | Rich-text description (sanitized), tags | P0 |
| T-6 | Custom fields: text, long text, number, currency, date, checkbox, dropdown, multi-label, URL, email, user, rating, Figma reference | P0 (core types), P1 (rest) |
| T-7 | Relations: blocks / blocked-by (dependencies with cycle prevention), relates-to, duplicates | P0 |
| T-8 | Checklists inside a task | P1 |
| T-9 | Time estimate. Time tracking entries | P1 / P2 |
| T-10 | Optimistic concurrency: a stale edit is rejected with a clear conflict message, not silently overwritten | P0 |

### 4.4 Collaboration

| ID | Requirement | Priority |
|---|---|---|
| C-1 | Threaded comments with @mentions on tasks | P0 |
| C-2 | Attachments on tasks and comments (local storage in development), behind authorized download | P0 |
| C-3 | Activity history per task: every field change, with actor and timestamp | P0 |
| C-4 | In-app notifications (assigned, mentioned, status changed on watched task, due soon) | P0 |
| C-5 | Email notifications (local SMTP catcher in development) | P1 |

### 4.5 Views

| ID | Requirement | Priority |
|---|---|---|
| V-1 | List view: grouped by status, inline edit, sort, bulk actions | P0 |
| V-2 | Kanban board: columns by status, drag-and-drop that respects server-side transition rules | P0 |
| V-3 | Calendar view (month/week) by due date, drag to reschedule | P0 |
| V-4 | Task detail drawer (open from any view, deep-linkable URL) | P0 |
| V-5 | Search (full text across title, description, comments) and filters (assignee, status, priority, tag, due range, custom field) | P0 |
| V-6 | Saved views (personal and shared) | P1 |
| V-7 | "My Work" view across all lists | P0 |
| V-8 | Gantt/timeline | P2 |

### 4.6 Agency workflows and QA

| ID | Requirement | Priority |
|---|---|---|
| W-1 | Configurable workflows per workspace. Default agency template: Backlog → To Do → Ready for Dev → In Development → Ready to Test → Testing in Staging → Final Review → Push to Production → Accepted | P0 |
| W-2 | Status categories (backlog, unstarted, active, review, done, cancelled) drive reporting, so reports do not depend on status names | P0 |
| W-3 | Server-enforced transition rules: allowed from→to pairs, minimum role, required comment, required fields | P0 |
| W-4 | A QA failure creates a QA cycle record with notes and evidence attachments and sends the task back to development. Retests create new cycles. Earlier cycles are never overwritten | P0 |
| W-5 | Deployment metadata on tasks (environment URL, build/commit reference, deployed-at) via custom fields or the QA cycle | P1 |
| W-6 | Workflows are data. No status name is hard-coded in UI components | P0 |

### 4.7 Automation

| ID | Requirement | Priority |
|---|---|---|
| A-1 | Rules: trigger (task created, status changed, assignee changed, due date approaching, comment added, field changed) + conditions + actions (set field/status, assign, comment, notify, send webhook, post to Slack) | P1 |
| A-2 | Execution log per rule run with inputs, outcome, and errors. Retries for transient failures | P1 |
| A-3 | Loop protection (an automation-originated change cannot re-trigger the same rule beyond a depth limit) | P1 |

### 4.8 Integrations (all optional)

| ID | Requirement | Priority |
|---|---|---|
| I-1 | Slack: post notifications to channels and DMs through a Slack app the agency owns | P1 |
| I-2 | Make.com: signed outgoing webhooks on events and authenticated incoming webhooks that create or update tasks | P1 |
| I-3 | Figma: store file/frame/node references on tasks with a link-out. Optional thumbnail fetch | P1 |
| I-4 | With every integration disconnected, the core app works fully | P0 |

### 4.9 Migration

| ID | Requirement | Priority |
|---|---|---|
| M-1 | Repeatable, idempotent import of ClickUp data into a staging workspace (see `MIGRATION_PLAN.md`) | P0 |
| M-2 | Reconciliation report comparing source and imported counts and fields | P0 |
| M-3 | Production import and cutover only with explicit written approval | P0 |

### 4.10 Reporting

| ID | Requirement | Priority |
|---|---|---|
| R-1 | Dashboard: open tasks by status category, overdue, by assignee, by project | P1 |
| R-2 | Cycle time (In Development → Accepted) and QA failure rate per project | P1 |
| R-3 | CSV export of a filtered task list | P1 |

## 5. Non-functional requirements

| Area | Requirement |
|---|---|
| Cost | No paid service required to develop, test, or run the core app. See `COST_AND_LICENSES.md` |
| Performance | List view of 1,000 tasks renders in under 1.5 s on a dev laptop. Common mutations under 300 ms server time on local Postgres |
| Scale target | 50 users, 50k tasks, 500k activity rows without architectural change |
| Availability | Single-instance deployment is acceptable. Nightly backups with a tested restore |
| Security | See `PERMISSIONS.md` and `ARCHITECTURE.md` §7 |
| Accessibility | WCAG 2.2 AA target: keyboard navigation for list and board, visible focus, colour contrast in both themes |
| Browser support | Last two versions of Chrome, Edge, Firefox, and Safari |
| Data ownership | Full database dump and attachment export available at any time |

## 6. Brand and UI principles

- **Identity:** an original "Eightcore" wordmark and an octagonal mark (8 sides, a nod to 8limbs). No ClickUp assets, colours, icons, or layout clones.
- **Palette:** charcoal `#17171A`, graphite `#2A2A2F`, warm white `#FAF8F5`, champagne-gold accent `#C9A96E`. Gold is used sparingly for focus, primary action, and selection. Never for large fills.
- **Typography:** an open-source variable sans font (e.g. Inter or Geist, both SIL OFL) with tabular numerals for dates and counts.
- **Density:** compact 32–36 px task rows, subtle 1 px borders, a 4/8 px spacing scale.
- **Themes:** light and dark, from CSS variables (shadcn/ui token convention).
- **Rule:** every visible control performs its action and persists its result. No placeholder buttons ship.

## 7. Success criteria for cutover

1. All active ClickUp projects are imported, and the reconciliation report shows 100% of tasks, comments, and assignees matched (documented exceptions for unsupported data).
2. The agency runs one full sprint with Eightcore as the system of record.
3. The permission test suite and E2E suite are green. A backup has been restored successfully.
4. Owner sign-off.
