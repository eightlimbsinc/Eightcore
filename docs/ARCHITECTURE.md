# Eightcore — Architecture

Status: approved 2026-10-13 (Better Auth included). Phase 2 implemented. Last updated 2026-10-13.

## 1. Starting point

The repository was empty when discovery began (no commits, no code). This is a greenfield design. The constraint is the cost rule in the master prompt: **free and open-source software only, runnable entirely on a developer's computer, with no paid service on the critical path.**

## 2. Decision summary

| Concern | Decision | Why |
|---|---|---|
| Shape | **Modular monolith**: one Next.js app plus one background worker process, same repo, same database | Lowest operational cost. No service mesh, no message broker |
| Runtime | Node.js **22 LTS** (≥ 22.12) or 24 LTS | Required by pg-boss. Supported by Next.js 16 |
| Web framework | **Next.js 16** (App Router), **React 19** | Approved stack. Server Components let reads call services directly. Server Actions handle mutations |
| Language | **TypeScript 6.0.x, `strict: true`** | TS 7.0 is `latest`, but `typescript-eslint` 8.x supports only `<6.1`. Pin 6.0 until the lint toolchain supports 7 |
| Styling / UI | **Tailwind CSS 4**, **shadcn/ui** (components copied into the repo, MIT), Radix primitives, lucide icons | Approved, free, and the code is owned by us, so it can be fully restyled |
| Database | **PostgreSQL 17** (16+ supported) | Authoritative store. Also powers search, jobs, and the event outbox |
| ORM / migrations | **Drizzle ORM 0.45.x** + **drizzle-kit**, with generated SQL migrations committed to git | Typed SQL, no runtime engine binary, plain-SQL migrations that are reviewable. (Drizzle 1.0 is still RC. Adopt later.) |
| DB driver | `pg` (node-postgres) | One driver shared by Drizzle, Better Auth, and pg-boss |
| Auth | **Better Auth** (MIT), self-hosted in-process, sessions stored in Postgres (**approved**, see §6) | Auth.js is in security-only maintenance. Supabase Auth adds a separate service |
| Authorization | Our own policy module (`src/server/authz`) with composite-FK workspace scoping in the database | Authorization belongs to the domain, not the auth library |
| Validation | **Zod 4** at every server boundary | One schema used for forms, actions, webhooks, and env |
| Jobs | **pg-boss** (MIT) on the same Postgres, with a separate `worker` process | No Redis, no paid orchestrator. Retries, cron, and throttling built in |
| Events | Transactional **outbox table** → worker → automations, notifications, webhooks, Slack | No lost or phantom events. Integrations are decoupled from request latency |
| Search | Postgres full-text search (`tsvector` + GIN) and `pg_trgm` for fuzzy title match | Free and good enough for 50k+ tasks. No Elasticsearch |
| Files | `StorageAdapter` interface. **Local filesystem** in development. S3-compatible later (SeaweedFS or Garage, self-hosted) | No paid object storage. MinIO CE is archived upstream (2026). Do not adopt it |
| Email | SMTP via `nodemailer`. **Mailpit** (MIT) catches mail locally | No paid email API required. Production SMTP is an optional choice |
| Realtime | Not in MVP. Later: Postgres `LISTEN/NOTIFY` → Server-Sent Events | Free and needs no extra infrastructure |
| Testing | Vitest, Playwright, ESLint 9, `tsc --noEmit` | Approved stack. ESLint 10 waits on the React/import/a11y plugins |
| Local infra | Docker Compose (Postgres, Mailpit) **or** native Postgres | Docker Engine is free. Docker Desktop has licence terms (see `COST_AND_LICENSES.md`) |

## 3. System context

```
                ┌──────────────────────────── developer laptop / single server ───────────────────────────┐
 Browser ──HTTPS──▶  Next.js app (web)                                                                     │
                │   ├─ Server Components (reads)  ─┐                                                       │
                │   ├─ Server Actions (mutations) ─┼─▶ Domain modules ─▶ Drizzle ─▶ PostgreSQL           │
                │   ├─ Route handlers (/api/*)    ─┘         │                         ▲  ▲               │
                │   │   files, webhooks, auth                │ outbox rows (same txn)  │  │               │
                │   └─ Better Auth (in-process)              ▼                         │  │               │
                │                                      Worker process (pg-boss) ───────┘  │               │
                │                                      ├─ automations                     │               │
                │                                      ├─ notifications / email ─▶ SMTP (Mailpit in dev)   │
                │                                      ├─ ClickUp importer ─▶ ClickUp API (read-only)     │
                │                                      └─ outgoing webhooks / Slack / Figma (optional)    │
                │   StorageAdapter ─▶ ./storage (dev) │ S3-compatible (later)                             │
                └──────────────────────────────────────────────────────────────────────────────────────────┘
```

External systems (ClickUp, Slack, Make.com, Figma) are reached **only from the worker** or from authenticated webhook routes, never from the browser.

## 4. Repository layout (target)

```
eightcore/
├─ docs/                       # these documents
├─ drizzle/                    # generated SQL migrations (committed, never edited after merge)
├─ docker-compose.yml          # postgres, mailpit
├─ src/
│  ├─ app/                     # Next.js routes only: thin, no business logic
│  │  ├─ (auth)/               # sign-in, sign-up, invite accept
│  │  ├─ (app)/w/[workspaceSlug]/...   # workspace-scoped pages
│  │  └─ api/                  # auth, files, webhooks, health
│  ├─ components/              # ui/ (shadcn), app-specific components
│  ├─ modules/                 # domain modules (the monolith's "services")
│  │  ├─ workspaces/  projects/  tasks/  workflows/  comments/
│  │  ├─ attachments/ custom-fields/ activity/ notifications/
│  │  ├─ automations/ integrations/{slack,make,figma}/ import-clickup/
│  │  └─ <module>/{schema.ts, service.ts, queries.ts, validators.ts, actions.ts, *.test.ts}
│  ├─ server/
│  │  ├─ db/                   # drizzle client, transaction helper, schema barrel
│  │  ├─ auth/                 # better-auth config, getSession(), requireUser()
│  │  ├─ authz/                # policies, can(), assert(), permission matrix
│  │  ├─ storage/              # StorageAdapter, LocalFsStorage, (S3Storage later)
│  │  ├─ jobs/                 # pg-boss client, job definitions, outbox dispatcher
│  │  ├─ env.ts                # zod-validated env, imports "server-only"
│  │  └─ crypto.ts             # AES-256-GCM for integration secrets, HMAC helpers
│  └─ lib/                     # shared pure utilities (dates, ordering, etc.)
├─ worker/index.ts             # worker entry: `npm run worker`
├─ scripts/                    # seed, reset, backup, clickup-inventory (read-only)
└─ tests/
   ├─ integration/             # Vitest against real Postgres
   ├─ e2e/                     # Playwright
   └─ fixtures/clickup/        # recorded, anonymised API responses
```

### Module rules

1. `app/` may import `modules/*/actions.ts` and `modules/*/queries.ts` only.
2. A module's `service.ts` holds the business rules. Every public service function takes a `ctx: ActorContext` (`{ userId, workspaceId, role, requestId }`) as its first argument and performs its own authorization check. No exceptions.
3. Modules talk to each other through exported service functions or outbox events, never by writing another module's tables directly.
4. Anything importing `server/` carries `import "server-only"`, so a leak into a client bundle fails the build.

## 5. Request lifecycle (mutation)

1. A Server Action or route handler receives input.
2. `requireUser()` reads the Better Auth session cookie and loads the session from Postgres. On failure: redirect or 401.
3. Zod parses the input. On failure: a structured field error.
4. `resolveWorkspace(slug, user)` loads the membership. Not a member → **404** (not 403, so workspaces cannot be enumerated).
5. The service runs inside `db.transaction()`:
   - `authz.assert(ctx, "task.update", task)` (project role, guest scope, ownership).
   - Domain checks (workflow transition allowed, no dependency cycle, version match).
   - The write. Composite FKs guarantee that every referenced row is in the same workspace.
   - Insert `activity_events` rows (before/after diff).
   - Insert an `outbox_events` row.
6. Commit. `revalidatePath`/`revalidateTag` refreshes affected views.
7. The worker claims outbox rows (`FOR UPDATE SKIP LOCKED`) and enqueues pg-boss jobs: automations, notifications, webhooks, Slack.

Reads follow steps 2–4, then a workspace-scoped query. **Every query against a workspace-owned table filters by `workspace_id`.** This is enforced in a query-helper layer and covered by tests.

## 6. Authentication — options evaluated

| | **Better Auth** (recommended) | **Auth.js / NextAuth** | **Supabase Auth (self-hosted GoTrue)** |
|---|---|---|---|
| Licence | MIT | ISC | MIT (GoTrue). Full Supabase stack is Apache-2.0 |
| Deployment | In-process library. Tables live in our Postgres via the Drizzle adapter | In-process library | **Separate Go service** (+ Kong/JWT setup if the full stack is used) |
| Status (Oct 2026) | Actively developed (v1.7). Now also maintains Auth.js | Maintainers recommend Better Auth for new projects. v4 stable is security-fixes only, and v5 has been beta for years | Active, but self-hosting is "community supported" |
| Email + password | Built in. scrypt hashing by default (can be swapped for Argon2id), verification, reset | Credentials provider is deliberately minimal: **no database sessions with credentials** (forces JWT), and you build reset and verification yourself | Built in |
| Sessions | DB sessions, revocable, cookie-based, rotation | JWT or DB (not with credentials) | JWT access + refresh tokens. Designed around Postgres RLS + PostgREST |
| Rate limiting, 2FA, passkeys | Built-in plugins (rate limit, 2FA TOTP, passkey) | Do it yourself | Rate limit and MFA built in |
| Fit with our authz | Good: identity only, and we keep workspace roles in our own tables | Good | Pushes us toward RLS-centric design and a second auth database schema (`auth.*`) |
| Ops cost | None beyond the app | None | One extra container, JWT secret management, SMTP config |

**Recommendation: Better Auth**, used for **identity and sessions only** (users, credentials, sessions, verification tokens, rate limiting, optional TOTP 2FA). Workspace membership, roles, and permissions stay in Eightcore's own schema and `authz` module, so the auth library can be swapped later. Its organisation plugin is not used.

**Approved 2026-10-13.** Implemented in `src/server/auth/config.ts`: email + password with required verification, 12-character minimum, DB sessions with no cookie cache (revocation takes effect on the next request), database-backed rate limits on auth routes, audit hooks for sign-in, failed sign-in and sign-up, and telemetry disabled. Its tables are mapped onto Eightcore names (`users`, `auth_sessions`, `auth_accounts`, `auth_verifications`, `auth_rate_limits`) with UUID IDs.

## 7. Security architecture

| Control | Implementation |
|---|---|
| Passwords | Better Auth scrypt (N=16384, r=16, p=1) or Argon2id via `@node-rs/argon2` (MIT). Minimum 12 characters. Breached-password check is optional and offline (k-anonymity API is free, but it is an external call, so it stays **off by default**) |
| Sessions | DB-backed, `HttpOnly`, `Secure` (prod), `SameSite=Lax` cookie. 7-day expiry with sliding refresh. Revoked on password change and role removal. "Sign out everywhere" |
| CSRF | Server Actions enforce `Origin` against `Host`. Better Auth checks trusted origins. Webhook routes do not use cookies |
| Authorization | Server-side `authz.assert` in every service function, plus composite FKs. Optional Postgres RLS as defence-in-depth in Phase 8 (see `PERMISSIONS.md` §6) |
| Input | Zod on every boundary. Rich text sanitized server-side (`sanitize-html` allowlist) before storage *and* rendering |
| Files | Uploaded through an authorized route. Size limit (default 50 MB). Content type sniffed with `file-type`. Stored under random keys, never under user-supplied paths. Downloaded through `/api/files/[id]` after an authz check, with `Content-Disposition: attachment` for non-image types and `X-Content-Type-Options: nosniff` |
| Headers | CSP per request in `src/proxy.ts` (Next.js 16's renamed middleware): nonce + `strict-dynamic` scripts, `frame-ancestors 'none'`, `form-action 'self'`. Styles allow `'unsafe-inline'` because Radix positions popovers with inline style attributes (scripts stay nonce-only). Plus `X-Frame-Options: DENY`, `nosniff`, HSTS (prod), `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy` |
| Secrets | `.env.local` (git-ignored). `env.ts` validates with Zod and imports `server-only`. Only `NEXT_PUBLIC_*` reaches the browser, and none of those are secrets. Integration tokens are encrypted at rest with AES-256-GCM (`node:crypto`) using `EIGHTCORE_ENCRYPTION_KEY` |
| DB roles | `eightcore_app` (DML only, no DDL, no `UPDATE/DELETE/TRUNCATE` on `activity_events`/`audit_log`), `eightcore_migrator` (DDL). Set up by `docker/postgres/` and verified by `tests/integration/constraints.test.ts`. The browser never sees any DB credential |
| Webhooks | Incoming: per-endpoint secret, HMAC-SHA256 over `timestamp.body`, 5-minute replay window, idempotency key table. Outgoing: same signature scheme so receivers can verify |
| Audit | `activity_events` (domain changes) and `audit_log` (security events: sign-in, failed sign-in, role change, invitation, integration connect, export, import run) |
| Rate limits | Better Auth limiter on auth routes. A per-user token bucket in Postgres for mutation-heavy routes and webhooks |
| Dependencies | `npm audit` in CI. Lockfile committed. Licence check script (see `COST_AND_LICENSES.md`) |

## 8. Data and concurrency strategy

- **IDs:** UUID (`gen_random_uuid()`, v4) on every table. An app-side UUIDv7 can be adopted later for index locality without a schema change.
- **Tenancy:** every workspace-owned row carries `workspace_id`. Child tables reference parents with **composite foreign keys** `(parent_id, workspace_id)`, which makes cross-workspace references impossible at the database level (`DATA_MODEL.md` §2).
- **Ordering:** fractional-index strings (`fractional-indexing`, CC0) for list, board, and subtask positions. A reorder updates one row.
- **Optimistic locking:** `tasks.version` integer. Updates use `WHERE id = $1 AND version = $2`. A mismatch returns 409 and the UI shows "This task changed — review and retry".
- **Soft delete:** `archived_at` (user-visible archive) and `deleted_at` (trash, purged after 30 days by a cron job). Partial indexes exclude deleted rows.
- **Timestamps:** `timestamptz` everywhere, stored in UTC and rendered in the user's time zone (`@date-fns/tz`). Due dates carry `due_has_time` so date-only deadlines don't drift across time zones.

## 9. Background jobs and automation engine

- **pg-boss** queues live in their own `pgboss` schema in the same database. The worker is `node worker/index.ts` (via `tsx` in development, compiled in production).
- **Outbox pattern:** domain writes insert `outbox_events` in the same transaction. A dispatcher job (every 1 s, plus `LISTEN` for low latency) fans out to queues: `automation.evaluate`, `notification.deliver`, `webhook.deliver`, `slack.post`, `email.send`.
- **Retries:** exponential backoff (pg-boss `retryLimit`/`retryBackoff`). Dead-letter queue surfaced in Settings → Integrations → Failed deliveries.
- **Automations:** rules are JSON (trigger, conditions, actions) validated by Zod. The evaluator is a pure function (unit-testable). Actions run through the **same service layer** as user actions, acting as a system actor with the rule creator's permissions captured at evaluation. Loop guard: events carry `causation_depth`, and rules stop at depth 3.
- **Schedules:** pg-boss cron for due-date reminders, trash purge, session cleanup, and import resumption.
- **ClickUp importer:** a long-running, checkpointed job. A per-token rate limiter (100 req/min on Free/Unlimited/Business plans) and resume-from-cursor.

## 10. Integrations (optional by construction)

Each integration is a module behind a provider interface and **disabled unless configured**. If a connection is absent or failing, its jobs no-op or dead-letter. Core task flows never wait on an external call.

| Integration | Mechanism | Notes |
|---|---|---|
| Slack | Agency-owned **internal** Slack app, bot token (`chat:write`, `chat:write.public`), `@slack/web-api` | Internal, customer-built apps are exempt from Slack's 2025 rate-limit reductions for non-Marketplace apps. Eightcore only posts messages, so the read-history limits don't apply anyway |
| Make.com | Outgoing signed webhooks + incoming webhook endpoints | Make's free tier (~1,000 credits/month) is the user's concern. Eightcore needs no Make account to function |
| Figma | Parse `figma.com/design/:fileKey/...?node-id=` URLs into `figma_references`. Optional thumbnail fetch with a personal access token | Rate limits depend on seat and plan, and View/Collab seats get very few Tier-1 calls. Thumbnail fetch is cached and optional |
| ClickUp | Read-only import (Phase 7) | Never writes to ClickUp |

## 11. Frontend architecture

- **Rendering:** Server Components for initial data (no client fetching waterfall). Client components for interactive views (board drag-and-drop with `@dnd-kit`, table with `@tanstack/react-table`). Optimistic UI via React 19 `useOptimistic`, reconciled with the server response.
- **State:** URL search params for filters, sort, and the open task (deep links). Minimal client state. TanStack Query only if polling or live views need it.
- **Design tokens:** CSS variables in `globals.css` (`--background`, `--foreground`, `--accent` = champagne gold, ...) with `.dark` overrides. Theme switch via `next-themes`. Components are shadcn/ui primitives restyled to the Eightcore palette.
- **Rich text:** Tiptap **open-source core and extensions only** (MIT). Tiptap Pro/Cloud extensions are commercial and **must not** be installed. The stored format is ProseMirror JSON plus a derived plain-text column for search.
- **Calendar:** built in-house on `date-fns` (month/week grid), or FullCalendar's **MIT packages only** (`core`, `daygrid`, `timegrid`, `interaction`). FullCalendar Premium (`resource-*`, `timeline`) is commercial. Do not install it.

## 12. Deployment (Phase 8, zero-cost path)

The default target is **self-hosting on hardware the agency already owns** (an office machine or existing server), using the same `docker-compose.yml` plus an app container, Caddy (Apache-2.0) for automatic HTTPS, and nightly `pg_dump` to a second disk. Any VPS or cloud host is an **optional paid choice**, documented with its costs and requiring approval. See `RUNBOOK.md`.

## 13. Architecture decision records

ADRs are added under `docs/adr/NNNN-title.md` as decisions are approved. Seeded from this document:

1. ADR-0001 Modular monolith on Next.js + Postgres
2. ADR-0002 Better Auth for identity (pending approval)
3. ADR-0003 pg-boss + transactional outbox for jobs and events
4. ADR-0004 Composite-FK workspace isolation
5. ADR-0005 Local filesystem storage behind `StorageAdapter`; S3-compatible (SeaweedFS/Garage) later, no MinIO
