/**
 * UWB proximity estimator for the MAOTANG DePIN edge.
 *
 * BLE tells you *which* beacon is around; UWB tells you *how far away* it is, to centimetres, by
 * timing a two-way ranging round-trip. A UWB report is therefore the strongest physical evidence
 * the miner can carry, and it has to be parsed from the radio's own frame format.
 *
 * `parseUwbFrame` understands a fixed 48-byte ranging report - the shape a FiRa / 802.15.4z bridge
 * (Apple Nearby Interaction, Android UWB, a DW3000 driver) can fill without any dynamic encoding:
 *
 *   offset  size  field                     encoding
 *   0       2     status                    uint16 BE (0 = success, see UWB_STATUS_CODES)
 *   2       2     sequence                  uint16 BE, ranging-round counter
 *   4       8     peerAddress               opaque 8 bytes
 *   12      8     sessionId                 opaque 8 bytes
 *   20      4     distanceCm                uint32 BE
 *   24      2     rssiDbm                   int16 BE
 *   26      2     azimuthCentiDeg           int16 BE, signed hundredths of a degree
 *   28      2     elevationCentiDeg         int16 BE, signed hundredths of a degree
 *   30      2     nlosBasisPoints           uint16 BE, 0..10000 probability of no line of sight
 *   32      8     deviceTimeMicros          uint64 BE
 *   40      8     reserved / vendor tag
 *
 * Object input is accepted too, because most platform bridges hand back a decoded dictionary.
 * Ranges that are out of the physical band, or whose status says the round failed, are reported as
 * rejected rather than being quietly dropped.
 */
import { canonicalize, sha256Hex } from "../node/identity.mjs";

export const UWB_DOMAIN = "maotang-uwb-range-v1";

/** Fixed ranging-report width understood by {parseUwbFrame}. */
export const UWB_FRAME_BYTES = 48;

/** Ranging status codes. Anything not listed here is treated as "unknown" and rejected. */
export const UWB_STATUS_CODES = Object.freeze({
  0: "success",
  1: "timeout",
  2: "measurement-failed",
  3: "no-peer",
  4: "peer-busy",
  5: "session-error",
});

/** Physical plausibility band for a UWB range, in metres. */
export const MAX_RANGE_M = 300;

/** Proximity bands, in metres: `immediate` is touch distance, `far` is still "same room". */
export const PROXIMITY_BANDS = Object.freeze({ immediate: 1, near: 5, far: 30 });

export class UwbError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "UwbError";
    this.code = code;
  }
}

function asBytes(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.from(data);
  if (typeof data === "string") {
    const hex = data.replace(/^0x/i, "");
    if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
      throw new UwbError("bad-frame", "UWB frame string is not hex");
    }
    return Buffer.from(hex, "hex");
  }
  return null;
}

/** Decodes the fixed-width ranging report into raw integer fields. */
export function parseUwbFrame(frame) {
  const bytes = asBytes(frame);
  if (bytes === null) throw new UwbError("bad-frame", "UWB frame must be bytes or hex");
  if (bytes.length !== UWB_FRAME_BYTES) {
    throw new UwbError("bad-frame", `UWB frame must be ${UWB_FRAME_BYTES} bytes, received ${bytes.length}`);
  }
  return {
    status: bytes.readUInt16BE(0),
    sequence: bytes.readUInt16BE(2),
    peerAddress: `0x${bytes.subarray(4, 12).toString("hex")}`,
    sessionId: `0x${bytes.subarray(12, 20).toString("hex")}`,
    distanceCm: bytes.readUInt32BE(20),
    rssiDbm: bytes.readInt16BE(24),
    azimuthCentiDeg: bytes.readInt16BE(26),
    elevationCentiDeg: bytes.readInt16BE(28),
    nlosBasisPoints: bytes.readUInt16BE(30),
    deviceTimeMicros: bytes.readBigUInt64BE(32),
    vendorTag: `0x${bytes.subarray(40, 48).toString("hex")}`,
  };
}

function reduce(raw, options) {
  if (typeof raw === "string" || Buffer.isBuffer(raw) || raw instanceof Uint8Array || Array.isArray(raw)) {
    const frame = parseUwbFrame(raw);
    return {
      status: frame.status,
      sequence: frame.sequence,
      peerAddress: frame.peerAddress,
      sessionId: frame.sessionId,
      distanceM: frame.distanceCm / 100,
      rssiDbm: frame.rssiDbm,
      azimuthDeg: frame.azimuthCentiDeg / 100,
      elevationDeg: frame.elevationCentiDeg / 100,
      nlosProbability: frame.nlosBasisPoints / 10000,
      deviceTimeMicros: frame.deviceTimeMicros,
      observedAt: options.now,
      source: "frame",
    };
  }
  if (raw === null || typeof raw !== "object") throw new UwbError("bad-report", "UWB report must be an object or a frame");

  const distanceSource = raw.distanceM ?? (raw.distanceCm === undefined ? raw.distance : Number(raw.distanceCm) / 100);
  if (distanceSource === undefined || distanceSource === null) {
    throw new UwbError("bad-report", "UWB report carries no distance");
  }
  const nlosSource = raw.nlosProbability ?? raw.nlos;
  const timeSource = raw.deviceTimeMicros ?? raw.deviceTime;
  return {
    status: raw.status === undefined || raw.status === null ? 0 : Number(raw.status),
    sequence: raw.sequence === undefined || raw.sequence === null ? 0 : Number(raw.sequence),
    peerAddress: raw.peerAddress ?? raw.peer ?? raw.mac ?? null,
    sessionId: raw.sessionId ?? null,
    distanceM: Number(distanceSource),
    rssiDbm: raw.rssiDbm === undefined || raw.rssiDbm === null ? null : Number(raw.rssiDbm ?? raw.rssi),
    azimuthDeg: raw.azimuthDeg === undefined || raw.azimuthDeg === null ? null : Number(raw.azimuthDeg ?? raw.azimuth),
    elevationDeg:
      raw.elevationDeg === undefined || raw.elevationDeg === null ? null : Number(raw.elevationDeg ?? raw.elevation),
    nlosProbability: nlosSource === undefined || nlosSource === null ? null : Number(nlosSource),
    deviceTimeMicros: timeSource === undefined || timeSource === null ? null : Number(timeSource),
    observedAt: options.now,
    source: "object",
  };
}

function proximityBand(distanceM) {
  if (distanceM <= PROXIMITY_BANDS.immediate) return "immediate";
  if (distanceM <= PROXIMITY_BANDS.near) return "near";
  if (distanceM <= PROXIMITY_BANDS.far) return "far";
  return "beyond";
}

function qualityOf(distanceM, nlosProbability) {
  const nlos = nlosProbability === null ? null : Number(nlosProbability);
  if (nlos !== null && nlos > 0.7) return "nlos";
  if (distanceM > PROXIMITY_BANDS.far) return "far";
  return nlos !== null && nlos <= 0.3 ? "line-of-sight" : "in-band";
}

/**
 * Normalizes one UWB ranging report.
 *
 * A non-zero status is a *failed* ranging round: it is surfaced as a rejection by the caller rather
 * than converted into a distance, because a timeout measured as 0 m would look like perfect proximity.
 */
export function normalizeUwbRange(raw, options = {}) {
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const reduced = reduce(raw, { now });

  const statusName = UWB_STATUS_CODES[reduced.status];
  if (statusName === undefined) {
    throw new UwbError("bad-status", `unknown UWB ranging status ${reduced.status}`);
  }
  if (statusName !== "success") {
    throw new UwbError("ranging-failed", `UWB ranging round reported "${statusName}"`);
  }
  if (!Number.isFinite(reduced.distanceM) || reduced.distanceM < 0 || reduced.distanceM > MAX_RANGE_M) {
    throw new UwbError("bad-distance", `UWB distance out of range: ${String(reduced.distanceM)} m`);
  }

  const range = {
    distanceM: Math.round(reduced.distanceM * 1000) / 1000,
    distanceCm: Math.round(reduced.distanceM * 100),
    rssiDbm: reduced.rssiDbm === null ? null : Math.round(reduced.rssiDbm),
    azimuthDeg: reduced.azimuthDeg === null ? null : Math.round(reduced.azimuthDeg * 100) / 100,
    elevationDeg: reduced.elevationDeg === null ? null : Math.round(reduced.elevationDeg * 100) / 100,
    nlosProbability: reduced.nlosProbability === null ? null : Math.min(1, Math.max(0, reduced.nlosProbability)),
    sequence: reduced.sequence,
    observedAt: reduced.observedAt,
    band: proximityBand(reduced.distanceM),
    quality: qualityOf(reduced.distanceM, reduced.nlosProbability),
    peerHash: reduced.peerAddress === null ? null : `0x${sha256Hex(`${UWB_DOMAIN}:peer:${String(reduced.peerAddress)}`)}`,
    sessionHash: reduced.sessionId === null ? null : `0x${sha256Hex(`${UWB_DOMAIN}:session:${String(reduced.sessionId)}`)}`,
    source: reduced.source,
  };
  return range;
}

/** Closest accepted range in a window, or null. */
export function closestRange(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) return null;
  return ranges.reduce((best, range) => (range.distanceM < best.distanceM ? range : best));
}

/** Order-independent commitment over a set of ranging reports. */
export function uwbSetHash(ranges) {
  const keys = [...new Set(ranges.map((range) => `${range.peerHash ?? "self"}:${range.distanceCm}:${range.sequence}`))].sort();
  return `0x${sha256Hex(`${UWB_DOMAIN}:set:${keys.join("|")}`)}`;
}

/** Compact, signed-friendly summary of one UWB window. */
export function summarizeUwb(ranges) {
  const closest = closestRange(ranges);
  return {
    rangeCount: ranges.length,
    uwbSetHash: ranges.length === 0 ? null : uwbSetHash(ranges),
    closestDistanceM: closest === null ? null : closest.distanceM,
    closestBand: closest === null ? null : closest.band,
    closestPeerHash: closest === null ? null : closest.peerHash,
  };
}

/** A UWB ranging-source object: `{ available, provider, ranges() }`. */
export function createSystemUwbBackend({ helperPath = process.env.MAOTANG_UWB_HELPER, timeoutMs = 5000 } = {}) {
  if (typeof helperPath !== "string" || helperPath.trim() === "") {
    return { available: false, provider: null, reason: "MAOTANG_UWB_HELPER is not set" };
  }
  return {
    available: true,
    provider: "system-helper",
    helperPath,
    async ranges() {
      const output = await new Promise((resolve, reject) => {
        execFile(
          helperPath,
          ["--ranges", "--json"],
          { timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
          (error, out) => (error ? reject(error) : resolve(out)),
        );
      });
      const text = String(output).trim();
      if (text === "") return [];
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : (parsed.ranges ?? []);
    },
  };
}

/** Collects UWB ranging reports for one window; failed rounds are counted, not silently dropped. */
export class UwbRanger {
  #backend;
  #now;

  constructor({ backend, now = () => Date.now(), logger } = {}) {
    this.#backend = backend ?? null;
    this.#now = now;
    this.logger = logger;
  }

  get available() {
    return this.#backend !== null && this.#backend !== undefined && this.#backend.available !== false;
  }

  status() {
    return {
      available: this.available,
      provider: this.#backend?.provider ?? null,
      reason: this.available ? null : (this.#backend?.reason ?? "no UWB backend configured"),
    };
  }

  async scan(context = {}) {
    if (!this.available) {
      throw new UwbError("uwb-unavailable", `UWB ranging is unavailable: ${this.#backend?.reason ?? "no UWB backend configured"}`);
    }
    const now = Math.floor(this.#now() / 1000);
    const raw = (await this.#backend.ranges({ since: context.since })) ?? [];
    if (!Array.isArray(raw)) throw new UwbError("bad-backend", "UWB backend must return an array of reports");

    const ranges = [];
    const rejected = { failedRound: 0, malformed: 0 };
    for (const report of raw) {
      try {
        ranges.push(normalizeUwbRange(report, { now }));
      } catch (error) {
        if (error?.code === "ranging-failed") rejected.failedRound += 1;
        else rejected.malformed += 1;
        this.logger?.warn?.(`[uwb] dropped ranging report: ${error?.message ?? error}`);
      }
    }
    ranges.sort((a, b) => a.distanceM - b.distanceM);
    this.lastScan = { reports: raw.length, ranges: ranges.length, ...rejected };
    return ranges;
  }
}
