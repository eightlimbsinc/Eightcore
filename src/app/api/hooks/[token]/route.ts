import { after } from "next/server";
import { z } from "zod";
import { handleInboundHook } from "@/modules/webhooks/inbound";

export const dynamic = "force-dynamic";

/**
 * Incoming webhook (e.g. a Make scenario): POST JSON to /api/hooks/<token> to create or update a
 * task. The token is the secret; requests act with the permissions of whoever created it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const text = await request.text();
  if (text.length > 100_000) return Response.json({ ok: false, error: "Body too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ ok: false, error: "Send JSON" }, { status: 400 });
  }
  const result = await handleInboundHook(token, body);
  if (result.ok) {
    after(() => import("@/modules/automations/engine").then((m) => m.processOutbox()).catch(() => undefined));
  }
  return Response.json(result.body, { status: result.status });
}

export function GET() {
  return Response.json({ ok: false, error: z.literal("POST JSON here").value }, { status: 405 });
}
