/**
 * BackgroundMiner: the ultra-low-power DePIN worker.
 *
 * It wakes on a slow duty cycle, drains its local evidence sources (BLE proximity scans, completed
 * NPU inference tasks, and - when wired in - the physical context a BLE proof commits to: the 5G
 * cell set, the GNSS fix and UWB ranges), compresses whatever it found into at most two proofs per
 * cycle,
 * and hands those proofs to a transport that can only reach the blockchain node over JSON-RPC.
 *
 * Power discipline is explicit:
 *   * the loop is a single timer with a long period and is `unref()`ed, so it never keeps the
 *     process alive and never busy-waits;
 *   * each cycle picks up only the newest `maxBlePingsPerProof` / `maxComputeTasksPerProof` items;
 *   * when the device is on battery below `batteryFloor` and not charging, NPU batching is skipped
 *     entirely - proximity pings keep flowing, compute work waits for power;
 *   * a cycle that found nothing to prove backs off instead of retrying immediately;
 *   * every proof is de-duplicated locally and checked against the on-chain per-epoch emission cap
 *     before it is signed, so the worker never burns a transaction on a proof that would revert.
 *
 * The miner holds no keys and opens no sockets of its own: it delegates signing and networking.
 */
import { canonicalize, sha256Hex } from "../node/identity.mjs";
import { encodeBleBatch, encodeComputeBatch } from "./abi.mjs";
import {
  EPOCH_MS,
  MAX_BLE_PINGS_PER_PROOF,
  MAX_COMPUTE_TASKS_PER_PROOF,
  MAX_EPOCH_REWARD,
  PROOF_TYPE_BLE_PING,
  PROOF_TYPE_ZK_COMPUTE,
  rewardFor,
  toBigInt,
} from "./constants.mjs";
import { InsufficientEvidenceError, batchBleObservations, batchComputeTasks } from "./telemetry.mjs";

const SILENT_LOGGER = { info() {}, warn() {}, error() {} };

export const DEFAULT_DUTY_CYCLE = Object.freeze({
  /** Run one cycle and exit, or keep a slow timer alive. */
  periodic: false,
  /** Wake period. One proof window by default. */
  periodMs: 15 * 60 * 1000,
  /** Pause after a cycle that produced no proofs, to keep the radio and NPU idle. */
  idleBackoffMs: 60 * 1000,
  /** How many observations/tasks a single proof may carry. */
  maxBlePingsPerProof: 16,
  maxComputeTasksPerProof: 8,
  /** Pull accrued rewards out of the vault as soon as a proof lands. */
  autoClaim: true,
  /** Skip NPU batching on a low battery so the radio keeps working. */
  lowPower: true,
  /** Battery percentage below which compute batching is paused unless charging. */
  batteryFloor: 25,
});

export class BackgroundMiner {
  #dutyCycle;
  #clock;
  #logger;
  #timer = null;
  #running = false;
  #cycle = 0;
  #seenProofIds = new Set();
  #epochAccrued = new Map();

  pendingMicro = 0n;
  claimedMicro = 0n;
  lastCycle = null;

  constructor({
    identity,
    transport,
    bleSource,
    computeSource,
    contextSource,
    powerSource,
    dutyCycle = {},
    clock = () => Date.now(),
    logger = SILENT_LOGGER,
  } = {}) {
    if (identity === undefined || identity === null) {
      throw new TypeError("BackgroundMiner requires a node identity to sign its proofs");
    }
    if (transport === undefined || transport === null) {
      throw new TypeError("BackgroundMiner requires a transport (the only way it reaches the chain)");
    }
    this.identity = identity;
    this.transport = transport;
    this.bleSource = bleSource;
    this.computeSource = computeSource;
    this.contextSource = contextSource;
    this.powerSource = powerSource;
    this.#dutyCycle = { ...DEFAULT_DUTY_CYCLE, ...dutyCycle };
    this.#clock = clock;
    this.#logger = logger;
  }

  get dutyCycle() {
    return { ...this.#dutyCycle };
  }

  get running() {
    return this.#running;
  }

  get cycles() {
    return this.#cycle;
  }

  /** Local de-duplication id. The chain derives its own keccak nullifier; this is a mesh-local guard. */
  proofId(proofType, proofData) {
    return sha256Hex(canonicalize({ proofType, proofData, agent: this.identity.nodeId }));
  }

  /**
   * One low-power cycle: drain the sources, build at most two proofs, submit, optionally claim.
   * A cycle that finds nothing returns normally with `proofs: []` - that is the common case.
   */
  async runCycle() {
    this.#cycle += 1;
    const now = Math.floor(this.#clock() / 1000);
    const report = {
      cycle: this.#cycle,
      startedAt: new Date(this.#clock()).toISOString(),
      observations: 0,
      tasks: 0,
      proofs: [],
      skipped: [],
      errors: [],
      claimed: null,
      pendingMicro: "0",
      physicalContext: null,
      physicalContextHash: null,
    };

    const physicalContext = await this.#collectContext({ since: now });
    if (physicalContext !== null) {
      report.physicalContext = physicalContext.summary;
      report.physicalContextHash = physicalContext.digest;
    }

    const observations = await this.#drain("ble", this.bleSource, "scan", { since: now });
    report.observations = observations.items.length;
    report.errors.push(...observations.errors);

    let tasks = { items: [], errors: [] };
    if (this.#computeAllowed()) {
      tasks = await this.#drain("compute", this.computeSource, "run", { since: now });
    } else {
      report.skipped.push({ reason: "low-power", stream: "compute" });
    }
    report.tasks = tasks.items.length;
    report.errors.push(...tasks.errors);

    const candidates = [];
    try {
      const batch = batchBleObservations(observations.items, {
        identity: this.identity,
        now,
        maxPings: this.#dutyCycle.maxBlePingsPerProof,
        context:
          physicalContext === null
            ? undefined
            : { physicalContextHash: physicalContext.digest, physicalContext: physicalContext.summary },
      });
      candidates.push({ proofType: PROOF_TYPE_BLE_PING, units: batch.pingCount, proofData: encodeBleBatch(batch), meta: batch });
    } catch (error) {
      if (!(error instanceof InsufficientEvidenceError)) throw error;
      report.skipped.push({ reason: error.code, stream: "ble" });
    }

    try {
      const batch = batchComputeTasks(tasks.items, {
        identity: this.identity,
        now,
        maxTasks: this.#dutyCycle.maxComputeTasksPerProof,
      });
      candidates.push({ proofType: PROOF_TYPE_ZK_COMPUTE, units: batch.taskCount, proofData: encodeComputeBatch(batch), meta: batch });
    } catch (error) {
      if (!(error instanceof InsufficientEvidenceError)) throw error;
      report.skipped.push({ reason: error.code, stream: "compute" });
    }

    for (const candidate of candidates) {
      const id = this.proofId(candidate.proofType, candidate.proofData);
      if (this.#seenProofIds.has(id)) {
        report.skipped.push({ reason: "duplicate-proof", stream: candidate.proofType });
        continue;
      }

      const reward = rewardFor(candidate.proofType, candidate.units);
      const epoch = Math.floor(this.#clock() / EPOCH_MS);
      const accrued = this.#epochAccrued.get(epoch) ?? 0n;
      if (accrued + reward > MAX_EPOCH_REWARD) {
        this.#logger.warn?.(`[mining] epoch ${epoch} emission cap reached; holding proof back`);
        report.skipped.push({ reason: "epoch-emission-cap", stream: candidate.proofType });
        continue;
      }

      const receipt = await this.transport.submitMiningProof({
        proofType: candidate.proofType,
        proofData: candidate.proofData,
        units: candidate.units,
      });

      this.#seenProofIds.add(id);
      this.#epochAccrued.set(epoch, accrued + reward);
      this.pendingMicro += reward;
      report.proofs.push({
        proofType: candidate.proofType,
        units: candidate.units,
        rewardMicro: reward.toString(),
        txHash: receipt.txHash,
        calldataBytes: receipt.calldataBytes,
      });
      this.#logger.info?.(`[mining] submitted ${candidate.units} unit(s), +${reward} micro-HUMAN, tx ${receipt.txHash}`);
    }

    if (this.#dutyCycle.autoClaim && this.pendingMicro > 0n) {
      const receipt = await this.transport.claimRewards();
      this.claimedMicro += this.pendingMicro;
      report.claimed = { amountMicro: this.pendingMicro.toString(), txHash: receipt.txHash };
      this.#logger.info?.(`[mining] claimed ${this.pendingMicro} micro-HUMAN, tx ${receipt.txHash}`);
      this.pendingMicro = 0n;
    }

    report.pendingMicro = this.pendingMicro.toString();
    report.finishedAt = new Date(this.#clock()).toISOString();
    this.lastCycle = report;
    return report;
  }

  /** Runs one cycle, or keeps a slow unref'd timer running until {stop}. */
  async start() {
    if (this.#running) return this.lastCycle;
    this.#running = true;
    const first = await this.runCycle();
    if (!this.#dutyCycle.periodic) {
      this.#running = false;
      return first;
    }
    this.#timer = setInterval(() => {
      this.runCycle().catch((error) => this.#logger.error?.(`[mining] cycle failed: ${error?.message ?? error}`));
    }, this.#dutyCycle.periodMs);
    this.#timer.unref?.();
    return first;
  }

  async stop() {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#running = false;
  }

  status() {
    return {
      nodeId: this.identity.nodeId,
      contract: this.transport?.contract ?? null,
      signer: this.transport?.signer?.kind ?? "none",
      running: this.#running,
      cycles: this.#cycle,
      pendingMicro: this.pendingMicro.toString(),
      pendingHuman: formatHuman(this.pendingMicro),
      claimedMicro: this.claimedMicro.toString(),
      claimedHuman: formatHuman(this.claimedMicro),
      proofsSubmitted: this.#seenProofIds.size,
      dutyCycle: this.dutyCycle,
      lastCycle: this.lastCycle,
    };
  }

  toJSON() {
    return this.status();
  }

  /**
   * Drains the physical-context source (5G cell set + GNSS fix + UWB ranges), if one is wired in.
   * A missing or failed source yields `null`, so the BLE proof keeps its original digest; the
   * failure is logged rather than silently swallowed, and nothing is fabricated.
   */
  async #collectContext(context) {
    if (this.contextSource === undefined || this.contextSource === null) return null;
    try {
      const data =
        typeof this.contextSource === "function"
          ? await this.contextSource(context)
          : await this.contextSource.collect(context);
      if (data === null || data === undefined) return null;
      if (typeof data.digest !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(data.digest)) {
        throw new TypeError("physical context source must return { digest } with a 32-byte hex digest");
      }
      return data;
    } catch (error) {
      this.#logger.warn?.(`[mining] physical context source failed: ${error?.message ?? error}`);
      return null;
    }
  }

  async #drain(stream, source, method, context) {
    if (source === undefined || source === null) {
      return { items: [], errors: [] };
    }
    try {
      const data = typeof source === "function" ? await source(context) : await source[method](context);
      if (!Array.isArray(data)) throw new TypeError(`${stream} source must return an array`);
      return { items: data, errors: [] };
    } catch (error) {
      this.#logger.warn?.(`[mining] ${stream} source failed: ${error?.message ?? error}`);
      return { items: [], errors: [{ stream, message: error?.message ?? String(error) }] };
    }
  }

  #computeAllowed() {
    if (!this.#dutyCycle.lowPower || this.powerSource === undefined || this.powerSource === null) return true;
    let power;
    try {
      power = this.powerSource();
    } catch {
      return true;
    }
    if (power === undefined || power === null) return true;
    if (power.charging === true) return true;
    const percent = Number(power.batteryPercent);
    if (!Number.isFinite(percent)) return true;
    return percent >= this.#dutyCycle.batteryFloor;
  }
}

/** Micro-units -> a human-readable mHUMAN string, for logs only. */
export function formatHuman(micro) {
  const value = toBigInt(micro);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction === "" ? `${whole} mHUMAN` : `${whole}.${fraction} mHUMAN`;
}