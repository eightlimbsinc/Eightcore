import { checkHealth } from "@/modules/system/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await checkHealth();
  return Response.json(health, { status: health.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
