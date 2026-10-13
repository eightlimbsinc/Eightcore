# Eightcore — Cost and Licences

Policy: free and open-source software by default. **Nothing that can incur a charge is added without written approval.** This file must be updated whenever a dependency is added, removed, or upgraded across a major version.

Licences and versions below were checked against the npm registry and project sites on **2026-10-13**. "FOSS" = free and open-source software (the licence permits free use, modification, and redistribution). A "free tier" of a hosted service is **not** FOSS and is listed separately.

## 1. Summary

| Category | Recurring cost for local development | Notes |
|---|---|---|
| Application dependencies | **$0** | All permissive licences (MIT, ISC, Apache-2.0, BSD, CC0, Unlicense) |
| Database, jobs, search, storage | **$0** | PostgreSQL + pg-boss + Postgres FTS + local filesystem |
| Local infrastructure | **$0** | Docker Engine (Apache-2.0) or native Postgres. Docker Desktop may require a paid subscription for larger companies (see §4) |
| Source hosting and CI | **$0** | GitHub Free. Actions minutes are capped for private repos, and a $0 spending limit prevents charges |
| Integrations | **$0 required** | Slack, Make.com, Figma, and ClickUp are all optional, and their plans are already owned or free tiers |
| Production hosting | **$0 if self-hosted on owned hardware** | A VPS or cloud host is an optional paid choice (§5) |

## 2. Runtime and framework

| Dependency | Version checked | Licence | FOSS | Free-tier restrictions | Optional paid services | Potential recurring cost |
|---|---|---|---|---|---|---|
| Node.js (22 LTS / 24 LTS) | 22.22 | MIT | ✅ | — | — | None |
| Next.js | 16.4.0 | MIT | ✅ | — | Vercel hosting (optional, **not used**) | None |
| React / React DOM | 19.3.0 | MIT | ✅ | — | — | None |
| TypeScript | pin 6.0.x (7.0.2 is latest) | Apache-2.0 | ✅ | — | — | None |
| Tailwind CSS | 4.3.3 | MIT | ✅ | — | Tailwind Plus (paid UI kit, **must not be used**) | None |
| shadcn/ui (`shadcn` CLI; components copied into repo) | 4.21.4 | MIT | ✅ | — | Third-party "pro" blocks sold by others (**must not be used**) | None |
| Radix UI primitives (`radix-ui`) | 1.8.1 | MIT | ✅ | — | — | None |
| lucide-react (icons) | 1.56.0 | ISC | ✅ | — | — | None |
| next-themes | 0.4.6 | MIT | ✅ | — | — | None |
| class-variance-authority / clsx / tailwind-merge | 0.7.1 / 2.1.1 / 3.7.0 | Apache-2.0 / MIT / MIT | ✅ | — | — | None |
| Zod | 4.6.7 | MIT | ✅ | — | — | None |
| react-hook-form | 7.90.0 | MIT | ✅ | — | — | None |
| @tanstack/react-table | 9.3.1 | MIT | ✅ | — | — | None |
| @tanstack/react-query (only if needed) | 5.104.2 | MIT | ✅ | — | — | None |
| @dnd-kit/core | 6.3.1 | MIT | ✅ | — | — | None |
| cmdk (command palette) | 1.1.1 | MIT | ✅ | — | — | None |
| sonner (toasts) | 2.0.8 | MIT | ✅ | — | — | None |
| date-fns / @date-fns/tz | 4.4.0 / 1.5.0 | MIT | ✅ | — | — | None |
| react-day-picker | 10.0.2 | MIT | ✅ | — | — | None |
| fractional-indexing | 4.0.0 | CC0-1.0 | ✅ (public domain) | — | — | None |
| Tiptap (`@tiptap/core`, `@tiptap/pm`, OSS extensions) | 3.32.0 | MIT | ✅ | — | **Tiptap Pro extensions, Tiptap Cloud/Collab are commercial. Do not install `@tiptap-pro/*`** | None if only OSS packages are used |
| sanitize-html | 2.18.0 | MIT | ✅ | — | — | None |
| recharts (dashboards) | 3.10.1 | MIT | ✅ | — | — | None |
| FullCalendar (alternative to an in-house calendar), **only** `core`, `daygrid`, `timegrid`, `interaction` | 6.1.x / 7.x | MIT | ✅ | — | **FullCalendar Premium (`resource-*`, `timeline`, `scheduler`) is commercial. Do not install** | None if only MIT packages are used |
| Fonts: Inter or Geist | — | SIL OFL 1.1 | ✅ | — | — | None (self-hosted via `next/font`, no Google API calls at runtime) |

## 3. Data, auth, jobs, server

| Dependency | Version checked | Licence | FOSS | Free-tier restrictions | Optional paid services | Potential recurring cost |
|---|---|---|---|---|---|---|
| PostgreSQL | 17 (16+ supported) | PostgreSQL Licence (permissive) | ✅ | — | Managed Postgres hosts (optional, not required) | None |
| Drizzle ORM | 0.45.4 | Apache-2.0 | ✅ | — | — | None |
| drizzle-kit (migrations CLI) | 0.31.11 | MIT | ✅ | — | — | None |
| pg (node-postgres) | 8.23.1 | MIT | ✅ | — | — | None |
| Better Auth (**pending approval**) | 1.7.7 | MIT | ✅ | — | Better Auth's hosted dashboard/infrastructure product is optional and **not used** | None |
| — alternative: Auth.js / next-auth | 4.24.15 (v5 beta) | ISC | ✅ | — | — | None. Security-maintenance only |
| — alternative: Supabase Auth (GoTrue, self-hosted) | — | MIT | ✅ | — | Supabase Cloud has a free tier with limits (**hosted, not used**) | None if self-hosted |
| @node-rs/argon2 (optional Argon2id hashing) | 2.2.2 | MIT | ✅ | — | — | None |
| pg-boss (jobs) | 12.37.1 | MIT | ✅ | — | — | None |
| tsx (run TS worker in dev) | 4.23.15 | MIT | ✅ | — | — | None |
| pino / pino-pretty (logging) | 10.4.0 / 13.2.0 | MIT | ✅ | — | Hosted log services (optional, not used) | None |
| nodemailer (SMTP) | 10.1.0 | MIT-0 | ✅ | — | Production SMTP relay (optional) | Possibly, if a paid SMTP relay is chosen later |
| file-type (MIME sniffing) | 22.1.1 | MIT | ✅ | — | — | None |
| server-only | 0.0.1 | MIT | ✅ | — | — | None |
| @aws-sdk/client-s3 (later, for S3-compatible self-hosted storage) | 3.x | Apache-2.0 | ✅ | — | AWS S3 itself is paid (**not used**). The SDK talks to any S3-compatible server | None with a self-hosted backend |
| @slack/web-api (optional integration) | 8.2.0 | MIT | ✅ | — | — | None (see §6) |

## 4. Tooling and local infrastructure

| Tool | Licence | FOSS | Notes / restrictions | Potential recurring cost |
|---|---|---|---|---|
| Vitest + @vitest/coverage-v8 (5.0.4) | MIT | ✅ | — | None |
| Playwright (@playwright/test 1.64.0) | Apache-2.0 | ✅ | Browsers downloaded free | None |
| @axe-core/playwright (4.13.0) | MPL-2.0 | ✅ | File-level copyleft applies only if *we modify axe's files*. Using it unmodified in tests imposes nothing on our code | None |
| Testing Library, jsdom | MIT | ✅ | — | None |
| ESLint 10, typescript-eslint 8.71, eslint-config-next | MIT | ✅ | typescript-eslint requires TypeScript < 6.1 (why TS is pinned) | None |
| Prettier | MIT | ✅ | — | None |
| Git | GPL-2.0 | ✅ | A tool, not distributed with the app | None |
| Docker Engine / Docker Compose (Linux) | Apache-2.0 | ✅ | — | None |
| **Docker Desktop** (macOS/Windows) | Proprietary (Docker Subscription Service Agreement) | ❌ | Free for personal use, education, non-commercial OSS, and **small businesses (< 250 employees AND < $10M annual revenue)**. Larger organisations need a paid subscription | **$0 for 8limbs if under both thresholds.** Otherwise use the free alternatives: Colima, Podman Desktop (Apache-2.0), Rancher Desktop (Apache-2.0), or native Postgres |
| Mailpit (local SMTP catcher) | MIT | ✅ | Docker image or single binary | None |
| Caddy (HTTPS reverse proxy, Phase 8) | Apache-2.0 | ✅ | Let's Encrypt certificates are free | None |

## 5. Hosting and services (all optional)

| Service | Required? | Free option | Paid trigger | Status |
|---|---|---|---|---|
| GitHub (repo) | No (local git works) | GitHub Free: unlimited private repos | Paid plans for advanced features | **In use (free)** |
| GitHub Actions (CI) | No (`npm run ci` locally) | Free for public repos. Private repos on Free get a monthly minutes quota (2,000 Linux min at time of writing) | Usage beyond the quota is billed **only if** a spending limit above $0 is set | Keep the spending limit at **$0** |
| Production hosting | No (self-host) | Agency-owned machine + Docker + Caddy | Any VPS/PaaS (Hetzner, DigitalOcean, Render, Vercel, etc.) has a monthly fee or free-tier limits | **Requires approval before use** |
| Domain name | Only for public HTTPS access | Can use an existing agency domain/subdomain | Domain registration (if a new one is needed) | Probably already owned |
| Object storage | No (local FS) | Self-hosted SeaweedFS (Apache-2.0) or Garage (AGPL-3.0, separate unmodified service, no impact on our code) | Cloud S3/R2/B2 | Not planned. **MinIO CE is archived upstream (2026) and must not be adopted** |
| Off-site backups | Recommended | Second local disk / NAS | Cloud backup storage | Decide in Phase 8 |
| Email delivery (production) | Only for email notifications | Existing Google Workspace/M365 SMTP relay (subject to that provider's sending limits) | Transactional email services (paid tiers) | Decide in Phase 6 |

## 6. Third-party APIs (optional integrations)

Usage limits are set by each provider and can change. The core app never depends on them.

| API | Plan dependency | Known limits (checked 2026-10-13) | Cost to Eightcore |
|---|---|---|---|
| ClickUp API v2/v3 (migration only) | Uses the agency's existing ClickUp plan | 100 req/min per token on Free Forever / Unlimited / Business. 1,000 on Business Plus. 10,000 on Enterprise | $0 extra. Only used until cutover |
| Slack Web API | Agency's existing Slack workspace. Create an **internal** (non-distributed) app | Tiered per-method rate limits. The 2025 reductions for non-Marketplace apps (e.g. `conversations.history` at Tier 1) exempt internal customer-built apps, and Eightcore only posts messages anyway | $0 |
| Make.com | Agency's own Make account, if any | Free plan ≈ 1,000 credits/month (third-party sources, verify on make.com/pricing). Each Make scenario run consumes credits **on Make's side** | $0 to Eightcore. Any Make plan upgrade is the agency's choice and requires approval |
| Figma REST API | Agency's existing Figma plan and seats | Limits depend on seat (View/Collab/Dev/Full), endpoint tier, and plan. View/Collab seats get very few Tier-1 calls (file/image endpoints). Thumbnail fetch is therefore optional and cached | $0. Link-only Figma references need no API at all |
| Have I Been Pwned range API (optional breached-password check) | None | Free, k-anonymity | $0. **Off by default** (external call) |

## 7. Explicitly excluded

- Paid AI APIs at runtime (no LLM features in the core app).
- Paid UI kits, templates, or themes (Tailwind Plus, premium shadcn blocks, ThemeForest, etc.).
- Tiptap Pro / Cloud, FullCalendar Premium.
- Managed auth providers (Clerk, Auth0, Supabase Cloud, Firebase Auth, etc.).
- Managed queues or workflow orchestrators (Temporal Cloud, Inngest Cloud, Trigger.dev Cloud, etc.).
- Redis as required infrastructure.
- MinIO (archived upstream). Any AGPL component **linked into** the app (AGPL services run as separate unmodified processes are acceptable after review).

## 8. Enforcement

- Phase 2 adds `scripts/check-licenses.mjs`, which reads `package-lock.json` and fails CI if any production dependency's licence is outside the allowlist: MIT, ISC, Apache-2.0, BSD-2/3-Clause, 0BSD, CC0-1.0, Unlicense, MIT-0, BlueOak-1.0.0, Python-2.0, MPL-2.0 (dev only).
- `npm view <pkg> license` and the package's repository `LICENSE` are checked before adding any dependency, and the result is recorded in this file in the same pull request.
