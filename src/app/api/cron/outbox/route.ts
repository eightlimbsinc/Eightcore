import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { processOutbox } from "@/modules/automations/engine";

export const dynamic = "force-dynamic";

/**
 * Catch-up for automations and webhooks: a scheduler (e.g. Supabase pg_cron, see docs/DEPLOY_NETLIFY_SUPABASE.md)
 * calls this every few minutes with `Authorization: Bearer <CRON_SECRET>`. Disabled when unset.
 */
async function handle(request: Request) {
  const secret = env().CRON_SECRET;
  const given = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(secret ?? "");
  const ok = secret && given.length === expected.length && timingSafeEqual(given, expected);
  if (!ok) return new Response("Not found", { status: 404 });
  let events = 0;
  let deliveries = 0;
  // A few rounds, so a backlog drains in one call.
  for (let i = 0; i < 5; i++) {
    const r = await processOutbox({ limit: 100 });
    events += r.events;
    deliveries += r.deliveries;
    if (!r.events && !r.deliveries) break;
  }
  return Response.json({ ok: true, events, deliveries });
}

export const GET = handle;
export const POST = handle;
