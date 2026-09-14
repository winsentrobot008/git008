/**
 * GET /api/aura-fit/entitlement?email=...
 *
 * Verifies an 008ai.online Pass against the landing page entitlement store so a
 * paying user can restore access inside Aura Fit. Rate limited to keep the
 * endpoint from being used to enumerate emails.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/aura-fit/guard";
import { listEntitlements } from "@/lib/orders-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const ip = clientIp(request.headers);
  const limit = checkRateLimit(`aura-fit:entitlement:${ip}`, 12, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { detail: "Too many attempts, try again shortly", retry_after: limit.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const email = (request.nextUrl.searchParams.get("email") || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ detail: "A valid email is required" }, { status: 400 });
  }

  try {
    const entitled = listEntitlements().some(
      (entry) => String(entry.email || "").toLowerCase() === email && entry.has_lifetime_access
    );
    return NextResponse.json({ email, entitled });
  } catch {
    return NextResponse.json({ detail: "Entitlement store unavailable" }, { status: 503 });
  }
}
