/**
 * Batch builders that turn raw on-device evidence into the 192-byte proofs MaoTangMining scores.
 *
 * Two evidence streams feed the miner:
 *   * BLE observations from nearby DePIN beacons (physical proximity), and
 *   * completed NPU/GPU inference tasks (offloaded compute).
 *
 * Nothing here talks to a network. Raw observations arrive from an injected source (a native radio
 * shim on a phone, or a fixture in tests), get filtered against the contract's rules, are hashed
 * into a set commitment, and are signed with the node's Ed25519 key so a relay cannot alter them.
 *
 * Both batches use Unix *seconds* for their window so they can be compared to `block.timestamp`.
 */
import { canonicalize, sha256Hex, signObject } from "../node/identity.mjs";
import {
  MAX_BLE_PINGS_PER_PROOF,
  MAX_BLE_RSSI,
  MAX_COMPUTE_TASKS_PER_PROOF,
  MAX_PROOF_AGE_MS,
  MIN_BLE_RSSI,
  MIN_COMPUTE_UNITS,
} from "./constants.mjs";

export const BLE_TELEMETRY_DOMAIN = "maotang-ble-telemetry-v1";
export const NPU_TASK_DOMAIN = "maotang-npu-compute-v1";

export class TelemetryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TelemetryError";
    this.code = code;
  }
}

/** "Nothing to prove this cycle" - a benign, expected outcome that must not raise an alarm. */
export class InsufficientEvidenceError extends TelemetryError {
  constructor(code, message) {
    super(code, message);
    this.name = "InsufficientEvidenceError";
  }
}

/** Accepts epoch seconds, epoch milliseconds or a Date and normalizes to epoch seconds. */
export function toSeconds(value) {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new TelemetryError("bad-timestamp", `not a timestamp: ${String(value)}`);
  return Math.floor(numeric > 1e11 ? numeric / 1000 : numeric);
}

/** Beacon ids are bytes32; anything else is hashed into one so a native shim can pass a device string. */
export function normalizeBeaconId(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new TelemetryError("bad-beacon", "beacon id is empty");
  }
  const raw = String(value).trim();
  const hex = raw.replace(/^0x/i, "");
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return `0x${hex.toLowerCase()}`;
  return `0x${sha256Hex(raw)}`;
}

export function normalizeBleObservation(raw, { now = Math.floor(Date.now() / 1000) } = {}) {
  const rssi = Math.round(Number(raw?.rssi));
  if (!Number.isFinite(rssi)) throw new TelemetryError("bad-rssi", `rssi is not a number: ${String(raw?.rssi)}`);
  return {
    beaconId: normalizeBeaconId(raw?.beaconId ?? raw?.id),
    rssi,
    observedAt: toSeconds(raw?.observedAt ?? raw?.at ?? now),
  };
}

export function normalizeComputeTask(raw, { now = Math.floor(Date.now() / 1000) } = {}) {
  const taskId = normalizeBeaconId(raw?.taskId ?? raw?.id);
  const computeUnits = Math.round(Number(raw?.computeUnits));
  if (!Number.isFinite(computeUnits) || computeUnits <= 0) {
    throw new TelemetryError("bad-compute-units", `computeUnits must be positive: ${String(raw?.computeUnits)}`);
  }
  const proofValue = raw?.proof ?? raw?.zkProof ?? raw?.proofDigest;
  if (proofValue === null || proofValue === undefined || String(proofValue).trim() === "") {
    throw new TelemetryError("missing-zk-proof", `task ${taskId} carries no proof digest`);
  }
  const proofDigest =
    /^0x[0-9a-f]{64}$/i.test(String(proofValue).trim())
      ? String(proofValue).trim().toLowerCase()
      : `0x${sha256Hex(String(proofValue))}`;
  return { taskId, computeUnits, completedAt: toSeconds(raw?.completedAt ?? raw?.at ?? now), proofDigest };
}

function setCommitment(ids) {
  return `0x${sha256Hex([...new Set(ids)].sort().join("|"))}`;
}

/**
 * Filters raw BLE observations against the contract's proximity rules and builds a BLE proof batch.
 * Out-of-band, stale and duplicate observations are dropped and reported, never silently trusted.
 */
export function batchBleObservations(observations, options = {}) {
  const { identity, now = Math.floor(Date.now() / 1000), maxPings = MAX_BLE_PINGS_PER_PROOF } = options;
  const cutoff = now - Math.floor(MAX_PROOF_AGE_MS / 1000);
  const accepted = [];
  const rejections = { outOfBand: 0, stale: 0, malformed: 0 };

  for (const raw of observations ?? []) {
    let observation;
    try {
      observation = normalizeBleObservation(raw, { now });
    } catch {
      rejections.malformed += 1;
      continue;
    }
    if (observation.rssi < MIN_BLE_RSSI || observation.rssi > MAX_BLE_RSSI) {
      rejections.outOfBand += 1;
      continue;
    }
    if (observation.observedAt < cutoff || observation.observedAt > now) {
      rejections.stale += 1;
      continue;
    }
    accepted.push(observation);
  }

  const seen = new Set();
  const unique = [];
  for (const observation of accepted.sort((a, b) => a.observedAt - b.observedAt)) {
    const key = `${observation.beaconId}:${observation.observedAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(observation);
  }

  const pings = unique.slice(-maxPings);
  if (pings.length === 0) {
    throw new InsufficientEvidenceError("no-ble-evidence", "no in-band, recent BLE observation this cycle");
  }

  const beaconIds = pings.map((observation) => observation.beaconId);
  const body = {
    beaconSetHash: setCommitment(beaconIds),
    windowStart: pings[0].observedAt,
    windowEnd: pings[pings.length - 1].observedAt,
    pingCount: pings.length,
    strongestRssi: Math.max(...pings.map((observation) => observation.rssi)),
    observations: pings.map((observation) => ({ ...observation })),
  };
  const signature = identity === undefined ? null : signObject(identity, BLE_TELEMETRY_DOMAIN, body);
  const telemetryDigest = `0x${sha256Hex(`${canonicalize(body)}\n${signature ?? ""}`)}`;

  return { ...body, telemetryDigest, telemetrySignature: signature, rejections };
}

/** Filters completed NPU tasks and builds a compute proof batch. */
export function batchComputeTasks(tasks, options = {}) {
  const { identity, now = Math.floor(Date.now() / 1000), maxTasks = MAX_COMPUTE_TASKS_PER_PROOF } = options;
  const cutoff = now - Math.floor(MAX_PROOF_AGE_MS / 1000);
  const accepted = [];
  const rejections = { stale: 0, malformed: 0 };

  for (const raw of tasks ?? []) {
    let task;
    try {
      task = normalizeComputeTask(raw, { now });
    } catch {
      rejections.malformed += 1;
      continue;
    }
    if (task.completedAt < cutoff || task.completedAt > now) {
      rejections.stale += 1;
      continue;
    }
    accepted.push(task);
  }

  const seen = new Set();
  const unique = [];
  for (const task of accepted.sort((a, b) => a.completedAt - b.completedAt)) {
    if (seen.has(task.taskId)) continue;
    seen.add(task.taskId);
    unique.push(task);
  }

  const selected = unique.slice(-maxTasks);
  if (selected.length === 0) {
    throw new InsufficientEvidenceError("no-compute-evidence", "no recent NPU task result this cycle");
  }
  const computeUnits = selected.reduce((total, task) => total + task.computeUnits, 0);
  if (computeUnits < MIN_COMPUTE_UNITS) {
    throw new InsufficientEvidenceError("insufficient-compute", `${computeUnits} compute units is below the ${MIN_COMPUTE_UNITS} minimum`);
  }

  const body = {
    taskSetHash: setCommitment(selected.map((task) => task.taskId)),
    windowStart: selected[0].completedAt,
    windowEnd: selected[selected.length - 1].completedAt,
    taskCount: selected.length,
    computeUnits,
    tasks: selected.map((task) => ({ ...task })),
  };
  const signature = identity === undefined ? null : signObject(identity, NPU_TASK_DOMAIN, body);
  const proofDigest = `0x${sha256Hex(`${canonicalize(body)}\n${signature ?? ""}`)}`;

  return { ...body, proofDigest, computeSignature: signature, rejections };
}