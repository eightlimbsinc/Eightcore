// Drops and recreates the LOCAL development database, then migrates.
// Refuses anything that isn't a localhost database. Run `npm run db:seed` afterwards.
import { readFile } from "node:fs/promises";
import pg from "pg";
import { loadEnvFiles } from "../load-env";
import { runMigrations } from "./migrate";

loadEnvFiles();
const url = process.env.DATABASE_MIGRATOR_URL;
if (!url) throw new Error("DATABASE_MIGRATOR_URL is not set (see .env.example)");
if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset in production");
const target = new URL(url);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(target.hostname)) {
  throw new Error(`Refusing to reset non-local database host "${target.hostname}"`);
}
const name = target.pathname.slice(1);
if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Unexpected database name "${name}"`);

const maintenance = new URL(url);
maintenance.pathname = "/postgres";
const admin = new pg.Client({ connectionString: maintenance.toString() });
await admin.connect();
try {
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
} finally {
  await admin.end();
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(await readFile("docker/postgres/sql/grants.sql", "utf8"));
} finally {
  await client.end();
}
await runMigrations(url);
console.log(`Database ${name} reset and migrated. Run "npm run db:seed" for demo data.`);
