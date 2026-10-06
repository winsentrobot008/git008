/**
 * Read-only local hardware probes for MobileNodeAttestation.
 *
 * Every probe is best-effort and never mutates the device. Raw identifiers (serials, UUIDs,
 * machine-ids) are reduced to a SHA-256 digest inside this module and are never returned, logged
 * or persisted: the attestation document only ever carries digests.
 *
 * Physical TEE/SE access needs a native shim (Android KeyStore attestation, Apple DeviceCheck /
 * App Attest, TPM 2.0). Until one is present these probes establish the *device fingerprint* and
 * report `attestationLevel: "software"`, which is the honest answer.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";

import { sha256Hex } from "./identity.mjs";

export const PROVIDERS = Object.freeze({
  ANDROID_TEE: "android-tee-keystore",
  APPLE_SE: "apple-secure-enclave",
  TPM2: "tpm2",
  SOFTWARE: "software",
});

export const ATTESTATION_LEVELS = Object.freeze({ HARDWARE: "hardware", SOFTWARE: "software" });

function tryExec(file, args, timeoutMs) {
  try {
    const out = execFileSync(file, args, {
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
      windowsHide: true,
    });
    const trimmed = String(out).trim();
    return trimmed === "" ? null : trimmed;
  } catch {
    return null;
  }
}

export function defaultExec(file, args, timeoutMs = 2000) {
  return tryExec(file, args, timeoutMs);
}

export function defaultReadFile(file) {
  try {
    const value = readFileSync(file, "utf8").trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

function digestEntry(source, value) {
  return { source, digest: sha256Hex(`${source}:${String(value)}`) };
}

function platformInfo(platform, arch, release) {
  return { os: platform, arch, release };
}

/**
 * Collects the device fingerprint.
 *
 * `options.probes` lets a caller (or a test) inject a deterministic probe result; injected raw
 * values still pass through the same digesting step.
 */
export function collectHardwareClaims(options = {}) {
  const exec = options.exec ?? defaultExec;
  const readFile = options.readFile ?? defaultReadFile;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const release = options.release ?? os.release();
  const notes = [];
  const entries = [];
  let provider = PROVIDERS.SOFTWARE;
  let attestationLevel = ATTESTATION_LEVELS.SOFTWARE;

  if (options.probes !== undefined) {
    for (const entry of options.probes.entries ?? []) {
      entries.push(entry);
    }
    provider = options.probes.provider ?? provider;
    attestationLevel = options.probes.attestationLevel ?? attestationLevel;
    for (const note of options.probes.notes ?? []) {
      notes.push(note);
    }
  } else if (platform === "android") {
    const bootState = exec("getprop", ["ro.boot.verifiedbootstate"]);
    const flashLocked = exec("getprop", ["ro.boot.flash.locked"]);
    entries.push(
      ["android.ro.boot.verifiedbootstate", bootState],
      ["android.ro.boot.flash.locked", flashLocked],
      ["android.ro.board.platform", exec("getprop", ["ro.board.platform"]) ?? exec("getprop", ["ro.hardware"])],
      ["android.ro.product.model", exec("getprop", ["ro.product.model"])],
      ["android.ro.boot.serialno", exec("getprop", ["ro.boot.serialno"])],
    );
    if (bootState !== null || flashLocked !== null) {
      provider = PROVIDERS.ANDROID_TEE;
      const locked = String(flashLocked) === "1" || String(bootState).toLowerCase() === "green";
      attestationLevel = locked ? ATTESTATION_LEVELS.HARDWARE : ATTESTATION_LEVELS.SOFTWARE;
    }
    notes.push("Android KeyStore attestation requires a native module; boot state is used as the hardware signal.");
  } else if (platform === "darwin") {
    const ioreg = exec("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], 4000);
    const hwUuid = ioreg === null ? null : /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(ioreg)?.[1] ?? null;
    entries.push(
      ["apple.hw.machine", exec("sysctl", ["-n", "hw.machine"])],
      ["apple.hw.model", exec("sysctl", ["-n", "hw.model"])],
      ["apple.ioreg.platform-uuid", hwUuid],
      ["apple.kern.uuid", exec("sysctl", ["-n", "kern.uuid"])],
    );
    if (arch === "arm64") {
      provider = PROVIDERS.APPLE_SE;
      attestationLevel = ATTESTATION_LEVELS.HARDWARE;
      notes.push("Secure Enclave keys need a DeviceCheck / App Attest shim; Node cannot call the SE directly.");
    }
  } else if (platform === "win32") {
    const uuid =
      exec("powershell", ["-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystemProduct).UUID"], 6000);
    const tpm = exec("powershell", ["-NoProfile", "-Command", "try { (Get-Tpm).TpmPresent } catch { 'False' }"], 6000);
    entries.push(
      ["windows.csproduct.uuid", uuid],
      ["windows.tpm.present", tpm],
      ["windows.computername", os.hostname()],
    );
    if (String(tpm).toLowerCase() === "true") {
      provider = PROVIDERS.TPM2;
      attestationLevel = ATTESTATION_LEVELS.HARDWARE;
      notes.push("TPM 2.0 present; sealing the node key to the TPM requires a native module.");
    }
  } else {
    const tpmDescription = readFile("/sys/class/tpm/tpm0/device/description");
    const hasTpmDevice = existsSync("/dev/tpm0") || tpmDescription !== null;
    entries.push(
      ["linux.dmi.product-uuid", readFile("/sys/class/dmi/id/product_uuid")],
      ["linux.dmi.board-serial", readFile("/sys/class/dmi/id/board_serial")],
      ["linux.etc.machine-id", readFile("/etc/machine-id")],
      ["linux.tpm.description", tpmDescription],
    );
    if (hasTpmDevice) {
      provider = PROVIDERS.TPM2;
      attestationLevel = ATTESTATION_LEVELS.HARDWARE;
      notes.push("TPM device node found; remote attestation quotes require tpm2-tools or a native module.");
    }
  }

  entries.push(["host", os.hostname()], ["arch", arch]);

  const claims = [];
  const seen = new Set();
  for (const [source, value] of entries) {
    if (value === null || value === undefined || String(value) === "") continue;
    if (seen.has(source)) continue;
    seen.add(source);
    claims.push(digestEntry(source, value));
  }
  claims.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));

  return {
    provider,
    attestationLevel,
    platform: platformInfo(platform, arch, release),
    claims,
    notes,
  };
}
