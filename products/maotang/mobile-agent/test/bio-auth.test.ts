/**
 * M5: the biometric channel and the nullifier layer.
 *
 * Two properties carry the module. First, no build gets a working biometric gate by accident - the device
 * gate refuses, the simulation has to be opted into, and a simulated assertion can never claim hardware
 * backing. Second, an approval is only usable for the exact digest it was given, which is what stops a
 * captured FaceID tap from releasing a different transaction.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BiometricAuthorizationGate,
  BiometricDeniedError,
  BiometricUnavailableError,
  DeviceBiometricGate,
  HardwareNullifierRegistry,
  NullifierFormatError,
  NullifierReplayError,
  SimulatedBiometricGate,
  deriveHardwareNullifier,
  isCanonicalNullifier,
  reduceToScalar,
  type BiometricAssertion,
  type BiometricGate,
  type BiometricRequest,
} from "../bio-auth/index.js";
import { SCALAR_FIELD } from "../shared/bn254.js";
import type { Address, AuthorizationRequest, Hex } from "../signer/types.js";

const NOW = 1_700_000_000;
const OWNER_KEY = "maotang.test.owner";
const FACTORY = "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853" as Address;
const CHALLENGE = `0x${"ab".repeat(32)}` as Hex;
const OTHER_CHALLENGE = `0x${"cd".repeat(32)}` as Hex;

/** TEST ONLY derivation material. Not a key, but it is fixed so the expected digest stays reproducible. */
const TEST_SEED = {
  hardwareIdHex: `0x${"aa".repeat(32)}` as Hex,
  enrollmentSaltHex: `0x${"bb".repeat(32)}` as Hex,
  epoch: 0,
};

/** TEST ONLY: a scripted authenticator, so binding and freshness can be driven without a device. */
class ScriptedGate implements BiometricGate {
  readonly mode = "simulated" as const;
  readonly kind = "software-simulation" as const;
  calls = 0;
  lastRequest: BiometricRequest | null = null;
  readonly #assertion: { grantedAt: number; challenge: Hex; keyId: string; hardwareBacked: boolean };

  constructor(options: { grantedAt?: number; challenge?: Hex; keyId?: string; hardwareBacked?: boolean } = {}) {
    this.#assertion = {
      grantedAt: options.grantedAt ?? NOW,
      challenge: options.challenge ?? CHALLENGE,
      keyId: options.keyId ?? OWNER_KEY,
      hardwareBacked: options.hardwareBacked ?? false,
    };
  }

  async isEnrolled(): Promise<boolean> {
    return true;
  }

  async enroll(): Promise<void> {}

  async revoke(): Promise<void> {}

  async authenticate(request: BiometricRequest): Promise<BiometricAssertion> {
    this.calls += 1;
    this.lastRequest = request;
    return {
      keyId: this.#assertion.keyId,
      challenge: this.#assertion.challenge,
      method: this.#assertion.hardwareBacked ? "biometric" : "simulated",
      hardwareBacked: this.#assertion.hardwareBacked,
      grantedAt: this.#assertion.grantedAt,
      detail: "test-only scripted assertion",
    };
  }
}

function biometricRequest(overrides: Partial<BiometricRequest> = {}): BiometricRequest {
  return {
    keyId: OWNER_KEY,
    purpose: "authorize-intent",
    challenge: CHALLENGE,
    reason: "claim quota",
    to: FACTORY,
    valueWei: 0n,
    selector: null,
    ...overrides,
  };
}

function authorizationRequest(overrides: Partial<AuthorizationRequest> = {}): AuthorizationRequest {
  return {
    keyId: OWNER_KEY,
    reason: "claim quota",
    challenge: CHALLENGE,
    to: FACTORY,
    valueWei: 0n,
    selector: null,
    ...overrides,
  };
}

test("the device gate refuses every operation and names the platform API", async () => {
  const gate = new DeviceBiometricGate();
  assert.equal(gate.mode, "device");
  assert.equal(gate.kind, "secure-enclave");
  await assert.rejects(gate.isEnrolled(), BiometricUnavailableError);
  await assert.rejects(gate.enroll(), BiometricUnavailableError);
  await assert.rejects(gate.revoke(), BiometricUnavailableError);
  await assert.rejects(gate.authenticate(biometricRequest()), (error: unknown) => {
    assert.ok(error instanceof BiometricUnavailableError);
    assert.match(error.message, /LAContext|BiometricPrompt|WebAuthn/);
    return true;
  });
});

test("the simulated channel refuses until the host opts in explicitly", async () => {
  const disabled = new SimulatedBiometricGate();
  await assert.rejects(disabled.isEnrolled(), BiometricUnavailableError);
  await assert.rejects(disabled.enroll(), BiometricUnavailableError);
  await assert.rejects(disabled.authenticate(biometricRequest()), (error: unknown) => {
    assert.ok(error instanceof BiometricUnavailableError);
    assert.match(error.message, /enabled: true/);
    return true;
  });
});

test("enrolment is required before any assertion", async () => {
  const gate = new SimulatedBiometricGate({ enabled: true, now: () => NOW });
  assert.equal(await gate.isEnrolled(), false);
  await assert.rejects(gate.authenticate(biometricRequest()), BiometricDeniedError);
  await gate.enroll();
  assert.equal(await gate.isEnrolled(), true);

  const assertion = await gate.authenticate(biometricRequest());
  assert.equal(assertion.challenge, CHALLENGE, "the assertion echoes the challenge it was asked about");
  assert.equal(assertion.method, "simulated");
  assert.equal(assertion.hardwareBacked, false, "a simulation may never claim hardware backing");
  assert.equal(assertion.grantedAt, NOW);

  await gate.revoke();
  await assert.rejects(gate.authenticate(biometricRequest()), BiometricDeniedError);
});

test("a cancelled prompt is a denial, not an assertion", async () => {
  const gate = new SimulatedBiometricGate({ enabled: true, behaviour: "deny" });
  await gate.enroll();
  await assert.rejects(gate.authenticate(biometricRequest()), BiometricDeniedError);
});

test("the simulated channel refuses to run in production without an explicit override", () => {
  assert.throws(
    () => new SimulatedBiometricGate({ enabled: true, nodeEnv: "production" }),
    BiometricUnavailableError,
  );
  assert.ok(new SimulatedBiometricGate({ enabled: true, nodeEnv: "production", allowInProduction: true }));
  assert.ok(new SimulatedBiometricGate({ enabled: true, nodeEnv: "test" }));
});

test("a challenge that is not a 32-byte digest is refused before any device call", async () => {
  const gate = new SimulatedBiometricGate({ enabled: true });
  await gate.enroll();
  await assert.rejects(gate.authenticate(biometricRequest({ challenge: "0x1234" })), BiometricDeniedError);

  const scripted = new ScriptedGate();
  const adapter = new BiometricAuthorizationGate({ gate: scripted, now: () => NOW });
  await assert.rejects(adapter.authorize(authorizationRequest({ challenge: "0x1234" })), BiometricDeniedError);
  assert.equal(scripted.calls, 0, "a malformed challenge must never reach the authenticator");
});

test("the adapter binds the grant to the request challenge and passes the prompt through", async () => {
  const gate = new ScriptedGate({ hardwareBacked: true });
  const adapter = new BiometricAuthorizationGate({ gate, now: () => NOW });
  const grant = await adapter.authorize(authorizationRequest());

  assert.equal(grant.challenge, CHALLENGE);
  assert.equal(grant.keyId, OWNER_KEY);
  assert.equal(grant.hardwareBacked, true);
  assert.equal(grant.method, "biometric");
  assert.equal(gate.lastRequest?.purpose, "authorize-intent");
  assert.equal(gate.lastRequest?.reason, "claim quota");
  assert.equal(gate.lastRequest?.to, FACTORY);
});

test("the adapter refuses an assertion bound to a different challenge or key", async () => {
  const mismatch = new BiometricAuthorizationGate({
    gate: new ScriptedGate({ challenge: OTHER_CHALLENGE }),
    now: () => NOW,
  });
  await assert.rejects(mismatch.authorize(authorizationRequest()), (error: unknown) => {
    assert.ok(error instanceof BiometricDeniedError);
    assert.match(error.message, /refusing to reuse an approval/);
    return true;
  });

  const wrongKey = new BiometricAuthorizationGate({ gate: new ScriptedGate({ keyId: "other-key" }), now: () => NOW });
  await assert.rejects(wrongKey.authorize(authorizationRequest()), BiometricDeniedError);
});

test("the adapter enforces freshness with an inclusive age boundary", async () => {
  const at = (grantedAt: number) => new BiometricAuthorizationGate({ gate: new ScriptedGate({ grantedAt }), now: () => NOW, maxAssertionAgeSeconds: 120 });
  assert.equal((await at(NOW - 120).authorize(authorizationRequest())).grantedAt, NOW - 120, "exactly at the limit is still fresh");
  await assert.rejects(at(NOW - 121).authorize(authorizationRequest()), BiometricDeniedError);
  await assert.rejects(at(NOW + 6).authorize(authorizationRequest()), BiometricDeniedError);
  assert.equal((await at(NOW + 5).authorize(authorizationRequest())).grantedAt, NOW + 5, "skew of 5s is tolerated");
  await assert.rejects(at(NOW + 0.5).authorize(authorizationRequest()), BiometricDeniedError);
});

test("the adapter refuses an assertion whose clock field is not an integer", async () => {
  const gate = new SimulatedBiometricGate({ enabled: true, now: () => 0.5 });
  await gate.enroll();
  await assert.rejects(new BiometricAuthorizationGate({ gate, now: () => NOW }).authorize(authorizationRequest()), BiometricDeniedError);
});

test("the adapter refuses an unusable max assertion age", () => {
  assert.throws(() => new BiometricAuthorizationGate({ gate: new ScriptedGate(), maxAssertionAgeSeconds: 0 }), RangeError);
  assert.throws(() => new BiometricAuthorizationGate({ gate: new ScriptedGate(), maxAssertionAgeSeconds: -5 }), RangeError);
});

test("nullifier derivation is deterministic and domain-separated", () => {
  const base = deriveHardwareNullifier(TEST_SEED);
  assert.equal(deriveHardwareNullifier({ ...TEST_SEED }), base);
  assert.equal((base.length - 2) / 2, 32);
  assert.equal(isCanonicalNullifier(base), true);

  const otherEpoch = deriveHardwareNullifier({ ...TEST_SEED, epoch: 1 });
  const otherSalt = deriveHardwareNullifier({ ...TEST_SEED, enrollmentSaltHex: `0x${"cc".repeat(32)}` as Hex });
  const otherHardware = deriveHardwareNullifier({ ...TEST_SEED, hardwareIdHex: `0x${"dd".repeat(32)}` as Hex });
  const withOwner = deriveHardwareNullifier({ ...TEST_SEED, ownerCommitment: `0x${"ee".repeat(32)}` as Hex });
  const withSameOwner = deriveHardwareNullifier({ ...TEST_SEED, ownerCommitment: `0x${"ee".repeat(32)}` as Hex });
  assert.equal(withOwner, withSameOwner);

  for (const [label, value] of [["epoch", otherEpoch], ["salt", otherSalt], ["hardware", otherHardware], ["owner", withOwner]] as const) {
    assert.notEqual(value, base, `changing ${label} must derive a different nullifier`);
  }
});

test("nullifier derivation refuses material too short to be an identity", () => {
  assert.throws(() => deriveHardwareNullifier({ ...TEST_SEED, hardwareIdHex: "0x1122" }), NullifierFormatError);
  assert.throws(() => deriveHardwareNullifier({ ...TEST_SEED, enrollmentSaltHex: "0x1122" }), NullifierFormatError);
  assert.throws(() => deriveHardwareNullifier({ ...TEST_SEED, hardwareIdHex: "nothex" as Hex }), NullifierFormatError);
  assert.throws(() => deriveHardwareNullifier({ ...TEST_SEED, epoch: -1 }), NullifierFormatError);
  assert.throws(() => deriveHardwareNullifier({ ...TEST_SEED, epoch: 1.5 }), NullifierFormatError);
  assert.throws(
    () => deriveHardwareNullifier({ ...TEST_SEED, ownerCommitment: `0x${"ee".repeat(31)}` as Hex }),
    NullifierFormatError,
  );
});

test("reduceToScalar maps a digest into the field and refuses zero", () => {
  const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}` as Hex;
  assert.equal(reduceToScalar(word(1n)), word(1n));
  assert.equal(reduceToScalar(word(SCALAR_FIELD - 1n)), word(SCALAR_FIELD - 1n), "the largest legal scalar passes through");
  assert.equal(reduceToScalar(word(SCALAR_FIELD + 1n)), word(1n), "a value above the field reduces, as modular arithmetic does");
  assert.throws(() => reduceToScalar(word(0n)), NullifierFormatError, "zero is rejected by HumanToken");
  assert.throws(() => reduceToScalar(word(SCALAR_FIELD)), NullifierFormatError, "the modulus reduces to zero");
  assert.throws(() => reduceToScalar(word(2n * SCALAR_FIELD)), NullifierFormatError);
  assert.throws(() => reduceToScalar("0x1234" as Hex), NullifierFormatError, "a short word is not a digest");
  assert.throws(() => reduceToScalar("zznothex" as Hex), NullifierFormatError);
});

test("isCanonicalNullifier accepts a derived nullifier and rejects zero or a short word", () => {
  assert.equal(isCanonicalNullifier(deriveHardwareNullifier(TEST_SEED)), true);
  assert.equal(isCanonicalNullifier(`0x${"0".repeat(64)}`), false);
  assert.equal(isCanonicalNullifier("0xabc"), false);
  assert.equal(isCanonicalNullifier(undefined), false);
  assert.equal(isCanonicalNullifier(1234), false);
});

test("the registry blocks a second claim of the same nullifier", () => {
  const registry = new HardwareNullifierRegistry();
  const nullifier = deriveHardwareNullifier(TEST_SEED);
  assert.equal(registry.stateOf(nullifier), "unseen");
  assert.equal(registry.isSpent(nullifier), false);

  registry.reserve(nullifier, NOW, "claim");
  assert.equal(registry.stateOf(nullifier), "pending");
  assert.equal(registry.isSpent(nullifier), true);
  assert.throws(() => registry.reserve(nullifier, NOW + 1), (error: unknown) => {
    assert.ok(error instanceof NullifierReplayError, `expected a replay error, got ${String(error)}`);
    assert.equal(error.state, "pending");
    assert.match(error.message, /QuotaAlreadyClaimed/);
    return true;
  });

  registry.consume(nullifier, NOW + 2, "mined");
  assert.equal(registry.stateOf(nullifier), "consumed");
  assert.throws(() => registry.reserve(nullifier, NOW + 3), NullifierReplayError);
  assert.throws(() => registry.consume(nullifier, NOW + 4), NullifierReplayError);
});

test("the registry releases a dropped transaction but never a consumed nullifier", () => {
  const registry = new HardwareNullifierRegistry();
  const nullifier = deriveHardwareNullifier(TEST_SEED);
  registry.reserve(nullifier, NOW);
  registry.release(nullifier);
  assert.equal(registry.stateOf(nullifier), "unseen");

  registry.reserve(nullifier, NOW);
  registry.consume(nullifier, NOW + 1);
  assert.throws(() => registry.release(nullifier), (error: unknown) => {
    assert.ok(error instanceof NullifierReplayError);
    assert.equal(error.state, "consumed");
    return true;
  });
  assert.equal(registry.stateOf(nullifier), "consumed", "the record survives a failed release");
});

test("the registry reconciles a claim it only saw on chain", () => {
  const registry = new HardwareNullifierRegistry();
  const nullifier = deriveHardwareNullifier({ ...TEST_SEED, epoch: 7 });
  registry.markSpentOnChain(nullifier, NOW);
  assert.equal(registry.stateOf(nullifier), "consumed");
  registry.markSpentOnChain(nullifier, NOW + 10);
  assert.equal(registry.entries().length, 1, "reconciliation is idempotent");
  assert.equal(registry.entries()[0]?.note, "observed on chain");
});

test("the registry refuses a nullifier that is not a canonical scalar", () => {
  const registry = new HardwareNullifierRegistry();
  assert.throws(() => registry.reserve("0x00", NOW), NullifierFormatError);
  assert.throws(() => registry.stateOf(`0x${"0".repeat(64)}`), NullifierFormatError);
  assert.throws(() => registry.reserve(`0x${SCALAR_FIELD.toString(16)}`, NOW), NullifierFormatError);
  assert.equal(registry.size, 0);
});

test("the registry canonicalizes casing so one nullifier cannot be reserved twice by case", () => {
  const registry = new HardwareNullifierRegistry();
  const nullifier = deriveHardwareNullifier(TEST_SEED);
  const upper = `0x${nullifier.slice(2).toUpperCase()}` as Hex;
  registry.reserve(nullifier, NOW);
  assert.throws(() => registry.reserve(upper, NOW), NullifierReplayError);
  assert.equal(registry.entries()[0]?.nullifier, nullifier.toLowerCase());
});
