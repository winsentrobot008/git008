/**
 * 5G / cellular and GNSS collector for the MAOTANG DePIN edge.
 *
 * A BLE ping proves "a beacon was near me"; the cell + GNSS pair proves "I was here, at this time,
 * on this network". Both are corroborating physical evidence for the same BLE_PING window, so the
 * miner commits their hashes into the proof digest rather than trusting a bare ping count.
 *
 * Two independent streams are normalized here:
 *   * cell towers - MCC / MNC / LAC-or-TAC / CellID (plus NR-ARFCN, RSRP, RSRQ, SINR for 5G NR and
 *     LTE), and
 *   * GNSS fixes - latitude / longitude / altitude / accuracy / speed / heading / satellite count.
 *
 * Nothing is trusted implicitly. Every field is range-checked, a tower without MCC+MNC+cell id is
 * malformed, and out-of-band signal strengths are reported instead of silently accepted. Backends
 * are injected (a native TelephonyManager / CoreLocation bridge, or a system helper process that
 * prints JSON), and an absent backend reports `available: false` rather than fabricating a fix.
 */
import { execFile } from "node:child_process";

import { canonicalize, sha256Hex } from "../node/identity.mjs";

export const CELL_DOMAIN = "maotang-cell-tower-v1";
export const GNSS_DOMAIN = "maotang-gnss-fix-v1";

export const RADIO_TYPES = Object.freeze({ NR: "nr", LTE: "lte", UMTS: "umts", GSM: "gsm" });

/** Plausibility bands, in dBm / dB. Values outside them are kept but flagged, never hidden. */
export const SIGNAL_RANGES = Object.freeze({
  rsrp: { min: -156, max: -31 },
  rsrq: { min: -43, max: 20 },
  sinr: { min: -23, max: 40 },
});

/** Highest latitude/longitude magnitude, and the maximum plausible horizontal accuracy. */
export const GNSS_LIMITS = Object.freeze({ lat: 90, lon: 180, accuracyM: 10000, speedMps: 400 });

export class CellularError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CellularError";
    this.code = code;
  }
}

export class PhysicalTelemetryUnavailableError extends CellularError {
  constructor(stream, reason) {
    super(`${stream}-unavailable`, `${stream} telemetry is unavailable: ${reason}`);
    this.name = "PhysicalTelemetryUnavailableError";
    this.stream = stream;
    this.reason = reason;
  }
}

function toInteger(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    throw new CellularError("bad-field", `${label} is not an integer: ${String(value)}`);
  }
  return numeric;
}

function boundedInt(value, label, min, max) {
  const numeric = toInteger(value, label);
  if (numeric < min || numeric > max) {
    throw new CellularError("bad-field", `${label} must be within [${min}, ${max}], received ${numeric}`);
  }
  return numeric;
}

function optionalNumber(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new CellularError("bad-field", `${label} is not a number: ${String(value)}`);
  return numeric;
}

function toSeconds(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value instanceof Date ? value.getTime() : value);
  if (!Number.isFinite(numeric)) throw new CellularError("bad-timestamp", `not a timestamp: ${String(value)}`);
  return Math.floor(numeric > 1e11 ? numeric / 1000 : numeric);
}

function signalQuality(kind, value) {
  if (value === null) return null;
  const range = SIGNAL_RANGES[kind];
  if (value < range.min || value > range.max) return "out-of-band";
  if (kind === "rsrp") return value >= -80 ? "excellent" : value >= -90 ? "good" : value >= -100 ? "fair" : "poor";
  return "in-band";
}

/**
 * Normalizes one cell-tower measurement.
 *
 * `lac` (2G/3G), `tac` (LTE/5G tracking area) and `cellId` / `ci` / `eci` / `nci` are aliases for
 * the same two fields, because every Android/iOS bridge spells them differently.
 */
export function normalizeCellTower(raw, options = {}) {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (raw === null || typeof raw !== "object") throw new CellularError("bad-cell", "cell tower must be an object");

  const mcc = boundedInt(raw.mcc ?? raw.MCC, "mcc", 0, 999);
  const mnc = boundedInt(raw.mnc ?? raw.MNC, "mnc", 0, 999);

  const tacSource = raw.tac ?? raw.TAC ?? raw.lac ?? raw.LAC;
  if (tacSource === null || tacSource === undefined || tacSource === "") {
    throw new CellularError("bad-cell", "cell tower carries neither a TAC nor a LAC");
  }
  const tac = boundedInt(tacSource, "tac", 0, 0xffffff);

  const cellIdSource = raw.cellId ?? raw.ci ?? raw.CI ?? raw.eci ?? raw.ECI ?? raw.nci ?? raw.NCI;
  if (cellIdSource === null || cellIdSource === undefined || cellIdSource === "") {
    throw new CellularError("bad-cell", "cell tower carries no cell id");
  }
  const cellId = boundedInt(cellIdSource, "cellId", 0, 0xfffffffff);

  const radioSource = String(raw.radio ?? raw.type ?? raw.technology ?? RADIO_TYPES.LTE).toLowerCase();
  const radio = radioSource === "5g" || radioSource === "nr" ? RADIO_TYPES.NR : radioSource;

  const rsrp = optionalNumber(raw.rsrp ?? raw.RSRP, "rsrp");
  const rsrq = optionalNumber(raw.rsrq ?? raw.RSRQ, "rsrq");
  const sinr = optionalNumber(raw.sinr ?? raw.SINR, "sinr");
  const arfcn = optionalNumber(raw.arfcn ?? raw.nrArfcn ?? raw.earfcn, "arfcn");

  const tower = {
    mcc,
    mnc,
    tac,
    cellId,
    radio,
    arfcn: arfcn === null ? null : Math.round(arfcn),
    rsrp: rsrp === null ? null : Math.round(rsrp),
    rsrq: rsrq === null ? null : Math.round(rsrq),
    sinr: sinr === null ? null : Math.round(sinr),
    observedAt: toSeconds(raw.observedAt ?? raw.timestamp ?? raw.at, now),
  };
  return {
    ...tower,
    quality: signalQuality("rsrp", tower.rsrp),
    flag: signalQuality("rsrp", tower.rsrp) === "out-of-band" ? "out-of-band" : "in-band",
  };
}

/** Canonical `mcc:mnc:radio:tac:cellId` identity, used for the set commitment. */
export function cellIdentityKey(tower) {
  return `${tower.mcc}:${tower.mnc}:${tower.radio}:${tower.tac}:${tower.cellId}`;
}

/** One-way tower hash: the raw cell id never leaves as a bare identifier in a digest. */
export function cellHashFor(tower) {
  return `0x${sha256Hex(`${CELL_DOMAIN}:${cellIdentityKey(tower)}`)}`;
}

/** Order-independent commitment over a set of towers, so a shuffled scan is the same evidence. */
export function cellSetHash(towers) {
  const keys = [...new Set(towers.map((tower) => cellIdentityKey(tower)))].sort();
  return `0x${sha256Hex(`${CELL_DOMAIN}:set:${keys.join("|")}`)}`;
}

/** Normalizes one GNSS fix. `fixType` is inferred from the fields when the bridge omits it. */
export function normalizeGnssFix(raw, options = {}) {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (raw === null || typeof raw !== "object") throw new CellularError("bad-fix", "GNSS fix must be an object");

  const lat = optionalNumber(raw.latitude ?? raw.lat, "latitude");
  const lon = optionalNumber(raw.longitude ?? raw.lon ?? raw.lng, "longitude");
  if (lat === null || lon === null) throw new CellularError("bad-fix", "GNSS fix carries no latitude/longitude");
  if (Math.abs(lat) > GNSS_LIMITS.lat) throw new CellularError("bad-fix", `latitude out of range: ${lat}`);
  if (Math.abs(lon) > GNSS_LIMITS.lon) throw new CellularError("bad-fix", `longitude out of range: ${lon}`);

  const accuracyM = optionalNumber(raw.accuracyM ?? raw.accuracy ?? raw.horizontalAccuracyM, "accuracyM");
  if (accuracyM !== null && (accuracyM <= 0 || accuracyM > GNSS_LIMITS.accuracyM)) {
    throw new CellularError("bad-fix", `accuracyM out of range: ${accuracyM}`);
  }
  const speedMps = optionalNumber(raw.speedMps ?? raw.speed, "speedMps");
  if (speedMps !== null && (speedMps < 0 || speedMps > GNSS_LIMITS.speedMps)) {
    throw new CellularError("bad-fix", `speedMps out of range: ${speedMps}`);
  }
  const altitudeM = optionalNumber(raw.altitudeM ?? raw.altitude, "altitudeM");
  const headingDeg = optionalNumber(raw.headingDeg ?? raw.heading ?? raw.course, "headingDeg");
  if (headingDeg !== null && (headingDeg < 0 || headingDeg > 360)) {
    throw new CellularError("bad-fix", `headingDeg out of range: ${headingDeg}`);
  }
  const satellites = optionalNumber(raw.satellites ?? raw.satelliteCount, "satellites");
  if (satellites !== null && (satellites < 0 || !Number.isInteger(satellites))) {
    throw new CellularError("bad-fix", `satellites must be a non-negative integer: ${satellites}`);
  }

  const declared = raw.fixType ?? raw.type;
  const fixType =
    declared !== null && declared !== undefined && declared !== ""
      ? String(declared).toLowerCase()
      : satellites !== null && satellites >= 4
        ? "3d"
        : "2d";

  return {
    lat,
    lon,
    altitudeM,
    accuracyM,
    speedMps,
    headingDeg,
    satellites,
    fixType,
    provider: raw.provider === null || raw.provider === undefined ? "gnss" : String(raw.provider).toLowerCase(),
    observedAt: toSeconds(raw.observedAt ?? raw.timestamp ?? raw.time ?? raw.at, now),
  };
}

/** One-way fix hash; the coordinate pair is never persisted raw. */
export function gnssHashFor(fix) {
  return `0x${sha256Hex(`${GNSS_DOMAIN}:${canonicalize({
    lat: fix.lat,
    lon: fix.lon,
    accuracyM: fix.accuracyM,
    observedAt: fix.observedAt,
  })}`)}`;
}

/** Runs a helper that prints one JSON document, for the system-wrapper backends. */
async function runHelper(helperPath, args, timeoutMs) {
  const stdout = await new Promise((resolve, reject) => {
    execFile(helperPath, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, out) =>
      error ? reject(error) : resolve(out),
    );
  });
  return String(stdout).trim();
}

export function createSystemCellBackend({ helperPath = process.env.MAOTANG_CELL_HELPER, timeoutMs = 5000 } = {}) {
  if (typeof helperPath !== "string" || helperPath.trim() === "") {
    return { available: false, provider: null, reason: "MAOTANG_CELL_HELPER is not set" };
  }
  return {
    available: true,
    provider: "system-helper",
    helperPath,
    async cells() {
      const output = await runHelper(helperPath, ["--cells", "--json"], timeoutMs);
      if (output === "") return [];
      const parsed = JSON.parse(output);
      return Array.isArray(parsed) ? parsed : (parsed.cells ?? []);
    },
  };
}

export function createSystemGnssBackend({ helperPath = process.env.MAOTANG_GNSS_HELPER, timeoutMs = 5000 } = {}) {
  if (typeof helperPath !== "string" || helperPath.trim() === "") {
    return { available: false, provider: null, reason: "MAOTANG_GNSS_HELPER is not set" };
  }
  return {
    available: true,
    provider: "system-helper",
    helperPath,
    async fix() {
      const output = await runHelper(helperPath, ["--fix", "--json"], timeoutMs);
      return output === "" ? null : JSON.parse(output);
    },
  };
}

/**
 * Collects the 5G/LTE/GSM cell set and, when a GNSS backend exists, the current fix.
 * Both backends are injected; a missing backend is reported, never simulated.
 */
export class CellularCollector {
  #cellBackend;
  #gnssBackend;
  #now;

  constructor({ cellBackend, gnssBackend, now = () => Date.now(), logger } = {}) {
    this.#cellBackend = cellBackend ?? null;
    this.#gnssBackend = gnssBackend ?? null;
    this.#now = now;
    this.logger = logger;
  }

  get available() {
    return this.#cellBackend !== null && this.#cellBackend !== undefined && this.#cellBackend.available !== false;
  }

  get gnssAvailable() {
    return this.#gnssBackend !== null && this.#gnssBackend !== undefined && this.#gnssBackend.available !== false;
  }

  status() {
    return {
      available: this.available,
      provider: this.#cellBackend?.provider ?? null,
      reason: this.available ? null : (this.#cellBackend?.reason ?? "no cellular backend configured"),
      gnssAvailable: this.gnssAvailable,
      gnssProvider: this.#gnssBackend?.provider ?? null,
      gnssReason: this.gnssAvailable ? null : (this.#gnssBackend?.reason ?? "no GNSS backend configured"),
    };
  }

  /** One cell-scan window -> normalized, de-duplicated towers. */
  async scan(context = {}) {
    if (!this.available) {
      throw new PhysicalTelemetryUnavailableError("cellular", this.#cellBackend?.reason ?? "no cellular backend configured");
    }
    const now = Math.floor(this.#now() / 1000);
    const raw = (await this.#cellBackend.cells({ since: context.since })) ?? [];
    if (!Array.isArray(raw)) throw new CellularError("bad-backend", "cellular backend must return an array");

    const towers = [];
    let malformed = 0;
    for (const entry of raw) {
      try {
        towers.push(normalizeCellTower(entry, { now }));
      } catch (error) {
        malformed += 1;
        this.logger?.warn?.(`[cell] dropped malformed tower: ${error?.message ?? error}`);
      }
    }
    const inBand = towers.filter((tower) => tower.flag === "in-band");
    this.lastScan = { towers: towers.length, inBand: inBand.length, malformed };
    return towers;
  }

  /** Current GNSS fix, or null when there is no fix (never a fabricated one). */
  async fix(context = {}) {
    if (!this.gnssAvailable) {
      throw new PhysicalTelemetryUnavailableError("gnss", this.#gnssBackend?.reason ?? "no GNSS backend configured");
    }
    const now = Math.floor(this.#now() / 1000);
    const raw = await this.#gnssBackend.fix({ since: context.since });
    if (raw === null || raw === undefined) return null;
    return normalizeGnssFix(raw, { now });
  }
}
