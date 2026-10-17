/**
 * `POST /api/agent/claim` - the cold-start claim request.
 *
 * What this route can honestly do in this build: validate the browser's hardware-assertion shape,
 * derive a deterministic request id and return a *pending* settlement ticket. What it cannot do:
 * mint or transfer MAOTANG. Enrollment uses WebAuthn `attestation: "none"`, so the server never
 * receives a public key and cannot verify the assertion signature; and this deployment has no faucet
 * contract. Both facts are returned in the body instead of being papered over with a fake balance.
 */

import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REWARD = "10";
const SYMBOL = "MAOTANG";
const ALIAS = /^[a-z0-9]{1,32}$/;
const CREDENTIAL = /^[A-Za-z0-9_-]{8,512}$/;
const HEX32 = /^0x[0-9a-f]{64}$/i;

function refusal(code: string, reason: string, status = 422): Response {
  return Response.json(
    { ok: false, success: false, code, message: reason, reason },
    { status },
  );
}

export async function POST(request: Request): Promise<Response> {
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
  const alias = typeof record.alias === "string" ? record.alias.trim().toLowerCase() : "";
  const credentialId = typeof record.credentialId === "string" ? record.credentialId : "";
  const nullifier = typeof record.nullifier === "string" ? record.nullifier : "";
  const challenge = typeof record.challenge === "string" ? record.challenge : "";

  if (!ALIAS.test(alias)) {
    return refusal("ALIAS_INVALID", "alias must be 1-32 lowercase alphanumeric characters");
  }
  if (!CREDENTIAL.test(credentialId)) {
    return refusal("CREDENTIAL_INVALID", "credentialId is not a WebAuthn credential identifier");
  }
  if (!HEX32.test(nullifier) || !HEX32.test(challenge)) {
    return refusal("ASSERTION_SHAPE_INVALID", "nullifier and challenge must be 32-byte 0x hex values");
  }
  if (record.userVerified !== true || record.hardwareBacked !== true) {
    return refusal(
      "BIO_NOT_VERIFIED",
      "a claim requires userVerified and hardwareBacked from the device assertion",
    );
  }

  // A deterministic request id lets the same device retry without inventing a second ticket. Nothing
  // is persisted: this deployment has no claim ledger, so the client must not treat it as a balance.
  const digest = createHash("sha256")
    .update(`${alias}:${nullifier}:${challenge}:${REWARD}:${SYMBOL}`)
    .digest("hex");

  return Response.json({
    ok: true,
    success: true,
    claim: {
      id: `mtc_${digest.slice(0, 24)}`,
      alias: `${alias}.008ai`,
      reward: REWARD,
      symbol: SYMBOL,
      status: "requested",
      settlement: "pending",
      onChain: false,
      faucetConfigured: false,
      attestation: "client-asserted",
      reason:
        "No MAOTANG faucet is configured for this deployment; this is a claim request, not a minted balance.",
    },
  });
}
