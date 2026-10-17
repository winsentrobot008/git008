/**
 * Local keystore for the node identity seed.
 *
 * Preference order: an explicit seed (tests/dev) -> MAOTANG_NODE_SEED -> the on-disk keystore ->
 * a freshly generated identity.
 *
 * Two record versions are understood:
 *
 *   * v1 (legacy) - `{ version: 1, seed }`: the seed sits in the file. It stays readable so an
 *     existing node is never orphaned, and it is transparently re-sealed the first time a
 *     hardware key provider is available.
 *   * v2 - `{ version: 2, sealedSeed, protection }`: the seed is sealed by a hardware-backed key
 *     (Android Keystore / Secure Enclave / TPM 2.0 / YubiKey / WebAuthn). `protection.kind`
 *     records which, so a verifier can see the strength of the binding.
 *
 * A v2 record whose hardware provider is missing is a hard error, never a regeneration: silently
 * replacing the node key would orphan the node's on-chain identity, so this fails closed.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { HardwareKeyError, isHardwareKind, resolveHardwareKeyProvider } from "./hardware-key.mjs";
import { NodeIdentity } from "./identity.mjs";

export const NODE_KEYSTORE_VERSION = 1;
export const SEALED_KEYSTORE_VERSION = 2;
export const DEFAULT_KEYSTORE_RELATIVE_PATH = ".node/node-key.json";

export { HardwareKeyError };

function isSeedHex(value) {
  return typeof value === "string" && value.length === 64 && /^[0-9a-fA-F]+$/.test(value);
}

function protectionOf(provider) {
  return { kind: provider?.kind ?? "software", hardwareBacked: provider?.hardwareBacked === true };
}

function writeKeystore(keystorePath, record) {
  mkdirSync(path.dirname(keystorePath), { recursive: true, mode: 0o700 });
  writeFileSync(keystorePath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(keystorePath, 0o600);
  } catch {
    // best effort on platforms without POSIX modes
  }
}

/** Seals the identity seed under the hardware provider and writes the v2 record. */
function sealInto(keystorePath, identity, provider, logger) {
  const sealedSeed = provider.seal(identity.exportSeed().toString("hex"));
  writeKeystore(keystorePath, {
    version: SEALED_KEYSTORE_VERSION,
    sealedSeed,
    protection: protectionOf(provider),
    createdAt: new Date().toISOString(),
  });
  logger?.info?.(`[maotang] sealed the node key with ${provider.kind} at ${keystorePath}`);
}

function resultOf(identity, { source, persisted, keystorePath, protection }) {
  const hardwareBacked = protection?.hardwareBacked === true && isHardwareKind(protection.kind);
  return { identity, source, persisted, keystorePath, keyProtection: protection, hardwareBacked };
}

/**
 * Loads, or creates and persists, this device's node identity.
 *
 * `hardwareKeyProvider` (optional) injects a seal/unseal provider; otherwise one is resolved from
 * the environment. `migrateToHardware: false` keeps a legacy plaintext record as-is.
 */
export function loadOrCreateIdentity(options = {}) {
  const { keystorePath, seedHex, env = process.env, logger, hardwareKeyProvider, migrateToHardware = true } = options;

  if (isSeedHex(seedHex)) {
    return resultOf(NodeIdentity.fromSeed(seedHex), {
      source: "explicit-seed",
      persisted: false,
      keystorePath,
      protection: { kind: "explicit-seed", hardwareBacked: false },
    });
  }
  if (isSeedHex(env.MAOTANG_NODE_SEED)) {
    return resultOf(NodeIdentity.fromSeed(env.MAOTANG_NODE_SEED), {
      source: "env-seed",
      persisted: false,
      keystorePath,
      protection: { kind: "env-seed", hardwareBacked: false },
    });
  }

  const provider =
    hardwareKeyProvider !== undefined && hardwareKeyProvider !== null
      ? hardwareKeyProvider
      : resolveHardwareKeyProvider({ env, logger });

  if (typeof keystorePath === "string" && existsSync(keystorePath)) {
    const stored = JSON.parse(readFileSync(keystorePath, "utf8"));

    if (stored.version === SEALED_KEYSTORE_VERSION) {
      if (typeof stored.sealedSeed !== "string" || stored.sealedSeed === "") {
        throw new HardwareKeyError("unreadable-keystore", `unreadable sealed node keystore at ${keystorePath}`);
      }
      if (provider === null || provider === undefined || provider.hardwareBacked !== true) {
        throw new HardwareKeyError(
          "hardware-unavailable",
          `node keystore at ${keystorePath} is sealed by ${stored.protection?.kind ?? "hardware"} but no hardware key provider is available`,
        );
      }
      const unsealed = provider.unseal(stored.sealedSeed);
      if (!isSeedHex(unsealed)) {
        throw new HardwareKeyError("unreadable-keystore", `sealed keystore at ${keystorePath} did not unseal to a 32-byte seed`);
      }
      return resultOf(NodeIdentity.fromSeed(unsealed), {
        source: "keystore",
        persisted: true,
        keystorePath,
        protection: { kind: stored.protection?.kind ?? provider.kind, hardwareBacked: true },
      });
    }

    if (stored.version !== NODE_KEYSTORE_VERSION || !isSeedHex(stored.seed)) {
      throw new HardwareKeyError("unreadable-keystore", `unreadable node keystore at ${keystorePath}`);
    }
    const identity = NodeIdentity.fromSeed(stored.seed);
    if (migrateToHardware && provider !== null && provider !== undefined && provider.hardwareBacked === true) {
      sealInto(keystorePath, identity, provider, logger);
      return resultOf(identity, { source: "keystore", persisted: true, keystorePath, protection: protectionOf(provider) });
    }
    return resultOf(identity, {
      source: "keystore",
      persisted: true,
      keystorePath,
      protection: { kind: "software", hardwareBacked: false },
    });
  }

  const identity = NodeIdentity.generate();
  if (typeof keystorePath === "string") {
    if (provider !== null && provider !== undefined && provider.hardwareBacked === true) {
      sealInto(keystorePath, identity, provider, logger);
    } else {
      writeKeystore(keystorePath, {
        version: NODE_KEYSTORE_VERSION,
        seed: identity.exportSeed().toString("hex"),
        createdAt: new Date().toISOString(),
      });
      logger?.warn?.(
        `[maotang] created a software node key at ${keystorePath}; prefer a hardware key provider (MAOTANG_HW_KEY_HELPER) in production`,
      );
    }
  }
  return resultOf(identity, {
    source: "generated",
    persisted: typeof keystorePath === "string",
    keystorePath,
    protection: protectionOf(provider),
  });
}
