/**
 * `GET /api/agent/claim/status?txHash=0x...` - real receipt polling.
 *
 * Pending means the node has not mined the transaction yet; it is never rendered as a balance. A
 * reverted receipt is reported as failed, and an unreachable faucet RPC is reported as unavailable
 * rather than as a successful claim.
 */

import {
  createFaucetClient,
  explorerTransactionUrl,
  readClaimReceipt,
  readFaucetConfig,
} from "@/lib/agent/faucet";
import { readOptionalGrowthIdentity } from "@/lib/growth/server";
import { recordGrowthEvent } from "@/lib/growth/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HASH = /^0x[0-9a-fA-F]{64}$/;

function reply(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const txHash = new URL(request.url).searchParams.get("txHash")?.trim() ?? "";
  if (!HASH.test(txHash)) {
    return reply(
      { ok: false, code: "TX_HASH_INVALID", message: "txHash must be a 32-byte 0x-prefixed hash" },
      400,
    );
  }

  const configResult = readFaucetConfig();
  if (!configResult.ok) {
    return reply(
      {
        ok: false,
        configured: false,
        code: "FAUCET_UNCONFIGURED",
        message: `the MAOTANG faucet is not configured (missing or invalid: ${configResult.missing.join(", ")})`,
      },
      503,
    );
  }
  const config = configResult.config;

  try {
    const client = createFaucetClient(config);
    const receipt = await readClaimReceipt(client, txHash);
    if (receipt.status === "confirmed" || receipt.status === "failed") {
      const growth = readOptionalGrowthIdentity(request);
      if (growth !== null) {
        await recordGrowthEvent({
          event: receipt.status === "confirmed" ? "claim_settled" : "claim_failed",
          identity: growth.identity,
          uniqueScope: `${receipt.status}:${txHash.toLowerCase()}`,
        });
      }
    }
    return reply({
      ok: true,
      configured: true,
      txHash: txHash.toLowerCase(),
      chainId: config.chainId,
      status: receipt.status,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
      explorerUrl: explorerTransactionUrl(config.explorerUrl, txHash),
    });
  } catch (error) {
    return reply(
      {
        ok: false,
        configured: true,
        code: "FAUCET_UNAVAILABLE",
        message: "the configured faucet RPC could not read the transaction receipt",
      },
      503,
    );
  }
}
