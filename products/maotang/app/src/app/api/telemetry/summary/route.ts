/**
 * `GET /api/telemetry/summary` - the KOL dashboard's honesty check.
 *
 * There is no durable referral/attribution database in this deployment. The route therefore reports
 * `configured: false` and null totals instead of inventing downstream invites or Genesis Points.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(
    {
      ok: true,
      configured: false,
      invites: null,
      conversions: null,
      genesisPoints: null,
      gasRewards: null,
      reason:
        "No durable attribution store is configured for this deployment; totals are unknown, not zero.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
