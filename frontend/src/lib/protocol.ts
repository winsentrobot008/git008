import {
  GRADUATION_TARGET_WEI,
  SUSTENANCE_VAULT_SHARE_BPS,
  graduationProgressBps,
  isGraduated,
  type Address,
  type Hex,
} from "@maotang/sdk";

/** Return encoding of a read this board performs. */
export type ReadKind = "uint256" | "address";

/**
 * Zero-argument selectors and return kinds for every read the live panels issue.
 *
 * The SDK ships the human-readable ABI fragments (`maoTangSustenanceVaultAbi`, `maoTangCurveAbi`),
 * but the browser bundle stays dependency-free, so the 4-byte selectors are pinned here rather than
 * pulling an ABI encoder into the client. Each entry is `cast sig` of the signature in the SDK ABI.
 */
export const ZERO_ARG_READS: Record<string, { selector: Hex; kind: ReadKind }> = {
  "calculatePrice()": { selector: "0xd348b409", kind: "uint256" },
  "target()": { selector: "0xd4b83992", kind: "uint256" },
  "token()": { selector: "0xfc0c546a", kind: "address" },
  "nativeFeesReceived()": { selector: "0xe59dac29", kind: "uint256" },
  "availableNative()": { selector: "0xb841a3e8", kind: "uint256" },
};

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
