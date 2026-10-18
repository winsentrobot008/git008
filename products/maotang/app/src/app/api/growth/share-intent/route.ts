/**
 * `/api/growth/share-intent` seals a short-lived, server-verifiable share unlock.
 *
 * The receipt proves that an enrolled, hardware-backed identity opened the X or Telegram share
 * composer from this device. It does not claim that a public post exists: neither platform exposes a
 * trustworthy server callback for that. The claim route therefore treats it as a bonus eligibility
 * receipt, not as proof of publication.
 */

import {
  jsonWithCookies,
  setCookie,
} from "@/lib/agent/webauthn-server";
import {
  GROWTH_SHARE_COOKIE,
  createShareReceipt,
  readShareReceipt,
} from "@/lib/growth/receipt";
import {
  BASE_CLAIM_REWARD_LABEL,
  SHARE_BOOST_BPS,
  SHARE_RECEIPT_TTL_SECONDS,
  isSharePlatform,
  previewRewardLabel,
} from "@/lib/growth/rules";
import { readOptionalGrowthIdentity } from "@/lib/growth/server";
import { recordGrowthEvent } from "@/lib/growth/store";
import { isSecurityHoldEngaged, securityHoldResponse } from "@/lib/system/security-hold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function refusal(code: string, message: string, status: number): Response {
  return Response.json(
    { ok: false, code, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function enrolledIdentity(request: Request): ReturnType<typeof readOptionalGrowthIdentity> {
  const auth = readOptionalGrowthIdentity(request);
  if (auth === null) {
    return null;
  }
  if (!auth.enrollment.userVerified || !auth.enrollment.hardwareBacked) {
    return null;
  }
  return auth;
}

export async function GET(request: Request): Promise<Response> {
  if (isSecurityHoldEngaged()) {
    return securityHoldResponse();
  }
  const auth = enrolledIdentity(request);
  if (auth === null) {
    return refusal(
      "HARDWARE_ENROLLMENT_REQUIRED",
      "a server-verified, hardware-backed enrollment is required",
      409,
    );
  }
  const receipt = readShareReceipt(request, auth.secret, auth.enrollment);
  return Response.json(
    {
      ok: true,
      unlocked: receipt !== null,
      platform: receipt?.platform ?? null,
      multiplierBps: receipt === null ? 10_000 : SHARE_BOOST_BPS,
      baseReward: BASE_CLAIM_REWARD_LABEL,
      bonusReward: receipt === null ? null : previewRewardLabel(SHARE_BOOST_BPS),
      expiresAt: receipt?.expiresAt ?? null,
      receiptTtlSeconds: SHARE_RECEIPT_TTL_SECONDS,
      proof: "sealed-share-intent",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (isSecurityHoldEngaged()) {
    return securityHoldResponse();
  }
  const auth = enrolledIdentity(request);
  if (auth === null) {
    return refusal(
      "HARDWARE_ENROLLMENT_REQUIRED",
      "a server-verified, hardware-backed enrollment is required",
      409,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refusal("INVALID_JSON", "the share body is not valid JSON", 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return refusal("INVALID_BODY", "the share body must be a JSON object", 400);
  }
  const platform = (body as Record<string, unknown>).platform;
  if (!isSharePlatform(platform)) {
    return refusal("SHARE_PLATFORM_INVALID", "platform must be x or telegram", 422);
  }

  const receipt = createShareReceipt(auth.secret, auth.enrollment, platform);
  const attribution = await recordGrowthEvent({
    event: "share_intent",
    code: auth.identity.alias,
    identity: auth.identity,
    uniqueScope: `share_intent_${platform}`,
  });

  return jsonWithCookies(
    {
      ok: true,
      unlocked: true,
      platform,
      multiplierBps: SHARE_BOOST_BPS,
      baseReward: BASE_CLAIM_REWARD_LABEL,
      bonusReward: previewRewardLabel(SHARE_BOOST_BPS),
      expiresAt: receipt.payload.expiresAt,
      receiptTtlSeconds: SHARE_RECEIPT_TTL_SECONDS,
      proof: "sealed-share-intent",
      attribution,
    },
    200,
    [
      setCookie(
        GROWTH_SHARE_COOKIE,
        receipt.value,
        SHARE_RECEIPT_TTL_SECONDS,
        auth.secureCookies,
      ),
    ],
  );
}
