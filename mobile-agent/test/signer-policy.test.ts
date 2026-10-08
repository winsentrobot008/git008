/**
 * The spend policy is the single place where "the agent may spend" is decided, so every refusal path is
 * asserted here rather than assumed. The two boundaries that matter most are inclusive by design and are
 * pinned explicitly: a value exactly at a cap is allowed, one wei more is not, and a value exactly at the
 * authorization threshold requires a human.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PolicyViolationError,
  SpendWindowLedger,
  evaluateIntent,
  selectorOf,
  type IntentLike,
  type PolicyDenialCode,
  type SpendPolicy,
} from "../signer/policy.js";
import type { Address, Hex } from "../signer/types.js";

const CHAIN_ID = 31337;
const FACTORY = "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853" as Address;
const CURVE = "0x9bd03768a7dcc129555de410ff8e85528a4f88b5" as Address;
const STRANGER = "0x00000000000000000000000000000000000000ff" as Address;
const CREATE_SELECTOR = "0x5cc3c5b2" as Hex;
const CLAIM_SELECTOR = "0x3e958aad" as Hex;
const ETH = 10n ** 18n;

function policy(overrides: Partial<SpendPolicy> = {}): SpendPolicy {
  return {
    chainId: CHAIN_ID,
    maxValueWeiPerTransaction: 1n * ETH,
    maxValueWeiPerWindow: 3n * ETH,
    windowSeconds: 3600,
    allowedDestinations: [FACTORY],
    allowedSelectors: [CREATE_SELECTOR],
    biometricThresholdWei: ETH / 2n,
    requireHardwareBackedAuthorization: false,
    ...overrides,
  };
}

function intent(overrides: Partial<IntentLike> = {}): IntentLike {
  return { to: FACTORY, valueWei: 0n, data: `${CREATE_SELECTOR}${"0".repeat(64)}`, chainId: CHAIN_ID, ...overrides };
}

function decide(overrides: Partial<IntentLike> = {}, policyOverrides: Partial<SpendPolicy> = {}, nowSeconds = 1_700_000_000) {
  const spendPolicy = policy(policyOverrides);
  return evaluateIntent(intent(overrides), spendPolicy, new SpendWindowLedger(spendPolicy.windowSeconds), nowSeconds);
}

/** Asserts a refusal code, and that the reason string names something a log reader can act on. */
function assertDenied(decision: ReturnType<typeof decide>, code: PolicyDenialCode): void {
  assert.equal(decision.allowed, false);
  if (decision.allowed) {
    return;
  }
  assert.equal(decision.code, code);
  assert.ok(decision.reason.length > 10, "a refusal must explain itself");
}

test("an allow-listed call inside every cap is allowed and reports what it decided", () => {
  const decision = decide({ valueWei: ETH / 10n });
  assert.equal(decision.allowed, true);
  if (!decision.allowed) {
    return;
  }
  assert.equal(decision.selector, CREATE_SELECTOR);
  assert.equal(decision.requiresAuthorization, false);
  assert.equal(decision.remainingWindowWei, 3n * ETH - ETH / 10n);
});

test("a missing policy denies everything rather than defaulting to permissive", () => {
  const ledger = new SpendWindowLedger(3600);
  assertDenied(evaluateIntent(intent(), null, ledger, 1), "POLICY_MISSING");
  assertDenied(evaluateIntent(intent(), undefined, ledger, 1), "POLICY_MISSING");
});

test("malformed intents are refused instead of coerced", () => {
  assertDenied(decide({ to: "0xnothex" }), "MALFORMED_INTENT");
  assertDenied(decide({ to: "0xa513e6e4b8f2a923d98304ec87f64353c4d5c85" }), "MALFORMED_INTENT");
  assertDenied(decide({ valueWei: -1n }), "MALFORMED_INTENT");
  assertDenied(decide({ chainId: 31337.5 }), "MALFORMED_INTENT");
  assertDenied(decide({ data: "0x1234" }), "MALFORMED_INTENT");
  assertDenied(decide({ data: "0x1234567" }), "MALFORMED_INTENT");
  assertDenied(decide({ data: "nothex" }), "MALFORMED_INTENT");
});

test("a chain-id mismatch is a refusal, not a warning", () => {
  assertDenied(decide({ chainId: 1 }), "CHAIN_MISMATCH");
});

test("the destination allow-list is closed by default", () => {
  assertDenied(decide({ to: STRANGER }), "DESTINATION_NOT_ALLOWED");
  assertDenied(decide({}, { allowedDestinations: [] }), "DESTINATION_NOT_ALLOWED");
});

test("the destination allow-list tolerates checksum casing but not a different address", () => {
  const checksummed = "0xA513E6E4b8f2a923D98304ec87F64353C4D5C853";
  assert.equal(decide({ to: checksummed }).allowed, true);
  assertDenied(decide({ to: CURVE }), "DESTINATION_NOT_ALLOWED");
});

test("the selector allow-list is closed by default, and a plain transfer skips it", () => {
  assertDenied(decide({ data: CLAIM_SELECTOR }), "SELECTOR_NOT_ALLOWED");
  assertDenied(decide({}, { allowedSelectors: [] }), "SELECTOR_NOT_ALLOWED");
  const transfer = decide({ data: "0x" }, { allowedSelectors: [] });
  assert.equal(transfer.allowed, true);
  if (transfer.allowed) {
    assert.equal(transfer.selector, null);
  }
});

test("the per-transaction cap is inclusive", () => {
  assert.equal(decide({ valueWei: ETH }).allowed, true, "exactly the cap is allowed");
  assertDenied(decide({ valueWei: ETH + 1n }), "VALUE_CAP_EXCEEDED");
});

test("the rolling-window cap is inclusive and counts earlier spends", () => {
  const spendPolicy = policy();
  const ledger = new SpendWindowLedger(spendPolicy.windowSeconds);
  const now = 1_700_000_000;
  ledger.record(2n * ETH, now);

  const exact = evaluateIntent(intent({ valueWei: ETH }), spendPolicy, ledger, now);
  assert.equal(exact.allowed, true);
  if (exact.allowed) {
    assert.equal(exact.remainingWindowWei, 0n, "the window is exactly exhausted");
  }

  // One wei more, against a window that is already full, is the refusal this cap exists for.
  const full = new SpendWindowLedger(spendPolicy.windowSeconds);
  full.record(3n * ETH, now);
  assert.equal(evaluateIntent(intent({ valueWei: 0n }), spendPolicy, full, now).allowed, true, "a zero-value call still fits");
  assertDenied(evaluateIntent(intent({ valueWei: 1n }), spendPolicy, full, now), "WINDOW_CAP_EXCEEDED");
});

test("a window rolls over and forgets the previous spend at exactly windowSeconds", () => {
  const spendPolicy = policy();
  const ledger = new SpendWindowLedger(spendPolicy.windowSeconds);
  const now = 1_700_000_000;
  ledger.record(3n * ETH, now);
  assert.equal(ledger.spentAt(now + 3599), 3n * ETH, "still inside the window");
  assert.equal(ledger.spentAt(now + 3600), 0n, "the window boundary clears the ledger");
  assert.equal(evaluateIntent(intent({ valueWei: ETH }), spendPolicy, ledger, now + 3600).allowed, true);
});

test("the authorization threshold is inclusive at both ends", () => {
  const at = decide({ valueWei: ETH / 2n });
  assert.equal(at.allowed, true);
  if (at.allowed) {
    assert.equal(at.requiresAuthorization, true, "exactly at the threshold needs a human");
  }
  const below = decide({ valueWei: ETH / 2n - 1n });
  assert.equal(below.allowed, true);
  if (below.allowed) {
    assert.equal(below.requiresAuthorization, false);
  }
  const zeroThreshold = decide({ valueWei: 0n }, { biometricThresholdWei: 0n });
  assert.equal(zeroThreshold.allowed, true);
  if (zeroThreshold.allowed) {
    assert.equal(zeroThreshold.requiresAuthorization, true, "a zero threshold demands authorization for everything");
  }
});

test("selectorOf distinguishes a transfer, a call and malformed calldata", () => {
  assert.equal(selectorOf("0x"), null);
  assert.equal(selectorOf(""), null);
  assert.equal(selectorOf(`${CREATE_SELECTOR}deadbeef`), CREATE_SELECTOR);
  assert.equal(selectorOf("0x1234"), "malformed");
  assert.equal(selectorOf("0x1234567"), "malformed");
});

test("the ledger refuses a window that cannot roll and a negative spend", () => {
  assert.throws(() => new SpendWindowLedger(0), RangeError);
  assert.throws(() => new SpendWindowLedger(-1), RangeError);
  assert.throws(() => new SpendWindowLedger(1.5), RangeError);
  assert.throws(() => new SpendWindowLedger(60).record(-1n, 1), RangeError);
});

test("the ledger starts its window at the first observation, so a snapshot is meaningful before any spend", () => {
  const ledger = new SpendWindowLedger(600);
  assert.deepEqual(ledger.snapshot(1_000), { windowStartSeconds: 1_000, spentWei: 0n, windowSeconds: 600 });
});

test("PolicyViolationError carries the machine-readable code", () => {
  const error = new PolicyViolationError("VALUE_CAP_EXCEEDED", "too much");
  assert.equal(error.name, "PolicyViolationError");
  assert.equal(error.code, "VALUE_CAP_EXCEEDED");
  assert.match(error.message, /^VALUE_CAP_EXCEEDED: too much$/);
  assert.ok(error instanceof Error);
});
