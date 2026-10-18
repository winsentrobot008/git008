/**
 * `POST /api/agent/webauthn/register/verify` - verifies the attestation and seals the enrollment.
 *
 * The browser sends the exact `RegistrationResponseJSON`; it does not send a public key, an identity
 * hash or a `hardwareBacked` boolean. Those are all derived here, from the attestation object and the
 * authenticator flags, and then signed into an HttpOnly enrollment cookie.
 */

import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { getAddress, isAddress } from "ethers";

import { isSecurityHoldEngaged, securityHoldResponse } from "@/lib/system/security-hold";
import {
  CHALLENGE_COOKIE,
  ENROLLMENT_COOKIE,
  REGISTRATION_CHALLENGE_TYPE,
  ENROLLMENT_TYPE,
  bytesToBase64Url,
  challengeTtlSeconds,
  clearCookie,
  enrollmentTtlSeconds,
  identityHashFor,
  isHardwareBackedAttestation,
  isRegistrationResponseJSON,
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

function refusal(code: string, message: string, status = 422): Response {
  return Response.json(
    { ok: false, code, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (isSecurityHoldEngaged()) {
    return securityHoldResponse();
  }

  const configResult = readWebAuthnConfig(request);
  if (!configResult.ok) {
    return refusal(configResult.code, configResult.reason, 503);
  }
  const { config } = configResult;

  const challenge = open<ChallengePayload>(
    readCookie(request, CHALLENGE_COOKIE),
    REGISTRATION_CHALLENGE_TYPE,
    config.secret,
  );
  if (challenge === null || challenge.kind !== "registration") {
    return refusal("CHALLENGE_EXPIRED", "the registration challenge is missing or expired", 409);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refusal("INVALID_JSON", "the registration body is not valid JSON", 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return refusal("INVALID_BODY", "the registration body must be a JSON object", 400);
  }
  const record = body as Record<string, unknown>;
  const response = record.response;
  if (!isRegistrationResponseJSON(response)) {
    return refusal("REGISTRATION_SHAPE_INVALID", "response is not a WebAuthn registration response");
  }
  const recipientInput = typeof record.recipient === "string" ? record.recipient.trim() : "";
  if (recipientInput !== "" && !isAddress(recipientInput)) {
    return refusal("RECIPIENT_INVALID", "recipient must be a 20-byte EVM address");
  }

  let verified;
  try {
    verified = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.expectedOrigin,
      expectedRPID: config.rpID,
      requireUserVerification: true,
    });
  } catch (error) {
    return refusal("REGISTRATION_INVALID", `attestation verification failed: ${(error as Error).message}`);
  }

  if (!verified.verified) {
    return refusal("REGISTRATION_INVALID", "the attestation did not verify");
  }
  const info = verified.registrationInfo;
  if (info === undefined) {
    return refusal("REGISTRATION_INVALID", "the attestation verified without registration information");
  }
  if (!info.userVerified) {
    return refusal("BIO_NOT_VERIFIED", "the authenticator did not assert user verification");
  }

  const hardwareBacked = isHardwareBackedAttestation(info.fmt, info.credentialDeviceType);
  const identityHash = identityHashFor(config.rpID, info.credential.id);
  const enrollment: EnrollmentPayload = {
    credentialId: info.credential.id,
    publicKey: bytesToBase64Url(info.credential.publicKey),
    counter: info.credential.counter,
    transports: info.credential.transports ?? [],
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    aaguid: info.aaguid,
    fmt: info.fmt,
    userVerified: info.userVerified,
    hardwareBacked,
    identityHash,
    alias: null,
    recipient: recipientInput === "" ? null : getAddress(recipientInput),
    createdAt: Date.now(),
  };
  const sealed = seal(ENROLLMENT_TYPE, enrollment, config.secret, enrollmentTtlSeconds());

  return jsonWithCookies(
    {
      ok: true,
      enrollment: {
        credentialId: enrollment.credentialId,
        identityHash: enrollment.identityHash,
        userVerified: enrollment.userVerified,
        hardwareBacked: enrollment.hardwareBacked,
        attestationFormat: enrollment.fmt,
        deviceType: enrollment.deviceType,
        backedUp: enrollment.backedUp,
        aaguid: enrollment.aaguid,
        recipient: enrollment.recipient,
      },
    },
    200,
    [
      setCookie(ENROLLMENT_COOKIE, sealed, enrollmentTtlSeconds(), config.secureCookies),
      clearCookie(CHALLENGE_COOKIE),
    ],
  );
}
