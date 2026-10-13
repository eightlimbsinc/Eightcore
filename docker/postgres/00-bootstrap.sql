-- Eightcore local bootstrap. Runs once as the Postgres superuser
-- (automatically via docker-entrypoint-initdb.d, or manually: see docs/RUNBOOK.md).
-- DEVELOPMENT PASSWORDS ONLY. Production uses generated secrets.

-- Owns the schema and runs migrations (DDL). CREATEDB lets the test suite create its own database.
CREATE ROLE eightcore_migrator LOGIN PASSWORD 'eightcore' CREATEDB;
-- Used by the running app: data access only, no DDL.
CREATE ROLE eightcore_app LOGIN PASSWORD 'eightcore';

CREATE DATABASE eightcore OWNER eightcore_migrator;
