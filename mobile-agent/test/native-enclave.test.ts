/**
 * M2 - the native secure-enclave adapter, driven by a simulated device bridge.
 *
 * Every test here answers one question: does the adapter hold the line when the bridge misbehaves? The
 * happy path proves the interface plumbing works; the failure cases prove the four properties
 * `native-enclave.ts` claims to enforce - curve, SPKI/point consistency, payload convention and
 * before-release verification - are enforced rather than trusted, because a bridge is code in another
 * runtime whose bugs are indistinguishable from an attack.
 *
 * The bridge double lives in `./helpers/bridges.js` and is test-only: a real bridge never hands private
 * material to JavaScript, which is the whole point of signing in the platform keystore.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EnclaveKeyError,
  EnclaveUnavailableError,
  verifyDigest,
  type SecureEnclave,
} from "../signer/enclave.js";
import {
  NativeBridgeEnclave,
  NativeBridgeError,
  assertNativeCryptoProvider,
  createNativeEnclave,
  nativeCryptoProviderFromGlobal,
  type NativeCryptoProvider,
} from "../signer/native-enclave.js";
import type { Hex } from "../signer/types.js";
import { createMockCryptoBridge } from "./helpers/bridges.js";

const ALIAS = "maotang.test.owner";
const DIGEST = `0x${"11".repeat(32)}` as Hex;

test("a device signature is normalized to raw and verifies against the key the bridge reported", async () => {
  const device = createMockCryptoBridge();
  const enclave: SecureEnclave = createNativeEnclave(device.provider);
  assert.equal(enclave.mode, "hardware");
  assert.equal((enclave as NativeBridgeEnclave).platform, "ios");

  const key = await enclave.generateKey(ALIAS);
  assert.equal(key.algorithm, "ECDSA-secp256k1");
  assert.equal(key.alias, ALIAS);
  assert.equal(key.keyId, `mock-key-${ALIAS}`);
  assert.equal(key.spkiPublicKey, device.spkiHexFor(ALIAS));
  assert.match(key.uncompressedPublicKey, /^0x04[0-9a-f]{128}$/);

  assert.deepEqual(await enclave.listKeys(), [ALIAS]);
  assert.equal((await enclave.getKey(ALIAS))?.keyId, key.keyId);

  const signature = await enclave.signDigest(ALIAS, DIGEST);
  assert.equal((signature.length - 2) / 2, 64, "a DER signature is re-packed to raw r||s");
  assert.equal(verifyDigest(key.spkiPublicKey, DIGEST, signature), true);

  const attestation = await enclave.attest(ALIAS);
  assert.equal(attestation.keyId, key.keyId);
  assert.equal(attestation.kind, "secure-enclave");
  assert.equal(attestation.hardwareBacked, true);

  await enclave.deleteKey(ALIAS);
  assert.equal(await enclave.getKey(ALIAS), null, "a deleted key is gone from the device too");
});

test("the adapter reads the public key before signing with a key it did not create", async () => {
  const device = createMockCryptoBridge();
  await device.provider.generateKeyAsync(ALIAS);
  const enclave = createNativeEnclave(device.provider);
  device.calls.length = 0;

  const signature = await enclave.signDigest(ALIAS, DIGEST);
  assert.deepEqual(
    device.calls,
    ["publicKeyAsync", "signAsync"],
    "the key identity is resolved before the returned signature is trusted",
  );
  assert.equal(verifyDigest(device.spkiHexFor(ALIAS), DIGEST, signature), true);
});

test("both DER and raw bridge signatures are accepted", async () => {
  for (const format of ["der", "raw"] as const) {
    const device = createMockCryptoBridge({ format });
    const enclave = createNativeEnclave(device.provider);
    const key = await enclave.generateKey(ALIAS);
    const signature = await enclave.signDigest(ALIAS, DIGEST);
    assert.equal((signature.length - 2) / 2, 64, `${format} must arrive as raw r||s`);
    assert.equal(verifyDigest(key.spkiPublicKey, DIGEST, signature), true);
  }
});

test("a P-256 key is refused because the EVM cannot verify it", async () => {
  const device = createMockCryptoBridge({ curve: "prime256v1" });
  const enclave = createNativeEnclave(device.provider);
  await assert.rejects(enclave.generateKey(ALIAS), (error: unknown) => {
    assert.ok(error instanceof NativeBridgeError);
    assert.match(error.message, /P-256/);
    return true;
  });
});

test("a bridge whose uncompressed point contradicts its own SPKI is refused", async () => {
  const device = createMockCryptoBridge({ corruptUncompressedPoint: true });
  const enclave = createNativeEnclave(device.provider);
  await assert.rejects(enclave.generateKey(ALIAS), (error: unknown) => {
    assert.ok(error instanceof NativeBridgeError);
    assert.match(error.message, /does not match its own SPKI/);
    return true;
  });
});

test("a bridge that hashed the digest again is refused instead of releasing a bad signature", async () => {
  const device = createMockCryptoBridge({ payloadMode: "message" });
  const enclave = createNativeEnclave(device.provider);
  await enclave.generateKey(ALIAS);
  await assert.rejects(enclave.signDigest(ALIAS, DIGEST), (error: unknown) => {
    assert.ok(error instanceof NativeBridgeError);
    assert.match(error.message, /payloadMode "message"/);
    return true;
  });
});

test("a signature that does not verify is never released", async () => {
  const wrongDigest = createMockCryptoBridge({ signDifferentDigest: true });
  const enclave = createNativeEnclave(wrongDigest.provider);
  await enclave.generateKey(ALIAS);
  await assert.rejects(enclave.signDigest(ALIAS, DIGEST), (error: unknown) => {
    assert.ok(error instanceof NativeBridgeError);
    assert.match(error.message, /does not verify/);
    return true;
  });

  const garbage = createMockCryptoBridge({ garbageSignature: true });
  const second = createNativeEnclave(garbage.provider);
  await second.generateKey(ALIAS);
  await assert.rejects(second.signDigest(ALIAS, DIGEST), NativeBridgeError);
});

test("a bridge failure is wrapped as a NativeBridgeError that keeps the cause", async () => {
  const device = createMockCryptoBridge({ failOn: ["signAsync"] });
  const enclave = createNativeEnclave(device.provider);
  await enclave.generateKey(ALIAS);
  await assert.rejects(enclave.signDigest(ALIAS, DIGEST), (error: unknown) => {
    assert.ok(error instanceof NativeBridgeError);
    assert.match(error.message, /signAsync failed/);
    assert.ok(error.cause instanceof Error, "the platform error must survive into the log");
    return true;
  });
});

test("constructing the adapter without a bridge yields a backend that refuses everything", async () => {
  const enclave = createNativeEnclave(null);
  assert.equal(enclave.mode, "hardware");
  assert.equal((enclave as NativeBridgeEnclave).platform, null);
  await assert.rejects(enclave.generateKey(ALIAS), EnclaveUnavailableError);
  await assert.rejects(enclave.getKey(ALIAS), EnclaveUnavailableError);
  await assert.rejects(enclave.listKeys(), EnclaveUnavailableError);
  await assert.rejects(enclave.deleteKey(ALIAS), EnclaveUnavailableError);
  await assert.rejects(enclave.signDigest(ALIAS, DIGEST), EnclaveUnavailableError);
  await assert.rejects(enclave.attest(ALIAS), EnclaveUnavailableError);
});

test("an incomplete or wrongly declared bridge is rejected when it is attached", () => {
  assert.throws(() => assertNativeCryptoProvider({ platform: "ios" }), NativeBridgeError);
  assert.throws(() => assertNativeCryptoProvider("bridge"), NativeBridgeError);
  assert.throws(() => assertNativeCryptoProvider(null), EnclaveUnavailableError);

  const device = createMockCryptoBridge();
  assert.throws(
    () => new NativeBridgeEnclave({ ...device.provider, platform: "web" } as unknown as NativeCryptoProvider),
    NativeBridgeError,
  );
});

test("aliases and digests are validated before the bridge is touched", async () => {
  const device = createMockCryptoBridge();
  const enclave = createNativeEnclave(device.provider);
  await assert.rejects(enclave.generateKey("bad alias"), EnclaveKeyError);
  await enclave.generateKey(ALIAS);
  await assert.rejects(enclave.signDigest(ALIAS, "0x1234" as Hex), EnclaveKeyError);
  assert.deepEqual(device.calls, ["generateKeyAsync"], "rejected input must never reach the platform");
});

test("a key the device does not hold resolves to null rather than a fabricated handle", async () => {
  const device = createMockCryptoBridge();
  const enclave = createNativeEnclave(device.provider);
  assert.equal(await enclave.getKey(ALIAS), null);
});

test("the bridge can be discovered on the injected global, and absence is not an error", () => {
  const device = createMockCryptoBridge();
  assert.equal(nativeCryptoProviderFromGlobal("MaotangAbsent"), null);
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.MaotangTestBridge = { crypto: device.provider };
  try {
    assert.equal(nativeCryptoProviderFromGlobal("MaotangTestBridge"), device.provider);
  } finally {
    delete globals.MaotangTestBridge;
  }
});