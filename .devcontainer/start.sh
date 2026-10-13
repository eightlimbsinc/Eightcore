#!/usr/bin/env bash
# Starts the dev server in a dev container. In GitHub Codespaces it first points
# BETTER_AUTH_URL at this codespace's public address, which auth and Server Actions require.
set -euo pipefail

if [ -n "${CODESPACE_NAME:-}" ] && [ -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ] && [ -f .env.local ]; then
  public_url="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  sed -i "s|^BETTER_AUTH_URL=.*|BETTER_AUTH_URL=${public_url}|" .env.local
  echo "BETTER_AUTH_URL=${public_url}"
fi

# A dev server left over from an earlier start would keep port 3000 (and its old settings).
if pkill -f "next dev" 2>/dev/null; then
  echo "Stopped a previously running dev server."
  sleep 2
fi

exec npm run dev
