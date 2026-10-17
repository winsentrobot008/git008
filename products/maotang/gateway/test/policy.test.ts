/**
 * The envelope: the shipped M2 numbers, the manifest-sourced allow-list, and the fail-closed behaviour when
 * there is no manifest at all.
 *
 * The last case is the one that matters most, so it is asserted through the *real* `evaluateIntent` rather
 * than by inspecting the array: a test that only checked `allowedDestinations.length === 0` would pass even
 * if the M2 engine treated an empty allow-list as "no restriction".
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SELECTOR_CLAIM_HUMAN_QUOTA,
  SELECTOR_CREATE_MEME_TOKEN,
  SELECTOR_REGISTER_AGENT,
  SpendWindowLedger,
  evaluateIntent,
} from "@maotang/mobile-agent/dist/signer/index.js";

import type { GatewayManifest } from "../src/config.js";
import { ETH, readManifest } from "../src/config.js";
import {
  DEFAULT_BIOMETRIC_THRESHOLD_WEI,
  DEFAULT_MAX_VALUE_WEI_PER_TRANSACTION,
  DEFAULT_MAX_VALUE_WEI_PER_WINDOW,
  DEFAULT_WINDOW_SECONDS,
  GATEWAY_SELECTORS,
  buildSpendPolicy,
  readPolicyEnvelope,
} from "../src/policy.js";
import { FACTORY, HUMAN_TOKEN, LOCAL_CHAIN_ID, OWNER, STRANGER } from "./helpers/vectors.js";

const EMPTY_MANIFEST: GatewayManifest = {
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

function manifestWith(overrides: Partial<GatewayManifest> = {}): GatewayManifest {
  return { ...EMPTY_MANIFEST, ...overrides };
}

test("the default envelope is the shipped M2 envelope, not a gateway invention", () => {
  const envelope = readPolicyEnvelope({}, EMPTY_MANIFEST);

  assert.equal(envelope.windowSeconds, 86_400, "24h");
  assert.equal(envelope.maxValueWeiPerTransaction, ETH / 10n, "0.1 ETH per transaction");
  assert.equal(envelope.maxValueWeiPerWindow, ETH / 2n, "0.5 ETH per window");
  assert.equal(envelope.biometricThresholdWei, 0n, "every transaction needs a human authorization");
  assert.equal(envelope.requireHardwareBackedAuthorization, true);
});

test("the shipped defaults are exported so a caller can assert them without re-deriving", () => {
  assert.equal(DEFAULT_WINDOW_SECONDS, 86_400);
  assert.equal(DEFAULT_MAX_VALUE_WEI_PER_TRANSACTION, ETH / 10n);
  assert.equal(DEFAULT_MAX_VALUE_WEI_PER_WINDOW, ETH / 2n);
  assert.equal(DEFAULT_BIOMETRIC_THRESHOLD_WEI, 0n);
});

test("the selector allow-list is the three reviewed entry points and cannot be widened by environment", () => {
  const envelope = readPolicyEnvelope(
    { MAOTANG_GATEWAY_POLICY_ALLOW_EXTRA_SELECTORS: "0xdeadbeef" } as NodeJS.ProcessEnv,
    EMPTY_MANIFEST,
  );

  assert.deepEqual(envelope.allowedSelectors, [
    SELECTOR_CLAIM_HUMAN_QUOTA,
    SELECTOR_CREATE_MEME_TOKEN,
    SELECTOR_REGISTER_AGENT,
  ]);
  assert.deepEqual(GATEWAY_SELECTORS, envelope.allowedSelectors);
  assert.equal(envelope.allowedSelectors.includes("0xdeadbeef" as never), false);
});

test("destinations come from the manifest, and the vault is excluded on purpose", () => {
  const envelope = readPolicyEnvelope(
    {},
    manifestWith({
      loaded: true,
      addresses: [HUMAN_TOKEN, FACTORY],
      humanToken: HUMAN_TOKEN,
      factory: FACTORY,
      agentRegistry: "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
      vault: "0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0",
    }),
  );

  assert.deepEqual(envelope.allowedDestinations, [
    FACTORY,
    HUMAN_TOKEN,
    "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512",
  ]);
  assert.equal(
    envelope.allowedDestinations.includes("0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0" as never),
    false,
    "no reviewed selector in this build targets the vault, so allowing it would only widen the set",
  );
  assert.deepEqual(envelope.extraDestinations, []);
});

test("extra destinations are reported as extras, so the widening is visible in the index", () => {
  const envelope = readPolicyEnvelope(
    { MAOTANG_GATEWAY_POLICY_ALLOW_EXTRA_DESTINATIONS: STRANGER },
    manifestWith({ loaded: true, humanToken: HUMAN_TOKEN, factory: FACTORY }),
  );

  assert.deepEqual(envelope.extraDestinations, [STRANGER]);
  assert.equal(envelope.allowedDestinations.includes(STRANGER), true);
});

test("caps are overridable, and a malformed override reads as the shipped default", () => {
  const overridden = readPolicyEnvelope(
    {
      MAOTANG_GATEWAY_POLICY_MAX_VALUE_WEI: "1",
      MAOTANG_GATEWAY_POLICY_WINDOW_WEI: "2",
      MAOTANG_GATEWAY_POLICY_WINDOW_SECONDS: "60",
      MAOTANG_GATEWAY_POLICY_THRESHOLD_WEI: "5",
    },
    EMPTY_MANIFEST,
  );
  assert.equal(overridden.maxValueWeiPerTransaction, 1n);
  assert.equal(overridden.maxValueWeiPerWindow, 2n);
  assert.equal(overridden.windowSeconds, 60);
  assert.equal(overridden.biometricThresholdWei, 5n);

  const malformed = readPolicyEnvelope(
    {
      MAOTANG_GATEWAY_POLICY_MAX_VALUE_WEI: "half an ether",
      MAOTANG_GATEWAY_POLICY_WINDOW_WEI: "-1",
      MAOTANG_GATEWAY_POLICY_WINDOW_SECONDS: "0",
      MAOTANG_GATEWAY_POLICY_THRESHOLD_WEI: "1e18",
    },
    EMPTY_MANIFEST,
  );
  assert.equal(malformed.maxValueWeiPerTransaction, ETH / 10n);
  assert.equal(malformed.maxValueWeiPerWindow, ETH / 2n);
  assert.equal(malformed.windowSeconds, 86_400);
  assert.equal(malformed.biometricThresholdWei, 0n);
});

test("a policy cannot be bound to a chain that is not a positive integer", () => {
  const envelope = readPolicyEnvelope({}, EMPTY_MANIFEST);

  assert.throws(() => buildSpendPolicy(envelope, 0), RangeError);
  assert.throws(() => buildSpendPolicy(envelope, -1), RangeError);
  assert.throws(() => buildSpendPolicy(envelope, 1.5), RangeError);
  assert.equal(buildSpendPolicy(envelope, LOCAL_CHAIN_ID).chainId, LOCAL_CHAIN_ID);
});

test("with no manifest the real policy engine refuses every destination", () => {
  const policy = buildSpendPolicy(readPolicyEnvelope({}, EMPTY_MANIFEST), LOCAL_CHAIN_ID);
  const ledger = new SpendWindowLedger(policy.windowSeconds);

  const decision = evaluateIntent(
    { to: HUMAN_TOKEN, valueWei: 0n, data: "0x", chainId: LOCAL_CHAIN_ID },
    policy,
    ledger,
    1_700_000_000,
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false ? decision.code : "", "DESTINATION_NOT_ALLOWED");
  assert.deepEqual(policy.allowedDestinations, []);
});

test("a manifest-backed policy allows the claim leg and refuses a stranger", () => {
  const policy = buildSpendPolicy(
    readPolicyEnvelope({}, manifestWith({ loaded: true, humanToken: HUMAN_TOKEN, factory: FACTORY })),
    LOCAL_CHAIN_ID,
  );

  const allowed = evaluateIntent(
    { to: HUMAN_TOKEN, valueWei: 0n, data: "0x3e958aad", chainId: LOCAL_CHAIN_ID },
    policy,
    new SpendWindowLedger(policy.windowSeconds),
    1_700_000_000,
  );
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.allowed === true ? allowed.requiresAuthorization : null, true, "threshold 0 demands an authorization");
  assert.equal(allowed.allowed === true ? allowed.selector : null, SELECTOR_CLAIM_HUMAN_QUOTA);

  const refused = evaluateIntent(
    { to: STRANGER, valueWei: 0n, data: "0x", chainId: LOCAL_CHAIN_ID },
    policy,
    new SpendWindowLedger(policy.windowSeconds),
    1_700_000_000,
  );
  assert.equal(refused.allowed, false);
  assert.equal(refused.allowed === false ? refused.code : "", "DESTINATION_NOT_ALLOWED");
});

test("the policy refuses the wrong chain rather than warning about it", () => {
  const policy = buildSpendPolicy(
    readPolicyEnvelope({}, manifestWith({ loaded: true, humanToken: HUMAN_TOKEN })),
    LOCAL_CHAIN_ID,
  );

  const decision = evaluateIntent(
    { to: HUMAN_TOKEN, valueWei: 0n, data: "0x", chainId: 1 },
    policy,
    new SpendWindowLedger(policy.windowSeconds),
    1_700_000_000,
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.allowed === false ? decision.code : "", "CHAIN_MISMATCH");
});

test("the manifest reader is what feeds the envelope, end to end", () => {
  const envelope = readPolicyEnvelope(
    {
      MAOTANG_GATEWAY_MANIFEST_PATH: "D:/definitely/not/here/contracts.json",
    },
    readManifest({ MAOTANG_GATEWAY_MANIFEST_PATH: "D:/definitely/not/here/contracts.json" }),
  );

  assert.deepEqual(envelope.allowedDestinations, []);
  assert.deepEqual(envelope.extraDestinations, []);
  assert.equal(envelope.maxValueWeiPerTransaction, ETH / 10n);
  void OWNER;
});