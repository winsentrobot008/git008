/**
 * `POST /api/agent/paymaster/authorization` - a signed, single-use Paymaster ticket.
 *
 * The endpoint is deliberately narrow. It requires the sealed personhood cookie created by a
 * cryptographically verified claim, reads the live on-chain quota, and only then signs the exact
 * digest `MaotangPaymaster.validatePaymasterUserOp` recovers. Issuing this ticket is not a claim that
 * gas was sponsored: the client still has to submit a user operation through an ERC-4337 bundler.
 */

import { getAddress, isAddress } from "ethers";

import { isSecurityHoldEngaged, securityHoldResponse } from "@/lib/system/security-hold";
import {
  PaymasterError,
  createPaymasterClient,
  issueAuthorization,
  readPaymasterConfig,
} from "@/lib/agent/paymaster";
import {
  PERSONHOOD_COOKIE,
  PERSONHOOD_TYPE,
  open,
  readCookie,
  readWebAuthnConfig,
  type PersonhoodPayload,
} from "@/lib/agent/webauthn-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const webAuthn = readWebAuthnConfig(request);
  if (!webAuthn.ok) {
    return refusal("WEBAUTHN_UNCONFIGURED", webAuthn.reason, 503);
  }
  const personhood = open<PersonhoodPayload>(
    readCookie(request, PERSONHOOD_COOKIE),
    PERSONHOOD_TYPE,
    webAuthn.config.secret,
  );
  if (personhood === null) {
    return refusal(
      "PERSONHOOD_REQUIRED",
      "a server-verified claim is required before a Paymaster ticket can be signed",
      403,
    );
  }

  const configResult = readPaymasterConfig();
  if (!configResult.ok) {
    return refusal(
      "PAYMASTER_UNCONFIGURED",
      `the MAOTANG Paymaster is not configured (missing or invalid: ${configResult.missing.join(", ")})`,
      503,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return refusal("INVALID_JSON", "the authorization body is not valid JSON", 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return refusal("INVALID_BODY", "the authorization body must be a JSON object", 400);
  }
  const sender = (body as Record<string, unknown>).sender;
  if (typeof sender !== "string" || !isAddress(sender)) {
    return refusal("SENDER_INVALID", "sender must be a 20-byte EVM address", 400);
  }

  // The personhood cookie is tied to the one wallet address the faucet claim was bound to. Without
  // this check any valid personhood cookie could sponsor an unrelated sender.
  if (
    personhood.recipient === null ||
    getAddress(sender) !== getAddress(personhood.recipient)
  ) {
    return refusal(
      "SENDER_NOT_BOUND",
      "the sender is not the wallet address bound to this hardware-verified claim",
      403,
    );
  }

  try {
    const client = createPaymasterClient(configResult.config);
    const authorization = await issueAuthorization(configResult.config, client, sender);
    return Response.json(
      {
        ok: true,
        configured: true,
        sponsored: false,
        note:
          "This is a signed Paymaster authorization, not a completed sponsorship. Append paymasterData after the 52-byte v0.7 prefix and submit the user operation through a bundler.",
        authorization,
        paymasterAddress: configResult.config.address,
        entryPoint: configResult.config.entryPoint,
        chainId: configResult.config.chainId,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof PaymasterError) {
      const status = error.code === "QUOTA_EXHAUSTED" ? 429 : 503;
      return refusal(error.code, error.message, status);
    }
    return refusal("PAYMASTER_UNAVAILABLE", (error as Error).message, 503);
  }
}
