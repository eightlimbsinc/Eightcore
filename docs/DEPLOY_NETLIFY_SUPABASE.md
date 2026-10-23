# Deploying Eightcore on Netlify + Supabase

Status: test deployment for invited testers. Hosting: **Netlify (free)** runs the app, **Supabase (free)** holds the database, **Google Workspace** sends email, **Cloudflare DNS** serves your domain. Approved 2026-10-23. Production hosting is a separate decision (`COST_AND_LICENSES.md`).

Keep every password, connection string, and secret out of chat, issues, and git. They go only into the files named below (git-ignored) and into Netlify's environment variables.

```
Browser ──HTTPS──▶ Netlify (Next.js app, US East) ──TLS, verified──▶ Supabase Postgres (transaction pooler)
                       │
                       └──SMTPS──▶ Google Workspace (invites, verification, password reset)
```

## 1. Supabase project (done once)

1. Create the project with **Enable Data API off** and **Enable automatic RLS off**, in a **US East** region (next to Netlify's default function region, so the many app↔database round trips stay short).
2. **Connect** (top bar) → **Session pooler** → copy the connection string (`postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@…pooler.supabase.com:5432/postgres`).
3. **Project Settings → Database → SSL Configuration → Download certificate** (e.g. `prod-ca-2021.crt`).

## 2. Create Eightcore's database accounts and tables (in your Codespace)

1. Open your Codespace and drag the downloaded `.crt` file into the file list (top-level folder). `*.crt` is git-ignored.
2. In the terminal:
   ```bash
   git pull
   DATABASE_SSL_CA_FILE=./prod-ca-2021.crt npm run db:supabase:setup
   ```
3. Paste the **Session pooler** string when asked, then type the **database password** (hidden as you type).

The command:
- Creates `eightcore_migrator` (owns the tables, runs migrations) and `eightcore_app` (data only, what Netlify uses) with fresh random passwords. Re-running rotates them.
- Applies all migrations, makes `activity_events` and `audit_log` append-only for the app.
- **Verifies** Supabase's API roles (`anon`, `authenticated`) have no access to any Eightcore table, row-level security won't hide rows from the app, and the app role can't create tables or rewrite history. It stops with `SECURITY:` if anything is wrong.
- Writes two git-ignored files:
  - `.env.netlify`: the settings Netlify needs.
  - `.env.supabase-admin`: migrator access, **for future migrations only, never for Netlify**.

Note: Eightcore's tables belong to `eightcore_migrator`, so Supabase's Table Editor (which uses the `postgres` role) may not show their rows. That is expected.

## 3. Email through Google Workspace

1. Use (or create) a Google Workspace account to send from, e.g. `eightcore@yourdomain.com`. It needs **2-Step Verification** on.
2. Create an **app password**: https://myaccount.google.com/apppasswords → name it "Eightcore" → copy the 16-character password (no spaces).
   If the page says app passwords aren't available, a Workspace admin must allow them (Admin console → Security → Less secure apps / app passwords), or use Google's SMTP relay service instead.
3. Your SMTP setting (replace both parts; `%40` stands for `@`):
   ```
   SMTP_URL=smtps://eightcore%40yourdomain.com:APPPASSWORD@smtp.gmail.com:465
   MAIL_FROM="Eightcore <eightcore@yourdomain.com>"
   ```

## 4. Netlify site

1. https://app.netlify.com → **Add new project → Import an existing project → GitHub** → `eightlimbsinc/Eightcore`.
2. **Branch to deploy:** `release` (see "Saving Netlify credits" below). Build settings come from `netlify.toml`; leave them as detected.
3. Before the first deploy, add environment variables (**Project configuration → Environment variables**, scope "All" or at least "Functions"):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | from `.env.netlify` |
   | `DATABASE_POOL_MAX` | `3` |
   | `DATABASE_SSL_CA` | from `.env.netlify` (the whole value, one line) |
   | `BETTER_AUTH_SECRET` | run `openssl rand -base64 32` in the Codespace and paste the result |
   | `BETTER_AUTH_URL` | your site address, e.g. `https://eightcore-8limbs.netlify.app` (later your domain) |
   | `SIGNUP_ALLOWED_EMAILS` | your own email (the first owner). Everyone else joins by invitation |
   | `AUTH_IP_HEADERS` | `x-nf-client-connection-ip` |
   | `SMTP_URL` | from step 3 |
   | `MAIL_FROM` | from step 3 |

   Do **not** add `DATABASE_MIGRATOR_URL` to Netlify.
4. **Deploy.** Open the site, sign up with the allowlisted email, verify it from your inbox, create the workspace, then invite testers from **Members**. Invitations are email-bound, single-use, and expire after 7 days.

`BETTER_AUTH_URL` must exactly match the address in the browser (scheme and host). After changing it, redeploy (**Deploys → Trigger deploy**).

## 5. Your domain (Cloudflare DNS)

1. Netlify: **Domain management → Add a domain** → e.g. `eightcore.yourdomain.com`.
2. Cloudflare DNS: add a **CNAME** `eightcore` → `<your-site>.netlify.app`, **Proxy status: DNS only** (grey cloud), so Netlify can issue the HTTPS certificate.
3. When Netlify shows the certificate as active, set `BETTER_AUTH_URL=https://eightcore.yourdomain.com` and redeploy.

## Saving Netlify credits

The free plan has 300 credits/month, a production deploy costs 15, and if they run out **the site goes offline until the next month**. So Netlify should not deploy on every development push:

- Netlify deploys only the `release` branch. It moves only when we decide to update the test site.
- **Project configuration → Build & deploy → Deploy previews: off** (no builds for pull requests).

## Applying future database changes

New releases may include migrations. Apply them **before** deploying the new app version:

```bash
set -a; . ./.env.supabase-admin; set +a
npm run db:migrate
```

## Free-tier limits to keep in mind

| Service | Limit | Effect |
|---|---|---|
| Supabase Free | Pauses after 7 days without activity; 500 MB; no backups | Restore from the Supabase dashboard if paused |
| Netlify Free | 300 credits/month, hard cap | Site offline when exhausted; deploy deliberately |
| Google Workspace | Gmail sending limits | Far above testing needs |

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `SECURITY: role anon has access…` during setup | The Data API exposed a table. Turn off the Data API, revoke the grant, re-run setup |
| Setup warns about row-level security | Turn off automatic RLS in Supabase, disable RLS on the listed tables, re-run |
| `self-signed certificate` / `unable to verify` | Wrong or missing certificate: re-download it from Supabase and check `DATABASE_SSL_CA` |
| "Sign-in was blocked because this address…" | `BETTER_AUTH_URL` doesn't match the browser's address. Fix and redeploy |
| "Eightcore is invite-only" on sign-up | Expected for uninvited emails. Invite them, or add them to `SIGNUP_ALLOWED_EMAILS` |
| Invitations never arrive | Check `SMTP_URL` (app password, `%40` for `@`) and the sender's Gmail "Sent" folder |
| Site says "Site not available" | Netlify credits used up for the month |
