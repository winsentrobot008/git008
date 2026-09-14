/**
 * GET /api/aura-fit/entitlement?email=...
 *
 * Canonical Aura Fit entitlement probe, re-exporting the long-standing
 * /api/savage-fit/entitlement handler.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export { GET } from "@/app/api/savage-fit/entitlement/route";
