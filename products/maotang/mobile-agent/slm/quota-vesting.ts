/**
 * ADR-045 - local compute-quota vesting and sybil slashing.
 *
 * The human quota is not handed to a node at activation; it is *vested*. A node starts with its nominal
 * quota fully locked, and each epoch of entropic (human-looking) natural interaction unlocks one small
 * slice. Two properties follow, and both are the point:
 *
 *   - a sybil farm's cost is not a one-off registration but a recurring, real-interaction bill stretched
 *     across the whole vesting window, so farming is only ever as cheap as behaving like a person;
 *   - the quota can be invalidated locally and fail-closed the moment the interaction pattern stops looking
 *     human, without asking a server, because the decider is a local ledger (the same posture M2 takes).
 *
 * Three vocabularies meet here and must not be confused:
 *
 *   - **consumer denominations** are `YuanYuan : MaoMao : FenFen = 1 : 10 : 100`, presentation-only names for
 *     a quantity of compute credit;
 *   - **the internal catalog** is `transfer | createMemeToken | claimHumanQuota`, and each action draws its
 *     own weight from that same 1:10:100 ratio, so one FenFen claim costs as much quota as a hundred
 *     transfers;
 *   - **the wire** keeps the internal ids. Nothing here renames an action; it only weighs it.
 *
 * This module holds no key, opens no socket and never signs. It is a ledger plus a judge, and its only two
 * outcomes are "accrue a slice" and "lock everything".
 */

import type { SlmAction } from "./intent-translator.js";

/** Consumer denominations, folded to lowercase so a lock and a lock-out use one value. */
export type QuotaDenomination = "YuanYuan" | "MaoMao" | "FenFen";

/**
 * One unit of each consumer denomination, measured in YuanYuan. The ratio is the contract: a MaoMao is ten
 * YuanYuan and a FenFen is a hundred, so the three names are one quantity at three scales rather than three
 * unrelated currencies.
 */
export const QUOTA_DENOMINATIONS: Readonly<Record<QuotaDenomination, bigint>> = Object.freeze({
  YuanYuan: 1n,
  MaoMao: 10n,
  FenFen: 100n,
});

/** The nominal quota a verified human is entitled to once fully vested, in YuanYuan. */
export const NOMINAL_QUOTA_YUANYUAN = 1_000_000n;

/** What one epoch of entropic interaction unlocks. Small on purpose: vesting is linear, not a cliff. */
export const DAILY_UNLOCK_YUANYUAN = 10_000n;

/** Epochs of sustained entropic interaction needed to vest the whole nominal quota (100 days). */
export const VESTING_WINDOW_DAYS = Number(NOMINAL_QUOTA_YUANYUAN / DAILY_UNLOCK_YUANYUAN);

/** Length of one vesting epoch. */
export const VESTING_EPOCH_SECONDS = 86_400;

/**
 * What each catalog action draws, in YuanYuan - the same 1:10:100 ratio as the denominations, so the owner
 * sees one scale rather than two. A transfer is one YuanYuan, launching a token is a MaoMao, claiming the
 * personhood quota is a FenFen.
 */
export const ACTION_COST_YUANYUAN: Readonly<Record<SlmAction, bigint>> = Object.freeze({
  transfer: QUOTA_DENOMINATIONS.YuanYuan,
  createMemeToken: QUOTA_DENOMINATIONS.MaoMao,
  claimHumanQuota: QUOTA_DENOMINATIONS.FenFen,
});

export interface QuotaDenominationsView {
  readonly yuanYuan: bigint;
  readonly maoMao: bigint;
  readonly fenFen: bigint;
}

/** Splits a YuanYuan quantity into the three consumer denominations, truncating like a balance would. */
export function toDenominations(yuanYuan: bigint): QuotaDenominationsView {
  const amount = yuanYuan > 0n ? yuanYuan : 0n;
  return {
    yuanYuan: amount,
    maoMao: amount / QUOTA_DENOMINATIONS.MaoMao,
    fenFen: amount / QUOTA_DENOMINATIONS.FenFen,
  };
}

// ---------------------------------------------------------------------------------------------------------
// The judge: does this epoch of interaction look like a person, or like a farm?
// ---------------------------------------------------------------------------------------------------------

/**
 * One interaction, described without its content.
 *
 * `digest` is the digest of the request *shape* (the action and the field layout), never the prompt, an
 * address, an amount or anything biometric - the judge needs to know two interactions looked alike, not what
 * either said.
 */
export interface InteractionSample {
  readonly atSeconds: number;
  readonly kind: string;
  readonly digest: string;
  readonly sessionId: string;
}

export interface EntropyObservation {
  readonly samples: readonly InteractionSample[];
  /** Devices the node claims to represent. A cluster claiming many phones from one session is a farm. */
  readonly claimedDevices: number;
  readonly nowSeconds: number;
}

export interface EntropyThresholds {
  /** A human cannot produce two deliberate interactions closer together than this. */
  readonly minIntervalSeconds: number;
  /** Floor on the coefficient of variation of inter-arrival times: below it the cadence is a metronome. */
  readonly minIntervalVariation: number;
  /** Ceiling on the share of one repeated digest before the epoch reads as a replay loop. */
  readonly maxDigestDominance: number;
  /** Ceiling on interactions in one epoch; above it the node is a burst, not a user. */
  readonly maxSamplesPerEpoch: number;
  /** Distinct shapes a real epoch of use produces. */
  readonly minDistinctDigests: number;
}

export const ENTROPY_THRESHOLDS: EntropyThresholds = Object.freeze({
  minIntervalSeconds: 3,
  minIntervalVariation: 0.15,
  maxDigestDominance: 0.9,
  maxSamplesPerEpoch: 600,
  minDistinctDigests: 2,
});

/** Why an epoch was judged non-human. Stable strings: they are logged and asserted. */
export type SybilCode =
  | "CLOCK_ROLLBACK"
  | "MACHINE_CADENCE"
  | "METRONOME_REGULARITY"
  | "BURST_DENSITY"
  | "REPLAY_REPETITION"
  | "VIRTUAL_DEVICE_CLUSTER";

export type EntropyVerdict =
  | {
      readonly kind: "entropic";
      readonly sampleCount: number;
      readonly distinctDigests: number;
      readonly variation: number;
    }
  | { readonly kind: "insufficient"; readonly code: "INSUFFICIENT_INTERACTION"; readonly reason: string }
  | { readonly kind: "sybil"; readonly code: SybilCode; readonly reason: string };

/**
 * Judges one epoch of interaction.
 *
 * The order is deliberate: a tampered clock is caught before any statistic can be computed from it, the
 * cheapest bot signature (impossible cadence) before the subtler one (perfect cadence), and the structural
 * farm signature (many claimed devices, one session) last, once the epoch is known to look human in every
 * other respect. A single interaction is `insufficient` rather than `sybil`: a new owner must not be
 * slashed for having no history yet.
 */
export function assessEntropy(
  observation: EntropyObservation,
  thresholds: EntropyThresholds = ENTROPY_THRESHOLDS,
): EntropyVerdict {
  const samples = Array.isArray(observation.samples) ? observation.samples : [];
  if (samples.length < 2) {
    return {
      kind: "insufficient",
      code: "INSUFFICIENT_INTERACTION",
      reason: "fewer than two interactions in this epoch, so there is no behaviour to judge yet",
    };
  }

  for (let index = 1; index < samples.length; index += 1) {
    if (!(samples[index].atSeconds >= samples[index - 1].atSeconds)) {
      return {
        kind: "sybil",
        code: "CLOCK_ROLLBACK",
        reason: "interaction timestamps are not monotonic, so the local clock was moved backwards",
      };
    }
  }

  const intervals: number[] = [];
  for (let index = 1; index < samples.length; index += 1) {
    intervals.push(samples[index].atSeconds - samples[index - 1].atSeconds);
  }
  const minInterval = Math.min(...intervals);
  if (minInterval < thresholds.minIntervalSeconds) {
    return {
      kind: "sybil",
      code: "MACHINE_CADENCE",
      reason:
        "two interactions were " + String(minInterval) + "s apart; a human cannot act faster than " +
        String(thresholds.minIntervalSeconds) + "s",
    };
  }

  const mean = intervals.reduce((total, value) => total + value, 0) / intervals.length;
  const variance =
    intervals.reduce((total, value) => total + (value - mean) * (value - mean), 0) / intervals.length;
  const variation = mean === 0 ? 0 : Math.sqrt(variance) / mean;
  if (intervals.length >= 3 && variation < thresholds.minIntervalVariation) {
    return {
      kind: "sybil",
      code: "METRONOME_REGULARITY",
      reason:
        "inter-arrival variation is " + variation.toFixed(3) + ", below the human floor of " +
        String(thresholds.minIntervalVariation),
    };
  }

  if (samples.length > thresholds.maxSamplesPerEpoch) {
    return {
      kind: "sybil",
      code: "BURST_DENSITY",
      reason:
        String(samples.length) + " interactions in one epoch exceeds the ceiling of " +
        String(thresholds.maxSamplesPerEpoch),
    };
  }

  const counts = new Map<string, number>();
  for (const sample of samples) {
    counts.set(sample.digest, (counts.get(sample.digest) ?? 0) + 1);
  }
  if (counts.size < thresholds.minDistinctDigests) {
    return {
      kind: "sybil",
      code: "REPLAY_REPETITION",
      reason: "every interaction in this epoch had the same shape, which is a loop rather than a user",
    };
  }
  let dominance = 0;
  for (const count of counts.values()) {
    if (count > dominance) {
      dominance = count;
    }
  }
  const share = dominance / samples.length;
  if (share > thresholds.maxDigestDominance) {
    return {
      kind: "sybil",
      code: "REPLAY_REPETITION",
      reason: "one repeated shape accounts for " + share.toFixed(3) + " of the epoch",
    };
  }

  const sessions = new Set(samples.map((sample) => sample.sessionId)).size;
  if (observation.claimedDevices > sessions) {
    return {
      kind: "sybil",
      code: "VIRTUAL_DEVICE_CLUSTER",
      reason:
        "the node claims " + String(observation.claimedDevices) + " devices but only " + String(sessions) +
        " interaction sessions exist, which is a virtual phone cluster",
    };
  }

  return { kind: "entropic", sampleCount: samples.length, distinctDigests: counts.size, variation };
}

// ---------------------------------------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------------------------------------

export type VestingState = "locked" | "vesting" | "vested" | "slashed";
export type QuotaDenialCode =
  | "QUOTA_SLASHED"
  | "QUOTA_LOCKED"
  | "QUOTA_EXHAUSTED"
  | "QUOTA_UNKNOWN_ACTION";

export type QuotaDecision =
  | { readonly allowed: true; readonly chargedYuanYuan: bigint; readonly remainingYuanYuan: bigint }
  | {
      readonly allowed: false;
      readonly code: QuotaDenialCode;
      readonly reason: string;
      readonly remainingYuanYuan: bigint;
    };

export interface QuotaSnapshot {
  readonly state: VestingState;
  /** Vesting position: T0 probation, T1 established, T2 fully vested. */
  readonly tier: "T0" | "T1" | "T2";
  readonly nominalYuanYuan: bigint;
  readonly unlockedYuanYuan: bigint;
  readonly consumedYuanYuan: bigint;
  readonly availableYuanYuan: bigint;
  readonly denominations: QuotaDenominationsView;
  readonly availableDenominations: QuotaDenominationsView;
  readonly epochsAccrued: number;
  readonly windowDays: number;
  /** Progress through the vesting schedule, 0..10000. */
  readonly vestingBasisPoints: number;
  readonly slashedCode: string | null;
  readonly slashedReason: string | null;
}

export type VestingOutcome =
  | { readonly accepted: true; readonly accruedYuanYuan: bigint; readonly snapshot: QuotaSnapshot }
  | {
      readonly accepted: false;
      readonly code: string;
      readonly reason: string;
      readonly slashed: boolean;
      readonly snapshot: QuotaSnapshot;
    };

/** The seam the action bridge consumes. Structurally satisfied by {@link LocalQuotaVault}. */
export interface QuotaAuthority {
  /** A non-mutating check, for a preview or a UI. */
  preview(action: SlmAction): QuotaDecision;
  /** The mutating check, run only on the path that can end in a signature. */
  charge(action: SlmAction): QuotaDecision;
}

export interface LocalQuotaVaultOptions {
  readonly nominalYuanYuan?: bigint;
  readonly dailyUnlockYuanYuan?: bigint;
  readonly thresholds?: EntropyThresholds;
  readonly now?: () => number;
}

/**
 * The local vesting ledger.
 *
 * Genesis is fully locked. {@link observeEntropy} is the only way quota is ever created, and it creates a
 * single slice per epoch - showing up twice in one day does not vest twice. {@link slash} is terminal and
 * fail-closed: it zeroes the usable balance and stays set until a hardware-backed owner authorization
 * clears it.
 */
export class LocalQuotaVault implements QuotaAuthority {
  readonly #nominal: bigint;
  readonly #dailyUnlock: bigint;
  readonly #thresholds: EntropyThresholds;
  readonly #now: () => number;
  #unlocked = 0n;
  #consumed = 0n;
  #epochsAccrued = 0;
  #lastAccruedEpoch = -1;
  #slashedCode: string | null = null;
  #slashedReason: string | null = null;

  constructor(options: LocalQuotaVaultOptions = {}) {
    this.#nominal = options.nominalYuanYuan ?? NOMINAL_QUOTA_YUANYUAN;
    this.#dailyUnlock = options.dailyUnlockYuanYuan ?? DAILY_UNLOCK_YUANYUAN;
    this.#thresholds = options.thresholds ?? ENTROPY_THRESHOLDS;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000));
    if (this.#nominal <= 0n || this.#dailyUnlock <= 0n) {
      throw new RangeError("quota amounts must be positive");
    }
  }

  get slashed(): boolean {
    return this.#slashedCode !== null;
  }

  /**
   * Judges one epoch and, when it looks human, unlocks one slice.
   *
   * A sybil verdict slashes; an insufficient history does neither (it accrues nothing and locks nothing),
   * because punishing a new owner for having no history is the fail-open direction dressed as caution.
   */
  observeEntropy(observation: EntropyObservation): VestingOutcome {
    if (this.#slashedCode !== null) {
      return {
        accepted: false,
        code: this.#slashedCode,
        reason: this.#slashedReason ?? "the quota is invalidated",
        slashed: true,
        snapshot: this.snapshot(),
      };
    }

    const verdict = assessEntropy(observation, this.#thresholds);
    if (verdict.kind === "sybil") {
      this.slash(verdict.code, verdict.reason);
      return { accepted: false, code: verdict.code, reason: verdict.reason, slashed: true, snapshot: this.snapshot() };
    }
    if (verdict.kind === "insufficient") {
      return {
        accepted: false,
        code: verdict.code,
        reason: verdict.reason,
        slashed: false,
        snapshot: this.snapshot(),
      };
    }

    const epoch = Math.floor(observation.nowSeconds / VESTING_EPOCH_SECONDS);
    if (epoch <= this.#lastAccruedEpoch) {
      return {
        accepted: false,
        code: "EPOCH_ALREADY_ACCRUED",
        reason: "this epoch has already vested its slice; vesting is one slice per epoch by construction",
        slashed: false,
        snapshot: this.snapshot(),
      };
    }

    const headroom = this.#nominal - this.#unlocked;
    const accrued = this.#dailyUnlock < headroom ? this.#dailyUnlock : headroom;
    this.#unlocked += accrued;
    this.#epochsAccrued += 1;
    this.#lastAccruedEpoch = epoch;
    return { accepted: true, accruedYuanYuan: accrued, snapshot: this.snapshot() };
  }

  preview(action: SlmAction): QuotaDecision {
    return this.#decide(action, false);
  }

  charge(action: SlmAction): QuotaDecision {
    return this.#decide(action, true);
  }

  /** Fail-closed invalidation. Terminal until {@link recoverByOwnerAuthorization} clears it. */
  slash(code: string, reason: string): void {
    if (this.#slashedCode === null) {
      this.#slashedCode = code;
      this.#slashedReason = reason;
    }
  }

  /** The only way back from a slash: the device owner, proven by hardware. */
  recoverByOwnerAuthorization(grant: { readonly hardwareBacked: boolean }): boolean {
    if (this.#slashedCode === null) {
      return true;
    }
    if (grant.hardwareBacked !== true) {
      return false;
    }
    this.#slashedCode = null;
    this.#slashedReason = null;
    return true;
  }

  snapshot(): QuotaSnapshot {
    // A slashed vault reports nothing as available: the unlocked/consumed pair stays as history, but the
    // spendable balance is zero, because that is what the gate will actually allow.
    const available =
      this.#slashedCode !== null ? 0n : this.#unlocked > this.#consumed ? this.#unlocked - this.#consumed : 0n;
    const state: VestingState =
      this.#slashedCode !== null
        ? "slashed"
        : this.#unlocked === 0n
          ? "locked"
          : this.#unlocked >= this.#nominal
            ? "vested"
            : "vesting";
    const establishedEpochs = Math.floor(VESTING_WINDOW_DAYS / 3);
    const tier: QuotaSnapshot["tier"] =
      this.#slashedCode !== null
        ? "T0"
        : this.#epochsAccrued >= VESTING_WINDOW_DAYS
          ? "T2"
          : this.#epochsAccrued >= establishedEpochs
            ? "T1"
            : "T0";
    return {
      state,
      tier,
      nominalYuanYuan: this.#nominal,
      unlockedYuanYuan: this.#unlocked,
      consumedYuanYuan: this.#consumed,
      availableYuanYuan: available,
      denominations: toDenominations(this.#unlocked),
      availableDenominations: toDenominations(available),
      epochsAccrued: this.#epochsAccrued,
      windowDays: VESTING_WINDOW_DAYS,
      vestingBasisPoints: Number((this.#unlocked * 10_000n) / this.#nominal),
      slashedCode: this.#slashedCode,
      slashedReason: this.#slashedReason,
    };
  }

  #decide(action: string, commit: boolean): QuotaDecision {
    const cost = ACTION_COST_YUANYUAN[action as SlmAction] as bigint | undefined;
    const available = this.#unlocked > this.#consumed ? this.#unlocked - this.#consumed : 0n;
    if (cost === undefined) {
      return {
        allowed: false,
        code: "QUOTA_UNKNOWN_ACTION",
        reason: "\"" + String(action) + "\" is not a catalog action, so it has no quota weight",
        remainingYuanYuan: available,
      };
    }
    if (this.#slashedCode !== null) {
      return {
        allowed: false,
        code: "QUOTA_SLASHED",
        reason: "the local quota is invalidated (" + this.#slashedCode + "); nothing may be charged",
        remainingYuanYuan: 0n,
      };
    }
    if (this.#unlocked === 0n) {
      return {
        allowed: false,
        code: "QUOTA_LOCKED",
        reason: "the nominal quota is fully locked; an epoch of natural interaction unlocks the first slice",
        remainingYuanYuan: 0n,
      };
    }
    if (available < cost) {
      return {
        allowed: false,
        code: "QUOTA_EXHAUSTED",
        reason:
          "this action costs " + String(cost) + " YuanYuan but only " + String(available) + " is unlocked",
        remainingYuanYuan: available,
      };
    }
    if (commit) {
      this.#consumed += cost;
    }
    return { allowed: true, chargedYuanYuan: cost, remainingYuanYuan: available - cost };
  }
}
