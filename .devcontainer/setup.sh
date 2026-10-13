#!/usr/bin/env bash
# One-time setup when the dev container is created: install, configure, migrate, seed.
set -euo pipefail

npm ci

if [ ! -f .env.local ]; then
  public_url="http://localhost:3000"
  if [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]; then
    public_url="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  fi
  cat > .env.local <<ENV
DATABASE_URL=postgres://eightcore_app:eightcore@localhost:5432/eightcore
DATABASE_MIGRATOR_URL=postgres://eightcore_migrator:eightcore@localhost:5432/eightcore
BETTER_AUTH_SECRET=$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')
BETTER_AUTH_URL=${public_url}
SMTP_URL=smtp://mailpit:1025
MAIL_FROM="Eightcore <no-reply@eightcore.local>"
ENV
  echo "Wrote .env.local (BETTER_AUTH_URL=${public_url})"
fi

# Postgres may still be initialising on first start.
for attempt in $(seq 1 30); do
  if npm run --silent db:migrate; then break; fi
  if [ "$attempt" -eq 30 ]; then echo "Database did not become ready" >&2; exit 1; fi
  echo "Waiting for Postgres (attempt ${attempt})..."
  sleep 2
done

npm run --silent db:seed
echo
echo "Ready. 'npm run dev' starts automatically; sign in with owner@demo.eightcore.local / eightcore demo password"
