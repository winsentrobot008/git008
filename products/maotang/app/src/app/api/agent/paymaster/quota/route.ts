/**
 * `GET /api/agent/paymaster/quota?sender=0x...` - the live on-chain 24h allowance.
 *
 * `verified` is read from the sealed personhood cookie set by a successful claim, never from a query
 * flag. When the Paymaster environment is absent the route answers `configured: false`; it does not
 * borrow the UI's old static 100/100.
 */

import { getAddress, isAddress } from "ethers";

import {
  createPaymasterClient,
  readPaymasterConfig,
  readPaymasterQuota,
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

function reply(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const sender = new URL(request.url).searchParams.get("sender")?.trim() ?? "";

  const webAuthn = readWebAuthnConfig(request);
  const personhood = webAuthn.ok
    ? open<PersonhoodPayload>(
        readCookie(request, PERSONHOOD_COOKIE),
        PERSONHOOD_TYPE,
        webAuthn.config.secret,
      )
    : null;
  const senderBound =
    sender !== "" &&
    isAddress(sender) &&
    personhood?.recipient != null &&
    getAddress(sender) === getAddress(personhood.recipient);
  // A valid cookie is not enough: the badge is "verified" only for the wallet address the
  // hardware claim bound to this personhood record.
  const verified = personhood !== null && (sender === "" || senderBound);

  const configResult = readPaymasterConfig();
  if (!configResult.ok) {
    return reply({
      ok: true,
      configured: false,
      verified,
      limit: 100,
      used: null,
      remaining: null,
      reason: `the MAOTANG Paymaster is not configured (missing or invalid: ${configResult.missing.join(", ")})`,
    });
  }

  if (sender === "") {
    return reply({
      ok: true,
      configured: true,
      verified,
      sender: null,
      limit: 100,
      used: null,
      remaining: null,
      reason: "a sender address is required to read a per-account quota",
    });
  }
  if (!isAddress(sender)) {
    return reply(
      { ok: false, configured: true, code: "SENDER_INVALID", message: "sender must be a 20-byte EVM address" },
      400,
    );
  }

  try {
    const client = createPaymasterClient(configResult.config);
    const quota = await readPaymasterQuota(client, sender);
    return reply({
      ok: true,
      ...quota,
      verified,
      explorerUrl: configResult.config.explorerUrl,
    });
  } catch (error) {
    return reply(
      {
        ok: false,
        configured: true,
        verified,
        code: "PAYMASTER_UNAVAILABLE",
        message: (error as Error).message,
      },
      503,
    );
  }
}
