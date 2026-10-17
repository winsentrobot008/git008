/**
 * M5 - the native biometric-gate adapter, driven by a simulated platform authenticator.
 *
 * The claim under test is that this adapter verifies the native assertion itself rather than trusting a
 * "prompt succeeded" boolean, so an approval it hands the wallet is bound to *this* challenge by a real
 * signature. The failure cases below are the ones that matter: a signature from another key, a mislabelled
 * key, a fabricated approval, a software channel pretending to be hardware, a rotated pin and a replayed
 * timestamp must all be refusals, not warnings.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSERTION_IS_RAW_BIOMETRIC_FREE,
  BiometricAuthorizationGate,
  BiometricDeniedError,
  BiometricUnavailableError,
  FORBIDDEN_RAW_BIOMETRIC_KEYS,
  NativeBiometricBridgeError,
  NativeBridgeBiometricGate,
  PROMPT_IS_RAW_BIOMETRIC_FREE,
  RawBiometricMaterialError,
  assertNativeBiometricProvider,
  createNativeBiometricGate,
  nativeBiometricProviderFromGlobal,
  type BiometricRequest,
  type NativeBiometricAssertion,
  type NativeBiometricProvider,
} from "../bio-auth/index.js";
import { EcdsaError } from "../shared/ecdsa.js";
import type { Address, Hex } from "../signer/types.js";
import { createMockBiometricBridge } from "./helpers/bridges.js";

const NOW = 1_700_000_000;
const OWNER_KEY = "maotang.test.owner";
const FACTORY = "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853" as Address;
const CHALLENGE = `0x${"ab".repeat(32)}` as Hex;
const ETH = 10n ** 18n;

function request(overrides: Partial<BiometricRequest> = {}): BiometricRequest {
  return {
    keyId: OWNER_KEY,
    purpose: "authorize-intent",
    challenge: CHALLENGE,
    reason: "sign a launch",
    to: FACTORY,
    valueWei: ETH,
    selector: null,
    ...overrides,
  };
}

test("a device assertion is verified and reported as hardware backed", async () => {
  const device = createMockBiometricBridge();
  const gate = new NativeBridgeBiometricGate({
    provider: device.provider,
    pinnedAssertionPublicKey: device.assertionPublicKeyHex,
    now: () => NOW,
  });
  assert.equal(gate.mode, "device");
  assert.equal(gate.kind, "secure-enclave");
  assert.equal(gate.hasPinnedKey, true);

  const assertion = await gate.authenticate(request());
  assert.equal(assertion.hardwareBacked, true);
  assert.equal(assertion.method, "biometric");
  assert.equal(assertion.keyId, OWNER_KEY);
  assert.equal(assertion.challenge, CHALLENGE);
  assert.equal(assertion.grantedAt, NOW);
  assert.match(assertion.detail, /verified a P-256 assertion/);
  assert.match(assertion.detail, /matches the pinned key/);

  assert.equal(device.prompts.length, 1);
  assert.equal(device.prompts[0]?.challenge, CHALLENGE);
  assert.equal(device.prompts[0]?.valueWei, ETH.toString(), "the prompt carries the value as a decimal string");
  assert.equal(device.prompts[0]?.reason, "sign a launch");
});

test("a KMS-style bridge that signs the pre-computed digest is followed, not second-guessed", async () => {
  const device = createMockBiometricBridge({ payloadMode: "digest", format: "raw" });
  const gate = new NativeBridgeBiometricGate({ provider: device.provider, now: () => NOW });
  assert.equal(gate.hasPinnedKey, false, "an unpinned gate verifies against the key the bridge reports");

  const assertion = await gate.authenticate(request());
  assert.equal(assertion.hardwareBacked, true);
  assert.match(assertion.detail, /digest mode, raw signature/);
  assert.match(assertion.detail, /pin it in production/);
});

test("a secp256k1 assertion key is accepted just as a P-256 one is", async () => {
  const device = createMockBiometricBridge({ curve: "secp256k1" });
  const gate = new NativeBridgeBiometricGate({ provider: device.provider, now: () => NOW });
  assert.match((await gate.authenticate(request())).detail, /secp256k1 assertion/);
});

test("a device-passcode method is reported through unchanged", async () => {
  const device = createMockBiometricBridge({ method: "device-passcode" });
  const gate = new NativeBridgeBiometricGate({ provider: device.provider, now: () => NOW });
  assert.equal((await gate.authenticate(request())).method, "device-passcode");
});

test("an assertion not backed by a valid signature over this challenge is refused", async () => {
  const signedElsewhere = createMockBiometricBridge({ signWithDifferentKey: true });
  await assert.rejects(
    new NativeBridgeBiometricGate({ provider: signedElsewhere.provider, now: () => NOW }).authenticate(request()),
    BiometricDeniedError,
  );

  const mislabelled = createMockBiometricBridge({ reportDifferentKey: true });
  await assert.rejects(
    new NativeBridgeBiometricGate({ provider: mislabelled.provider, now: () => NOW }).authenticate(request()),
    BiometricDeniedError,
  );

  const corrupt = createMockBiometricBridge({ corruptSignature: true });
  await assert.rejects(
    new NativeBridgeBiometricGate({ provider: corrupt.provider, now: () => NOW }).authenticate(request()),
    BiometricDeniedError,
  );
});

test("a channel that does not claim hardware backing is refused, pointing at the simulated gate", async () => {
  const software = createMockBiometricBridge({ hardwareBacked: false });
  await assert.rejects(
    new NativeBridgeBiometricGate({ provider: software.provider, now: () => NOW }).authenticate(request()),
    (error: unknown) => {
      assert.ok(error instanceof BiometricDeniedError);
      assert.match(error.message, /SimulatedBiometricGate/);
      return true;
    },
  );
});

test("a pinned key is enforced, and rotating the pin to the real key admits it", async () => {
  const device = createMockBiometricBridge();
  const wrongPin = new NativeBridgeBiometricGate({
    provider: device.provider,
    pinnedAssertionPublicKey: device.otherPublicKeyHex,
    now: () => NOW,
  });
  await assert.rejects(wrongPin.authenticate(request()), (error: unknown) => {
    assert.ok(error instanceof BiometricDeniedError);
    assert.match(error.message, /pinned biometric key/);
    return true;
  });

  const rightPin = new NativeBridgeBiometricGate({
    provider: device.provider,
    pinnedAssertionPublicKey: device.assertionPublicKeyHex,
    now: () => NOW,
  });
  assert.equal((await rightPin.authenticate(request())).hardwareBacked, true);
});

test("a future timestamp is a bridge fault, not a stale approval", async () => {
  const device = createMockBiometricBridge({ grantedAt: NOW + 60 });
  await assert.rejects(
    new NativeBridgeBiometricGate({ provider: device.provider, now: () => NOW }).authenticate(request()),
    (error: unknown) => {
      assert.ok(error instanceof BiometricDeniedError);
      assert.match(error.message, /in the future/);
      return true;
    },
  );
});

test("a non-integer platform timestamp is refused as a broken bridge", async () => {
  const device = createMockBiometricBridge({ nonIntegerGrantedAt: true });
  await assert.rejects(
    new NativeBridgeBiometricGate({ provider: device.provider, now: () => NOW }).authenticate(request()),
    NativeBiometricBridgeError,
  );
});

test("no bridge attached: the gate refuses every call and pins nothing", async () => {
  const gate = createNativeBiometricGate({ provider: null });
  assert.equal(gate.mode, "device");
  await assert.rejects(gate.isEnrolled(), BiometricUnavailableError);
  await assert.rejects(gate.enroll(), BiometricUnavailableError);
  await assert.rejects(gate.revoke(), BiometricUnavailableError);
  await assert.rejects(gate.authenticate(request()), BiometricUnavailableError);
});

test("an incomplete or wrongly declared biometric bridge is rejected when attached", () => {
  assert.throws(() => assertNativeBiometricProvider({ platform: "ios" }), NativeBiometricBridgeError);
  assert.throws(() => assertNativeBiometricProvider(42), NativeBiometricBridgeError);
  assert.throws(() => assertNativeBiometricProvider(null), BiometricUnavailableError);

  const device = createMockBiometricBridge();
  assert.throws(
    () =>
      new NativeBridgeBiometricGate({
        provider: { ...device.provider, platform: "web" } as unknown as NativeBiometricProvider,
      }),
    NativeBiometricBridgeError,
  );
});

test("a failing prompt is wrapped as a bridge error that keeps the cause", async () => {
  const device = createMockBiometricBridge({ failOn: ["authenticateAsync"] });
  await assert.rejects(
    new NativeBridgeBiometricGate({ provider: device.provider, now: () => NOW }).authenticate(request()),
    (error: unknown) => {
      assert.ok(error instanceof NativeBiometricBridgeError);
      assert.match(error.message, /authenticateAsync failed/);
      assert.ok(error.cause instanceof Error, "the platform error must survive into the log");
      return true;
    },
  );
  assert.equal(device.prompts.length, 1, "the prompt reached the platform before it failed");
});

test("enrolment state is read and written through the bridge", async () => {
  const device = createMockBiometricBridge({ enabled: false });
  const gate = new NativeBridgeBiometricGate({ provider: device.provider, now: () => NOW });
  assert.equal(await gate.isEnrolled(), false);
  await gate.enroll();
  assert.equal(await gate.isEnrolled(), true);
  await gate.revoke();
  assert.equal(await gate.isEnrolled(), false);
});

test("a challenge that is not a 32-byte digest is refused before the prompt is shown", async () => {
  const device = createMockBiometricBridge();
  const gate = new NativeBridgeBiometricGate({ provider: device.provider, now: () => NOW });
  await assert.rejects(gate.authenticate(request({ challenge: "0x1234" as Hex })), BiometricDeniedError);
  assert.equal(device.prompts.length, 0);
});

test("an assertion key pin that is not a public key is rejected at construction", () => {
  const device = createMockBiometricBridge();
  assert.throws(
    () => new NativeBridgeBiometricGate({ provider: device.provider, pinnedAssertionPublicKey: "0x00" as Hex }),
    EcdsaError,
  );
});

test("through BiometricAuthorizationGate a native grant satisfies the wallet authorization seam", async () => {
  const device = createMockBiometricBridge();
  const authorization = new BiometricAuthorizationGate({
    gate: new NativeBridgeBiometricGate({
      provider: device.provider,
      pinnedAssertionPublicKey: device.assertionPublicKeyHex,
      now: () => NOW,
    }),
    now: () => NOW,
  });
  const grant = await authorization.authorize({
    keyId: OWNER_KEY,
    reason: "sign a launch",
    challenge: CHALLENGE,
    to: FACTORY,
    valueWei: ETH,
    selector: null,
  });
  assert.equal(grant.method, "biometric");
  assert.equal(grant.hardwareBacked, true);
  assert.equal(grant.challenge, CHALLENGE);
  assert.equal(grant.grantedAt, NOW);
});

test("the biometric bridge can be discovered on the injected global", () => {
  const device = createMockBiometricBridge();
  assert.equal(nativeBiometricProviderFromGlobal("MaotangBioAbsent"), null);
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.MaotangBioTest = { biometrics: device.provider };
  try {
    assert.equal(nativeBiometricProviderFromGlobal("MaotangBioTest"), device.provider);
  } finally {
    delete globals.MaotangBioTest;
  }
});
test("the gate is a nonce verifier: raw biometric material is refused on both sides of the bridge", async () => {
  // Compile-time proofs, read at runtime so a type regression is caught here as well as at build time.
  assert.equal(PROMPT_IS_RAW_BIOMETRIC_FREE, true);
  assert.equal(ASSERTION_IS_RAW_BIOMETRIC_FREE, true);
  assert.ok(FORBIDDEN_RAW_BIOMETRIC_KEYS.length > 0);

  const device = createMockBiometricBridge();
  await new NativeBridgeBiometricGate({ provider: device.provider, now: () => NOW }).authenticate(request());
  // What crossed the bridge is a challenge and a description of the action - never a template.
  assert.deepStrictEqual(Object.keys(device.prompts[0] ?? {}).sort(), [
    "challenge",
    "keyId",
    "purpose",
    "reason",
    "selector",
    "to",
    "valueWei",
  ]);

  for (const leak of [{ biometricTemplate: "0x00" }, { nested: { fingerprint: "0x01" } }, { faceImage: "0x02" }]) {
    const leaking: NativeBiometricProvider = {
      ...device.provider,
      async authenticateAsync(prompt) {
        const honest = await device.provider.authenticateAsync(prompt);
        return { ...honest, ...leak } as unknown as NativeBiometricAssertion;
      },
    };
    await assert.rejects(
      new NativeBridgeBiometricGate({ provider: leaking, now: () => NOW }).authenticate(request()),
      RawBiometricMaterialError,
      `a payload carrying ${JSON.stringify(leak)} must be refused`,
    );
  }
});