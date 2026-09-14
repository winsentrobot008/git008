/**
 * balance - the intake/movement ledger behind Aura Fit (知己轻体).
 *
 * The intake log answers "what did that cost". This module answers the only
 * question the two besties care about next: "so how do we shape the rest of the
 * day, gracefully?"
 *
 * Energy model: the standard MET formula, kcal/min = MET x 3.5 x kg / 200.
 *   - plank hold (isometric core work):  MET 4.0
 *   - slow jog (a gentle movement prescription): MET 7.0
 * A 70 kg reference mass lets the maths run before the user ever steps on a
 * scale; every constant is exported so a profile screen can override it later
 * without touching the card, the event log or the hand-off.
 *
 * Pure, React-free and storage-free: components/aura-fit/SculptProgressCard.tsx,
 * the FoodScanEvent balanceMath payload (types/health-bus.ts) and the briefing
 * that opens the Fit Bestie all quote these same numbers.
 */

import type { BalanceMath } from "@/types/health-bus";

export const BALANCE_MODEL = {
  /** Reference body mass for the MET maths (no scale required at signup). */
  referenceWeightKg: 70,
  /** One meal's fair share of a 2,100 kcal maintenance day. */
  mealBudgetKcal: 700,
  /** The day's ideal energy line shown on the shaping dashboard. */
  sculptIdealKcal: 2100,
  /** Metabolic equivalents: isometric plank hold vs. slow jog. */
  plankMet: 4.0,
  jogMet: 7.0,
  /** A plank prescription is rounded up to a usable 15 s hold. */
  plankStepSeconds: 15,
} as const;

export interface BalanceInput {
  /** kcal the logged meal contained. */
  caloriesConsumed: number;
  /**
   * Movement energy already logged today (voice coach session / wearable).
   * Credited against the meal before any gap is declared, so a user who has
   * already trained is never nudged to train twice for the same calories.
   */
  activeCaloriesBurned?: number;
  /** Override for the meal's kcal allowance. */
  mealBudgetKcal?: number;
  /** Override for the reference body mass used by the MET maths. */
  weightKg?: number;
}

function positive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** Body mass the MET maths runs at: the caller's, or the 70 kg reference. */
export function resolveWeightKg(weightKg?: number): number {
  return positive(Number(weightKg), BALANCE_MODEL.referenceWeightKg);
}

/** kcal burned per minute at a given MET intensity and body mass. */
export function kcalPerMinute(
  met: number,
  weightKg: number = BALANCE_MODEL.referenceWeightKg
): number {
  return (met * 3.5 * positive(weightKg, BALANCE_MODEL.referenceWeightKg)) / 200;
}

/** kcal burned per second of a plank hold. */
export function plankKcalPerSecond(weightKg?: number): number {
  return kcalPerMinute(BALANCE_MODEL.plankMet, resolveWeightKg(weightKg)) / 60;
}

/** kcal burned per minute of a slow jog. */
export function jogKcalPerMinute(weightKg?: number): number {
  return kcalPerMinute(BALANCE_MODEL.jogMet, resolveWeightKg(weightKg));
}

/**
 * The meal's balance sheet.
 *
 *   net = consumed - mealBudget - activeCaloriesBurned
 *
 * Anything still positive is the gap a short movement session closes; it is then
 * expressed in the two gentle currencies the Fit Bestie offers.
 */
export function computeBalance(input: BalanceInput): BalanceMath {
  const caloriesConsumed = Math.round(nonNegative(input.caloriesConsumed));
  const activeCaloriesBurned = Math.round(nonNegative(input.activeCaloriesBurned ?? 0));
  const mealBudgetKcal = Math.round(
    nonNegative(input.mealBudgetKcal ?? BALANCE_MODEL.mealBudgetKcal)
  );
  const weightKg = resolveWeightKg(input.weightKg);

  const netCalories = caloriesConsumed - mealBudgetKcal - activeCaloriesBurned;
  const targetBurnCalories = Math.max(0, Math.round(netCalories));

  const plankPerSecond = plankKcalPerSecond(weightKg);
  const jogPerMinute = jogKcalPerMinute(weightKg);

  return {
    caloriesConsumed,
    activeCaloriesBurned,
    mealBudgetKcal,
    netCalories: Math.round(netCalories),
    targetBurnCalories,
    balanced: targetBurnCalories === 0,
    suggestedPlankSeconds:
      targetBurnCalories === 0
        ? 0
        : Math.ceil(targetBurnCalories / plankPerSecond / BALANCE_MODEL.plankStepSeconds) *
          BALANCE_MODEL.plankStepSeconds,
    suggestedRunMinutes:
      targetBurnCalories === 0 ? 0 : Math.max(1, Math.ceil(targetBurnCalories / jogPerMinute)),
    plankKcalPerSecond: Math.round(plankPerSecond * 10000) / 10000,
    jogKcalPerMinute: Math.round(jogPerMinute * 100) / 100,
  };
}

/** "7m 30s" / "45s" - a long plank hold reads better in minutes. */
export function formatPlankHold(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

// ── Ideal-proportion shaping dashboard ───────────────────────────────────────

/** The day's shaping state, framed as progress - never as an error. */
export type SculptState = "radiant" | "aligned" | "shaping";

export interface SculptProgress {
  /** 0..1 fill for the silhouette gauge (1 = the ideal line is reached). */
  progress: number;
  /** Graceful day state, used to pick the dashboard copy. */
  state: SculptState;
  /** kcal consumed today. */
  consumedKcal: number;
  /** Movement kcal logged today. */
  burnedKcal: number;
  /** kcal the day's silhouette is aiming for. */
  idealKcal: number;
  /** consumed - burned - ideal; positive means the shape still has room to settle. */
  gapKcal: number;
  /** Gentle movement minutes that bring the silhouette back to its ideal line. */
  movementMinutes: number;
}

/**
 * The Barbie-silhouette dashboard metric.
 *
 * A day is ALIGNED when net intake lands within 15% of the ideal line, RADIANT
 * when it is lighter than that (the silhouette is already sleek), and SHAPING
 * when a little movement would settle it. There is no "error" state: being over
 * the line is simply more shaping to do, and the card says so kindly.
 */
export function computeSculpt(
  consumedKcal: number,
  burnedKcal: number = 0,
  idealKcal: number = BALANCE_MODEL.sculptIdealKcal,
  weightKg?: number
): SculptProgress {
  const consumed = Math.round(nonNegative(consumedKcal));
  const burned = Math.round(nonNegative(burnedKcal));
  const ideal = Math.round(positive(Number(idealKcal), BALANCE_MODEL.sculptIdealKcal));
  const net = consumed - burned;
  const ratio = net / ideal;

  const progress = Math.min(1, Math.max(0, ratio));
  const state: SculptState =
    Math.abs(ratio - 1) <= 0.15 ? "aligned" : ratio < 1 ? "radiant" : "shaping";
  const gapKcal = Math.round(net - ideal);
  const movementMinutes =
    gapKcal <= 0 ? 0 : Math.max(1, Math.ceil(gapKcal / jogKcalPerMinute(weightKg)));

  return {
    progress: Math.round(progress * 1000) / 1000,
    state,
    consumedKcal: consumed,
    burnedKcal: burned,
    idealKcal: ideal,
    gapKcal,
    movementMinutes,
  };
}

/**
 * The line folded into the hand-off briefing, so the voice coach quotes the same
 * movement target the Calorie Bestie showed on screen. Kept short: the server
 * caps the untrusted briefing at HEALTH_CONTEXT_MAX_CHARS (320).
 */
export function balanceBriefingLine(math: BalanceMath): string {
  if (math.balanced) return "Movement invite: nothing to chase - the day is already in balance.";
  return `Movement invite: ${math.targetBurnCalories} kcal above the meal line (${formatPlankHold(
    math.suggestedPlankSeconds
  )} plank / ${math.suggestedRunMinutes} min easy jog).`;
}
