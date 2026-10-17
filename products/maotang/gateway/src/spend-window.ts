/**
 * The 24h SpendWindow ledger the gateway keeps for every owner it has seen.
 *
 * This is the third of the gateway's three jobs and the one with the least room for improvisation, so it
 * does the opposite of improvising: the arithmetic **is** the M2 ledger. `SpendWindowLedger`,
 * `SpendPolicy` and `evaluateIntent` are imported from `@maotang/mobile-agent/dist/signer/index.js` - the
 * module the mobile wallet signs behind - rather than re-implemented here. A second copy of "what is left
 * in the window" is exactly the drift ADR-034 / ADR-035 recorded between the C-end pill and the M2 card,
 * and it is the drift that turns a cap into a decoration.
 *
 * What this file adds is the *service* half a long-lived process needs and a single-shot wallet does not:
 *
 *   - **one ledger per owner, bounded.** An unbounded `Map` keyed by a caller-supplied address is a
 *     memory-growth vector, so the map evicts its least-recently-touched owner past `maxOwners`. An evicted
 *     owner simply starts a fresh window; the chain remains the authority on what was actually spent, and
 *     the gateway is a convenience index, not a second accounting system.
 *   - **a per-owner queue.** Node is single-threaded, but an `await` inside a read-modify-write still
 *     interleaves with another request. {@link SpendWindowService.runExclusive} serializes *all* work for
 *     one owner, which is what lets `broadcast.ts` treat "evaluate, forward, record" as one atomic step and
 *     closes the burst race a bare check would leave open.
 *   - **an explicit clock.** `nowSeconds` is a parameter, never an internal `Date.now()`, for the reason
 *     the ledger itself gives: a window boundary cannot be tested if the clock is hidden.
 */

import { SpendWindowLedger, type SpendWindowSnapshot } from "@maotang/mobile-agent/dist/signer/index.js";
import type { Address } from "@maotang/mobile-agent/dist/signer/index.js";

/** Default ceiling on the owners one process will track. */
export const DEFAULT_MAX_OWNERS = 512;

/** What `GET /v1/spend-window` answers. Amounts are decimal strings: these are wei, never floats. */
export interface SpendWindowReport {
  readonly ok: true;
  readonly owner: Address;
  readonly windowSeconds: number;
  readonly windowStartSeconds: number;
  readonly spentWei: string;
  readonly capWei: string;
  readonly remainingWei: string;
  /** Seconds until the window rolls clean. `0` means the next recorded spend starts a new window. */
  readonly windowEndsInSeconds: number;
  /** How many owners this process is currently tracking, so the bound is observable, not implied. */
  readonly trackedOwners: number;
  readonly observedAtSeconds: number;
}

export interface SpendWindowOptions {
  /** Rolling window length in seconds. The shipped M2 envelope is 86400 (24h). */
  readonly windowSeconds: number;
  /** Inclusive cap across one window, in wei. */
  readonly capWei: bigint;
  readonly maxOwners?: number;
}

/** The window's own snapshot, straight from the M2 ledger, plus what the service adds. */
export function toReport(
  owner: Address,
  snapshot: SpendWindowSnapshot,
  capWei: bigint,
  trackedOwners: number,
  nowSeconds: number,
): SpendWindowReport {
  const remaining = capWei - snapshot.spentWei;
  const elapsed = nowSeconds - snapshot.windowStartSeconds;
  const endsIn = snapshot.windowSeconds - elapsed;

  return {
    ok: true,
    owner,
    windowSeconds: snapshot.windowSeconds,
    windowStartSeconds: snapshot.windowStartSeconds,
    spentWei: snapshot.spentWei.toString(),
    capWei: capWei.toString(),
    // Clamped at zero: an over-cap window (a lowered cap, a restored ledger) reports "nothing left"
    // rather than a negative allowance a client might render as a spend.
    remainingWei: (remaining > 0n ? remaining : 0n).toString(),
    windowEndsInSeconds: endsIn > 0 ? endsIn : 0,
    trackedOwners,
    observedAtSeconds: nowSeconds,
  };
}

export class SpendWindowService {
  readonly #windowSeconds: number;
  readonly #capWei: bigint;
  readonly #maxOwners: number;
  readonly #ledgers = new Map<string, SpendWindowLedger>();
  readonly #queues = new Map<string, Promise<unknown>>();

  constructor(options: SpendWindowOptions) {
    if (!Number.isSafeInteger(options.windowSeconds) || options.windowSeconds <= 0) {
      throw new RangeError(`windowSeconds must be a positive integer, got ${String(options.windowSeconds)}`);
    }
    if (options.capWei < 0n) {
      throw new RangeError("capWei must be non-negative");
    }
    this.#windowSeconds = options.windowSeconds;
    this.#capWei = options.capWei;
    this.#maxOwners = options.maxOwners ?? DEFAULT_MAX_OWNERS;
  }

  get windowSeconds(): number {
    return this.#windowSeconds;
  }

  get capWei(): bigint {
    return this.#capWei;
  }

  get trackedOwners(): number {
    return this.#ledgers.size;
  }

  /**
   * The M2 ledger for one owner, created on first use.
   *
   * Returns the ledger itself rather than a wrapper, because `evaluateIntent` takes a ledger and the
   * policy decision has to be made against the *same* object that will be mutated by the spend it allows.
   */
  ledgerFor(owner: Address): SpendWindowLedger {
    const key = owner.toLowerCase();
    const existing = this.#ledgers.get(key);
    if (existing !== undefined) {
      // Re-insert so the map's iteration order stays least-recently-touched-first for eviction.
      this.#ledgers.delete(key);
      this.#ledgers.set(key, existing);
      return existing;
    }
    if (this.#ledgers.size >= this.#maxOwners) {
      const oldest = this.#ledgers.keys().next();
      if (oldest.done !== true) {
        this.#ledgers.delete(oldest.value);
      }
    }
    const created = new SpendWindowLedger(this.#windowSeconds);
    this.#ledgers.set(key, created);
    return created;
  }

  snapshotFor(owner: Address, nowSeconds: number): SpendWindowSnapshot {
    return this.ledgerFor(owner).snapshot(nowSeconds);
  }

  reportFor(owner: Address, nowSeconds: number): SpendWindowReport {
    return toReport(owner, this.snapshotFor(owner, nowSeconds), this.#capWei, this.#ledgers.size, nowSeconds);
  }

  /**
   * Records a spend against an owner's window.
   *
   * Deliberately one-way: the shipped {@link SpendWindowLedger} has no decrement, and this service does not
   * add one. `broadcast.ts` records *before* it forwards, so the window always over-counts a leg whose
   * outcome the gateway could not observe - the direction that costs an owner one retry instead of costing
   * the protocol its cap.
   */
  record(owner: Address, amountWei: bigint, nowSeconds: number): void {
    this.ledgerFor(owner).record(amountWei, nowSeconds);
  }

  /**
   * Runs `task` with exclusive access to one owner's window.
   *
   * A promise chain, not a lock: each caller appends to the tail and the next link waits on the previous.
   * The chain entry is dropped when the queue drains, so a quiet owner costs no bookkeeping.
   */
  async runExclusive<T>(owner: Address, task: () => Promise<T>): Promise<T> {
    const key = owner.toLowerCase();
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    // The stored chain must never reject, or every later caller would inherit the rejection.
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.#queues.set(key, settled);
    try {
      return await run;
    } finally {
      if (this.#queues.get(key) === settled) {
        this.#queues.delete(key);
      }
    }
  }
}