/**
 * BLE proximity scanner for the MAOTANG DePIN edge.
 *
 * The scanner is the *physical* half of a BLE_PING proof. It does three real jobs and delegates
 * only the radio itself:
 *
 *   1. parses raw Bluetooth-GAP advertising data (AD structures) into flags, local name, service
 *      UUIDs, TX power, service data and manufacturer data - the same byte layout every BLE
 *      advertiser emits, so a native shim can hand us the packet verbatim;
 *   2. reduces every advertiser to a one-way *node hash* - a beacon's identity on the wire is a
 *      device address or a manufacturer payload, and neither should be persisted raw;
 *   3. normalizes one scan window into the `{ beaconId, rssi, observedAt }` observations that
 *      `mining/telemetry.mjs` filters into a BLE_PING batch.
 *
 * Two backends are supported and both are injected, so nothing here talks to a radio directly:
 *   * a native module (`noble` / `@abandonware/noble` / a vendor HCI wrapper) loaded lazily, and
 *   * a *system native wrapper*: any helper process that prints one JSON advertiser per line on
 *     stdout (Android `cmd bluetooth_manager`, a `btmon` parser, a Swift/Java applet, ...).
 *
 * When neither backend is present the scanner reports `available: false` and `scan()` throws
 * {BleUnavailableError}. It never invents observations: an absent radio must be visible in the
 * report, exactly like the hardware-attestation probes report `attestationLevel: "software"`.
 */
import { execFile } from "node:child_process";

import { sha256Hex } from "../node/identity.mjs";

export const BLE_SCAN_MODES = Object.freeze({ PASSIVE: "passive", ACTIVE: "active" });

/** Domain separation for the beacon -> node-hash reduction. */
export const BLE_NODE_DOMAIN = "maotang-ble-node-v1";

/** Placeholder Bluetooth SIG company id used by MAOTANG test beacons (0xFFFF is reserved for testing). */
export const MAOTANG_BLE_COMPANY_ID = 0xffff;

/** Advertising-data type codes we understand (Bluetooth Core Spec, Vol 3, Part C, 11). */
export const AD_TYPES = Object.freeze({
  FLAGS: 0x01,
  UUID16_INCOMPLETE: 0x02,
  UUID16_COMPLETE: 0x03,
  UUID32_INCOMPLETE: 0x04,
  UUID32_COMPLETE: 0x05,
  UUID128_INCOMPLETE: 0x06,
  UUID128_COMPLETE: 0x07,
  NAME_SHORT: 0x08,
  NAME_COMPLETE: 0x09,
  TX_POWER: 0x0a,
  SERVICE_DATA_16: 0x16,
  MANUFACTURER: 0xff,
});

export class BleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BleError";
    this.code = code;
  }
}

/** No radio backend is reachable on this device. */
export class BleUnavailableError extends BleError {
  constructor(reason) {
    super("ble-unavailable", `BLE scanning is unavailable: ${reason}`);
    this.name = "BleUnavailableError";
    this.reason = reason;
  }
}

function asBytes(data) {
  if (data === null || data === undefined) return null;
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.from(data);
  if (typeof data === "string") {
    const hex = data.replace(/^0x/i, "");
    if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
      throw new BleError("bad-advertising-data", "advertising data string is not hex");
    }
    return Buffer.from(hex, "hex");
  }
  return null;
}

function shortUuid(hex) {
  return `0x${hex.toLowerCase()}`;
}

function longUuid(hex) {
  const value = hex.toLowerCase();
  return `0x${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

/**
 * Parses a BLE advertising packet (the AD-structure list) into its fields.
 *
 * A malformed structure terminates parsing at that point rather than throwing: real radios emit
 * truncated tails, and one bad advertiser must not lose the whole scan window.
 */
export function parseAdvertisingData(data) {
  const bytes = asBytes(data);
  if (bytes === null) throw new BleError("bad-advertising-data", "advertising data must be bytes or hex");
  if (bytes.length === 0) throw new BleError("bad-advertising-data", "advertising data is empty");

  const result = {
    flags: null,
    localName: null,
    txPower: null,
    serviceUuids: [],
    serviceData: [],
    manufacturerData: [],
    adStructures: 0,
  };

  let offset = 0;
  while (offset < bytes.length) {
    const length = bytes[offset];
    if (length === 0) break; // zero-length field terminates the packet
    const typeIndex = offset + 1;
    const end = typeIndex + length; // `length` counts the type byte plus its payload
    if (end > bytes.length) break; // truncated tail
    const type = bytes[typeIndex];
    const value = bytes.subarray(typeIndex + 1, end);
    result.adStructures += 1;

    switch (type) {
      case AD_TYPES.FLAGS:
        result.flags = value.length === 0 ? 0 : value[0];
        break;
      case AD_TYPES.NAME_SHORT:
      case AD_TYPES.NAME_COMPLETE:
        result.localName = value.toString("utf8").replace(/\0+$/, "");
        break;
      case AD_TYPES.TX_POWER:
        if (value.length >= 1) result.txPower = value.readInt8(0);
        break;
      case AD_TYPES.UUID16_INCOMPLETE:
      case AD_TYPES.UUID16_COMPLETE:
        for (let i = 0; i + 1 < value.length; i += 2) {
          result.serviceUuids.push(shortUuid(value.subarray(i, i + 2).toString("hex")));
        }
        break;
      case AD_TYPES.UUID32_INCOMPLETE:
      case AD_TYPES.UUID32_COMPLETE:
        for (let i = 0; i + 3 < value.length; i += 4) {
          result.serviceUuids.push(shortUuid(value.subarray(i, i + 4).toString("hex")));
        }
        break;
      case AD_TYPES.UUID128_INCOMPLETE:
      case AD_TYPES.UUID128_COMPLETE:
        for (let i = 0; i + 15 < value.length; i += 16) {
          result.serviceUuids.push(longUuid(value.subarray(i, i + 16).toString("hex")));
        }
        break;
      case AD_TYPES.SERVICE_DATA_16:
        if (value.length >= 2) {
          result.serviceData.push({
            uuid: shortUuid(value.subarray(0, 2).toString("hex")),
            data: `0x${value.subarray(2).toString("hex")}`,
          });
        }
        break;
      case AD_TYPES.MANUFACTURER:
        if (value.length >= 2) {
          result.manufacturerData.push({
            companyId: value.readUInt16LE(0),
            data: `0x${value.subarray(2).toString("hex")}`,
          });
        }
        break;
      default:
        break;
    }

    offset = end;
  }

  return result;
}

/** One-way node hash for a physical beacon. Raw device ids never leave this module. */
export function nodeHashFor(deviceId) {
  if (deviceId === null || deviceId === undefined || String(deviceId).trim() === "") {
    throw new BleError("bad-device-id", "beacon device id is empty");
  }
  return `0x${sha256Hex(`${BLE_NODE_DOMAIN}:${String(deviceId).trim()}`)}`;
}

/**
 * Extracts the beacon's advertised node hash, when the beacon carries one.
 *
 * MAOTANG beacons put a 32-byte node hash in the manufacturer-specific field so the beacon's
 * identity is self-certifying rather than a MAC address a phone would have to log.
 */
export function extractAdvertisedNodeHash(parsed, companyId = MAOTANG_BLE_COMPANY_ID) {
  for (const entry of parsed?.manufacturerData ?? []) {
    if (entry.companyId !== companyId) continue;
    const hex = String(entry.data).replace(/^0x/, "");
    if (hex.length >= 64) return `0x${hex.slice(0, 64).toLowerCase()}`;
  }
  return null;
}

/**
 * Normalizes one raw advertiser from a backend into a telemetry observation.
 * `raw` may be a processed object (noble style) or a raw advertising packet.
 */
export function normalizeAdvertiser(raw, options = {}) {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const mode = options.mode ?? BLE_SCAN_MODES.PASSIVE;
  const companyId = options.companyId ?? MAOTANG_BLE_COMPANY_ID;

  if (raw === null || typeof raw !== "object") {
    throw new BleError("bad-advertiser", "advertiser must be an object");
  }

  const rssi = Math.round(Number(raw.rssi ?? raw.RSSI));
  if (!Number.isFinite(rssi)) throw new BleError("bad-rssi", `advertiser carries no numeric rssi: ${raw.rssi}`);

  const observedAtSeconds = Number(raw.observedAt ?? raw.timestamp ?? raw.time);
  const observedAt = Number.isFinite(observedAtSeconds)
    ? Math.floor(observedAtSeconds > 1e11 ? observedAtSeconds / 1000 : observedAtSeconds)
    : now;

  const advertised =
    raw.manufacturerData !== undefined || raw.advertisement !== undefined || raw.adData !== undefined
      ? parseAdvertisingData(raw.manufacturerData ?? raw.advertisement ?? raw.adData)
      : null;

  const deviceId = raw.deviceId ?? raw.address ?? raw.id ?? raw.uuid ?? raw.peripheral;
  const nodeHash = raw.nodeHash ?? (advertised === null ? null : extractAdvertisedNodeHash(advertised, companyId));

  const beaconId = nodeHash ?? nodeHashFor(deviceId ?? `${rssi}:${observedAt}`);

  return {
    beaconId,
    rssi,
    observedAt,
    mode,
    nodeHash,
    deviceIdHash: deviceIdHashFor(deviceId),
    localName: raw.localName ?? raw.name ?? advertised?.localName ?? null,
    txPower: raw.txPower ?? advertised?.txPower ?? null,
    serviceUuids: raw.serviceUuids ?? advertised?.serviceUuids ?? [],
  };
}

/** A stable, one-way handle for the radio device id; used for de-duplication only, never persisted raw. */
function deviceIdHashFor(deviceId) {
  if (deviceId === null || deviceId === undefined || String(deviceId).trim() === "") return null;
  return `0x${sha256Hex(`maotang-ble-device-v1:${String(deviceId).trim()}`)}`;
}

/** Loads an optional native BLE module without making it a hard dependency. */
export async function loadNativeBleBackend({ specifiers = ["noble", "@abandonware/noble"] } = {}) {
  for (const specifier of specifiers) {
    try {
      const imported = await import(specifier);
      const api = imported?.default ?? imported;
      if (api !== null && typeof api === "object" && (typeof api.on === "function" || typeof api.startScanning === "function")) {
        return { available: true, provider: specifier, api, error: null };
      }
    } catch {
      // try the next specifier
    }
  }
  return { available: false, provider: null, api: null, error: "no native BLE module is installed" };
}

/**
 * Adapts a `noble` / `@abandonware/noble` module into the backend contract {scan()} expects.
 *
 * The adapter owns the event wiring - subscribe, start, wait one window, stop, unsubscribe - so the
 * scanner stays ignorant of which fork is installed. Both the promise-returning API
 * (`startScanningAsync`) and the classic callback API are supported.
 */
export function createNobleBleBackend({ api = null, scanWindowMs = 3000, allowDuplicates = true } = {}) {
  if (api === null || api === undefined || typeof api.on !== "function") {
    return { available: false, provider: null, reason: "no noble event emitter was provided" };
  }
  return {
    available: true,
    provider: "noble",
    async scan({ windowMs = scanWindowMs } = {}) {
      const advertisers = [];
      const onDiscover = (peripheral) => {
        if (peripheral === null || typeof peripheral !== "object") return;
        const advertisement = peripheral.advertisement ?? {};
        advertisers.push({
          deviceId: peripheral.address ?? peripheral.id ?? peripheral.uuid,
          rssi: peripheral.rssi,
          localName: advertisement.localName ?? null,
          txPower: advertisement.txPowerLevel ?? null,
          serviceUuids: advertisement.serviceUuids ?? [],
          manufacturerData: advertisement.manufacturerData,
          observedAt: Math.floor(Date.now() / 1000),
        });
      };
      api.on("discover", onDiscover);
      try {
        await startNobleScan(api, allowDuplicates);
        await new Promise((resolve) => setTimeout(resolve, windowMs));
      } finally {
        try {
          await stopNobleScan(api);
        } finally {
          if (typeof api.removeListener === "function") api.removeListener("discover", onDiscover);
          else if (typeof api.off === "function") api.off("discover", onDiscover);
        }
      }
      return advertisers;
    },
  };
}

async function startNobleScan(api, allowDuplicates) {
  if (typeof api.startScanningAsync === "function") {
    await api.startScanningAsync([], allowDuplicates);
    return;
  }
  await new Promise((resolve, reject) => {
    api.startScanning([], allowDuplicates, (error) => (error ? reject(error) : resolve()));
  });
}

async function stopNobleScan(api) {
  if (typeof api.stopScanningAsync === "function") {
    await api.stopScanningAsync();
    return;
  }
  api.stopScanning();
}

/**
 * A *system native wrapper* backend: runs a helper process that prints one JSON advertiser per
 * line on stdout. This is how a phone-owned HCI bridge (Android BluetoothLeScanner, a `btmon`
 * parser, a Swift applet) is wired in without shipping a native Node addon.
 */
export function createSystemBleBackend({ helperPath = process.env.MAOTANG_BLE_HELPER, timeoutMs = 5000 } = {}) {
  if (typeof helperPath !== "string" || helperPath.trim() === "") {
    return { available: false, provider: null, reason: "MAOTANG_BLE_HELPER is not set" };
  }
  return {
    available: true,
    provider: "system-helper",
    helperPath,
    /** Runs the helper for one scan window and returns the JSON lines it printed. */
    async scan({ windowMs = 3000 } = {}) {
      const stdout = await new Promise((resolve, reject) => {
        execFile(
          helperPath,
          ["--window-ms", String(windowMs), "--jsonl"],
          { timeout: timeoutMs + windowMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
          (error, out) => (error ? reject(error) : resolve(out)),
        );
      });
      return String(stdout)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter((entry) => entry !== null);
    },
  };
}

/**
 * Scans for nearby DePIN beacons and returns telemetry observations.
 *
 * `backend` is injected (tests, a browser bridge, a native shim). With no backend the scanner is
 * simply unavailable - {scan} throws and {status} says so, and no observation is fabricated.
 */
export class BleScanner {
  #backend;
  #mode;
  #windowMs;
  #now;

  constructor({ backend, mode = BLE_SCAN_MODES.PASSIVE, windowMs = 3000, now = () => Date.now(), logger } = {}) {
    if (mode !== BLE_SCAN_MODES.PASSIVE && mode !== BLE_SCAN_MODES.ACTIVE) {
      throw new BleError("bad-mode", `scan mode must be "passive" or "active", received ${mode}`);
    }
    this.#backend = backend ?? null;
    this.#mode = mode;
    this.#windowMs = windowMs;
    this.#now = now;
    this.logger = logger;
  }

  get mode() {
    return this.#mode;
  }

  get windowMs() {
    return this.#windowMs;
  }

  get available() {
    return this.#backend !== null && this.#backend !== undefined && this.#backend.available !== false;
  }

  status() {
    return {
      available: this.available,
      provider: this.#backend?.provider ?? null,
      mode: this.#mode,
      windowMs: this.#windowMs,
      reason: this.available ? null : (this.#backend?.reason ?? "no BLE backend configured"),
    };
  }

  /**
   * One scan window -> observations, newest last, de-duplicated by (node handle, timestamp).
   * Throws {BleUnavailableError} when no radio backend is configured.
   */
  async scan(context = {}) {
    if (!this.available) {
      throw new BleUnavailableError(this.#backend?.reason ?? "no BLE backend configured");
    }
    const now = Math.floor(this.#now() / 1000);
    const windowMs = context.windowMs ?? this.#windowMs;
    const raw = (await this.#backend.scan({ windowMs, mode: this.#mode, since: context.since })) ?? [];
    if (!Array.isArray(raw)) throw new BleError("bad-backend", "BLE backend must return an array of advertisers");

    const observations = [];
    let malformed = 0;
    for (const advertiser of raw) {
      try {
        observations.push(normalizeAdvertiser(advertiser, { now, mode: this.#mode }));
      } catch (error) {
        malformed += 1;
        this.logger?.warn?.(`[ble] dropped malformed advertiser: ${error?.message ?? error}`);
      }
    }

    const seen = new Set();
    const unique = [];
    for (const observation of observations.sort((a, b) => a.observedAt - b.observedAt)) {
      const key = `${observation.beaconId}:${observation.observedAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(observation);
    }
    this.lastScan = { mode: this.#mode, windowMs, advertisers: raw.length, observations: unique.length, malformed };
    return unique;
  }
}
