/**
 * The history index: a bounded walk of recent blocks, filtered to one address.
 *
 * There is no indexer here and the file says so instead of pretending: the gateway reads the last N
 * blocks the node still serves, keeps the transactions whose `from` or `to` is the address asked for, and
 * returns them newest first. Two consequences follow, and both are on the wire rather than in a comment:
 *
 *   - `blocksScanned` / `fromBlock` / `toBlock` travel with the answer, so a client can say *how much*
 *     history it looked at. "No transactions" from a 25-block window is a very different statement from
 *     "no transactions", and a UI that showed the second would be inventing coverage;
 *   - `truncated` is `true` when the caller asked for more depth than the gateway will read. The bound is
 *     a resource guard, not a policy: an unbounded walk turns one HTTP request into a full-chain scan.
 *
 * The walk is the same idiom `app/src/lib/chain.ts` already uses for the launch board (`launchCount()` then
 * a bounded `launchAt(i)` fan-out), for the same reason: a bounded fan-out over a node's own primitives
 * needs no indexer to keep in sync with the chain, and therefore cannot be stale relative to it.
 */

import type { Address, Hex } from "@maotang/mobile-agent/dist/signer/index.js";

import { parseAddress } from "./config.js";
import type { JsonRpcUpstream } from "./json-rpc.js";

/** Most entries one answer will carry, however busy the window was. */
export const MAX_HISTORY_ENTRIES = 200;

/** One transaction, as the panel renders it. `valueWei` is a decimal string: it is money, not a float. */
export interface HistoryEntry {
  readonly hash: Hex | null;
  readonly blockNumber: number;
  readonly indexInBlock: number;
  readonly from: Address | null;
  readonly to: Address | null;
  readonly valueWei: string;
  /** `in` when the address is the recipient, `out` when it is the sender, `self` for both. */
  readonly direction: "in" | "out" | "self";
}

export interface HistoryReport {
  readonly ok: true;
  readonly address: Address;
  readonly headBlock: number;
  readonly fromBlock: number;
  readonly toBlock: number;
  readonly blocksScanned: number;
  /** `true` when the requested depth exceeded {@link MAX_HISTORY_BLOCKS} and was clamped. */
  readonly truncated: boolean;
  /** `true` when the address has more matching transactions in the window than one answer carries. */
  readonly entriesTruncated: boolean;
  readonly entries: readonly HistoryEntry[];
}

export interface HistoryOptions {
  /** How many blocks back to read. Clamped to `[1, maxBlocks]`. */
  readonly depth: number;
  /** The hard ceiling, from `readGatewayConfig().historyMaxBlocks`. */
  readonly maxBlocks: number;
  readonly signal?: AbortSignal;
}

interface RawTransaction {
  readonly hash?: unknown;
  readonly from?: unknown;
  readonly to?: unknown;
  readonly value?: unknown;
}

function hexQuantityToBigInt(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    return 0n;
  }
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function hexQuantityToNumber(value: unknown): number {
  const parsed = Number.parseInt(typeof value === "string" ? value : "", 16);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Reads one address's recent transactions.
 *
 * A block the node no longer serves is skipped rather than failing the whole answer: a pruned node must
 * narrow the window's coverage, not break the panel. `blocksScanned` reports what actually came back.
 */
export async function readHistory(
  upstream: JsonRpcUpstream,
  address: Address,
  options: HistoryOptions,
): Promise<HistoryReport> {
  const { signal } = options;
  const head = await upstream.blockNumber(signal);

  const requested = Number.isSafeInteger(options.depth) && options.depth > 0 ? options.depth : 1;
  const depth = Math.min(requested, options.maxBlocks);
  const fromBlock = Math.max(0, head - depth + 1);

  const heights: number[] = [];
  for (let height = head; height >= fromBlock; height -= 1) {
    heights.push(height);
  }

  const blocks = await Promise.all(
    heights.map(async (height) => ({
      height,
      block: await upstream.getBlockByNumber(height, true, signal),
    })),
  );

  const subject = address.toLowerCase();
  const entries: HistoryEntry[] = [];
  let scanned = 0;

  for (const { height, block } of blocks) {
    if (block === null) {
      continue;
    }
    scanned += 1;
    const transactions = Array.isArray(block.transactions) ? (block.transactions as RawTransaction[]) : [];
    for (const [indexInBlock, transaction] of transactions.entries()) {
      if (typeof transaction !== "object" || transaction === null) {
        continue;
      }
      const from = parseAddress(transaction.from);
      const to = parseAddress(transaction.to);
      if (from !== subject && to !== subject) {
        continue;
      }
      entries.push({
        hash: typeof transaction.hash === "string" ? (transaction.hash.toLowerCase() as Hex) : null,
        blockNumber: typeof block.number === "string" ? hexQuantityToNumber(block.number) : height,
        indexInBlock,
        from,
        to,
        valueWei: hexQuantityToBigInt(transaction.value).toString(),
        direction: from === subject && to === subject ? "self" : from === subject ? "out" : "in",
      });
    }
  }

  // Newest first, and within a block the later transaction first - the order a person reads a statement.
  entries.sort((a, b) => (b.blockNumber - a.blockNumber) || (b.indexInBlock - a.indexInBlock));

  return {
    ok: true,
    address,
    headBlock: head,
    fromBlock,
    toBlock: head,
    blocksScanned: scanned,
    truncated: requested > options.maxBlocks,
    entriesTruncated: entries.length > MAX_HISTORY_ENTRIES,
    entries: entries.slice(0, MAX_HISTORY_ENTRIES),
  };
}
