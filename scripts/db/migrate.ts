// Applies SQL migrations in ./drizzle using the migrator role (DDL rights).
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { loadEnvFiles } from "../load-env";

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnvFiles();
  const url = process.env.DATABASE_MIGRATOR_URL;
  if (!url) throw new Error("DATABASE_MIGRATOR_URL is not set (see .env.example)");
  await runMigrations(url);
  console.log("Migrations applied.");
}
