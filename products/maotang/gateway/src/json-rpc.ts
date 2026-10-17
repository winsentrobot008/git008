/**
 * The upstream JSON-RPC client - the *only* place the gateway talks to a node.
 *
 * Two rules make this file the gateway's whole egress story:
 *
 *   1. **The endpoint is never a parameter.** It comes from {@link JsonRpcUpstreamOptions}, which the boot
 *      path fills from `readGatewayConfig()`. A caller chooses the *method*, never the *target*, so the
 *      gateway is not an open relay that a request body can repoint at another node.
 *   2. **Reads and writes are separated by an allow-list.** {@link READ_METHODS} is the set a `POST
 *      /v1/rpc` body may name; anything else is refused before a socket opens. Transporting a signed
 *      transaction is a *different* method ({@link JsonRpcUpstream.sendRawTransaction}) that no request
 *      body can reach, because broadcast has to pass the policy engine first (see `broadcast.ts`).
 *
 * A third distinction matters to the broadcast proxy and is encoded in the refusal *codes*, not in prose:
 * an answer we could parse as a JSON-RPC verdict is **deterministic** (`UPSTREAM_ERROR`: the node
 * considered the call and said no), while a timeout or an unreachable transport is **uncertain**
 * (`UPSTREAM_TIMEOUT` / `UPSTREAM_UNREACHABLE`: the call may have landed anyway). `broadcast.ts` records a
 * window reservation for the uncertain case and only for it.
 */

import type { Address, Hex } from "@maotang/mobile-agent/dist/signer/index.js";

import { GatewayError } from "./errors.js";

/**
 * The read surface `POST /v1/rpc` forwards. It is the same set the C-end console issues through its
 * same-origin proxy (`app/src/app/api/rpc/route.ts`), so the two halves of the protocol cannot drift into
 * exposing different reads.
 */
export const READ_METHODS: readonly string[] = Object.freeze([
  "eth_chainId",
  "net_version",
  "web3_clientVersion",
  "eth_blockNumber",
  "eth_gasPrice",
  "eth_feeHistory",
  "eth_getBalance",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionCount",
  "eth_call",
  "eth_estimateGas",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getLogs",
]);

const READ_METHOD_SET: ReadonlySet<string> = new Set(READ_METHODS);

/**
 * Namespaces no caller may reach, whatever the allow-list says.
 *
 * These are the node-administration surfaces: `anvil_*` / `evm_*` / `hardhat_*` mint and rewind chain
 * state, `admin_*` and `personal_*` own accounts and keys, `debug_*` and `txpool_*` expose internals.
 * The check runs *first*, so a future edit that added one of them to {@link READ_METHODS} would still be
 * refused - the two lists are not allowed to contradict each other in the permissive direction.
 */
const BLOCKED_PREFIXES: readonly string[] = Object.freeze([
  "admin_",
  "debug_",
  "personal_",
  "miner_",
  "txpool_",
  "anvil_",
  "evm_",
  "hardhat_",
]);

/** `true` when `method` is on the read allow-list and in no blocked namespace. */
export function isReadMethod(method: string): boolean {
  if (!READ_METHOD_SET.has(method)) {
    return false;
  }
  const lower = method.toLowerCase();
  return !BLOCKED_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** The namespace that blocked a method, or `null`. Used to name the refusal precisely in a log. */
export function blockedNamespace(method: string): string | null {
  const lower = method.toLowerCase();
  return BLOCKED_PREFIXES.find((prefix) => lower.startsWith(prefix)) ?? null;
}

/** One JSON-RPC block, narrowed to the fields the history index reads. */
export interface RawBlock {
  readonly number?: unknown;
  readonly hash?: unknown;
  readonly timestamp?: unknown;
  readonly transactions?: unknown;
}

export interface JsonRpcUpstreamOptions {
  readonly rpcUrl: string;
  readonly timeoutMs: number;
}

interface JsonRpcEnvelope {
  readonly result?: unknown;
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

export class JsonRpcUpstream {
  readonly #url: string;
  readonly #timeoutMs: number;
  #nextId = 1;

  constructor(options: JsonRpcUpstreamOptions) {
    this.#url = options.rpcUrl;
    this.#timeoutMs = options.timeoutMs;
  }

  /** The bound endpoint. Reported by `GET /v1/index` so an operator can see what the gateway dials. */
  get url(): string {
    return this.#url;
  }

  /**
   * Forwards one read method.
   *
   * `signal` is the caller's own cancellation (a dropped HTTP request); it is combined with the
   * per-call timeout rather than replacing it, so neither the caller nor the configuration can disable
   * the other's bound.
   */
  async call<T>(method: string, params: readonly unknown[] = [], signal?: AbortSignal): Promise<T> {
    if (!isReadMethod(method)) {
      const namespace = blockedNamespace(method);
      throw new GatewayError(
        "UPSTREAM_METHOD_BLOCKED",
        namespace === null
          ? `${method} is not on the gateway's read allow-list`
          : `${method} belongs to the blocked ${namespace} namespace`,
      );
    }
    return this.#dispatch<T>(method, params, signal);
  }

  /**
   * Transports an already-signed transaction.
   *
   * Deliberately *not* reachable through {@link call}: it is named explicitly by `broadcast.ts` after the
   * policy engine has allowed the leg, which is the only reason `eth_sendRawTransaction` is absent from
   * {@link READ_METHODS}.
   */
  async sendRawTransaction(rawTransaction: Hex, signal?: AbortSignal): Promise<Hex> {
    const hash = await this.#dispatch<unknown>("eth_sendRawTransaction", [rawTransaction], signal);
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new GatewayError("UPSTREAM_ERROR", "the node accepted the request but returned no transaction hash");
    }
    return hash.toLowerCase() as Hex;
  }

  async chainId(signal?: AbortSignal): Promise<number> {
    const value = await this.call<unknown>("eth_chainId", [], signal);
    if (typeof value !== "string") {
      throw new GatewayError("UPSTREAM_ERROR", "eth_chainId returned a non-string result");
    }
    const parsed = Number.parseInt(value, 16);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new GatewayError("UPSTREAM_ERROR", `eth_chainId returned an unreadable chain id: ${value}`);
    }
    return parsed;
  }

  async blockNumber(signal?: AbortSignal): Promise<number> {
    const value = await this.call<unknown>("eth_blockNumber", [], signal);
    if (typeof value !== "string") {
      throw new GatewayError("UPSTREAM_ERROR", "eth_blockNumber returned a non-string result");
    }
    const parsed = Number.parseInt(value, 16);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new GatewayError("UPSTREAM_ERROR", `eth_blockNumber returned an unreadable height: ${value}`);
    }
    return parsed;
  }

  /** Native balance in wei. `0x` (a node that answers for an unknown account) reads as `0n`. */
  async getBalance(address: Address, signal?: AbortSignal): Promise<bigint> {
    const value = await this.call<unknown>("eth_getBalance", [address, "latest"], signal);
    if (typeof value !== "string") {
      throw new GatewayError("UPSTREAM_ERROR", "eth_getBalance returned a non-string result");
    }
    if (value === "0x") {
      return 0n;
    }
    try {
      return BigInt(value);
    } catch {
      throw new GatewayError("UPSTREAM_ERROR", `eth_getBalance returned an unreadable quantity: ${value}`);
    }
  }

  async getTransactionCount(address: Address, signal?: AbortSignal): Promise<number> {
    const value = await this.call<unknown>("eth_getTransactionCount", [address, "latest"], signal);
    if (typeof value !== "string") {
      throw new GatewayError("UPSTREAM_ERROR", "eth_getTransactionCount returned a non-string result");
    }
    const parsed = Number.parseInt(value, 16);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new GatewayError("UPSTREAM_ERROR", `eth_getTransactionCount returned: ${value}`);
    }
    return parsed;
  }

  /** One block by decimal height, or `null` when the node does not have it. */
  async getBlockByNumber(height: number, withTransactions: boolean, signal?: AbortSignal): Promise<RawBlock | null> {
    if (!Number.isSafeInteger(height) || height < 0) {
      throw new GatewayError("BAD_REQUEST", `block height must be a non-negative integer, got ${String(height)}`);
    }
    const tag = `0x${height.toString(16)}`;
    const value = await this.call<unknown>("eth_getBlockByNumber", [tag, withTransactions], signal);
    if (value === null) {
      return null;
    }
    if (typeof value !== "object") {
      throw new GatewayError("UPSTREAM_ERROR", "eth_getBlockByNumber returned a non-object result");
    }
    return value as RawBlock;
  }

  /** The single wire call. Every public method above funnels through here, so timeouts apply once. */
  async #dispatch<T>(method: string, params: readonly unknown[], signal?: AbortSignal): Promise<T> {
    const id = this.#nextId;
    this.#nextId += 1;

    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const combined = signal === undefined ? timeout : AbortSignal.any([timeout, signal]);

    let response: Response;
    try {
      response = await fetch(this.#url, {
        method: "POST",
        headers: { "content-type": "application/json", "cache-control": "no-store" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: combined,
      });
    } catch (error) {
      throw transportRefusal(error, method);
    }

    const text = await response.text();
    let envelope: JsonRpcEnvelope | null = null;
    try {
      const parsed = JSON.parse(text) as unknown;
      envelope = typeof parsed === "object" && parsed !== null ? (parsed as JsonRpcEnvelope) : null;
    } catch {
      envelope = null;
    }

    if (envelope === null) {
      // The endpoint answered, but not with JSON-RPC. A gateway in front of the node (an HTML error page,
      // a captive portal) lands here, and the transaction may or may not have reached the node - so this
      // is classified as transport trouble, never as the node's verdict.
      throw new GatewayError("UPSTREAM_UNREACHABLE", `${method} did not answer with a JSON-RPC envelope`, {
        detail: `HTTP ${response.status}`,
      });
    }

    if (envelope.error !== undefined && envelope.error !== null) {
      const message = typeof envelope.error.message === "string" ? envelope.error.message : "upstream error";
      throw new GatewayError("UPSTREAM_ERROR", `${method} was refused by the node`, { detail: message });
    }
    if (envelope.result === undefined) {
      throw new GatewayError("UPSTREAM_ERROR", `${method} answered without a result`);
    }
    return envelope.result as T;
  }
}

/** Classifies a `fetch` rejection: a spent deadline, or a transport that never answered. */
function transportRefusal(error: unknown, method: string): GatewayError {
  const name = (error as { name?: string } | null)?.name;
  if (name === "TimeoutError") {
    return new GatewayError("UPSTREAM_TIMEOUT", `${method} exceeded the upstream deadline`);
  }
  if (name === "AbortError") {
    return new GatewayError("UPSTREAM_UNREACHABLE", `${method} was aborted before the node answered`);
  }
  return new GatewayError("UPSTREAM_UNREACHABLE", `${method} could not reach the configured endpoint`, {
    detail: (error as Error)?.message ?? "network error",
  });
}