// Test database URLs, derived from the dev URLs (override with TEST_DATABASE_* env vars).
function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

const migratorBase =
  process.env.DATABASE_MIGRATOR_URL ?? "postgres://eightcore_migrator:eightcore@localhost:5432/eightcore";
const appBase = process.env.DATABASE_URL ?? "postgres://eightcore_app:eightcore@localhost:5432/eightcore";

export const TEST_DATABASE_NAME = process.env.TEST_DATABASE_NAME ?? "eightcore_test";
/** Migrator role, connected to an existing database (used to create the test database). */
export const MIGRATOR_ADMIN_URL = migratorBase;
export const TEST_MIGRATOR_URL =
  process.env.TEST_DATABASE_MIGRATOR_URL ?? withDatabase(migratorBase, TEST_DATABASE_NAME);
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? withDatabase(appBase, TEST_DATABASE_NAME);
