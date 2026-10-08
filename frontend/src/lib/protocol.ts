import {
  GRADUATION_TARGET_WEI,
  SUSTENANCE_VAULT_SHARE_BPS,
  graduationProgressBps,
  isGraduated,
  type Address,
  type Hex,
} from "@maotang/sdk";

/** Return encoding of a read this board performs. */
export type ReadKind = "uint256" | "address" | "string";

/** ABI type of the single static argument a keyed read is called with, when it takes one. */
export type ReadArg = "uint256" | "address";

/** One read the board issues: its 4-byte selector, its return kind and its optional single argument. */
export interface ReadSpec {
  selector: Hex;
  kind: ReadKind;
  /** Present when the function takes exactly one static argument, which the transport ABI-encodes. */
  arg?: ReadArg;
}

/**
 * Selectors and return kinds for every read the live panels issue.
 *
 * The SDK ships the human-readable ABI fragments (`maoTangSustenanceVaultAbi`, `maoTangCurveAbi`),
 * but the browser bundle stays dependency-free, so the 4-byte selectors are pinned here rather than
 * pulling an ABI encoder into the client. Each entry is `cast sig` of the signature in the SDK ABI,
 * and `arg` is the ABI type of the one argument a keyed read carries.
 *
 * `launchCount` / `launchAt` are the factory's own launch registry. Walking it is what lets the board
 * render the real launches with no indexer, no event replay and no address list to keep in sync.
 */
export const CONTRACT_READS: Record<string, ReadSpec> = {
  "calculatePrice()": { selector: "0xd348b409", kind: "uint256" },
  "target()": { selector: "0xd4b83992", kind: "uint256" },
  "token()": { selector: "0xfc0c546a", kind: "address" },
  "nativeFeesReceived()": { selector: "0xe59dac29", kind: "uint256" },
  "availableNative()": { selector: "0xb841a3e8", kind: "uint256" },
  "launchCount()": { selector: "0x27cca59f", kind: "uint256" },
  "launchAt(uint256)": { selector: "0x7f5780c4", kind: "address", arg: "uint256" },
  "creator()": { selector: "0x02d05d3f", kind: "address" },
  "name()": { selector: "0x06fdde03", kind: "string" },
  "symbol()": { selector: "0x95d89b41", kind: "string" },
};

/** {@link CONTRACT_READS} keyed by bare function name, so a caller passes `launchAt`, not its signature. */
const READ_BY_NAME: Record<string, ReadSpec> = Object.fromEntries(
  Object.entries(CONTRACT_READS).map(([signature, spec]) => [
    signature.slice(0, signature.indexOf("(")),
    spec,
  ]),
);

/** Resolves the spec of a read, or `undefined` when the board has no selector pinned for it. */
export function readSpec(functionName: string): ReadSpec | undefined {
  return READ_BY_NAME[functionName];
}

/** One launch as the board renders it: the on-chain token identity plus the curve numbers. */
export interface LaunchCard {
  /** `MemeToken` address. */
  address: Address;
  /** Bonding curve that prices and holds the token inventory. */
  curve: Address;
  /** Account the factory recorded as the creator. */
  creator: Address;
  name: string;
  symbol: string;
  /** Reserve held by the curve, in wei. */
  reserveWei: bigint;
  /** Spot price in reserve wei per one whole meme token. */
  priceWei: bigint;
}

/** Live revenue accounting of `MaoTangSustenanceVault`. */
export interface VaultStats {
  /** Lifetime native fees received from the 0.5% swap and 1.00% graduation streams. */
  nativeReceived: bigint;
  /** Native fees still awaiting the agent-gated routing call to sovereign wallets. */
  nativeAvailable: bigint;
}

/** Curve numbers the graduation bar renders. */
export interface CurveSnapshot {
  token: Address;
  /** Reserve (native balance) currently held by the curve, in wei. */
  reserve: bigint;
  /** Reserve that graduates the curve, in wei. */
  target: bigint;
  /** Spot price in reserve wei per one whole meme token. */
  price: bigint;
}

/** Progress towards graduation plus the reserve still missing. */
export interface GraduationGap {
  /** Completion in basis points, capped at 10000. */
  progressBps: number;
  /** Reserve still required to graduate, in wei; zero once the target is met. */
  remainingWei: bigint;
  graduated: boolean;
}

/**
 * Percentage completion and the remaining raise.
 *
 * The percentage comes from `graduationProgressBps`, the same helper the contract mirrors, so the bar
 * cannot drift from the on-chain curve math.
 */
export function graduationGap(reserve: bigint, target: bigint = GRADUATION_TARGET_WEI): GraduationGap {
  const progressBps = graduationProgressBps(reserve, target);
  return {
    progressBps,
    remainingWei: reserve >= target ? 0n : target - reserve,
    graduated: isGraduated(reserve, target),
  };
}

/**
 * Share of every collected fee that funds sovereign wallets.
 *
 * Mirrors `SUSTENANCE_VAULT_SHARE_BPS` so the copy on the vault card cannot outlive the policy.
 */
export const SOVEREIGN_SHARE_LABEL = `${Number(SUSTENANCE_VAULT_SHARE_BPS) / 100}%`;
