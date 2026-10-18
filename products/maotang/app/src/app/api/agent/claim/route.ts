/**
 * `POST /api/agent/claim` - the Face ID-gated cold-start claim.
 *
 * The route trusts nothing the browser says about verification:
 *
 *   1. the challenge came from a sealed HttpOnly cookie;
 *   2. the assertion signature is checked against the enrolled public key by
 *      `@simplewebauthn/server`, with `requireUserVerification: true`;
 *   3. the credential must have returned a direct attestation and be single-device, so
 *      `hardwareBacked` is a server verdict rather than a client boolean;
 *   4. the one-claim-per-identity ledger is the on-chain `MaotangFaucet` mapping.
 *
 * When the faucet or WebAuthn environment is absent the route answers `503 ..._UNCONFIGURED`.
 * It never invents a transaction hash, a minted balance or a pending settlement ticket.
 */

import { formatUnits, getAddress, isAddress } from "ethers";

import { isSecurityHoldEngaged, securityHoldResponse } from "@/lib/system/security-hold";
import {
  createFaucetClient,
  explorerTransactionUrl,
  hasClaimed,
  preflightFaucet,
  readFaucetConfig,
  submitClaimAmount,
  FaucetError,
} from "@/lib/agent/faucet";
import { GROWTH_SHARE_COOKIE, readShareReceipt } from "@/lib/growth/receipt";
import {
  SHARE_BOOST_BPS,
  boostClaimUnits,
  normalizeReferral,
} from "@/lib/growth/rules";
import { growthIdentity } from "@/lib/growth/server";
import { recordGrowthEvent } from "@/lib/growth/store";
import {
  CHALLENGE_COOKIE,
  CLAIM_CHALLENGE_TYPE,
  ENROLLMENT_COOKIE,
  ENROLLMENT_TYPE,
  PERSONHOOD_COOKIE,
  PERSONHOOD_TYPE,
  base64UrlBytes,
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
  type ChallengePayload,
  type EnrollmentPayload,
  verifyEnrollmentAssertion,
  type PersonhoodPayload,
} from "@/lib/agent/webauthn-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALIAS = /^[a-z0-9]{1,32}$/;

function refusal(code: string, reason: string, status = 422): Response {
  return Response.json(
    { ok: false, success: false, code, message: reason, reason },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (isSecurityHoldEngaged()) {
    return securityHoldResponse();
  }

  const faucetResult = readFaucetConfig();
  if (!faucetResult.ok) {
    return refusal(
      "FAUCET_UNCONFIGURED",
      `the MAOTANG faucet is not configured (missing or invalid: ${faucetResult.missing.join(", ")})`,
      503,
    );
  }
  const faucet = faucetResult.config;

  const webAuthnResult = readWebAuthnConfig(request);
  if (!webAuthnResult.ok) {
    return refusal(webAuthnResult.code, webAuthnResult.reason, 503);
  }
  const webAuthn = webAuthnResult.config;

  const enrollment = open<EnrollmentPayload>(
    readCookie(request, ENROLLMENT_COOKIE),
    ENROLLMENT_TYPE,
    webAuthn.secret,
  );
  if (enrollment === null) {
    return refusal("ENROLLMENT_REQUIRED", "register this device before claiming", 409);
  }
  const challenge = open<ChallengePayload>(
    readCookie(request, CHALLENGE_COOKIE),
    CLAIM_CHALLENGE_TYPE,
    webAuthn.secret,
  );
  if (challenge === null || challenge.kind !== "claim") {
    return refusal("CHALLENGE_EXPIRED", "request a fresh claim challenge before asserting", 409);
  }
  if (challenge.credentialId !== undefined && challenge.credentialId !== enrollment.credentialId) {
    return refusal("CREDENTIAL_MISMATCH", "the challenge was issued for a different credential", 409);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refusal("INVALID_JSON", "the claim body is not valid JSON", 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return refusal("INVALID_BODY", "the claim body must be a JSON object", 400);
  }
  const record = body as Record<string, unknown>;
  const referralInput = typeof record.referral === "string" ? record.referral : "";
  const referralCode = normalizeReferral(referralInput);
  if (referralInput !== "" && referralCode === null) {
    return refusal("REFERRAL_INVALID", "referral must be 1-32 lowercase alphanumeric characters");
  }
  const assertion = record.assertion;
  if (!isAuthenticationResponseJSON(assertion)) {
    return refusal("ASSERTION_SHAPE_INVALID", "assertion is not a WebAuthn authentication response");
  }
  if (assertion.id !== enrollment.credentialId) {
    return refusal("CREDENTIAL_MISMATCH", "the assertion is for a different credential", 409);
  }

  const aliasInput = typeof record.alias === "string" ? record.alias.trim().toLowerCase() : "";
  if (aliasInput !== "" && !ALIAS.test(aliasInput)) {
    return refusal("ALIAS_INVALID", "alias must be 1-32 lowercase alphanumeric characters");
  }
  const recipientInput = typeof record.recipient === "string" ? record.recipient.trim() : "";
  const requestedRecipient = recipientInput !== "" ? recipientInput : (faucet.defaultRecipient ?? "");
  if (requestedRecipient !== "" && !isAddress(requestedRecipient)) {
    return refusal("RECIPIENT_INVALID", "recipient must be a 20-byte EVM address", 400);
  }
  if (enrollment.recipient !== null) {
    if (
      requestedRecipient !== "" &&
      getAddress(requestedRecipient) !== getAddress(enrollment.recipient)
    ) {
      return refusal(
        "RECIPIENT_MISMATCH",
        "the recipient does not match the wallet bound to this hardware enrollment",
        409,
      );
    }
  } else if (requestedRecipient === "") {
    return refusal("RECIPIENT_REQUIRED", "the claim needs a recipient EVM address", 400);
  }
  const recipient = enrollment.recipient ?? getAddress(requestedRecipient);

  if (!enrollment.userVerified) {
    return refusal("BIO_NOT_VERIFIED", "the enrollment was not user-verified");
  }
  if (!enrollment.hardwareBacked) {
    return refusal(
      "HARDWARE_ATTESTATION_UNAVAILABLE",
      "this credential returned no direct single-device attestation, so it is not hardware-backed",
    );
  }

  let verification;
  try {
    verification = await verifyEnrollmentAssertion(assertion, challenge.challenge, enrollment, webAuthn);
  } catch (error) {
    return refusal("ASSERTION_INVALID", `assertion verification failed: ${(error as Error).message}`);
  }
  if (!verification.verified || !verification.userVerified) {
    return refusal("BIO_NOT_VERIFIED", "the authenticator did not cryptographically assert user verification");
  }
  if (verification.counter !== 0 && verification.counter <= enrollment.counter) {
    return refusal("COUNTER_REPLAY", "the authenticator signature counter did not advance", 409);
  }

  const identityHash = identityHashFor(webAuthn.rpID, enrollment.credentialId);
  if (identityHash !== enrollment.identityHash) {
    return refusal("IDENTITY_MISMATCH", "the stored identity hash does not match this credential", 409);
  }
  const growth = growthIdentity(enrollment, webAuthn.secret);
  const attributedCode = referralCode !== null && referralCode !== growth.alias ? referralCode : null;
  const shareReceipt = readShareReceipt(request, webAuthn.secret, enrollment);

  const client = createFaucetClient(faucet);
  let preflight;
  let txHash: string;
  let multiplierBps: number;
  let rewardUnits: bigint;
  try {
    preflight = await preflightFaucet(client, faucet);
    if (preflight.paused) {
      return refusal("FAUCET_PAUSED", "the MAOTANG faucet contract is paused", 503);
    }
    if (await hasClaimed(client, identityHash)) {
      return refusal("ALREADY_CLAIMED", "this hardware identity has already claimed", 409);
    }
    multiplierBps = shareReceipt === null ? 10_000 : SHARE_BOOST_BPS;
    rewardUnits = boostClaimUnits(BigInt(preflight.rewardUnits), multiplierBps);
    if (rewardUnits > BigInt(preflight.maxRewardUnits)) {
      return refusal(
        "FAUCET_REWARD_CAP_EXCEEDED",
        "the server-derived claim reward exceeds the faucet contract cap",
        503,
      );
    }
    txHash = await submitClaimAmount(client, recipient, identityHash, rewardUnits);
  } catch (error) {
    if (error instanceof FaucetError) {
      const status = error.code === "ALREADY_CLAIMED" ? 409 : 503;
      return refusal(error.code, error.message, status);
    }
    return refusal(
      "FAUCET_UNAVAILABLE",
      "the configured faucet RPC could not complete the claim transaction",
      503,
    );
  }

  const updatedEnrollment: EnrollmentPayload = {
    ...enrollment,
    counter: verification.counter !== 0 ? verification.counter : enrollment.counter,
    alias: aliasInput === "" ? enrollment.alias : aliasInput,
    recipient: getAddress(recipient),
  };
  const personhood: PersonhoodPayload = {
    identityHash,
    alias: updatedEnrollment.alias,
    credentialId: enrollment.credentialId,
    recipient: getAddress(recipient),
    verifiedAt: Date.now(),
  };

  const attribution = await recordGrowthEvent({
    event: "claim_broadcast",
    code: attributedCode,
    identity: growth,
    uniqueScope: "claim_broadcast",
  });
  const reward = formatUnits(rewardUnits, preflight.decimals);
  return jsonWithCookies(
    {
      ok: true,
      success: true,
      claim: {
        id: `mtc_${identityHash.slice(2, 26)}`,
        alias: updatedEnrollment.alias === null ? null : `${updatedEnrollment.alias}.008ai`,
        reward,
        rewardUnits: rewardUnits.toString(),
        baseRewardUnits: preflight.rewardUnits,
        maxRewardUnits: preflight.maxRewardUnits,
        multiplierBps,
        sharePlatform: shareReceipt?.platform ?? null,
        symbol: preflight.symbol,
        status: "pending",
        settlement: "onchain",
        onChain: true,
        txHash,
        explorerUrl: explorerTransactionUrl(faucet.explorerUrl, txHash),
        identityHash,
        recipient,
        chainId: faucet.chainId,
        attribution,
        attestation: {
          verified: true,
          userVerified: true,
          hardwareBacked: true,
          format: enrollment.fmt,
          deviceType: enrollment.deviceType,
        },
      },
    },
    200,
    [
      setCookie(
        ENROLLMENT_COOKIE,
        seal(ENROLLMENT_TYPE, updatedEnrollment, webAuthn.secret, enrollmentTtlSeconds()),
        enrollmentTtlSeconds(),
        webAuthn.secureCookies,
      ),
      setCookie(
        PERSONHOOD_COOKIE,
        seal(PERSONHOOD_TYPE, personhood, webAuthn.secret, personhoodTtlSeconds()),
        personhoodTtlSeconds(),
        webAuthn.secureCookies,
      ),
      clearCookie(CHALLENGE_COOKIE),
      clearCookie(GROWTH_SHARE_COOKIE),
    ],
  );
}
