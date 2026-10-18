/**
 * `GET /api/telemetry/summary` - aggregate growth and referral metrics.
 *
 * Durable counters come from the configured Redis REST store. Without it, local development may use
 * an explicitly ephemeral in-process store; production reports `configured: false` rather than
 * presenting invented retention or conversion numbers.
 */

import { readGrowthSummary } from "@/lib/growth/store";
import { readOptionalGrowthIdentity } from "@/lib/growth/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const queryCode = new URL(request.url).searchParams.get("code");
  const auth = readOptionalGrowthIdentity(request);
  const summary = await readGrowthSummary(queryCode ?? auth?.identity.alias ?? null);
  return Response.json(
    { ok: true, ...summary },
    { headers: { "Cache-Control": "no-store" } },
  );
}
