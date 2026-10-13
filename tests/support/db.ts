// Privileged test helpers. They use the migrator role, which the app never uses at runtime.
import pg from "pg";
import { TEST_MIGRATOR_URL } from "./test-db-urls";

let pool: pg.Pool | undefined;

/** Migrator-role pool for cleanup and assertions that bypass app privileges. */
export function adminPool(): pg.Pool {
  pool ??= new pg.Pool({ connectionString: TEST_MIGRATOR_URL, max: 2 });
  return pool;
}

export async function closeAdminPool(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export async function truncateAll(): Promise<void> {
  const { rows } = await adminPool().query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  if (rows.length === 0) return;
  await adminPool().query(
    `TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

export async function count(table: string, where = "true", params: unknown[] = []): Promise<number> {
  const { rows } = await adminPool().query<{ n: string }>(
    `select count(*)::text as n from ${table} where ${where}`,
    params,
  );
  return Number(rows[0]?.n ?? 0);
}
