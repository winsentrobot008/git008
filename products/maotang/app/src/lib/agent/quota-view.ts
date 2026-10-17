/**
 * Rendering rules for the ADR-045 compute-quota ledger.
 *
 * The C-end card and the engineer console both describe the same three-number quota, so the arithmetic
 * that turns a ledger snapshot into text lives here, once - the same reason `spend-view.ts` exists for
 * the M2 window (ADR-034 / ADR-035). Two properties are load-bearing:
 *
 *   - the denomination ratio is `YuanYuan : MaoMao : FenFen = 1 : 10 : 100`, and it is a *display*
 *     rule: the server reports one quantity in YuanYuan, and the other two units are that quantity
 *     divided by 10 and 100. Nothing here creates compute.
 *   - a progress bar is a *picture of a number the server reported*, never a number of its own. A
 *     malformed basis-point value renders as an empty bar (the fail-closed reading), not as a full one.
 *
 * This module holds no key, opens no socket and imports nothing from the M1/M2 runtime, so it is safe to
 * pull into a client component.
 */

/** The weights behind the three consumer names, as the protocol fixes them. */
export const DENOMINATION_RATIO = Object.freeze({ yuanYuan: 1, maoMao: 10, fenFen: 100 });

/** One quantity expressed in all three consumer denominations. */
export interface QuotaDenominations {
  readonly yuanYuan: string;
  readonly maoMao: string;
  readonly fenFen: string;
}

/**
 * The quota block `GET /api/agent/status` reports, field for field.
 *
 * `vestingBasisPoints` and `epochProgressBasisPoints` are 0..10000. The first is cumulative progress
 * through the vesting schedule; the second is how far the *live* epoch has run, which is the only part of
 * this ledger that moves while the owner watches.
 */
export interface QuotaReport {
  readonly state: "locked" | "vesting" | "vested" | "slashed";
  readonly tier: "T0" | "T1" | "T2";
  readonly nominalYuanYuan: string;
  readonly unlockedYuanYuan: string;
  readonly consumedYuanYuan: string;
  readonly availableYuanYuan: string;
  readonly denominations: QuotaDenominations;
  readonly availableDenominations: QuotaDenominations;
  readonly epochsAccrued: number;
  readonly windowDays: number;
  readonly dailyUnlockYuanYuan: string;
  readonly vestingBasisPoints: number;
  readonly slashedCode: string | null;
  readonly slashedReason: string | null;
  readonly epochSeconds: number;
  readonly epochElapsedSeconds: number;
  readonly epochProgressBasisPoints: number;
}

/**
 * `1000000` -> `"1,000,000"`.
 *
 * Grouped so a six- or seven-digit quota is readable at a glance. A value that is not an integer string is
 * returned untouched rather than coerced to zero: an unreadable number must stay visibly unreadable.
 */
export function formatQuotaUnits(value: string): string {
  const match = /^-?(\d+)$/.exec(value.trim());
  if (match === null) {
    return value;
  }
  const negative = match[1].startsWith("-");
  const digits = negative ? match[1].slice(1) : match[1];
  return (negative ? "-" : "") + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * One YuanYuan quantity in all three denominations, by the fixed 1 : 10 : 100 ratio.
 *
 * Integer division, never a float, because the unit is an amount of compute and a rounded amount is the
 * wrong amount. A value that will not parse is returned as the same unreadable string for all three
 * units, so a malformed ledger is visible rather than silently zero.
 */
export function denominate(yuanYuan: string): QuotaDenominations {
  let total: bigint;
  try {
    total = BigInt(yuanYuan);
  } catch {
    return { yuanYuan, maoMao: yuanYuan, fenFen: yuanYuan };
  }
  const amount = total > 0n ? total : 0n;
  const byRatio = (divisor: number) => formatQuotaUnits((amount / BigInt(divisor)).toString());
  return { yuanYuan: byRatio(1), maoMao: byRatio(10), fenFen: byRatio(100) };
}

/** Clamps a basis-point reading to `0..100`, the range a percentage bar can paint. */
export function percentFromBasisPoints(basisPoints: number): number {
  if (!Number.isFinite(basisPoints)) {
    return 0;
  }
  const clamped = Math.min(10_000, Math.max(0, basisPoints));
  return clamped / 100;
}

/**
 * The `width` a progress bar should paint.
 *
 * A hair of fill is kept whenever any progress exists, so a bar at 0.4% is visibly not at 0% and the owner
 * can tell it is moving. Zero stays zero.
 */
export function barWidth(percent: number): string {
  if (!Number.isFinite(percent) || percent <= 0) {
    return "0%";
  }
  return `${Math.max(0.5, Math.min(100, percent))}%`;
}

/** `false` for a locked, slashed or absent ledger - the states in which nothing is spendable. */
export function quotaIsSpendable(quota: QuotaReport | null | undefined): boolean {
  return (
    quota !== null && quota !== undefined && quota.state !== "slashed" && quota.availableYuanYuan !== "0"
  );
}

/** `86_400` -> `"1d"`, `3600` -> `"1h"`, `90` -> `"90s"`. Derived, so a shortened test is never "1d". */
export function epochLabel(seconds: number): string {
  if (seconds > 0 && seconds % 86_400 === 0) {
    return `${seconds / 86_400}d`;
  }
  if (seconds > 0 && seconds % 3600 === 0) {
    return `${seconds / 3600}h`;
  }
  return `${seconds}s`;
}

/**
 * Seconds until the current epoch closes, clamped at zero.
 *
 * The card counts this down so "vesting" is visibly a clock and not a slogan; `0` is a real answer
 * (the next slice is due now), and a malformed pair reads as `0` rather than as a negative wait.
 */
export function secondsToNextSlice(epochSeconds: number, elapsedSeconds: number): number {
  if (!Number.isFinite(epochSeconds) || !Number.isFinite(elapsedSeconds)) {
    return 0;
  }
  const left = Math.floor(epochSeconds - elapsedSeconds);
  return left > 0 ? left : 0;
}
