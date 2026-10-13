# Eightcore — Runbook

Status: **Phase 2.** Local setup, database, authentication, and test commands below are implemented and tested. Sections marked *(target)* describe later phases. Last updated 2026-10-13.

## 1. Prerequisites (all free)

| Tool | Version | Install |
|---|---|---|
| Node.js | 22 LTS (≥ 22.12) or 24 LTS | https://nodejs.org or `nvm`/`fnm` |
| npm | bundled with Node | — |
| Git | any recent | OS package manager |
| PostgreSQL | 17 (16+ works) | **Option A:** Docker (below). **Option B:** native install (Postgres.app on macOS, apt/dnf on Linux, EDB installer on Windows) |
| Container runtime (Option A) | Docker Engine (Linux), Colima / Podman Desktop / Rancher Desktop (macOS/Windows), or Docker Desktop if 8limbs qualifies for its free tier (see `COST_AND_LICENSES.md` §4) | — |

No cloud accounts, API keys, or paid subscriptions are needed to run Eightcore locally.

## 2. First-time setup

```bash
git clone <repo-url> eightcore && cd eightcore
npm ci
cp .env.example .env.local
openssl rand -base64 32               # paste into BETTER_AUTH_SECRET in .env.local
```

### 2a. Database with Docker (Option A)

```bash
docker compose up -d                  # postgres:17 on 127.0.0.1:5432, mailpit on :1025 (SMTP) / :8025 (web UI)
```

On first start, the container runs `docker/postgres/00-bootstrap.sql` and `01-grants.sh`. They create two roles and the `eightcore` database:

| Role | Used by | Rights |
|---|---|---|
| `eightcore_migrator` | `npm run db:*` scripts, tests | Owns the schema (DDL). `CREATEDB` so tests can create their own database |
| `eightcore_app` | the running app (`DATABASE_URL`) | Data only (`SELECT/INSERT/UPDATE/DELETE`). **No** `UPDATE/DELETE` on `activity_events` or `audit_log`. No DDL |

The passwords in those files are **development-only**.

### 2b. Database with a native PostgreSQL (Option B)

Run the same two files once as the `postgres` superuser:

```bash
psql -U postgres -f docker/postgres/00-bootstrap.sql
psql -U postgres -d eightcore -f docker/postgres/sql/grants.sql
```

Without Mailpit, leave `SMTP_URL` empty in `.env.local`. Outgoing mail (verification, invites, resets) is then written to `.mail/*.json`, and each link is printed in the dev-server console.

### 2c. Migrate, seed, run

```bash
npm run db:migrate                    # apply SQL migrations in ./drizzle
npm run db:seed                       # dev-only demo workspace /w/demo
npm run dev                           # http://localhost:3000
```

Seeded accounts (password `eightcore demo password`, development only):

| Role | Email |
|---|---|
| Owner | `owner@demo.eightcore.local` |
| Admin | `admin@demo.eightcore.local` |
| Member | `member@demo.eightcore.local` |
| Guest | `guest@demo.eightcore.local` (commenter on the ACME project only) |

Mail sent by the app appears at http://localhost:8025 (Mailpit) or in `.mail/`.

### Environment variables (`.env.example`)

| Variable | Example | Secret? | Notes |
|---|---|---|---|
| `DATABASE_URL` | `postgres://eightcore_app:eightcore@localhost:5432/eightcore` | yes | App role: data access only |
| `DATABASE_MIGRATOR_URL` | `postgres://eightcore_migrator:eightcore@localhost:5432/eightcore` | yes | DDL role. Used only by `db:*` scripts and tests |
| `BETTER_AUTH_SECRET` | 32+ random characters | yes | Signs session cookies. Rotating it signs everyone out |
| `BETTER_AUTH_URL` | `http://localhost:3000` | no | Public base URL. Also the only trusted origin |
| `SMTP_URL` | `smtp://localhost:1025` | prod: yes | Empty → mail is written to `MAIL_OUTBOX_DIR` (refused in production) |
| `MAIL_FROM` | `Eightcore <no-reply@eightcore.local>` | no | |
| `MAIL_OUTBOX_DIR` | `.mail` | no | Git-ignored |
| `EIGHTCORE_ALLOW_FILE_MAIL` | `0` | no | `1` only for the local E2E server (production build without SMTP) |
| `EIGHTCORE_ENCRYPTION_KEY` | *(Phase 6)* | yes | Encrypts integration secrets at rest |
| `CLICKUP_API_TOKEN` | *(Phase 7, unset)* | yes | Only for an approved import |

Only variables prefixed `NEXT_PUBLIC_` reach the browser, and there are none today. `src/server/env.ts` validates everything on first use and fails with a message naming the bad variable. `npm run secrets:scan` checks every build's client bundles for secret names and values.

## 3. Everyday commands

| Command | Purpose |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run lint` / `npm run typecheck` / `npm run format` | Static checks |
| `npm test` | Unit tests + integration tests (integration needs Postgres: it creates `eightcore_test` itself) |
| `npm run test:unit` / `npm run test:integration` | One project only |
| `npm run build` | Production build |
| `npm run test:e2e` | Playwright against the production build (run `npm run build` first). Recreates `eightcore_e2e` on every run |
| `npm run ci` | Everything CI runs, locally |
| `npm run db:generate` | Generate a migration from schema changes (review the SQL before committing) |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Seed demo data (refuses `NODE_ENV=production`. Safe to re-run) |
| `npm run db:reset` | Drop and recreate the **local** dev database, then migrate (refuses non-localhost hosts) |
| `npm run db:studio` | Drizzle Studio (local DB browser) |
| `npm run licenses:check` | Licence allowlist check over `package-lock.json` |
| `npm run secrets:scan` | Scan `.next/static` for leaked secrets (after a build) |
| `npm run worker` | *(target, Phase 6)* background worker |

Playwright needs a Chromium build: `npx playwright install chromium` (free download). To use a Chromium already on the machine instead, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome`.

## 4. Database migrations

1. Edit `src/modules/*/schema.ts`.
2. `npm run db:generate`. Review the generated SQL in `drizzle/`. Hand-write additional SQL (triggers, roles, RLS) as a separate custom migration.
3. `npm run db:migrate` locally. Run the tests.
4. Commit schema + migration together. **Never edit a migration that has been merged.** Write a new one.
5. Destructive changes (drop column or table) need two steps: deploy code that stops using the column, then drop it in a later release.

## 5. Backups and restore

**Local development:** the data is disposable. Use `npm run db:reset`.

**Production (self-hosted, Phase 8):**

```bash
# nightly (cron or pg-boss schedule), compressed custom format
pg_dump --format=custom --no-owner --file=/backups/eightcore_$(date +%F).dump "$DATABASE_MIGRATOR_URL"
# attachments
rsync -a /srv/eightcore/storage/ /backups/storage/
# retention: 14 daily, 8 weekly, 6 monthly; copy to a second physical disk / NAS
```

Restore drill (performed at least quarterly, and before cutover):

```bash
createdb eightcore_restore_test
pg_restore --no-owner --dbname=eightcore_restore_test /backups/eightcore_YYYY-MM-DD.dump
# point a local instance at it and run the smoke test: sign in, open a project, open a task, download an attachment
```

## 6. Production deployment *(target, Phase 8, zero-hosting-cost path)*

1. An agency-owned machine (Linux preferred) with Docker Engine, a static LAN IP, or a subdomain pointed at it.
2. `docker compose -f docker-compose.prod.yml up -d` runs `postgres`, `app` (Next.js standalone build), `worker`, and `caddy` (automatic HTTPS via Let's Encrypt).
3. Secrets come from a root-only `.env.production`, never committed.
4. Migrations run as a one-off `app` container with `DATABASE_MIGRATOR_URL` before starting the new version.
5. Health check: `GET /api/health` (DB connectivity, pending migration count, worker heartbeat age).

Paid hosting (VPS/PaaS) is optional and needs approval (`COST_AND_LICENSES.md` §5).

## 7. Operations

| Situation | Action |
|---|---|
| Worker stopped | Jobs queue safely in Postgres. Restart with `npm run worker` (or `docker compose restart worker`). Nothing is lost |
| Integration failing (Slack/Make/Figma) | Core app unaffected. Check Settings → Integrations → Failed deliveries. Fix the credentials and retry the dead-lettered jobs |
| User locked out | An Owner/Admin issues a password reset link from Settings → Members. Sessions can be revoked there |
| Suspected credential leak | Rotate `BETTER_AUTH_SECRET` (forces sign-in for everyone), rotate the DB passwords, rotate the affected integration tokens, review `audit_log` |
| Disk filling | Check `storage/` size, `activity_events` growth, and pg-boss archive retention (default 7 days) |

## 8. Key rotation: `EIGHTCORE_ENCRYPTION_KEY`

Encrypted columns store `secret_key_version`. To rotate: add `EIGHTCORE_ENCRYPTION_KEY_V2`, set it as the active version, run `npm run secrets:reencrypt`, verify, then remove the old key. (Implemented in Phase 6.)

## 9. ClickUp import (Phase 7, approval-gated)

```bash
# 1. read-only inventory (requires approval to use the token)
CLICKUP_API_TOKEN=... npm run import:clickup -- inventory --team <teamId>
# 2. staging run into a dedicated staging workspace
npm run import:clickup -- run --mode staging --workspace eightcore-staging --scope scope.yaml
# 3. reconciliation report
npm run import:clickup -- reconcile --job <jobId>
# final mode refuses to run without --approved-by matching a workspace Owner
```

See `MIGRATION_PLAN.md`.

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| `ECONNREFUSED 5432` | `docker compose ps`. Start Postgres. Check `DATABASE_URL` host and port |
| `Environment validation failed` | Compare `.env.local` with `.env.example`. The message names the variable |
| `password authentication failed for user "eightcore_app"` | The bootstrap SQL hasn't run on this Postgres. See §2a/§2b |
| `permission denied for schema public` on migrate | `grants.sql` wasn't applied to the database (§2b) |
| Sign-in says "verify your email" | Open the link from Mailpit or `.mail/`, or use a seeded account |
| `Too many attempts` on sign-in | The auth rate limit (10 sign-ins/min per IP) applies. Wait a minute |
| Emails not arriving | Open http://localhost:8025. Check `SMTP_URL` |
| Playwright cannot find a browser | `npx playwright install chromium` (free download) |
| `permission denied for table` | A migration ran as the app role. Re-run with `DATABASE_MIGRATOR_URL` |
| Docker Desktop licence concern | Use Colima, Podman Desktop, Rancher Desktop, or native Postgres. Nothing in Eightcore depends on Docker Desktop specifically |
