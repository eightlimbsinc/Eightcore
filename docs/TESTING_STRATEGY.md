# Eightcore — Testing Strategy

Status: Phase 1 proposal. Every phase ships with passing tests for its acceptance criteria. Last updated 2026-10-13.

## 1. Tooling (all free and open source)

| Tool | Licence | Use |
|---|---|---|
| Vitest 5 | MIT | Unit and integration tests |
| `@vitest/coverage-v8` | MIT | Coverage |
| Testing Library (React) + jsdom | MIT | Component tests for complex interactive components only |
| Playwright (`@playwright/test`) | Apache-2.0 | End-to-end tests in Chromium (Firefox/WebKit in nightly runs) |
| `@axe-core/playwright` | MPL-2.0 (unmodified use, no obligations for our code) | Automated accessibility checks in E2E |
| ESLint 9 + `typescript-eslint` + `eslint-config-next` | MIT | Lint, including `no-floating-promises` and import boundaries |
| TypeScript 6.0 (`strict`, `noUncheckedIndexedAccess`) | Apache-2.0 | `tsc --noEmit` type check |
| Prettier | MIT | Formatting |
| PostgreSQL 17 (Docker or native) | PostgreSQL Licence | Real database for integration and E2E tests. **No DB mocks for data-access code** |

## 2. Test layers

| Layer | Scope | Location | Database | Speed target |
|---|---|---|---|---|
| **Unit** | Pure functions: workflow transition evaluation, permission matrix lookups, automation condition evaluation, fractional ordering, ClickUp transforms, date/timezone helpers, validators | `src/**/*.test.ts` | None | < 10 s total |
| **Integration** | Service functions end to end against Postgres: authz, constraints, transactions, activity/outbox writes, migrations | `tests/integration/**` | Real Postgres, isolated per worker | < 2 min |
| **Component** | Complex client components (board drag-and-drop logic, filter builder) | `src/components/**/*.test.tsx` | None | < 30 s |
| **E2E** | Critical user journeys through the browser against a production build | `tests/e2e/**` | Seeded Postgres | < 5 min |
| **Migration** | ClickUp importer against recorded fixtures and a fake API server | `tests/integration/import-clickup/**` | Real Postgres | < 1 min |

### Database isolation for integration tests

- `globalSetup` creates `eightcore_test_template`, runs all migrations once, and loads base seed data.
- Each Vitest worker gets `CREATE DATABASE eightcore_test_<n> TEMPLATE eightcore_test_template` (fast, about 100 ms).
- Each test runs inside a transaction that is rolled back, except tests that exercise transaction behaviour, which truncate instead.
- Test factories (`tests/factories.ts`) build workspaces, users, projects, and tasks through **service functions**, so fixtures obey the same invariants as production.

## 3. Mandatory suites

### 3.1 Security and permissions (Phase 2 onward)

- Generated **role × action matrix** (`PERMISSIONS.md` §7). Adding an action without matrix coverage fails CI.
- Cross-workspace **IDOR** tests for every read and mutation.
- Guest-scoping tests across list, board, calendar, search, My Work, and notifications.
- Composite-FK violation tests at the SQL level.
- Session revocation and expiry. Password-reset token single-use and expiry.
- Auth route rate limiting.
- File download authorization and path traversal.
- Secrets: a test asserts that the client bundle contains no `DATABASE_URL`, `BETTER_AUTH_SECRET`, or `EIGHTCORE_ENCRYPTION_KEY` (build-output scan in CI).

### 3.2 Domain invariants

- Subtask cycles and depth limit rejected (including concurrent re-parenting).
- Dependency cycles rejected.
- A status from another workflow is rejected.
- Strict workflow: disallowed transitions rejected server-side. Required comment and required fields enforced. `min_project_role` enforced.
- QA cycles: a fail creates a cycle with notes and evidence. A retest creates a new cycle. Concluded cycles are immutable.
- Optimistic concurrency: a stale `version` returns a conflict.
- Every mutation writes exactly the expected `activity_events` and `outbox_events` rows in the same transaction (rollback leaves neither).

### 3.3 Jobs and automation

- The outbox dispatcher delivers each event exactly once to each queue under concurrent workers (`SKIP LOCKED`).
- Automation loop guard stops at the depth limit.
- Webhook signatures: valid accepted, tampered rejected, replay outside the window rejected, duplicate idempotency key ignored.
- Integrations disabled → the core flows pass the same E2E suite (**"offline mode" CI job**: no integration env vars set).

### 3.4 E2E journeys (Playwright)

1. Sign up → create workspace → invite member → member accepts.
2. Create project → list → tasks and subtasks → assign two users → set due date and priority.
3. Board: drag a task across allowed columns. A disallowed drop is reverted with an explanation.
4. Task drawer: edit fields, comment with @mention, upload an attachment, see activity history.
5. QA flow: Ready to Test → Testing in Staging → fail with note and evidence → back to In Development → retest → pass → Accepted. Both cycles visible.
6. Search and filters return the expected tasks. A guest sees only shared items.
7. Calendar: drag to reschedule, and the due date persists after reload.
8. Light/dark theme toggle persists. axe reports no serious violations on the main screens (`tests/e2e/accessibility.spec.ts`: every main page in light and dark mode, plus the Add task window and the command palette, against WCAG 2.1 A/AA). Performance is measured separately (`PERFORMANCE.md`).

## 4. CI pipeline (GitHub Actions)

```
lint ─┐
types ├─▶ unit ─▶ integration (postgres service container) ─▶ build ─▶ e2e (chromium) ─▶ licence check
fmt  ─┘
```

- Runs on pull requests and `main`. Nightly: full browser matrix + `npm audit`.
- **Cost note:** GitHub Actions is free for public repositories. Private repositories on GitHub Free get a monthly minutes allowance (2,000 Linux minutes at the time of writing). Above that, runs are billed only if a spending limit is set above $0, which is the default-safe setting. Every check also runs locally via `npm run ci`, so CI is a convenience, not a requirement.
- No secrets are needed in CI: the database is ephemeral, integrations are disabled, and ClickUp is faked.

## 5. Coverage and quality gates

| Gate | Threshold |
|---|---|
| Unit + integration line coverage of `src/modules/**` and `src/server/**` | ≥ 80% (≥ 95% for `server/authz`) |
| Permission matrix coverage | 100% of actions × roles |
| Type errors / lint errors | 0 |
| E2E critical journeys | 100% passing |
| axe serious/critical violations | 0 |

## 6. Phase acceptance

Each phase in `IMPLEMENTATION_ROADMAP.md` lists acceptance criteria. A phase is complete only when:

1. Its acceptance tests exist and pass locally (`npm run ci`) and in CI.
2. No earlier suite regressed.
3. `COST_AND_LICENSES.md` is updated for any new dependency.
4. `RUNBOOK.md` is updated for any new command or environment variable.
