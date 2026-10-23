# Eightcore — Cost and Licences

Policy: free and open-source software by default. **Nothing that can incur a charge is added without written approval.** This file must be updated whenever a dependency is added, removed, or upgraded across a major version.

Licences and versions below were checked against the npm registry and project sites on **2026-10-13**, and are enforced on every CI run by `npm run licenses:check` (§8). "FOSS" = free and open-source software (the licence permits free use, modification, and redistribution). A "free tier" of a hosted service is **not** FOSS and is listed separately.

## 1. Summary

| Category | Recurring cost for local development | Notes |
|---|---|---|
| Application dependencies | **$0** | All permissive licences (MIT, ISC, Apache-2.0, BSD, CC0, Unlicense) |
| Database, jobs, search, storage | **$0** | PostgreSQL + pg-boss + Postgres FTS + local filesystem |
| Local infrastructure | **$0** | Docker Engine (Apache-2.0) or native Postgres. Docker Desktop may require a paid subscription for larger companies (see §4) |
| Source hosting and CI | **$0** | GitHub Free. Actions minutes are capped for private repos, and a $0 spending limit prevents charges |
| Integrations | **$0 required** | Slack, Make.com, Figma, and ClickUp are all optional, and their plans are already owned or free tiers |
| Hosting | **$9/month for the test deployment** (Netlify Personal; Supabase Free) | Production hosting will likely need paid plans; decided with a costed comparison before go-live (§5) |

## 2. Runtime and framework

| Dependency | Version checked | Licence | FOSS | Free-tier restrictions | Optional paid services | Potential recurring cost |
|---|---|---|---|---|---|---|
| Node.js (22 LTS / 24 LTS) | 22.22 | MIT | ✅ | — | — | None |
| Next.js | 16.4.2 | MIT | ✅ | — | Vercel hosting (optional, **not used**) | None |
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
| Geist font (`geist` npm package) | 1.7.2 | SIL OFL 1.1 | ✅ | — | — | None. Bundled locally, so builds and pages make no Google Fonts calls |

## 3. Data, auth, jobs, server

| Dependency | Version checked | Licence | FOSS | Free-tier restrictions | Optional paid services | Potential recurring cost |
|---|---|---|---|---|---|---|
| PostgreSQL | 17 (16+ supported) | PostgreSQL Licence (permissive) | ✅ | — | Managed Postgres hosts (optional, not required) | None |
| Drizzle ORM | 0.45.4 | Apache-2.0 | ✅ | — | — | None |
| drizzle-kit (migrations CLI) | 0.31.11 | MIT | ✅ | — | — | None |
| pg (node-postgres) | 8.23.1 | MIT | ✅ | — | — | None |
| Better Auth (**approved 2026-10-13**) | 1.7.7 | MIT | ✅ | — | Better Auth's hosted dashboard/infrastructure product is optional and **not used**. Telemetry is off by default and explicitly disabled in config | None |
| — alternative: Auth.js / next-auth | 4.24.15 (v5 beta) | ISC | ✅ | — | — | None. Security-maintenance only |
| — alternative: Supabase Auth (GoTrue, self-hosted) | — | MIT | ✅ | — | Supabase Cloud has a free tier with limits (**hosted, not used**) | None if self-hosted |
| @node-rs/argon2 (optional Argon2id hashing) | 2.2.2 | MIT | ✅ | — | — | None |
| pg-boss (jobs) | 12.37.1 | MIT | ✅ | — | — | None |
| tsx (run TS worker in dev) | 4.23.15 | MIT | ✅ | — | — | None |
| pino / pino-pretty (logging) | 10.4.0 / 13.2.0 | MIT | ✅ | — | Hosted log services (optional, not used) | None |
| nodemailer (SMTP) | 10.1.0 | MIT-0 | ✅ | — | Production SMTP relay (optional) | Possibly, if a paid SMTP relay is chosen later |
| file-type (MIME sniffing, **in use since Phase 3b**) | 22.2.0 | MIT | ✅ | — | — | None |
| @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities (board drag and drop, with keyboard support, **in use since Phase 4**) | 6.3.1 / 10.0.0 / 3.2.2 | MIT | ✅ | — | — | None |
| aws4fetch (S3 request signing for file storage, **in use since Phase 3b**) | 1.0.20 | MIT | ✅ | — | Talks to any S3-compatible store; the test deployment uses Supabase Storage (Free plan, below) | None on the free tier |
| server-only | 0.0.1 | MIT | ✅ | — | — | None |
| @slack/web-api (optional integration) | 8.2.0 | MIT | ✅ | — | — | None (see §6) |

## 4. Tooling and local infrastructure

| Tool | Licence | FOSS | Notes / restrictions | Potential recurring cost |
|---|---|---|---|---|
| Vitest + @vitest/coverage-v8 (5.0.4) | MIT | ✅ | — | None |
| Playwright (@playwright/test 1.64.0) | Apache-2.0 | ✅ | Browsers downloaded free | None |
| @axe-core/playwright (4.13.0) | MPL-2.0 | ✅ | File-level copyleft applies only if *we modify axe's files*. Using it unmodified in tests imposes nothing on our code | None |
| Testing Library, jsdom | MIT | ✅ | — | None |
| ESLint 9.39, typescript-eslint 8.71, eslint-config-next 16.4 | MIT | ✅ | ESLint 10 is out, but `eslint-plugin-react`, `-import` and `-jsx-a11y` (used by `eslint-config-next`) don't support it yet. typescript-eslint requires TypeScript < 6.1 (why TS is pinned) | None |
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
| GitHub Codespaces (browser preview / cloud dev environment) | No (local setup works) | Personal GitHub Free accounts include 120 core-hours and 15 GB-month storage per month. The default 2-core machine therefore gives about 60 hours/month. Codespaces from this org repo bill to the creator's personal allowance unless the org opts to pay. GitHub org plans include no free Codespaces quota | Usage beyond the allowance is billed only if the account's Codespaces budget is above $0 (default $0 for personal accounts). If the org opts in, its usage is billed to the org | **Optional.** Keep budgets at **$0** and stop codespaces when idle |
| **Netlify** (test deployment: runs the app) | No (any Node host works) | Free plan, commercial use allowed: 300 credits/month **hard cap**; a production deploy costs 15 credits; when credits run out every site on the team is paused until the next cycle. No overage billing on Free | Paid plans (per-member pricing; check current rates before go-live) | **Approved for testing 2026-10-23. Team upgraded to Personal ($9/month, 1,000 credits) on 2026-10-23**, the project's first paid service, so the team's other sites aren't at risk of the free-credit cutoff. Deploy only the `release` branch; deploy previews off (`DEPLOY_NETLIFY_SUPABASE.md`) |
| **Supabase** (test deployment: Postgres + Storage for attachments) | No (any Postgres works; any S3-compatible store works for files) | Free plan: 2 active projects per account, 500 MB database, **1 GB file storage, 50 MB per file**, pauses after 7 days without activity, no backups | Pro from $25/month per organization (includes compute credit for one small project; each further project adds compute cost). Spend cap on by default | **Approved for testing 2026-10-23** (Free). Data API and automatic RLS disabled; access verified by `npm run db:supabase:setup` |
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

## 8. Installed today (Phase 2)

Everything else in §2–§4 is **planned** and is added (and re-verified) in the phase that needs it.

| Kind | Packages (exact versions in `package.json`) |
|---|---|
| Runtime | next 16.4.2, react / react-dom 19.3.0, better-auth 1.7.7, drizzle-orm 0.45.4, pg 8.23.1, zod 4.6.7, nodemailer 10.1.0, radix-ui 1.8.1, lucide-react 1.56.0, next-themes 0.4.6, class-variance-authority 0.7.1, clsx 2.1.1, tailwind-merge 3.7.0, geist 1.7.2, server-only 0.0.1, fractional-indexing 4.0.0 (CC0-1.0), aws4fetch 1.0.20, file-type 22.2.0, @dnd-kit/core 6.3.1, @dnd-kit/sortable 10.0.0, @dnd-kit/utilities 3.2.2 |
| Development | typescript 6.0.3, tailwindcss + @tailwindcss/postcss 4.3.3, drizzle-kit 0.31.11, eslint 9.39.5, eslint-config-next 16.4.2, typescript-eslint 8.71.2, prettier 3.9.10, prettier-plugin-tailwindcss 0.8.1 (MIT), vitest 5.0.4, @playwright/test 1.64.0, tsx 4.23.15, @types/* |

### Reviewed non-permissive transitive packages

| Package | Licence | Pulled in by | Why it's acceptable |
|---|---|---|---|
| `lightningcss` (+ platform binaries) | MPL-2.0 | Tailwind CSS 4 (CSS compiler, build time) | File-level copyleft. Used unmodified, so there are no obligations for our code |
| `axe-core` | MPL-2.0 | `eslint-plugin-jsx-a11y` (lint only) | Same. Dev tooling, unmodified |
| `@img/sharp-libvips-*` | LGPL-3.0-or-later | `sharp`, Next.js's optional image optimiser | Dynamically linked, unmodified native library. LGPL permits this in proprietary apps. Optional and platform-specific |
| `caniuse-lite` | CC-BY-4.0 | Browserslist (build tooling) | Data licence. Attribution is kept in the package |

### Known `npm audit` findings (2026-10-13)

| Advisory | Where | Exposure | Action |
|---|---|---|---|
| esbuild ≤ 0.24.2 dev-server CORS (GHSA-67mh-4wv8-2f99), moderate | `drizzle-kit` → `@esbuild-kit/*` | Only when running esbuild's *dev server*, which drizzle-kit never starts. Not in the app runtime | Track drizzle-kit 1.0, which drops `@esbuild-kit` |
| braces stack exhaustion (GHSA-vfj7-8cjw-p6xm), high | `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` | Lint-time glob matching over our own repo files only | Track the next `eslint-config-next` release |

No advisory affects code that runs in the deployed app.

## 9. Enforcement

- `scripts/check-licenses.mjs` (`npm run licenses:check`, run in CI) reads `package-lock.json` and fails if **any** installed package's licence is outside the allowlist: MIT, MIT-0, ISC, Apache-2.0, BSD-2/3-Clause, 0BSD, CC0-1.0, Unlicense, BlueOak-1.0.0, Python-2.0, CC-BY-4.0 (data), SIL OFL 1.1 (fonts), plus the reviewed MPL-2.0 / LGPL-3.0 entries above. A new non-permissive licence fails CI until it's reviewed here.
- `npm view <pkg> license` and the package's repository `LICENSE` are checked before adding any dependency, and the result is recorded in this file in the same pull request.
