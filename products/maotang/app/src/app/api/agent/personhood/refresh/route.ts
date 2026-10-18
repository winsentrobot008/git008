/**
 * `POST /api/agent/personhood/refresh` - renew the sealed personhood cookie with a live assertion.
 *
 * A claim is one-per-hardware-identity, so a returning owner cannot re-claim just to refresh the
 * 24h personhood record. This route verifies a fresh assertion over the same server-issued claim
 * challenge, advances the signature counter, and re-seals the personhood cookie from the recipient
 * already bound to the enrollment. It never mints, signs a transaction or invents a recipient.
 */

import { isSecurityHoldEngaged, securityHoldResponse } from "@/lib/system/security-hold";
import {
  CHALLENGE_COOKIE,
  CLAIM_CHALLENGE_TYPE,
  ENROLLMENT_COOKIE,
  ENROLLMENT_TYPE,
  PERSONHOOD_COOKIE,
  PERSONHOOD_TYPE,
  clearCookie,
  enrollmentTtlSeconds,
  identityHashFor,
  isAuthenticationResponseJSON,
  jsonWithCookies,
  open,
  personhoodTtlSeconds,
  readCookie,
  readWebAuthnConfig,
  seal,
  setCookie,
  verifyEnrollmentAssertion,
  type ChallengePayload,
  type EnrollmentPayload,
  type PersonhoodPayload,
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
  const config = configResult.config;

  const enrollment = open<EnrollmentPayload>(
    readCookie(request, ENROLLMENT_COOKIE),
    ENROLLMENT_TYPE,
    config.secret,
  );
  if (enrollment === null) {
    return refusal("ENROLLMENT_REQUIRED", "register this device before refreshing personhood", 409);
  }

  const challenge = open<ChallengePayload>(
    readCookie(request, CHALLENGE_COOKIE),
    CLAIM_CHALLENGE_TYPE,
    config.secret,
  );
  if (challenge === null || challenge.kind !== "claim") {
    return refusal("CHALLENGE_EXPIRED", "request a fresh challenge before asserting", 409);
  }
  if (challenge.credentialId !== undefined && challenge.credentialId !== enrollment.credentialId) {
    return refusal("CREDENTIAL_MISMATCH", "the challenge was issued for a different credential", 409);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refusal("INVALID_JSON", "the refresh body is not valid JSON", 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return refusal("INVALID_BODY", "the refresh body must be a JSON object", 400);
  }
  const assertion = (body as Record<string, unknown>).assertion;
  if (!isAuthenticationResponseJSON(assertion)) {
    return refusal("ASSERTION_SHAPE_INVALID", "assertion is not a WebAuthn authentication response");
  }
  if (assertion.id !== enrollment.credentialId) {
    return refusal("CREDENTIAL_MISMATCH", "the assertion is for a different credential", 409);
  }
  if (!enrollment.userVerified) {
    return refusal("BIO_NOT_VERIFIED", "the enrollment was not user-verified", 403);
  }
  if (!enrollment.hardwareBacked) {
    return refusal(
      "HARDWARE_ATTESTATION_UNAVAILABLE",
      "this credential returned no direct single-device attestation",
      403,
    );
  }

  let verification;
  try {
    verification = await verifyEnrollmentAssertion(assertion, challenge.challenge, enrollment, config);
  } catch (error) {
    return refusal("ASSERTION_INVALID", `assertion verification failed: ${(error as Error).message}`);
  }
  if (!verification.verified || !verification.userVerified) {
    return refusal("BIO_NOT_VERIFIED", "the authenticator did not cryptographically assert user verification", 403);
  }
  if (verification.counter !== 0 && verification.counter <= enrollment.counter) {
    return refusal("COUNTER_REPLAY", "the authenticator signature counter did not advance", 409);
  }

  const identityHash = identityHashFor(config.rpID, enrollment.credentialId);
  if (identityHash !== enrollment.identityHash) {
    return refusal("IDENTITY_MISMATCH", "the stored identity hash does not match this credential", 409);
  }
  if (enrollment.recipient === null) {
    return refusal("CLAIM_REQUIRED", "this device has not completed a faucet claim", 409);
  }

  const updatedEnrollment: EnrollmentPayload = {
    ...enrollment,
    counter: verification.counter !== 0 ? verification.counter : enrollment.counter,
  };
  const personhood: PersonhoodPayload = {
    identityHash,
    alias: updatedEnrollment.alias,
    credentialId: enrollment.credentialId,
    recipient: enrollment.recipient,
    verifiedAt: Date.now(),
  };

  return jsonWithCookies(
    {
      ok: true,
      personhood: {
        identityHash,
        alias: personhood.alias === null ? null : `${personhood.alias}.008ai`,
        recipient: personhood.recipient,
        verifiedAt: personhood.verifiedAt,
        expiresAt: Math.floor(Date.now() / 1000) + personhoodTtlSeconds(),
      },
    },
    200,
    [
      setCookie(
        ENROLLMENT_COOKIE,
        seal(ENROLLMENT_TYPE, updatedEnrollment, config.secret, enrollmentTtlSeconds()),
        enrollmentTtlSeconds(),
        config.secureCookies,
      ),
      setCookie(
        PERSONHOOD_COOKIE,
        seal(PERSONHOOD_TYPE, personhood, config.secret, personhoodTtlSeconds()),
        personhoodTtlSeconds(),
        config.secureCookies,
      ),
      clearCookie(CHALLENGE_COOKIE),
    ],
  );
}
