# Eightcore — Runbook

Status: **target procedures.** The application code does not exist yet (Phase 1 is documentation only). Commands below become real in Phase 2, and this file is updated as each phase lands. Last updated 2026-10-13.

## 1. Prerequisites (all free)

| Tool | Version | Install |
|---|---|---|
| Node.js | 22 LTS (≥ 22.12) or 24 LTS | https://nodejs.org or `nvm`/`fnm` |
| npm | bundled with Node | — |
| Git | any recent | OS package manager |
| PostgreSQL | 17 (16+ works) | **Option A:** Docker (see below). **Option B:** native install (Postgres.app on macOS, apt/dnf on Linux, EDB installer on Windows) |
| Container runtime (Option A) | Docker Engine (Linux), Colima / Podman Desktop / Rancher Desktop (macOS/Windows), or Docker Desktop if 8limbs qualifies for its free tier (see `COST_AND_LICENSES.md` §4) | — |

No cloud accounts, API keys, or paid subscriptions are needed to run Eightcore locally.

## 2. First-time setup (target, Phase 2)

```bash
git clone <repo-url> eightcore && cd eightcore
cp .env.example .env.local            # then fill in the generated secrets below
npm ci

# generate secrets (never commit .env.local)
openssl rand -base64 32               # → BETTER_AUTH_SECRET
openssl rand -base64 32               # → EIGHTCORE_ENCRYPTION_KEY

docker compose up -d                  # postgres:17 on :5432, mailpit on :1025 (SMTP) / :8025 (web UI)
npm run db:migrate                    # apply SQL migrations in ./drizzle
npm run db:seed                       # dev-only demo workspace, users per role, Agency Delivery workflow
npm run dev                           # http://localhost:3000
npm run worker                        # second terminal: background jobs (Phase 6+)
```

Mail sent by the app (verification, invites, password reset) appears at http://localhost:8025.

### Environment variables (`.env.example`)

| Variable | Example | Secret? | Notes |
|---|---|---|---|
| `DATABASE_URL` | `postgres://eightcore_app:eightcore@localhost:5432/eightcore` | yes | App role: DML only |
| `DATABASE_MIGRATOR_URL` | `postgres://eightcore_migrator:eightcore@localhost:5432/eightcore` | yes | DDL role used only by migrations |
| `BETTER_AUTH_SECRET` | 32+ random bytes | yes | Session signing |
| `BETTER_AUTH_URL` | `http://localhost:3000` | no | Trusted origin |
| `EIGHTCORE_ENCRYPTION_KEY` | 32 random bytes, base64 | yes | Encrypts integration secrets at rest. Rotation procedure in §8 |
| `STORAGE_DRIVER` | `local` | no | `local` \| `s3` (later) |
| `STORAGE_LOCAL_DIR` | `./storage` | no | Git-ignored, outside `public/` |
| `SMTP_URL` | `smtp://localhost:1025` | dev: no | Mailpit locally |
| `MAIL_FROM` | `Eightcore <no-reply@localhost>` | no | |
| `CLICKUP_API_TOKEN` | *(unset)* | yes | Phase 7 only. Leave unset unless running an approved import |
| `SLACK_*`, `FIGMA_*` | *(unset)* | yes | Optional. Normally configured in-app (encrypted in DB) instead |

Only variables prefixed `NEXT_PUBLIC_` reach the browser, and none of them may hold a secret. `src/server/env.ts` validates everything at boot and refuses to start on missing or invalid values.

## 3. Everyday commands (target)

| Command | Purpose |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run worker` | Background worker (pg-boss) |
| `npm run lint` / `npm run typecheck` / `npm run format` | Static checks |
| `npm test` | Unit + integration tests (needs Postgres running) |
| `npm run test:e2e` | Playwright against a production build + seeded DB |
| `npm run ci` | Everything CI runs, locally |
| `npm run db:generate` | Generate a migration from schema changes (review the SQL before committing) |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Seed dev data (refuses to run when `NODE_ENV=production`) |
| `npm run db:reset` | Drop and recreate the **local dev** DB, migrate, seed (refuses non-localhost hosts) |
| `npm run db:studio` | Drizzle Studio (local DB browser) |
| `npm run licenses:check` | Licence allowlist check |

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

## 6. Production deployment (target, Phase 8, zero-hosting-cost path)

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
| `env validation failed` at boot | Compare `.env.local` with `.env.example`. The message names the variable |
| Emails not arriving | Open http://localhost:8025. Check `SMTP_URL` |
| Playwright cannot find a browser | `npx playwright install chromium` (free download) |
| `permission denied for table` | A migration ran as the app role. Re-run with `DATABASE_MIGRATOR_URL` |
| Docker Desktop licence concern | Use Colima, Podman Desktop, Rancher Desktop, or native Postgres. Nothing in Eightcore depends on Docker Desktop specifically |
