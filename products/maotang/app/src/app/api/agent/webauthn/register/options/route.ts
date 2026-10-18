/**
 * `GET /api/agent/webauthn/register/options` - the server-issued registration challenge.
 *
 * The browser must not invent the challenge: a local random value proves nothing to the server. The
 * challenge is sealed into an HttpOnly cookie and the matching `user.id` is remembered there too.
 * `attestationType: "direct"` asks for a real attestation statement; a device that answers with
 * `fmt: "none"` is still registered, but the claim route will refuse to call it hardware-backed.
 */

import { randomBytes } from "node:crypto";

import { generateRegistrationOptions } from "@simplewebauthn/server";

import { isSecurityHoldEngaged, securityHoldResponse } from "@/lib/system/security-hold";
import {
  CHALLENGE_COOKIE,
  REGISTRATION_CHALLENGE_TYPE,
  challengeTtlSeconds,
  jsonWithCookies,
  readWebAuthnConfig,
  seal,
  setCookie,
  type ChallengePayload,
} from "@/lib/agent/webauthn-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (isSecurityHoldEngaged()) {
    return securityHoldResponse();
  }

  const configResult = readWebAuthnConfig(request);
  if (!configResult.ok) {
    return Response.json(
      { ok: false, code: configResult.code, message: configResult.reason },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { config } = configResult;
  const userId = randomBytes(32);
  const userName = `owner-${userId.toString("hex").slice(0, 12)}`;

  let options;
  try {
    options = await generateRegistrationOptions({
      rpName: "MAOTANG Agent OS",
      rpID: config.rpID,
      userID: new Uint8Array(userId),
      userName,
      userDisplayName: "MAOTANG Owner",
      timeout: 60_000,
      attestationType: "direct",
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      supportedAlgorithmIDs: [-7, -257],
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "WEBAUTHN_OPTIONS_FAILED",
        message: (error as Error).message,
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }

  const payload: ChallengePayload = {
    challenge: options.challenge,
    kind: "registration",
    userId: Buffer.from(userId).toString("base64url"),
  };
  const sealed = seal(REGISTRATION_CHALLENGE_TYPE, payload, config.secret, challengeTtlSeconds());

  return jsonWithCookies({ ok: true, options }, 200, [
    setCookie(CHALLENGE_COOKIE, sealed, challengeTtlSeconds(), config.secureCookies),
  ]);
}
