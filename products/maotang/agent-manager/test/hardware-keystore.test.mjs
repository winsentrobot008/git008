/**
 * The node key never leaves the device in the clear once a hardware key provider is present.
 *
 * These tests pin the two properties that matter: a sealed keystore is *not* readable without the
 * hardware root (fail-closed, never a silent regeneration), and the legacy plaintext record still
 * loads and is migrated in place so an existing node is never orphaned.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HardwareKeyError,
  createHelperKeyProvider,
  createInjectedKeyProvider,
  createSoftwareKeyProvider,
  hardwareKeyBinding,
  isHardwareKind,
  resolveHardwareKeyProvider,
} from "../src/node/hardware-key.mjs";
import { SEALED_KEYSTORE_VERSION, loadOrCreateIdentity } from "../src/node/keystore.mjs";

const SEED = "1f".repeat(32);

/** A reversible stand-in for a secure element: seals with a marker byte before reversing. */
function fakeHardwareProvider({ kind = "yubikey-piv" } = {}) {
  return createInjectedKeyProvider({
    kind,
    seal: (seedHex) => "0x37" + Buffer.from(seedHex, "hex").reverse().toString("hex"),
    unseal: (sealedHex) => {
      const bytes = Buffer.from(String(sealedHex).replace(/^0x/, ""), "hex");
      if (bytes[0] !== 0x37) throw new Error("not sealed by this provider");
      return bytes.subarray(1).reverse().toString("hex");
    },
  });
}

function helperProvider() {
  return createHelperKeyProvider({
    helperPath: "fake-hw-helper",
    run: (_helper, command, payload) => {
      if (command === "describe") return { provider: "tpm2", hardwareBacked: true };
      if (command === "seal") return { sealed: "0xaa" + payload };
      if (command === "unseal") return { seed: String(payload).slice(4) };
      throw new Error("unknown command");
    },
  });
}

function workspace(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "maotang-keystore-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, keyPath: path.join(dir, "node-key.json") };
}

test("an explicit seed and the environment seed win without touching the keystore", (t) => {
  const { keyPath } = workspace(t);
  const explicit = loadOrCreateIdentity({ keystorePath: keyPath, seedHex: SEED, env: {}, hardwareKeyProvider: fakeHardwareProvider() });
  assert.equal(explicit.source, "explicit-seed");
  assert.equal(explicit.persisted, false);
  assert.equal(explicit.keyProtection.kind, "explicit-seed");
  assert.equal(existsSync(keyPath), false);

  const fromEnv = loadOrCreateIdentity({ keystorePath: keyPath, env: { MAOTANG_NODE_SEED: SEED }, hardwareKeyProvider: fakeHardwareProvider() });
  assert.equal(fromEnv.source, "env-seed");
  assert.equal(fromEnv.hardwareBacked, false);
  assert.equal(existsSync(keyPath), false);
});

test("with no hardware root the keystore stays a warned-about software file", (t) => {
  const { keyPath } = workspace(t);
  const warnings = [];
  const created = loadOrCreateIdentity({ keystorePath: keyPath, env: {}, hardwareKeyProvider: createSoftwareKeyProvider(), logger: { warn: (m) => warnings.push(m) } });
  assert.equal(created.source, "generated");
  assert.equal(created.persisted, true);
  assert.equal(created.hardwareBacked, false);
  assert.equal(created.keyProtection.kind, "software");

  const record = JSON.parse(readFileSync(keyPath, "utf8"));
  assert.equal(record.version, 1);
  assert.equal(record.seed, created.identity.exportSeed().toString("hex"));
  assert.ok(warnings.some((line) => line.includes("software node key")));

  const reopened = loadOrCreateIdentity({ keystorePath: keyPath, env: {}, hardwareKeyProvider: createSoftwareKeyProvider() });
  assert.equal(reopened.source, "keystore");
  assert.equal(reopened.identity.nodeId, created.identity.nodeId);
});

test("a hardware provider seals the seed, and the sealed record is unusable without it", (t) => {
  const { keyPath } = workspace(t);
  const provider = fakeHardwareProvider();
  const logs = [];
  const created = loadOrCreateIdentity({ keystorePath: keyPath, env: {}, hardwareKeyProvider: provider, logger: { info: (m) => logs.push(m) } });

  assert.equal(created.hardwareBacked, true);
  assert.equal(created.keyProtection.kind, "yubikey-piv");
  assert.ok(logs.some((line) => line.includes("sealed the node key")));

  const raw = readFileSync(keyPath, "utf8");
  const record = JSON.parse(raw);
  assert.equal(record.version, SEALED_KEYSTORE_VERSION);
  assert.equal(raw.includes(created.identity.exportSeed().toString("hex")), false, "the plaintext seed is never on disk");
  assert.equal(record.protection.kind, "yubikey-piv");

  const reopened = loadOrCreateIdentity({ keystorePath: keyPath, env: {}, hardwareKeyProvider: fakeHardwareProvider() });
  assert.equal(reopened.source, "keystore");
  assert.equal(reopened.identity.nodeId, created.identity.nodeId);
  assert.equal(reopened.hardwareBacked, true);

  for (const unavailable of [createSoftwareKeyProvider(), undefined]) {
    let error = null;
    try {
      loadOrCreateIdentity({ keystorePath: keyPath, env: {}, hardwareKeyProvider: unavailable });
    } catch (thrown) {
      error = thrown;
    }
    assert.ok(error instanceof HardwareKeyError, "a sealed keystore must fail closed without hardware");
    assert.equal(error.code, "hardware-unavailable");
  }
  assert.equal(JSON.parse(readFileSync(keyPath, "utf8")).version, SEALED_KEYSTORE_VERSION, "a failed load never rewrites the keystore");
});

test("a legacy plaintext record is migrated in place and keeps its node id", (t) => {
  const { keyPath } = workspace(t);
  const original = loadOrCreateIdentity({ keystorePath: keyPath, env: {}, hardwareKeyProvider: createSoftwareKeyProvider() });
  assert.equal(JSON.parse(readFileSync(keyPath, "utf8")).version, 1);

  const migrated = loadOrCreateIdentity({ keystorePath: keyPath, env: {}, hardwareKeyProvider: fakeHardwareProvider() });
  assert.equal(migrated.identity.nodeId, original.identity.nodeId);
  assert.equal(migrated.hardwareBacked, true);
  assert.equal(JSON.parse(readFileSync(keyPath, "utf8")).version, SEALED_KEYSTORE_VERSION);

  const held = loadOrCreateIdentity({ keystorePath: keyPath, env: {}, hardwareKeyProvider: fakeHardwareProvider(), migrateToHardware: false });
  assert.equal(held.identity.nodeId, original.identity.nodeId);
});

test("the environment helper and MAOTANG_HW_KEY_PROVIDER resolve the provider honestly", () => {
  const helper = helperProvider();
  assert.equal(helper.available, true);
  assert.equal(helper.hardwareBacked, true);
  assert.equal(helper.kind, "tpm2");
  const sealed = helper.seal(SEED);
  assert.equal(helper.unseal(sealed), SEED);

  assert.equal(resolveHardwareKeyProvider({ providers: [helper], env: {} }).kind, "tpm2");
  assert.equal(resolveHardwareKeyProvider({ providers: [helper], env: { MAOTANG_HW_KEY_PROVIDER: "software" } }).hardwareBacked, false);

  const broken = createHelperKeyProvider({ helperPath: "missing", run: () => { throw new Error("ENOENT"); } });
  assert.equal(broken.available, false);
  assert.equal(broken.hardwareBacked, false);
  assert.match(broken.reason, /unavailable/);
  assert.equal(resolveHardwareKeyProvider({ providers: [], env: {} }).kind, "software");

  const soft = createSoftwareKeyProvider({ reason: "ci" });
  assert.equal(soft.seal(SEED), SEED);
  assert.equal(soft.unseal(SEED), SEED);
  assert.equal(soft.status().reason, "ci");
  assert.throws(() => createInjectedKeyProvider({ kind: "tpm2", seal: () => "x" }), /must implement seal/);
});

test("hardware kinds and the binding digest are namespaced", () => {
  assert.equal(isHardwareKind("tpm2"), true);
  assert.equal(isHardwareKind("apple-secure-enclave"), true);
  assert.equal(isHardwareKind("software"), false);
  const binding = hardwareKeyBinding({ kind: "tpm2", nodeId: "ab".repeat(32) });
  assert.match(binding, /^[0-9a-f]{64}$/);
  assert.notEqual(binding, hardwareKeyBinding({ kind: "android-tee-keystore", nodeId: "ab".repeat(32) }));
});

test("an unreadable keystore is a hard error, not a new identity", (t) => {
  const { keyPath } = workspace(t);
  writeFileSync(keyPath, JSON.stringify({ version: 1, seed: "nope" }));
  assert.throws(() => loadOrCreateIdentity({ keystorePath: keyPath, env: {}, hardwareKeyProvider: createSoftwareKeyProvider() }), /unreadable node keystore/);
  writeFileSync(keyPath, JSON.stringify({ version: SEALED_KEYSTORE_VERSION, sealedSeed: "" }));
  assert.throws(() => loadOrCreateIdentity({ keystorePath: keyPath, env: {}, hardwareKeyProvider: fakeHardwareProvider() }), /unreadable sealed node keystore/);
});
