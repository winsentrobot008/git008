import {
  MaoTangClient,
  maoTangSustenanceVaultAbi,
  type Address,
  type ContractReadRequest,
  type ContractTransport,
  type CurveState,
  type Hex,
} from "@maotang/sdk";
import { ZERO_ARG_READS, type CurveSnapshot, type ReadKind, type VaultStats } from "./protocol";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * `MaoTangClient` requires a factory in its config, but this board only performs read-only curve
 * queries, which never touch the factory. Keep the placeholder explicit instead of inventing a
 * deployment address in the UI.
 */
const READ_ONLY_FACTORY: Address = "0x0000000000000000000000000000000000000000";

/**
 * Local anvil endpoint. Used as the dev/testnet fallback so `npm run dev` shows live panels without
 * a `.env.local`; a production build never invents an endpoint.
 */
export const DEV_FALLBACK_RPC_URL = "http://127.0.0.1:8545";

/** Chain endpoints the live panels poll. Built from `NEXT_PUBLIC_*` so the client bundle stays static. */
export interface ChainConfig {
  rpcUrl: string;
  /** True when `rpcUrl` came from {@link DEV_FALLBACK_RPC_URL} rather than the environment. */
  usingDevFallback: boolean;
  /** Bonding curve whose graduation progress the board tracks. */
  curve: Address | null;
  /** `MaoTangSustenanceVault` whose revenue the board tracks. */
  vault: Address | null;
  /** `HumanToken` ($mHUMAN) minted by the personhood claim. */
  humanToken: Address | null;
}

/** Trims and validates a hex address, returning `null` for anything that is not 20 bytes. */
export function parseAddress(value: string | undefined | null): Address | null {
  const trimmed = value?.trim();
  if (!trimmed || !ADDRESS_PATTERN.test(trimmed)) {
    return null;
  }
  return trimmed.toLowerCase() as Address;
}

/** First value that parses as an address; lets a canonical key and its legacy alias coexist. */
export function firstAddress(...values: (string | undefined)[]): Address | null {
  for (const value of values) {
    const parsed = parseAddress(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

/**
 * Reads the deployment the board points at, or `null` when no endpoint is available at all.
 *
 * Addresses stay `null` when they are missing or malformed, which keeps the corresponding panel in
 * its deterministic "awaiting rpc" state instead of guessing. Outside production the RPC URL falls
 * back to local anvil, so `npm run dev` works against a local chain with no configuration.
 */
export function readChainConfig(): ChainConfig | null {
  const configured = process.env.NEXT_PUBLIC_MAOTANG_RPC_URL?.trim();
  const rpcUrl = configured && configured !== "" ? configured : process.env.NODE_ENV === "production" ? null : DEV_FALLBACK_RPC_URL;
  if (rpcUrl === null) {
    return null;
  }
  return {
    rpcUrl,
    usingDevFallback: !configured,
    curve: firstAddress(process.env.NEXT_PUBLIC_MAOTANG_CURVE_ADDRESS, process.env.NEXT_PUBLIC_MAOTANG_CURVE),
    vault: firstAddress(process.env.NEXT_PUBLIC_MAOTANG_VAULT_ADDRESS, process.env.NEXT_PUBLIC_MAOTANG_VAULT),
    humanToken: firstAddress(process.env.NEXT_PUBLIC_MAOTANG_HUMAN_TOKEN_ADDRESS),
  };
}

interface JsonRpcPayload {
  result?: unknown;
  error?: { code?: number; message?: string };
}

function toBigInt(value: string): bigint {
  return value === "0x" || value === "" ? 0n : BigInt(value);
}

function resolveRead(request: ContractReadRequest): { selector: Hex; kind: ReadKind } {
  if (request.args && request.args.length > 0) {
    throw new Error(`the read-only transport only encodes zero-argument calls, got "${request.functionName}"`);
  }
  const entry = ZERO_ARG_READS[`${request.functionName}()`];
  if (!entry) {
    throw new Error(`no selector registered for "${request.functionName}()"`);
  }
  return entry;
}

function decode(kind: ReadKind, result: string): bigint | Address {
  if (kind === "address") {
    if (result.length < 42) {
      throw new Error(`RPC returned a malformed address: ${result}`);
    }
    return `0x${result.slice(-40)}`.toLowerCase() as Address;
  }
  return toBigInt(result);
}

async function jsonRpc(
  rpcUrl: string,
  method: string,
  params: readonly unknown[],
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`${method} failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as JsonRpcPayload;
  if (payload.error) {
    throw new Error(`${method} rejected with code ${payload.error.code ?? "unknown"}: ${payload.error.message ?? "no message"}`);
  }
  if (typeof payload.result !== "string") {
    throw new Error(`${method} returned no result`);
  }
  return payload.result;
}

/**
 * Minimal read-only `ContractTransport` over raw JSON-RPC.
 *
 * Writes throw: the board never signs, and the SDK keeps encoding/signing behind this seam.
 */
export function createJsonRpcTransport(rpcUrl: string, signal: AbortSignal): ContractTransport {
  return {
    async getChainId(): Promise<number> {
      return Number(toBigInt(await jsonRpc(rpcUrl, "eth_chainId", [], signal)));
    },
    async getAccount(): Promise<Address | undefined> {
      return undefined;
    },
    async getBalance(address: Address): Promise<bigint> {
      return toBigInt(await jsonRpc(rpcUrl, "eth_getBalance", [address, "latest"], signal));
    },
    async read<Result>(request: ContractReadRequest): Promise<Result> {
      const entry = resolveRead(request);
      const result = await jsonRpc(rpcUrl, "eth_call", [{ to: request.address, data: entry.selector }, "latest"], signal);
      return decode(entry.kind, result) as unknown as Result;
    },
    async write(): Promise<Hex> {
      throw new Error("the board transport is read-only and cannot sign transactions");
    },
    async waitForReceipt(): Promise<{ status: "success" | "reverted" }> {
      throw new Error("the board transport never submits transactions");
    },
  };
}

/** Polls `MaoTangSustenanceVault` for the revenue accumulated for sovereign wallets. */
export async function fetchVaultStats(
  config: ChainConfig,
  vault: Address,
  signal: AbortSignal,
): Promise<VaultStats> {
  const transport = createJsonRpcTransport(config.rpcUrl, signal);
  const [nativeReceived, nativeAvailable] = await Promise.all([
    transport.read<bigint>({ address: vault, abi: maoTangSustenanceVaultAbi, functionName: "nativeFeesReceived" }),
    transport.read<bigint>({ address: vault, abi: maoTangSustenanceVaultAbi, functionName: "availableNative" }),
  ]);
  return { nativeReceived, nativeAvailable };
}

/** Polls a bonding curve: reserve, raise target, spot price and the token it backs. */
export async function fetchCurveState(
  config: ChainConfig,
  curve: Address,
  signal: AbortSignal,
): Promise<CurveState> {
  const client = new MaoTangClient({
    factory: READ_ONLY_FACTORY,
    transport: createJsonRpcTransport(config.rpcUrl, signal),
  });
  const state = await client.getCurveState(curve);
  return state;
}

/** Narrows a full curve read down to what the graduation bar renders. */
export function toCurveSnapshot(state: CurveState): CurveSnapshot {
  return { token: state.token, reserve: state.reserve, target: state.target, price: state.price };
}
