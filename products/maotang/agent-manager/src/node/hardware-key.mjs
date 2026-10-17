/**
 * Hardware-backed sealing for the MAOTANG node identity seed.
 *
 * The Ed25519 seed is the only secret an agent holds. On a phone it must not sit in a plaintext
 * file: it should be sealed by the device's secure element (Android Keystore, Apple Secure
 * Enclave, TPM 2.0) or by a removable authenticator (YubiKey PIV, a WebAuthn `hmac-secret`
 * credential). This module is the *bridge*, never a reimplementation of any of them:
 *
 *   * the hardware is reached through an injected provider, and
 *   * a provider is a tiny, auditable contract - `seal(seedHex) -> sealedHex` and
 *     `unseal(sealedHex) -> seedHex` - so a native shim, a YubiKey PIV wrapper or a WebAuthn
 *     credential can all be plugged in without the keystore knowing which one it talks to.
 *
 * Two rules keep this honest:
 *
 *   1. **Never fabricate hardware.** A provider that cannot prove a hardware root reports
 *      `hardwareBacked: false`, and {resolveHardwareKeyProvider} then falls back to the software
 *      path with a reason the caller can log. No key is ever derived from a guessable device
 *      string: that would be both insecure and non-deterministic across reinstalls.
 *   2. **Fail closed.** A keystore sealed by hardware that is no longer present must be an error,
 *      never a silent regeneration - replacing the node key would orphan the on-chain identity.
 */
import { execFileSync } from "node:child_process";

import { sha256Hex } from "./identity.mjs";

export const HARDWARE_KEY_PROVIDERS = Object.freeze({
  SOFTWARE: "software",
  OS_SECURE_STORE: "os-secure-store",
  ANDROID_TEE: "android-tee-keystore",
  APPLE_SE: "apple-secure-enclave",
  TPM2: "tpm2",
  YUBIKEY: "yubikey-piv",
  WEBAUTHN: "webauthn-hmac-secret",
});

/** Domain separation for the binding digest; never used to derive key material. */
export const HARDWARE_KEY_DOMAIN = "maotang-hardware-key-v1";

const HARDWARE_KINDS = new Set([
  HARDWARE_KEY_PROVIDERS.OS_SECURE_STORE,
  HARDWARE_KEY_PROVIDERS.ANDROID_TEE,
  HARDWARE_KEY_PROVIDERS.APPLE_SE,
  HARDWARE_KEY_PROVIDERS.TPM2,
  HARDWARE_KEY_PROVIDERS.YUBIKEY,
  HARDWARE_KEY_PROVIDERS.WEBAUTHN,
]);

export function isHardwareKind(kind) {
  return HARDWARE_KINDS.has(kind);
}

export class HardwareKeyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HardwareKeyError";
    this.code = code;
  }
}

/**
 * A digest that *binds* an identity to its protection kind, for attestation and audit only.
 * It is not a key: it leaks nothing that a node id does not already leak.
 */
export function hardwareKeyBinding({ kind, nodeId }) {
  return sha256Hex(`${HARDWARE_KEY_DOMAIN}:binding:${kind}:${nodeId}`);
}

/** The honest software fallback: no secure element is available, and it says so. */
export function createSoftwareKeyProvider({ reason = "no hardware key provider is configured" } = {}) {
  return {
    kind: HARDWARE_KEY_PROVIDERS.SOFTWARE,
    hardwareBacked: false,
    available: false,
    reason,
    seal: (seedHex) => seedHex,
    unseal: (sealedHex) => sealedHex,
    status() {
      return { kind: HARDWARE_KEY_PROVIDERS.SOFTWARE, hardwareBacked: false, available: false, reason };
    },
  };
}

/** Wraps an injected seal/unseal pair (native shim, YubiKey PIV, WebAuthn hmac-secret). */
export function createInjectedKeyProvider({ kind, seal, unseal, hardwareBacked = isHardwareKind(kind), reason = null }) {
  if (typeof seal !== "function" || typeof unseal !== "function") {
    throw new HardwareKeyError("bad-provider", `hardware key provider ${kind} must implement seal() and unseal()`);
  }
  const safeSeal = (seedHex) => String(seal(seedHex));
  const safeUnseal = (sealedHex) => String(unseal(sealedHex));
  return {
    kind,
    hardwareBacked: hardwareBacked === true,
    available: true,
    reason,
    seal: safeSeal,
    unseal: safeUnseal,
    status() {
      return { kind, hardwareBacked: hardwareBacked === true, available: true, reason };
    },
  };
}

/** Runs a helper command with the payload on stdin and parses its single JSON document. */
export function runKeyHelper(helperPath, command, payload, timeoutMs = 10000) {
  let stdout;
  try {
    stdout = execFileSync(helperPath, [command], {
      input: payload,
      timeout: timeoutMs,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    throw new HardwareKeyError("helper-failed", `hardware key helper ${command} failed: ${error?.message ?? error}`);
  }
  const text = String(stdout).trim();
  if (text === "") throw new HardwareKeyError("helper-failed", `hardware key helper ${command} returned nothing`);
  try {
    return JSON.parse(text);
  } catch {
    throw new HardwareKeyError("helper-failed", `hardware key helper ${command} did not return JSON`);
  }
}

/**
 * Secure-element bridge, mirroring the BLE/cell/UWB system-helper pattern: a native shim owns the
 * TEE/SE/TPM2/YubiKey session and answers `describe`, `seal` and `unseal` (seed on stdin, JSON on
 * stdout). If the helper is missing or cannot describe itself, this falls back to software with a
 * reason instead of throwing, so an absent radio never stops the node from starting.
 */
export function createHelperKeyProvider({ helperPath = process.env.MAOTANG_HW_KEY_HELPER, timeoutMs = 10000, run = runKeyHelper } = {}) {
  if (typeof helperPath !== "string" || helperPath.trim() === "") {
    return createSoftwareKeyProvider({ reason: "MAOTANG_HW_KEY_HELPER is not set" });
  }
  let described;
  try {
    described = run(helperPath, "describe", "", timeoutMs);
  } catch (error) {
    return createSoftwareKeyProvider({ reason: `hardware key helper unavailable: ${error?.message ?? error}` });
  }
  const kind = String(described.provider ?? described.kind ?? HARDWARE_KEY_PROVIDERS.OS_SECURE_STORE).toLowerCase();
  const hardwareBacked = described.hardwareBacked === undefined ? isHardwareKind(kind) : described.hardwareBacked === true;
  return createInjectedKeyProvider({
    kind,
    hardwareBacked,
    reason: described.reason ?? null,
    seal: (seedHex) => {
      const out = run(helperPath, "seal", seedHex, timeoutMs);
      if (typeof out.sealed !== "string" || out.sealed === "") {
        throw new HardwareKeyError("helper-failed", "hardware key helper did not return a sealed seed");
      }
      return out.sealed;
    },
    unseal: (sealedHex) => {
      const out = run(helperPath, "unseal", sealedHex, timeoutMs);
      if (typeof out.seed !== "string" || out.seed === "") {
        throw new HardwareKeyError("helper-failed", "hardware key helper did not return a seed");
      }
      return out.seed;
    },
  });
}

/**
 * Picks the strongest available provider: explicitly injected ones first, then the environment
 * helper. `MAOTANG_HW_KEY_PROVIDER=software` forces the plaintext path (used by CI).
 */
export function resolveHardwareKeyProvider({ providers = [], env = process.env, logger } = {}) {
  const configured = String(env.MAOTANG_HW_KEY_PROVIDER ?? "").trim().toLowerCase();
  if (configured === HARDWARE_KEY_PROVIDERS.SOFTWARE) {
    return createSoftwareKeyProvider({ reason: "MAOTANG_HW_KEY_PROVIDER=software" });
  }
  const candidates = [
    ...providers.filter((provider) => provider !== null && provider !== undefined),
    createHelperKeyProvider({ helperPath: env.MAOTANG_HW_KEY_HELPER }),
  ];
  const backed = candidates.find((provider) => provider.available === true && provider.hardwareBacked === true);
  if (backed !== undefined) return backed;
  const anyAvailable = candidates.find((provider) => provider.available === true);
  if (anyAvailable !== undefined && configured === "") {
    logger?.info?.(`[maotang] hardware key provider ${anyAvailable.kind} is available but does not claim hardware backing`);
  }
  if (anyAvailable !== undefined) return anyAvailable;
  return createSoftwareKeyProvider({ reason: "no hardware key provider is available" });
}
