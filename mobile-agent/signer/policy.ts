/**
 * Fail-closed spend policy for the M2 autonomous wallet.
 *
 * Every branch here is written so that the *absence* of information denies the action: a missing
 * allow-list entry, an unparsable field, a `null` policy or a chain-id mismatch all resolve to a
 * refusal carrying a machine-readable {@link PolicyDenialCode}. The wallet releases a signature only
 * behind an `allowed: true` decision, so this file is the single place where "the agent may spend" is
 * decided - which is what makes it testable.
 *
 * Two boundaries are deliberate and are asserted in the tests, because an off-by-one in either is a
 * silent grant of authority:
 *
 *   - caps are **inclusive**: a value exactly equal to `maxValueWeiPerTransaction` is allowed, one wei
 *     more is refused;
 *   - the authorization threshold is **inclusive**: a value at or above `biometricThresholdWei`
 *     requires a human authorization, so a threshold of `0n` demands one for every transaction.
 */

import { isAddress, isHex, type Address, type Hex } from "./types.js";

/**
 * Why a transaction was refused. Stable strings: they are logged and asserted, not shown to users.
 *
 * The two `AUTHORIZATION_*` codes are raised by the wallet *after* an intent has been allowed, when the
 * grant it was handed does not satisfy the policy. They are refusals to release a signature, never
 * refusals of the intent itself.
 */
export type PolicyDenialCode =
  | "POLICY_MISSING"
  | "MALFORMED_INTENT"
  | "CHAIN_MISMATCH"
  | "DESTINATION_NOT_ALLOWED"
  | "SELECTOR_NOT_ALLOWED"
  | "VALUE_CAP_EXCEEDED"
  | "WINDOW_CAP_EXCEEDED"
  | "AUTHORIZATION_CHALLENGE_MISMATCH"
  | "AUTHORIZATION_NOT_HARDWARE_BACKED";

/** Result of evaluating one intent. `allowed` is the only shape the wallet will sign behind. */
export type PolicyDecision =
  | {
      readonly allowed: true;
      /** True when this value is at or above the policy threshold and needs a human authorization. */
      readonly requiresAuthorization: boolean;
      /** Selector of the call, or `null` for a plain value transfer. */
      readonly selector: Hex | null;
      readonly remainingWindowWei: bigint;
    }
  | { readonly allowed: false; readonly code: PolicyDenialCode; readonly reason: string };

/**
 * The owner-defined envelope the agent may act inside.
 *
 * `allowedDestinations` and `allowedSelectors` are allow-lists, never deny-lists: an empty list refuses
 * everything rather than permitting everything, so an unconfigured policy cannot spend.
 */
export interface SpendPolicy {
  /** Chain the wallet is allowed to sign for. A different chain is refused, not warned about. */
  readonly chainId: number;
  /** Inclusive per-transaction native value cap, in wei. */
  readonly maxValueWeiPerTransaction: bigint;
  /** Inclusive native value cap across one rolling window, in wei. */
  readonly maxValueWeiPerWindow: bigint;
  /** Length of the rolling window, in seconds. */
  readonly windowSeconds: number;
  /** Lowercase allow-list of destinations. An empty list refuses every destination. */
  readonly allowedDestinations: readonly Address[];
  /** Lowercase allow-list of 4-byte selectors. An empty list refuses every contract call. */
  readonly allowedSelectors: readonly Hex[];
  /** Inclusive threshold at or above which a human authorization is required. */
  readonly biometricThresholdWei: bigint;
  /** When true, an authorization that is not hardware backed is refused outright. */
  readonly requireHardwareBackedAuthorization: boolean;
}

/** The subset of a transaction the evaluation needs. A full intent is structurally compatible. */
export interface IntentLike {
  readonly to: string;
  readonly valueWei: bigint;
  readonly data: string;
  readonly chainId: number;
}

/** Rolling spend window, pure with respect to time so tests can pin the clock. */
export interface SpendWindowSnapshot {
  readonly windowStartSeconds: number;
  readonly spentWei: bigint;
  readonly windowSeconds: number;
}

/**
 * Tracks native value spent inside a rolling window.
 *
 * Time is an explicit argument rather than a hidden `Date.now()`: the repo already pins clocks in the
 * Foundry tests and injects `now` in the telemetry collector, and a ledger that reads the wall clock
 * internally cannot be tested at a window boundary.
 */
export class SpendWindowLedger {
  readonly #windowSeconds: number;
  #windowStartSeconds = 0;
  #spentWei = 0n;

  constructor(windowSeconds: number) {
    if (!Number.isSafeInteger(windowSeconds) || windowSeconds <= 0) {
      throw new RangeError(`windowSeconds must be a positive integer, got ${windowSeconds}`);
    }
    this.#windowSeconds = windowSeconds;
  }

  /** Rolls the window forward if `nowSeconds` is past its end, then reports the total spent. */
  spentAt(nowSeconds: number): bigint {
    this.#roll(nowSeconds);
    return this.#spentWei;
  }

  /** Records a spend, rolling the window first so a new window starts clean. */
  record(amountWei: bigint, nowSeconds: number): void {
    if (amountWei < 0n) {
      throw new RangeError("cannot record a negative spend");
    }
    this.#roll(nowSeconds);
    this.#spentWei += amountWei;
  }

  snapshot(nowSeconds: number): SpendWindowSnapshot {
    this.#roll(nowSeconds);
    return { windowStartSeconds: this.#windowStartSeconds, spentWei: this.#spentWei, windowSeconds: this.#windowSeconds };
  }

  #roll(nowSeconds: number): void {
    if (this.#windowStartSeconds === 0) {
      this.#windowStartSeconds = nowSeconds;
      return;
    }
    if (nowSeconds >= this.#windowStartSeconds + this.#windowSeconds) {
      this.#windowStartSeconds = nowSeconds;
      this.#spentWei = 0n;
    }
  }
}

/** Selector of a call, or `null` for a plain value transfer. Malformed calldata is a refusal. */
export function selectorOf(data: string): Hex | null | "malformed" {
  if (data === "0x" || data === "") {
    return null;
  }
  if (!isHex(data) || data.length < 10) {
    return "malformed";
  }
  return data.slice(0, 10) as Hex;
}

/**
 * Evaluates one intent against the policy. Refusals are values, not exceptions, so a caller can log or
 * surface them; the wallet turns a refusal into a thrown {@link PolicyViolationError}.
 */
export function evaluateIntent(
  intent: IntentLike,
  policy: SpendPolicy | null | undefined,
  ledger: SpendWindowLedger,
  nowSeconds: number,
): PolicyDecision {
  if (policy === null || policy === undefined) {
    return { allowed: false, code: "POLICY_MISSING", reason: "no spend policy is configured, which denies everything" };
  }

  const to = typeof intent.to === "string" ? intent.to.trim().toLowerCase() : "";
  if (!isAddress(to)) {
    return { allowed: false, code: "MALFORMED_INTENT", reason: `destination is not a 20-byte hex address: ${String(intent.to)}` };
  }
  if (typeof intent.valueWei !== "bigint" || intent.valueWei < 0n) {
    return { allowed: false, code: "MALFORMED_INTENT", reason: "valueWei must be a non-negative bigint" };
  }
  if (!Number.isSafeInteger(intent.chainId)) {
    return { allowed: false, code: "MALFORMED_INTENT", reason: "chainId must be an integer" };
  }
  const selector = selectorOf(intent.data);
  if (selector === "malformed") {
    return { allowed: false, code: "MALFORMED_INTENT", reason: "calldata is neither empty nor even-length hex with a selector" };
  }

  if (intent.chainId !== policy.chainId) {
    return { allowed: false, code: "CHAIN_MISMATCH", reason: `policy is bound to chain ${policy.chainId}, intent targets ${intent.chainId}` };
  }

  const allowList = policy.allowedDestinations.map((value) => value.toLowerCase());
  if (!allowList.includes(to)) {
    return { allowed: false, code: "DESTINATION_NOT_ALLOWED", reason: `${to} is not in the destination allow-list (${allowList.length} entries)` };
  }

  if (selector !== null) {
    const selectors = policy.allowedSelectors.map((value) => value.toLowerCase());
    if (!selectors.includes(selector)) {
      return { allowed: false, code: "SELECTOR_NOT_ALLOWED", reason: `${selector} is not in the selector allow-list (${selectors.length} entries)` };
    }
  }

  if (intent.valueWei > policy.maxValueWeiPerTransaction) {
    return { allowed: false, code: "VALUE_CAP_EXCEEDED", reason: `value ${intent.valueWei} exceeds the per-transaction cap ${policy.maxValueWeiPerTransaction}` };
  }

  const spent = ledger.spentAt(nowSeconds);
  if (spent + intent.valueWei > policy.maxValueWeiPerWindow) {
    return { allowed: false, code: "WINDOW_CAP_EXCEEDED", reason: `value ${intent.valueWei} on top of ${spent} spent exceeds the window cap ${policy.maxValueWeiPerWindow}` };
  }

  return {
    allowed: true,
    requiresAuthorization: intent.valueWei >= policy.biometricThresholdWei,
    selector,
    remainingWindowWei: policy.maxValueWeiPerWindow - spent - intent.valueWei,
  };
}

/** Thrown by the wallet when a policy refuses an intent, or when an authorization is not acceptable. */
export class PolicyViolationError extends Error {
  readonly code: PolicyDenialCode;

  constructor(code: PolicyDenialCode, reason: string) {
    super(`${code}: ${reason}`);
    this.name = "PolicyViolationError";
    this.code = code;
  }
}
