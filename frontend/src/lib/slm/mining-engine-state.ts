/**
 * M1 console - the on-demand edge compute state machine.
 *
 * The M1 model is ~400 MiB of weights and, once resident, wants a GPU. Both are expensive in exactly the
 * two currencies a phone cannot spare: battery and thermals. So the console runs in one of two modes, and
 * this module is the machine that decides which one - it is deliberately *not* a component, because the
 * rule it encodes is a policy about the owner's device, and a policy belongs in a testable function.
 *
 * The rule:
 *
 *   `IDLE_SOVEREIGN` is the resting state. It is **zero-energy**: no bytes are fetched, no GPU adapter is
 *   requested, no model work is scheduled. It is also the state a freshly rendered console is in, because
 *   importing this module and constructing an engine performs no work at all.
 *
 *   Leaving `IDLE_SOVEREIGN` takes an explicit owner intent that names *why* the device must wake up:
 *   either the owner is executing a **network transaction** or the owner is **activating mining**. Those
 *   are the only two gates, and {@link ComputeGateKind} is closed - there is no third value a caller could
 *   invent to smuggle in a background transfer.
 *
 *   The wake-up walks exactly two steps, so the console can say honestly what it is doing:
 *   `FETCHING_CORE` (transfer, length-check and SHA-256 verify the pinned artifact) then `MOUNTING_GPU`
 *   (bind the compute backend). `ACTIVE` is the only phase in which a compute-consuming action may run.
 *
 * Every other transition is a refusal, and refusals are values: the reducer reports `ok: false` with a
 * stable code and leaves the phase untouched. Two of them are load-bearing rather than defensive:
 *
 *   - `owner-intent` while **not** idle is `COMPUTE_ALREADY_ENGAGED`. The heavy path is entered once.
 *   - `core-verified` / `gpu-bound` from `IDLE_SOVEREIGN` is `OWNER_INTENT_REQUIRED`. A loader that
 *     resolved on its own - a stray `useEffect`, a resumed promise, a caller that skipped the gesture -
 *     cannot mount a GPU, because the machine has no edge from the preview state to either work state.
 *
 * Time is an explicit argument (`nowMs`) rather than a hidden `Date.now()`, matching `SpendWindowLedger`
 * and the telemetry collector: a machine that reads the wall clock internally cannot be replayed.
 */

/** The phase the console is in. `IDLE_SOVEREIGN` is the only zero-energy one. */
export type SlmEnginePhase = "IDLE_SOVEREIGN" | "FETCHING_CORE" | "MOUNTING_GPU" | "ACTIVE" | "FAULT";

/** The two - and only two - reasons the device is allowed to leave its zero-energy preview. */
export type ComputeGateKind = "network-transaction" | "mining-activation";

/** Every gate, so a caller can enumerate and assert the closed set instead of guessing. */
export const COMPUTE_GATES: readonly ComputeGateKind[] = Object.freeze([
  "network-transaction",
  "mining-activation",
]);

/** The compute backend a CPU-only fallback deliberately keeps available. */
export type SlmEngineBackend = "webgpu" | "wasm";

/** Why a transition was refused. Stable strings: logged and asserted, never shown raw to a user. */
export type SlmEngineRefusalCode =
  | "OWNER_INTENT_REQUIRED"
  | "COMPUTE_ALREADY_ENGAGED"
  | "CORE_NOT_VERIFIED"
  | "GPU_NOT_MOUNTED"
  | "NO_COMPUTE_TO_RELEASE"
  | "FAULTED_REQUIRES_RELEASE";

/** Human-readable phase labels, so the state machine and its console cannot drift apart. */
export const SLM_ENGINE_PHASE_LABEL: Readonly<Record<SlmEnginePhase, string>> = Object.freeze({
  IDLE_SOVEREIGN: "IDLE_SOVEREIGN \u00b7 zero-energy preview",
  FETCHING_CORE: "FETCHING_CORE \u00b7 verifying pinned weights",
  MOUNTING_GPU: "MOUNTING_GPU \u00b7 binding compute backend",
  ACTIVE: "ACTIVE \u00b7 mining node live",
  FAULT: "FAULT \u00b7 compute halted",
});

/** Transfer progress of the core fetch. `fraction` is `null` while the total length is unknown. */
export interface SlmCoreProgress {
  readonly loadedBytes: number;
  readonly totalBytes: number;
  readonly fraction: number | null;
}

/** A recorded failure. `code` mirrors `ModelLoadError.code` when the loader raised it. */
export interface SlmEngineFault {
  readonly code: string;
  readonly message: string;
}

/** What the console renders. Immutable, so a subscriber can hold one safely. */
export interface SlmEngineSnapshot {
  readonly phase: SlmEnginePhase;
  /** The gate that woke the device up, or `null` while it is still asleep. */
  readonly gate: ComputeGateKind | null;
  /** Why the machine is where it is. Plain prose, for a log line or a UI subtitle. */
  readonly reason: string;
  readonly enteredAtMs: number;
  readonly progress: SlmCoreProgress | null;
  /** Set once the core has been verified in this session. */
  readonly verifiedSha256: string | null;
  readonly verifiedBytes: number | null;
  readonly backend: SlmEngineBackend | null;
  readonly fault: SlmEngineFault | null;
}

/** Something that happened. Only `owner-intent` can move the machine out of the preview. */
export type SlmEngineTrigger =
  | { readonly kind: "owner-intent"; readonly gate: ComputeGateKind; readonly reason: string }
  | { readonly kind: "core-verified"; readonly sha256: string; readonly bytes: number }
  | { readonly kind: "gpu-bound"; readonly backend: SlmEngineBackend }
  | { readonly kind: "teardown"; readonly reason: string }
  | { readonly kind: "fault"; readonly code: string; readonly message: string };

/** Result of one dispatch. Refusals carry the unchanged snapshot, so a caller can keep rendering. */
export type SlmEngineTransition =
  | {
      readonly ok: true;
      readonly from: SlmEnginePhase;
      readonly to: SlmEnginePhase;
      readonly code: null;
      readonly reason: string;
      readonly snapshot: SlmEngineSnapshot;
    }
  | {
      readonly ok: false;
      readonly from: SlmEnginePhase;
      readonly to: SlmEnginePhase;
      readonly code: SlmEngineRefusalCode;
      readonly reason: string;
      readonly snapshot: SlmEngineSnapshot;
    };

/** True only for the resting, zero-energy phase: nothing fetched, nothing mounted, nothing spent. */
export function isZeroEnergyPhase(phase: SlmEnginePhase): boolean {
  return phase === "IDLE_SOVEREIGN";
}

/** True when a compute-consuming action is allowed to run. Only the fully mounted phase qualifies. */
export function mayConsumeEdgeCompute(snapshot: SlmEngineSnapshot): boolean {
  return snapshot.phase === "ACTIVE";
}

/** True for the two owner gates, and false for every other string a caller might pass. */
export function isComputeGate(value: unknown): value is ComputeGateKind {
  return typeof value === "string" && (COMPUTE_GATES as readonly string[]).includes(value);
}

/** The snapshot a fresh engine starts from: preview only, no progress, no fault, no gate. */
export function initialSlmEngineSnapshot(nowMs: number): SlmEngineSnapshot {
  return {
    phase: "IDLE_SOVEREIGN",
    gate: null,
    reason: "zero-energy preview: no weights resident, no GPU requested, nothing scheduled",
    enteredAtMs: nowMs,
    progress: null,
    verifiedSha256: null,
    verifiedBytes: null,
    backend: null,
    fault: null,
  };
}

function refuse(
  snapshot: SlmEngineSnapshot,
  code: SlmEngineRefusalCode,
  reason: string,
): SlmEngineTransition {
  return { ok: false, from: snapshot.phase, to: snapshot.phase, code, reason, snapshot };
}

function advance(
  snapshot: SlmEngineSnapshot,
  to: SlmEnginePhase,
  reason: string,
  nowMs: number,
  patch: Partial<SlmEngineSnapshot>,
): SlmEngineTransition {
  const next: SlmEngineSnapshot = { ...snapshot, ...patch, phase: to, reason, enteredAtMs: nowMs };
  return { ok: true, from: snapshot.phase, to, code: null, reason, snapshot: next };
}

/**
 * The whole machine, as a pure function of `(snapshot, trigger, nowMs)`.
 *
 * Exported so a caller can replay a session from a log, and so the transition table is one screen of
 * code instead of being spread across a component's `useState` calls.
 */
export function reduceSlmEngine(
  snapshot: SlmEngineSnapshot,
  trigger: SlmEngineTrigger,
  nowMs: number,
): SlmEngineTransition {
  const from = snapshot.phase;

  switch (trigger.kind) {
    case "fault":
      // A fault is always recordable, from any phase, and is the one transition that ignores the machine's
      // shape: refusing to record why the device stopped would be the worst possible failure mode.
      return advance(snapshot, "FAULT", `fault: ${trigger.code}`, nowMs, {
        fault: { code: trigger.code, message: trigger.message },
        progress: null,
      });

    case "teardown":
      if (from === "IDLE_SOVEREIGN") {
        return refuse(snapshot, "NO_COMPUTE_TO_RELEASE", "nothing is engaged, so there is nothing to release");
      }
      return advance(snapshot, "IDLE_SOVEREIGN", trigger.reason, nowMs, {
        gate: null,
        progress: null,
        backend: null,
        fault: null,
      });

    case "owner-intent":
      if (from === "FAULT") {
        return refuse(
          snapshot,
          "FAULTED_REQUIRES_RELEASE",
          "the engine is faulted; release it before engaging compute again",
        );
      }
      if (from !== "IDLE_SOVEREIGN") {
        return refuse(
          snapshot,
          "COMPUTE_ALREADY_ENGAGED",
          `compute is already engaged in ${from}; the owner gate is entered once per session`,
        );
      }
      return advance(snapshot, "FETCHING_CORE", `${trigger.gate}: ${trigger.reason}`, nowMs, {
        gate: trigger.gate,
        progress: { loadedBytes: 0, totalBytes: 0, fraction: 0 },
        fault: null,
      });

    case "core-verified":
      if (from === "IDLE_SOVEREIGN") {
        return refuse(
          snapshot,
          "OWNER_INTENT_REQUIRED",
          "no owner gesture opened the compute gate, so verified weights cannot mount a GPU",
        );
      }
      if (from !== "FETCHING_CORE") {
        return refuse(snapshot, "COMPUTE_ALREADY_ENGAGED", `the core was already verified in ${from}`);
      }
      return advance(snapshot, "MOUNTING_GPU", `core verified (${trigger.sha256.slice(0, 12)}\u2026)`, nowMs, {
        verifiedSha256: trigger.sha256,
        verifiedBytes: trigger.bytes,
        progress: null,
      });

    case "gpu-bound":
      if (from === "IDLE_SOVEREIGN") {
        return refuse(
          snapshot,
          "OWNER_INTENT_REQUIRED",
          "no owner gesture opened the compute gate, so no GPU adapter may be requested",
        );
      }
      if (from === "FETCHING_CORE") {
        return refuse(snapshot, "CORE_NOT_VERIFIED", "the weights were not verified, so there is nothing to mount");
      }
      if (from !== "MOUNTING_GPU") {
        return refuse(snapshot, "COMPUTE_ALREADY_ENGAGED", `the compute backend is already bound in ${from}`);
      }
      return advance(snapshot, "ACTIVE", `backend ${trigger.backend} bound`, nowMs, { backend: trigger.backend });

    default: {
      // `SlmEngineTrigger` is closed; this branch exists so an untyped caller cannot reach the machine.
      const unreachable: never = trigger;
      return refuse(snapshot, "OWNER_INTENT_REQUIRED", `unknown trigger: ${String(unreachable)}`);
    }
  }
}

/**
 * The engine a component holds.
 *
 * It owns one immutable snapshot and notifies subscribers on every accepted transition. Refusals do not
 * notify, because nothing changed - which is what lets a `useEffect` depend on the phase without looping.
 */
export class SlmMiningEngine {
  #snapshot: SlmEngineSnapshot;
  readonly #listeners = new Set<(snapshot: SlmEngineSnapshot) => void>();

  constructor(nowMs: number) {
    this.#snapshot = initialSlmEngineSnapshot(nowMs);
  }

  get snapshot(): SlmEngineSnapshot {
    return this.#snapshot;
  }

  get phase(): SlmEnginePhase {
    return this.#snapshot.phase;
  }

  /** Dispatches one trigger. Accepted transitions notify; refusals are returned, not thrown. */
  dispatch(trigger: SlmEngineTrigger, nowMs: number): SlmEngineTransition {
    if (trigger.kind === "owner-intent" && !isComputeGate(trigger.gate)) {
      return refuse(this.#snapshot, "OWNER_INTENT_REQUIRED", `unknown compute gate: ${String(trigger.gate)}`);
    }
    const transition = reduceSlmEngine(this.#snapshot, trigger, nowMs);
    if (transition.ok) {
      this.#snapshot = transition.snapshot;
      for (const listener of this.#listeners) {
        listener(this.#snapshot);
      }
    }
    return transition;
  }

  /**
   * Records fetch progress without changing the phase. Ignored outside the fetch, so a late progress
   * callback from an aborted transfer cannot resurrect a progress bar in the preview state.
   */
  reportProgress(progress: SlmCoreProgress, nowMs: number): boolean {
    if (this.#snapshot.phase !== "FETCHING_CORE") {
      return false;
    }
    this.#snapshot = { ...this.#snapshot, progress, enteredAtMs: nowMs };
    for (const listener of this.#listeners) {
      listener(this.#snapshot);
    }
    return true;
  }

  /** Subscribes to accepted transitions. Returns the unsubscribe function. */
  subscribe(listener: (snapshot: SlmEngineSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}

/** One engine per console. A factory, so a caller owns the lifecycle explicitly. */
export function createSlmMiningEngine(nowMs: number = Date.now()): SlmMiningEngine {
  return new SlmMiningEngine(nowMs);
}