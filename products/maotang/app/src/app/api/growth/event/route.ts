/**
 * Privacy-preserving growth events.
 *
 * The browser chooses a step name, never an identity, wallet, credential, IP or multiplier. The
 * route derives a pseudonymous subject from the sealed hardware enrollment and stores aggregate
 * counters plus a hashed active-user bitmap.
 */

import { readOptionalGrowthIdentity } from "@/lib/growth/server";
import { normalizeReferral } from "@/lib/growth/rules";
import { recordGrowthEvent, type GrowthEventName } from "@/lib/growth/store";
import { isSecurityHoldEngaged, securityHoldResponse } from "@/lib/system/security-hold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLIENT_EVENTS = new Set<GrowthEventName>([
  "app_open",
  "pwa_install",
  "referral_open",
  "activation",
  "claim_start",
]);

function refusal(code: string, message: string, status: number): Response {
  return Response.json(
    { ok: false, code, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (isSecurityHoldEngaged()) {
    return securityHoldResponse();
  }

  const auth = readOptionalGrowthIdentity(request);
  if (auth === null) {
    return refusal(
      "HARDWARE_ENROLLMENT_REQUIRED",
      "a server-verified, hardware-backed enrollment is required",
      409,
    );
  }
  if (!auth.enrollment.userVerified || !auth.enrollment.hardwareBacked) {
    return refusal(
      "HARDWARE_ENROLLMENT_REQUIRED",
      "the enrollment is not user-verified and hardware-backed",
      403,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refusal("INVALID_JSON", "the growth event body is not valid JSON", 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return refusal("INVALID_BODY", "the growth event body must be a JSON object", 400);
  }

  const record = body as Record<string, unknown>;
  const event = record.event;
  if (typeof event !== "string" || !CLIENT_EVENTS.has(event as GrowthEventName)) {
    return refusal("GROWTH_EVENT_NOT_ALLOWED", "the growth event is not client-recordable", 422);
  }

  const suppliedCode = record.code;
  const code = normalizeReferral(suppliedCode);
  if (event === "referral_open" && code === null) {
    return refusal("REFERRAL_CODE_INVALID", "referral_open needs a valid referral code", 422);
  }
  if (code !== null && code === auth.identity.alias) {
    return refusal("SELF_REFERRAL", "a device cannot attribute its own referral", 422);
  }

  const attribution = await recordGrowthEvent({
    event: event as GrowthEventName,
    code,
    identity: auth.identity,
    uniqueScope: code === null ? event : `${event}:${code}`,
  });
  return Response.json(
    {
      ok: true,
      event,
      recorded: attribution.counted,
      persistent: attribution.persistent,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
