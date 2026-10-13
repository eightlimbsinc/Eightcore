// Creates (or recreates) a disposable database for automated tests, using the migrator role:
// drop → create → grants → migrations. Refuses names that don't look like test databases.
import { readFile } from "node:fs/promises";
import pg from "pg";
import { runMigrations } from "./migrate";
import { loadEnvFiles } from "../load-env";

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export async function createTestDatabase(migratorUrl: string, name: string): Promise<string> {
  if (!/^eightcore_(test|e2e)[a-z0-9_]*$/.test(name)) {
    throw new Error(
      `Refusing to recreate "${name}": test databases must be named eightcore_test* or eightcore_e2e*`,
    );
  }
  const admin = new pg.Client({ connectionString: migratorUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const target = withDatabase(migratorUrl, name);
  const client = new pg.Client({ connectionString: target });
  await client.connect();
  try {
    await client.query(await readFile("docker/postgres/sql/grants.sql", "utf8"));
  } finally {
    await client.end();
  }
  await runMigrations(target);
  return target;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnvFiles();
  const name = process.argv[2];
  const url = process.env.DATABASE_MIGRATOR_URL;
  if (!name) throw new Error("usage: create-test-db.ts <database-name>");
  if (!url) throw new Error("DATABASE_MIGRATOR_URL is not set (see .env.example)");
  await createTestDatabase(url, name);
  console.log(`Test database ${name} ready.`);
}
