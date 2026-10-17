/**
 * `ALL /v1/broadcast` - the forbidden direct-broadcast surface, denied by name.
 *
 * Every write in this product enters through the unified signed pipeline
 * (`ConsumerView.submit` -> policy envelope -> owner authorization -> RPC). A bare
 * `/v1/broadcast` route would let a caller skip the spend envelope, the biometric gate and the
 * audit trail, so this surface must not exist at all.
 *
 * Next answers `404` for an unmatched path when the app runs alone. The Vercel service rewrite in
 * `products/maotang/vercel.json` normalises the not-found page for non-GET methods to `200`, so an
 * explicit handler keeps the contract a real `404` at every layer instead of depending on how a
 * host routes an unrouted method.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function denied(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "NOT_FOUND", message: "Direct broadcast is not available." },
    { status: 404, headers: { "cache-control": "no-store" } },
  );
}

export const GET = denied;
export const POST = denied;
export const PUT = denied;
export const PATCH = denied;
export const DELETE = denied;
export const HEAD = denied;
export const OPTIONS = denied;