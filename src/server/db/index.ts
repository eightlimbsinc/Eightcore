import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/server/env";
import { connectionOptionsFromEnv, poolConfig } from "./connection";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
/** A transaction handle; services accept either so they compose inside callers' transactions. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type DbOrTx = Database | Tx;

const globalForDb = globalThis as unknown as { eightcorePool?: Pool; eightcoreDb?: Database };

function create(): Database {
  const options = connectionOptionsFromEnv();
  const pool =
    globalForDb.eightcorePool ??
    new Pool(poolConfig(env().DATABASE_URL, { ...options, max: options.max ?? 10 }));
  // Reuse the pool across hot reloads in development.
  if (env().NODE_ENV !== "production") globalForDb.eightcorePool = pool;
  return drizzle(pool, { schema, casing: "snake_case" });
}

/** Lazily-created database client (the app role: data access only). */
export function db(): Database {
  globalForDb.eightcoreDb ??= create();
  return globalForDb.eightcoreDb;
}

export async function closeDb(): Promise<void> {
  await globalForDb.eightcorePool?.end();
  globalForDb.eightcorePool = undefined;
  globalForDb.eightcoreDb = undefined;
}

export { schema };
