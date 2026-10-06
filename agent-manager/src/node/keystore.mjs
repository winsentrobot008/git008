/**
 * Local keystore for the node identity seed.
 *
 * Preference order: an explicit seed (tests/dev) -> MAOTANG_NODE_SEED -> the on-disk keystore ->
 * a freshly generated identity. The on-disk file is created with mode 0600 and lives in a
 * git-ignored directory; on a phone this should be replaced by the OS secure store
 * (Android Keystore / iOS Keychain), which is where a hardware-backed key belongs.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { NodeIdentity } from "./identity.mjs";

export const NODE_KEYSTORE_VERSION = 1;
export const DEFAULT_KEYSTORE_RELATIVE_PATH = ".node/node-key.json";

function isSeedHex(value) {
  return typeof value === "string" && value.length === 64 && /^[0-9a-fA-F]+$/.test(value);
}

export function loadOrCreateIdentity(options = {}) {
  const { keystorePath, seedHex, env = process.env, logger } = options;

  if (isSeedHex(seedHex)) {
    return { identity: NodeIdentity.fromSeed(seedHex), source: "explicit-seed", persisted: false };
  }
  if (isSeedHex(env.MAOTANG_NODE_SEED)) {
    return { identity: NodeIdentity.fromSeed(env.MAOTANG_NODE_SEED), source: "env-seed", persisted: false };
  }

  if (typeof keystorePath === "string" && existsSync(keystorePath)) {
    const stored = JSON.parse(readFileSync(keystorePath, "utf8"));
    if (stored.version !== NODE_KEYSTORE_VERSION || !isSeedHex(stored.seed)) {
      throw new Error(`unreadable node keystore at ${keystorePath}`);
    }
    return { identity: NodeIdentity.fromSeed(stored.seed), source: "keystore", persisted: true, keystorePath };
  }

  const identity = NodeIdentity.generate();
  if (typeof keystorePath === "string") {
    mkdirSync(path.dirname(keystorePath), { recursive: true, mode: 0o700 });
    writeFileSync(
      keystorePath,
      `${JSON.stringify(
        { version: NODE_KEYSTORE_VERSION, seed: identity.exportSeed().toString("hex"), createdAt: new Date().toISOString() },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    try {
      chmodSync(keystorePath, 0o600);
    } catch {
      // best effort on platforms without POSIX modes
    }
    logger?.warn?.(
      `[maotang] created a software node key at ${keystorePath}; prefer the OS secure store in production`,
    );
  }

  return { identity, source: "generated", persisted: typeof keystorePath === "string", keystorePath };
}
