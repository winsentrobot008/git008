/**
 * Composition root for the physical DePIN edge: BLE + 5G/cellular + GNSS + UWB.
 *
 * The three scanner modules each own one radio and report `available: false` when their backend is
 * missing. This module fuses them into the two shapes `BackgroundMiner` already drains:
 *
 *   * `scan(context)`    -> BLE observations (the `bleSource` stream), and
 *   * `collect(context)` -> the physical *context* the BLE proof commits to (cell set hash, GNSS
 *                           digest, UWB range set), which `mining/telemetry.mjs` folds into the
 *                           signed telemetry digest.
 *
 * Two invariants matter here:
 *
 *   1. **Nothing is fabricated.** A missing radio produces `null` fields and an entry in
 *      `unavailable`, so a verifier can see exactly which evidence was present.
 *   2. **The context is deterministic.** Only numbers, strings, `null` and string arrays are emitted
 *      (never `undefined`), because the context is canonicalized and hashed on both the miner and
 *      any consumer that re-derives the digest.
 */
import { canonicalize, sha256Hex } from "../node/identity.mjs";

import { BleScanner, createNobleBleBackend, createSystemBleBackend, loadNativeBleBackend } from "./ble-scanner.mjs";
import {
  CellularCollector,
  cellSetHash,
  createSystemCellBackend,
  createSystemGnssBackend,
  gnssHashFor,
} from "./cellular-collector.mjs";
import { UwbRanger, createSystemUwbBackend, summarizeUwb } from "./uwb-ranger.mjs";

export const PHYSICAL_CONTEXT_DOMAIN = "maotang-physical-context-v1";

function strongestRsrp(towers) {
  const values = towers.map((tower) => tower.rsrp).filter((value) => value !== null && value !== undefined);
  return values.length === 0 ? null : Math.max(...values);
}

function uniqueRadios(towers) {
  return [...new Set(towers.map((tower) => tower.radio))].sort();
}

/**
 * Fuses the three evidence streams into one fixed-shape context object.
 * Every field is present; absence is `null` plus the stream name in `unavailable`.
 */
export function summarizePhysicalContext({ cells = [], gnss = null, uwb = [], unavailable = [], observedAt = null } = {}) {
  const uwbSummary = summarizeUwb(uwb);
  return {
    version: 1,
    observedAt,
    cellCount: cells.length,
    inBandCellCount: cells.filter((tower) => tower.flag === "in-band").length,
    cellSetHash: cells.length === 0 ? null : cellSetHash(cells),
    cellRadios: uniqueRadios(cells),
    strongestRsrpDbm: strongestRsrp(cells),
    gnssFixCount: gnss === null ? 0 : 1,
    gnssDigest: gnss === null ? null : gnss.digest,
    gnssLatitude: gnss === null ? null : gnss.fix.lat,
    gnssLongitude: gnss === null ? null : gnss.fix.lon,
    gnssAccuracyM: gnss === null ? null : gnss.fix.accuracyM,
    gnssFixType: gnss === null ? null : gnss.fix.fixType,
    gnssObservedAt: gnss === null ? null : gnss.fix.observedAt,
    uwbRangeCount: uwbSummary.rangeCount,
    uwbSetHash: uwbSummary.uwbSetHash,
    uwbClosestDistanceM: uwbSummary.closestDistanceM,
    uwbClosestBand: uwbSummary.closestBand,
    unavailable: [...unavailable].sort(),
  };
}

/** Commits the fused context to a single bytes32, so the proof digest covers all four radios. */
export function physicalContextHash(context) {
  return `0x${sha256Hex(`${PHYSICAL_CONTEXT_DOMAIN}:${canonicalize(context)}`)}`;
}

/**
 * Builds the default `{ scan, collect, status }` source from the environment.
 *
 * Each radio is bridged by a system helper (`MAOTANG_BLE_HELPER`, `MAOTANG_CELL_HELPER`,
 * `MAOTANG_GNSS_HELPER`, `MAOTANG_UWB_HELPER`), with `noble` as the optional native BLE fallback.
 * A missing helper simply reports that stream unavailable; nothing is simulated.
 */
export async function createSystemDepinSource({ env = process.env, logger, now = () => Date.now() } = {}) {
  const helperBle = createSystemBleBackend({ helperPath: env.MAOTANG_BLE_HELPER });
  const native = helperBle.available === true ? null : await loadNativeBleBackend();
  const bleBackend =
    helperBle.available === true
      ? helperBle
      : native?.available === true
        ? createNobleBleBackend({ api: native.api ?? null })
        : helperBle;

  return createDepinTelemetrySource({
    ble: new BleScanner({ backend: bleBackend, mode: env.MAOTANG_BLE_MODE, logger, now }),
    cellular: new CellularCollector({
      cellBackend: createSystemCellBackend({ helperPath: env.MAOTANG_CELL_HELPER }),
      gnssBackend: createSystemGnssBackend({ helperPath: env.MAOTANG_GNSS_HELPER }),
      logger,
      now,
    }),
    uwb: new UwbRanger({ backend: createSystemUwbBackend({ helperPath: env.MAOTANG_UWB_HELPER }), logger, now }),
    logger,
    now,
  });
}

/**
 * Builds the `{ scan, collect, status }` adapter used as both `bleSource` and `contextSource`.
 *
 * `ble` is a {BleScanner}; `cellular` is a {CellularCollector} (cells + GNSS); `uwb` is a
 * {UwbRanger}. Any of them may be omitted, and the corresponding stream is then reported unavailable.
 */
export function createDepinTelemetrySource({ ble, cellular, uwb, logger, now = () => Date.now() } = {}) {
  async function scan(context = {}) {
    if (ble === undefined || ble === null) return [];
    return ble.scan(context);
  }

  async function collect(context = {}) {
    const unavailable = [];
    let cells = [];
    let gnss = null;
    let ranges = [];

    if (cellular !== undefined && cellular !== null) {
      try {
        cells = await cellular.scan(context);
      } catch (error) {
        unavailable.push("cellular");
        logger?.warn?.(`[depin] cellular scan unavailable: ${error?.message ?? error}`);
      }
      try {
        const fix = await cellular.fix(context);
        gnss = fix === null ? null : { fix, digest: gnssHashFor(fix) };
      } catch (error) {
        unavailable.push("gnss");
        logger?.warn?.(`[depin] GNSS fix unavailable: ${error?.message ?? error}`);
      }
    } else {
      unavailable.push("cellular", "gnss");
    }

    if (uwb !== undefined && uwb !== null) {
      try {
        ranges = await uwb.scan(context);
      } catch (error) {
        unavailable.push("uwb");
        logger?.warn?.(`[depin] UWB ranging unavailable: ${error?.message ?? error}`);
      }
    } else {
      unavailable.push("uwb");
    }

    const observedAt = Math.floor(now() / 1000);
    const summary = summarizePhysicalContext({ cells, gnss, uwb: ranges, unavailable, observedAt });
    return { cells, gnss: gnss === null ? null : gnss.fix, uwb: ranges, summary, digest: physicalContextHash(summary) };
  }

  function status() {
    return {
      ble: ble?.status?.() ?? { available: false, reason: "no BLE scanner configured" },
      cellular: cellular?.status?.() ?? { available: false, gnssAvailable: false, reason: "no cellular collector configured" },
      uwb: uwb?.status?.() ?? { available: false, reason: "no UWB ranger configured" },
      available: Boolean(ble?.available) || Boolean(cellular?.available) || Boolean(uwb?.available),
    };
  }

  return { scan, collect, status };
}
