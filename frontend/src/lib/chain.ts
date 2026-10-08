import {
  MaoTangClient,
  maoTangCurveAbi,
  maoTangFactoryAbi,
  maoTangSustenanceVaultAbi,
  type Address,
  type ContractReadRequest,
  type ContractTransport,
  type CurveState,
  type Hex,
} from "@maotang/sdk";
import {
  readSpec,
  type CurveSnapshot,
  type LaunchCard,
  type ReadArg,
  type ReadKind,
  type ReadSpec,
  type VaultStats,
} from "./protocol";

/**
 * Manifest fallbacks for the deployment.
 *
 * `frontend/config/contracts.json` is written by `contracts/scripts/deploy-testnet.ts` on every
 * deployment, so it - not this file - is the source of truth for which chain the board points at.
 * `next.config.ts` reads it in Node at config load and forwards its addresses as the
 * `NEXT_PUBLIC_MANIFEST_*` values below, so a production build binds the live deployment without any
 * address being copied by hand. Importing the JSON here instead would make a missing manifest a hard
 * bundle error; this indirection degrades to an empty string and the explicit variables still win.
 */
const MANIFEST_OPERATOR = process.env.NEXT_PUBLIC_MANIFEST_OPERATOR_ADDRESS;
const MANIFEST_DEVELOPER = process.env.NEXT_PUBLIC_MANIFEST_DEVELOPER_ADDRESS;
const MANIFEST_BTC_REVENUE = process.env.NEXT_PUBLIC_MANIFEST_BTC_REVENUE_ADDRESS;
const MANIFEST_FACTORY = process.env.NEXT_PUBLIC_MANIFEST_FACTORY_ADDRESS;
const MANIFEST_VAULT = process.env.NEXT_PUBLIC_MANIFEST_VAULT_ADDRESS;
const MANIFEST_HUMAN_TOKEN = process.env.NEXT_PUBLIC_MANIFEST_HUMAN_TOKEN_ADDRESS;
const MANIFEST_CURVE = process.env.NEXT_PUBLIC_MANIFEST_CURVE_ADDRESS;
const MANIFEST_CHAIN_ID = process.env.NEXT_PUBLIC_MANIFEST_CHAIN_ID;

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
  /** `MaoTangFactory` whose launch registry the board walks. */
  factory: Address | null;
  /** Bonding curve whose graduation progress the board tracks. */
  curve: Address | null;
  /** `MaoTangSustenanceVault` whose revenue the board tracks. */
  vault: Address | null;
  /** `HumanToken` ($mHUMAN) minted by the personhood claim. */
  humanToken: Address | null;
  /** `NEXT_PUBLIC_CHAIN_ID` the board expects; `null` when unset or malformed. */
  chainId: number | null;
  /** Operator revenue beneficiary (`NEXT_PUBLIC_OPERATOR_ADDRESS`); env first, manifest second. */
  operator: Address | null;
  /** Developer revenue beneficiary (`NEXT_PUBLIC_DEVELOPER_ADDRESS`). */
  developer: Address | null;
  /** BTC cross-chain payout metadata (`NEXT_PUBLIC_BTC_REVENUE_ADDRESS`); never an EVM target. */
  btcRevenueAddress: string | null;
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
 * Parses `NEXT_PUBLIC_CHAIN_ID` as a positive integer.
 *
 * Returns `null` for an unset or malformed value, so a typo degrades to "unknown chain" rather
 * than a silent `NaN` in a comparison.
 */
export function parseChainId(value: string | undefined | null): number | null {
  const trimmed = value?.trim();
  if (!trimmed || !/^[0-9]+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Trims a Bitcoin payout address.
 *
 * Deliberately not validated as hex: `NEXT_PUBLIC_BTC_REVENUE_ADDRESS` is cross-chain payout
 * metadata (`1Cq...` base58), not an EVM address, so only non-emptiness is required.
 */
export function parseBtcAddress(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Reads the deployment the board points at, or `null` when no endpoint is available at all.
 *
 * Addresses stay `null` when they are missing or malformed, which keeps the corresponding panel in
 * its deterministic "awaiting rpc" state instead of guessing. Outside production the RPC URL falls
 * back to local anvil, so `npm run dev` works against a local chain with no configuration.
 *
 * Every address falls back to the deployment manifest (`frontend/config/contracts.json`) when its
 * variable is unset, so a board bound by the manifest alone still finds the factory, the curve and
 * the vault instead of showing empty panels.
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
    factory: firstAddress(process.env.NEXT_PUBLIC_MAOTANG_FACTORY_ADDRESS, MANIFEST_FACTORY),
    curve: firstAddress(
      process.env.NEXT_PUBLIC_MAOTANG_CURVE_ADDRESS,
      process.env.NEXT_PUBLIC_MAOTANG_CURVE,
      MANIFEST_CURVE,
    ),
    vault: firstAddress(
      process.env.NEXT_PUBLIC_MAOTANG_VAULT_ADDRESS,
      process.env.NEXT_PUBLIC_MAOTANG_VAULT,
      MANIFEST_VAULT,
    ),
    humanToken: firstAddress(process.env.NEXT_PUBLIC_MAOTANG_HUMAN_TOKEN_ADDRESS, MANIFEST_HUMAN_TOKEN),
    chainId: parseChainId(process.env.NEXT_PUBLIC_CHAIN_ID ?? MANIFEST_CHAIN_ID),
    operator: firstAddress(process.env.NEXT_PUBLIC_OPERATOR_ADDRESS, MANIFEST_OPERATOR),
    developer: firstAddress(process.env.NEXT_PUBLIC_DEVELOPER_ADDRESS, MANIFEST_DEVELOPER),
    btcRevenueAddress: parseBtcAddress(process.env.NEXT_PUBLIC_BTC_REVENUE_ADDRESS ?? MANIFEST_BTC_REVENUE),
  };
}

interface JsonRpcPayload {
  result?: unknown;
  error?: { code?: number; message?: string };
}

function toBigInt(value: string): bigint {
  return value === "0x" || value === "" ? 0n : BigInt(value);
}

/** Hex body of an RPC result, without its `0x` prefix. */
function hexBody(result: string): string {
  return result.startsWith("0x") ? result.slice(2) : result;
}

/**
 * Resolves a read request against the pinned selector registry.
 *
 * The registry is keyed by full signature, so arity is part of the lookup: a request carrying the
 * wrong number of arguments fails loudly here instead of encoding a call nothing answers.
 */
function resolveRead(request: ContractReadRequest): { entry: ReadSpec; args: readonly unknown[] } {
  const entry = readSpec(request.functionName);
  if (!entry) {
    throw new Error(`no selector registered for "${request.functionName}"`);
  }
  const args = request.args ?? [];
  const expected = entry.arg === undefined ? 0 : 1;
  if (args.length !== expected) {
    throw new Error(`"${request.functionName}" takes ${expected} argument(s), got ${args.length}`);
  }
  return { entry, args };
}

/** Encodes the single static argument of a keyed read as one 32-byte ABI word. */
function encodeArg(type: ReadArg, value: unknown): string {
  if (type === "address") {
    const parsed = parseAddress(typeof value === "string" ? value : null);
    if (parsed === null) {
      throw new Error(`an address argument must be 20 hex bytes, got ${String(value)}`);
    }
    return parsed.slice(2).padStart(64, "0");
  }
  const numeric = typeof value === "bigint" ? value : BigInt(String(value));
  return numeric.toString(16).padStart(64, "0");
}

/** Decodes an ABI-encoded `string` return: an offset word, a length word and zero-padded payload. */
function decodeString(result: string): string {
  const body = hexBody(result);
  if (body.length < 128) {
    throw new Error(`RPC returned a malformed string: ${result}`);
  }
  const offset = Number(BigInt(`0x${body.slice(0, 64)}`)) * 2;
  const length = Number(BigInt(`0x${body.slice(offset, offset + 64)}`));
  const payload = body.slice(offset + 64, offset + 64 + length * 2);
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Number.parseInt(payload.slice(index * 2, index * 2 + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

function decode(kind: ReadKind, result: string): bigint | Address | string {
  if (kind === "address") {
    const body = hexBody(result);
    if (body.length < 40) {
      throw new Error(`RPC returned a malformed address: ${result}`);
    }
    return `0x${body.slice(-40)}`.toLowerCase() as Address;
  }
  if (kind === "string") {
    return decodeString(result);
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
      const { entry, args } = resolveRead(request);
      const data = (entry.arg === undefined ? entry.selector : `${entry.selector}${encodeArg(entry.arg, args[0])}`) as Hex;
      const result = await jsonRpc(rpcUrl, "eth_call", [{ to: request.address, data }, "latest"], signal);
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
    factory: config.factory ?? READ_ONLY_FACTORY,
    transport: createJsonRpcTransport(config.rpcUrl, signal),
  });
  const state = await client.getCurveState(curve);
  return state;
}

/** Narrows a full curve read down to what the graduation bar renders. */
export function toCurveSnapshot(state: CurveState): CurveSnapshot {
  return { token: state.token, reserve: state.reserve, target: state.target, price: state.price };
}

/** Upper bound on the launches one poll walks, so a spammed factory cannot explode a refresh. */
export const MAX_TRACKED_LAUNCHES = 12;

/**
 * Reads the factory's launch registry, newest first.
 *
 * `MaoTangFactory` records every launch it deployed and exposes `launchCount()` / `launchAt(i)`, so
 * the board renders the real board from the factory address alone: no indexer, no event replay and no
 * address list to keep in sync. A launch appears as soon as its `createMemeToken` call is mined, which
 * is what makes the board live rather than illustrative. Newest first, and capped at
 * {@link MAX_TRACKED_LAUNCHES} so a factory with a thousand launches still costs one bounded refresh.
 */
export async function fetchLaunches(
  config: ChainConfig,
  factory: Address,
  signal: AbortSignal,
): Promise<LaunchCard[]> {
  const transport = createJsonRpcTransport(config.rpcUrl, signal);
  const count = await transport.read<bigint>({
    address: factory,
    abi: maoTangFactoryAbi,
    functionName: "launchCount",
  });

  const total = Number(count);
  if (!Number.isSafeInteger(total) || total <= 0) {
    return [];
  }

  const indexes: number[] = [];
  for (let index = total - 1; index >= 0 && indexes.length < MAX_TRACKED_LAUNCHES; index -= 1) {
    indexes.push(index);
  }
  return Promise.all(indexes.map((index) => fetchLaunch(factory, transport, index)));
}

/** Reads one launch: its curve, the token behind it, and the curve's current numbers. */
async function fetchLaunch(
  factory: Address,
  transport: ContractTransport,
  index: number,
): Promise<LaunchCard> {
  const curve = await transport.read<Address>({
    address: factory,
    abi: maoTangFactoryAbi,
    functionName: "launchAt",
    args: [BigInt(index)],
  });

  const client = new MaoTangClient({ factory, transport });
  const [state, creator] = await Promise.all([
    client.getCurveState(curve),
    transport.read<Address>({ address: curve, abi: maoTangCurveAbi, functionName: "creator" }),
  ]);

  // `MemeToken` has no SDK ABI fragment, and this transport resolves selectors from `CONTRACT_READS`
  // rather than from the request's `abi`, so the empty fragment below is never read.
  const [name, symbol] = await Promise.all([
    transport.read<string>({ address: state.token, abi: [], functionName: "name" }),
    transport.read<string>({ address: state.token, abi: [], functionName: "symbol" }),
  ]);

  return {
    address: state.token,
    curve,
    creator,
    name,
    symbol,
    reserveWei: state.reserve,
    priceWei: state.price,
  };
}
