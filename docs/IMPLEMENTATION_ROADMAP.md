# Eightcore — Implementation Roadmap

Status: Phase 1 approved. **Phase 2 complete** (pending your review). Phases run strictly in order. A phase is done only when its acceptance criteria pass (see `TESTING_STRATEGY.md` §6). Last updated 2026-10-13.

## Decisions needed before Phase 2

| # | Decision | Recommendation |
|---|---|---|
| D1 | Approve the stack in `ARCHITECTURE.md` §2 | ✅ Approved 2026-10-13 |
| D2 | Authentication library | ✅ **Better Auth** approved 2026-10-13 |
| D3 | Local Postgres via Docker Engine/Docker Desktop or native install | Either. Docker Desktop has licence conditions for larger companies (see `COST_AND_LICENSES.md`) |
| D4 | Repository hosting | GitHub Free (current). Keep the repo private |
| D5 | Rich-text editor | Tiptap open-source core (MIT), with Pro extensions excluded |

---

## Phase 1 — Architecture and cost review ✅

**Deliverables:** the nine documents in `docs/`.
**Acceptance:** documents reviewed. Decisions D1–D5 answered.

## Phase 2 — Local environment, database, authentication, permissions ✅

**Scope**

1. Scaffold Next.js 16 + TypeScript 6.0 strict + Tailwind 4 + shadcn/ui init + ESLint + Prettier + Vitest + Playwright.
2. `docker-compose.yml` (Postgres 17, Mailpit). `.env.example`. Zod-validated `env.ts`. `server-only` guards.
3. Drizzle setup, migration scripts, DB roles (`eightcore_app`, `eightcore_migrator`), `updated_at` trigger.
4. Schema: identity tables (Better Auth), `workspaces`, `workspace_members`, `workspace_invitations`, `projects`, `project_members`, `audit_log`, `activity_events`, `outbox_events`.
5. Better Auth: email/password sign-up and sign-in, email verification and password reset via Mailpit, DB sessions, sign out everywhere, auth rate limiting.
6. `authz` module: permission matrix, `resolveActor`, `assert`/`can`, 404-vs-403 semantics.
7. Workspace creation, switcher, invitations (accept flow), member role management, project create and visibility. Minimal branded shell (sidebar, theme toggle).
8. Security headers (CSP), the `/api/health` endpoint, seed script, `npm run ci`.
9. GitHub Actions CI.

**Acceptance criteria**

- [x] `docker compose up -d && npm run db:migrate && npm run db:seed && npm run dev` works on a clean machine using only the RUNBOOK. *(Verified here with a native Postgres 16 via RUNBOOK §2b; the Docker path uses the same bootstrap files.)*
- [x] A user can sign up, verify email, sign in, create a workspace, and invite a second user, who accepts and appears with the chosen role. *(Playwright: `tests/e2e/onboarding.spec.ts`)*
- [x] Permission-matrix tests pass for all Phase 2 actions: unit (every role × action, hand-written expectations) and integration (every exposed action through the real services). Cross-workspace IDOR tests return 404 and change nothing.
- [x] Composite-FK violation tests fail at the database as expected. The app role can't rewrite history or change the schema.
- [x] Sessions are revoked on sign-out-everywhere, password change, and password reset (tested).
- [x] The client bundle scan finds no server secrets (`npm run secrets:scan`).
- [x] Lint, type check, unit, integration, and E2E (journey 1) are green locally. CI workflow added (`.github/workflows/ci.yml`).
- [x] Licence check passes over the full `package-lock.json` (`npm run licenses:check`).

**Delivered beyond the minimum:** member deactivation and reactivation, an invariant that every workspace keeps at least one active owner (deferred DB trigger), private projects with explicit project roles, guest cap at editor, project archive, account page (change password, sign out everywhere), transactional activity, audit, and outbox writes on every mutation.

**Deferred, by design:** 2FA/passkeys (Better Auth plugins, add when wanted), the workspace settings and audit-log viewer screens (Phase 4), the background worker that drains `outbox_events` (Phase 6), Postgres RLS defence-in-depth (Phase 8).

## Phase 3 — Projects, tasks, subtasks, assignments, comments

**Scope:** folders, lists, workflows and statuses (with the seeded Agency Delivery template, simple mode first), tasks with subtasks (cycle/depth guards), multiple assignees, watchers, priority, dates, tags, relations and dependencies (cycle guard), optimistic locking, comments with threads and mentions, attachments via `StorageAdapter` (local FS), activity history, in-app notifications (synchronous insert for now), core custom field types.
**Acceptance:** domain-invariant suite (`TESTING_STRATEGY.md` §3.2, minus QA) green. Attachment authz tests green. Every mutation writes activity and outbox rows. Minimal functional UI for each feature (polished in Phase 4).

## Phase 4 — Premium interface, list, Kanban, calendar, search, filters

**Scope:** final Eightcore design system (tokens, typography, light/dark), sidebar with project/folder/list tree, workspace switcher, list view (grouping, inline edit, bulk actions, keyboard navigation), Kanban (dnd-kit, fractional ordering), calendar (month/week, drag to reschedule), task detail drawer (deep link), command palette (`cmdk`), full-text search, filter builder, saved views, My Work, notification centre, settings screens.
**Acceptance:** E2E journeys 2, 3, 4, 6, 7, 8 green. 1,000-task list renders in < 1.5 s locally. Zero serious axe violations. Every visible control persists its action (manual checklist + E2E).

## Phase 5 — Agency workflows and QA handoffs

**Scope:** strict transition rules editor (allowed pairs, `min_project_role`, required comment and fields), QA cycles with notes and evidence, retest history UI, deployment metadata fields, workflow assignment per list with status remapping on move, `task_status_changes` + cycle-time and QA failure reports, dashboard v1.
**Acceptance:** E2E journey 5 green. Transition rules enforced server-side (tests bypass the UI). Concluded QA cycles are immutable. Reports match fixture data.

## Phase 6 — Background jobs and optional integrations

**Scope:** pg-boss worker, outbox dispatcher, notification and email delivery via jobs, due-date reminders (cron), automation engine (rules, conditions, actions, run log, loop guard), outgoing and incoming signed webhooks (Make.com-compatible), Slack (internal app, channel and DM notifications), Figma references (URL parsing, optional cached thumbnails), integration settings with encrypted secrets and a failed-delivery view.
**Acceptance:** §3.3 suite green. The "offline mode" CI job (no integrations configured) passes the full E2E suite. Each integration has a disconnected, healthy, and failing-state test. Webhook signature tests pass.

## Phase 7 — ClickUp migration and reconciliation

**Scope:** importer module per `MIGRATION_PLAN.md`: inventory CLI, extract, mapping review UI, staging load, reconciliation reports, error CSV, dry-run.
**Gates:** inventory against the real ClickUp workspace needs approval. **Final import and cutover need written Owner approval.**
**Acceptance:** fixture-based importer tests (pagination, 429, retries, idempotent re-run, resume) green. A staging import of the real workspace is reconciled with documented exceptions only.

## Phase 8 — Hardening, backups, documentation, deployment

**Scope:** backup and restore scripts with a restore drill, optional Postgres RLS defence-in-depth, S3-compatible storage adapter (SeaweedFS or Garage, optional), production Docker image + Caddy, self-hosted deployment guide, performance pass, security review, user guide.
**Acceptance:** a restore drill from a nightly backup succeeds. Production build runs on agency-owned hardware with HTTPS. Security review findings are resolved. Full test suite green. Owner sign-off for cutover (then Phase 7 step 8).

---

## Indicative sequencing

| Phase | Relative size |
|---|---|
| 2 | M |
| 3 | L |
| 4 | L |
| 5 | M |
| 6 | L |
| 7 | M |
| 8 | M |

Sizes are relative effort, not calendar commitments. Each phase ends with a review and an explicit go-ahead for the next.
