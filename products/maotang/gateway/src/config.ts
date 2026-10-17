/**
 * Gateway configuration, read from the process environment.
 *
 * The gateway is the *server* half of the MAOTANG wallet, so every knob here is a server-side
 * `MAOTANG_GATEWAY_*` variable. There is deliberately no `NEXT_PUBLIC_*` alias: a spend cap is
 * configuration, not content, and a cap published into a browser bundle is a cap the browser could have
 * written.
 *
 * Two defaults are load-bearing and are asserted in `test/config.test.ts`:
 *
 *   - **the endpoint falls back, the scope does not.** With no `MAOTANG_GATEWAY_RPC_URL` the gateway
 *     points at local `anvil` and says so (`usingDevFallback`), because a developer with no `.env` must
 *     still be able to run the smoke test. Nothing else falls back.
 *   - **the destination allow-list comes from the deployment manifest, never from this file.** With no
 *     manifest the list is *empty*, and an empty allow-list refuses every destination - which is the
 *     fail-closed reading the M2 policy already implements (`mobile-agent/signer/policy.ts`). A
 *     convenient hard-coded default here would be an authority grant nobody reviewed.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Address } from "@maotang/mobile-agent/dist/signer/index.js";

/** Wei helper, so the caps below read as the money they are. */
export const ETH = 10n ** 18n;

/** Local `anvil`. The one value that has a fallback; see the file header. */
export const DEV_FALLBACK_RPC_URL = "http://127.0.0.1:8545";

/** Local `anvil` chain id. */
export const DEV_FALLBACK_CHAIN_ID = 31337;

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8787;
export const DEFAULT_MAX_BODY_BYTES = 128 * 1024;
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 15_000;
export const DEFAULT_HISTORY_BLOCKS = 25;

/** Upper bound on one history walk, so a caller cannot ask the gateway to read a whole chain. */
export const MAX_HISTORY_BLOCKS = 256;

/** The deployment manifest `contracts/scripts/deploy-testnet.ts` rewrites on every deployment. */
export interface GatewayManifest {
  /** `true` when a manifest file was found *and* yielded at least one address. */
  readonly loaded: boolean;
  readonly path: string | null;
  readonly chainId: number | null;
  readonly rpcUrl: string | null;
  /** Every contract address the manifest declares, lowercased, deduplicated. */
  readonly addresses: readonly Address[];
  readonly humanToken: Address | null;
  readonly agentRegistry: Address | null;
  readonly factory: Address | null;
  readonly vault: Address | null;
  /** The deployment's owner account - the account whose balance the C-end panel reads. */
  readonly owner: Address | null;
}

export interface GatewayConfig {
  readonly host: string;
  readonly port: number;
  readonly rpcUrl: string;
  /** `true` when `rpcUrl` came from {@link DEV_FALLBACK_RPC_URL} rather than the environment. */
  readonly usingDevFallback: boolean;
  readonly chainId: number;
  readonly usingFallbackChainId: boolean;
  readonly manifest: GatewayManifest;
  readonly maxBodyBytes: number;
  readonly upstreamTimeoutMs: number;
  readonly historyDefaultBlocks: number;
  readonly historyMaxBlocks: number;
}

const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;

/** Trims and validates a hex address, returning `null` for anything that is not 20 bytes. */
export function parseAddress(value: unknown): Address | null {
  const trimmed = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ADDRESS_PATTERN.test(trimmed) ? (trimmed as Address) : null;
}

/** The first value that parses as an address, so a canonical key and a legacy alias can coexist. */
export function firstAddress(...values: unknown[]): Address | null {
  for (const value of values) {
    const parsed = parseAddress(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

/** A positive integer from the environment, or `null` when unset or malformed. */
export function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** A non-negative `bigint` from the environment, or `null` when unset or malformed. */
export function parseWei(value: unknown): bigint | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    return null;
  }
  try {
    return BigInt(trimmed);
  } catch {
    return null;
  }
}

/** Comma-separated addresses, lowercased and deduplicated. Anything unparsable is dropped. */
export function parseAddressList(value: unknown): Address[] {
  const raw = typeof value === "string" ? value : "";
  const seen = new Set<string>();
  for (const entry of raw.split(",")) {
    const parsed = parseAddress(entry);
    if (parsed !== null) {
      seen.add(parsed);
    }
  }
  return [...seen] as Address[];
}

interface RawManifest {
  contracts?: Record<string, unknown>;
  network?: { chainId?: unknown; rpcUrl?: unknown };
  tokens?: { mHUMAN?: { address?: unknown } };
  owner?: unknown;
  deployer?: unknown;
}

/** Where a manifest could live, given the working directory the gateway was started from. */
function manifestCandidates(env: NodeJS.ProcessEnv): string[] {
  const explicit = env.MAOTANG_GATEWAY_MANIFEST_PATH?.trim();
  if (explicit !== undefined && explicit !== "") {
    return [explicit];
  }
  // Three working directories are supported, because all three are real ways to start this process and
  // guessing wrong would silently empty the allow-list:
  //
  //   - `gateway/` itself (`npm start`), which reaches the manifest through `app/`;
  //   - the MAOTANG project root (`node gateway/dist/server.js`), where `deploy-testnet.ts` writes;
  //   - any directory holding a `config/contracts.json`, so a deployment can ship the manifest beside
  //     whatever starts the gateway.
  //
  // An absent file is not an error: the allow-list stays empty and the deployment refuses to spend.
  const cwd = process.cwd();
  return [
    path.join(cwd, "config", "contracts.json"),
    path.join(cwd, "app", "config", "contracts.json"),
    path.join(cwd, "..", "app", "config", "contracts.json"),
  ];
}

function addressNamed(contracts: Record<string, unknown>, name: string): Address | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(contracts)) {
    if (key.toLowerCase() === wanted) {
      return parseAddress(value);
    }
  }
  return null;
}

/**
 * Reads the deployment manifest, or reports its absence.
 *
 * Read through `fs` rather than imported, for the reason `app/src/lib/agent/runtime.ts` gives: a JSON
 * import makes a missing manifest a load-time crash, while a failed read here degrades to "no manifest
 * addresses" and the deployment refuses to spend - which is the safe half of the same event.
 */
export function readManifest(env: NodeJS.ProcessEnv = process.env): GatewayManifest {
  const empty: GatewayManifest = {
    loaded: false,
    path: null,
    chainId: null,
    rpcUrl: null,
    addresses: [],
    humanToken: null,
    agentRegistry: null,
    factory: null,
    vault: null,
    owner: null,
  };

  for (const candidate of manifestCandidates(env)) {
    if (!existsSync(candidate)) {
      continue;
    }
    let parsed: RawManifest;
    try {
      parsed = JSON.parse(readFileSync(candidate, "utf8")) as RawManifest;
    } catch {
      return { ...empty, path: candidate };
    }

    const contracts = parsed.contracts ?? {};
    const addresses = [...new Set(
      Object.values(contracts)
        .map((value) => parseAddress(value))
        .filter((value): value is Address => value !== null),
    )];

    return {
      loaded: addresses.length > 0,
      path: candidate,
      chainId: parsePositiveInt(typeof parsed.network?.chainId === "string" ? parsed.network.chainId : null),
      rpcUrl: typeof parsed.network?.rpcUrl === "string" ? parsed.network.rpcUrl : null,
      addresses,
      humanToken: firstAddress(addressNamed(contracts, "HumanToken"), parsed.tokens?.mHUMAN?.address),
      agentRegistry: addressNamed(contracts, "AIAgentRegistry"),
      factory: addressNamed(contracts, "MaoTangFactory"),
      vault: addressNamed(contracts, "MaoTangSustenanceVault"),
      owner: firstAddress(parsed.owner, parsed.deployer),
    };
  }

  return empty;
}

/**
 * Builds the gateway configuration.
 *
 * `manifestPath` is resolved before the RPC endpoint because the manifest is also the *fallback* for the
 * endpoint and the chain id: the value `deploy-testnet` wrote is a better answer than a hard-coded local
 * default, and an operator's explicit variable beats both.
 */
export function readGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const manifest = readManifest(env);

  const explicitRpc = env.MAOTANG_GATEWAY_RPC_URL?.trim();
  const rpcUrl =
    explicitRpc !== undefined && explicitRpc !== "" ? explicitRpc : (manifest.rpcUrl ?? DEV_FALLBACK_RPC_URL);
  const usingDevFallback = rpcUrl === DEV_FALLBACK_RPC_URL && (explicitRpc === undefined || explicitRpc === "");

  const explicitChainId = parsePositiveInt(env.MAOTANG_GATEWAY_CHAIN_ID ?? null);
  const chainId = explicitChainId ?? manifest.chainId ?? DEV_FALLBACK_CHAIN_ID;

  return {
    host: env.MAOTANG_GATEWAY_HOST?.trim() || DEFAULT_HOST,
    port: parsePositiveInt(env.MAOTANG_GATEWAY_PORT ?? null) ?? DEFAULT_PORT,
    rpcUrl,
    usingDevFallback,
    chainId,
    usingFallbackChainId: explicitChainId === null && manifest.chainId === null,
    manifest,
    maxBodyBytes: parsePositiveInt(env.MAOTANG_GATEWAY_MAX_BODY_BYTES ?? null) ?? DEFAULT_MAX_BODY_BYTES,
    upstreamTimeoutMs:
      parsePositiveInt(env.MAOTANG_GATEWAY_UPSTREAM_TIMEOUT_MS ?? null) ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
    historyDefaultBlocks:
      parsePositiveInt(env.MAOTANG_GATEWAY_HISTORY_BLOCKS ?? null) ?? DEFAULT_HISTORY_BLOCKS,
    historyMaxBlocks: MAX_HISTORY_BLOCKS,
  };
}

/**
 * The endpoint as an operator report may show it.
 *
 * A hosted RPC URL is routinely a secret *in its path* (`https://mainnet.infura.io/v3/<key>`,
 * `https://eth-mainnet.g.alchemy.com/v2/<key>`), so echoing the configured value verbatim into
 * `GET /v1/index` - a route whose whole purpose is to be readable - would put a credential in a log, a
 * screenshot and a support ticket. AGENTS.md's rule is that a token is used and never echoed.
 *
 * The rule here: a URL with no userinfo, no query, no fragment and no path reports itself; anything else
 * reports scheme and host only, and the caller is told it was shortened (`endpointRedacted`). A local
 * `anvil` endpoint - the developer case this whole file defaults to - is therefore shown in full, which is
 * the case where legibility is worth something.
 */
export function redactEndpoint(value: string): { readonly endpoint: string; readonly endpointRedacted: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    // Not a URL at all. Report nothing rather than the raw string, which could be anything.
    return { endpoint: "<unparseable>", endpointRedacted: true };
  }

  const hasSecret =
    parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "";
  const barePath = parsed.pathname === "" || parsed.pathname === "/";
  if (!hasSecret && barePath) {
    return { endpoint: value.trim(), endpointRedacted: false };
  }
  return { endpoint: `${parsed.protocol}//${parsed.host}/...`, endpointRedacted: true };
}