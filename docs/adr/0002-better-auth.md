# ADR-0002: Better Auth for identity and sessions

- Status: **Accepted** (approved by the workspace owner, 2026-10-13)
- Context: `ARCHITECTURE.md` §6 compares Better Auth, Auth.js, and self-hosted Supabase Auth.

## Decision

Use Better Auth (MIT) in-process, with its tables in our PostgreSQL via the Drizzle adapter, for **identity and sessions only**: users, password credentials, sessions, email verification, password reset, and auth rate limiting. Workspace membership, roles, and permissions stay in Eightcore's own schema and `src/server/authz`.

## Consequences

- No extra service, no paid provider, no JWTs to manage. Sessions are database rows, so revocation is immediate.
- Better Auth's organisation plugin is deliberately **not** used, which keeps the auth library replaceable.
- Better Auth's table names are mapped to ours (`users`, `auth_sessions`, ...). Runtime schema validation (on by default) catches drift after upgrades.
- Upgrades are pinned (`--save-exact`) and re-run `tests/integration/auth.test.ts`, which covers verification, password policy, hashing, revocation, and reset.
