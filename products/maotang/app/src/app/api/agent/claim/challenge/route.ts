/**
 * `GET /api/agent/claim/challenge` - a server-issued assertion challenge for the enrolled credential.
 *
 * The app fetches this before the tap, because iOS Safari requires `navigator.credentials.get` to run
 * inside the tap's transient user activation. The sealed cookie binds the challenge to the exact
 * credential id; the claim route will refuse an assertion for any other key.
 */

import { generateAuthenticationOptions } from "@simplewebauthn/server";

import { isSecurityHoldEngaged, securityHoldResponse } from "@/lib/system/security-hold";
import {
  CHALLENGE_COOKIE,
  CLAIM_CHALLENGE_TYPE,
  ENROLLMENT_COOKIE,
  ENROLLMENT_TYPE,
  challengeTtlSeconds,
  jsonWithCookies,
  open,
  readCookie,
  readWebAuthnConfig,
  seal,
  setCookie,
  type ChallengePayload,
  type EnrollmentPayload,
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

  const enrollment = open<EnrollmentPayload>(
    readCookie(request, ENROLLMENT_COOKIE),
    ENROLLMENT_TYPE,
    config.secret,
  );
  if (enrollment === null) {
    return Response.json(
      {
        ok: false,
        code: "ENROLLMENT_REQUIRED",
        message: "no server-verified enrollment cookie is present; register this device first",
      },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const options = await generateAuthenticationOptions({
      rpID: config.rpID,
      allowCredentials: [
        {
          id: enrollment.credentialId,
          transports: enrollment.transports as AuthenticatorTransportFuture[],
        },
      ],
      userVerification: "required",
      timeout: 60_000,
    });
    const payload: ChallengePayload = {
      challenge: options.challenge,
      kind: "claim",
      credentialId: enrollment.credentialId,
      alias: enrollment.alias ?? undefined,
    };
    const sealed = seal(CLAIM_CHALLENGE_TYPE, payload, config.secret, challengeTtlSeconds());
    return jsonWithCookies(
      {
        ok: true,
        challenge: options.challenge,
        options,
        hardwareBacked: enrollment.hardwareBacked,
        attestationFormat: enrollment.fmt,
      },
      200,
      [setCookie(CHALLENGE_COOKIE, sealed, challengeTtlSeconds(), config.secureCookies)],
    );
  } catch (error) {
    return Response.json(
      { ok: false, code: "WEBAUTHN_CHALLENGE_FAILED", message: (error as Error).message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}

type AuthenticatorTransportFuture = "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";
