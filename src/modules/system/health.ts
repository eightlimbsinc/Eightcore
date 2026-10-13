import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";

/** Liveness + database connectivity. Reveals no versions, hosts or counts. */
export async function checkHealth(): Promise<{ ok: boolean; database: "up" | "down" }> {
  try {
    await db().execute(sql`select 1`);
    return { ok: true, database: "up" };
  } catch {
    return { ok: false, database: "down" };
  }
}
