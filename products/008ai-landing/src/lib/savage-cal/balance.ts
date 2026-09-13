/**
 * balance - the intake/burn ledger behind the Savage Cal AI verdict.
 *
 * The audit answers "what did that cost". This module answers the only question
 * the bestie cares about next: "so how much movement does that cost you?"
 *
 * Energy model: the standard MET formula, kcal/min = MET x 3.5 x kg / 200.
 *   - plank hold (isometric core work):  MET 4.0
 *   - slow jog (what an atonement order actually prescribes): MET 7.0
 * A 70 kg reference mass lets the maths run before the user ever steps on a
 * scale; every constant is exported so a profile screen can override it later
 * without touching the card, the event log or the roast hand-off.
 *
 * Pure, React-free and storage-free: components/savage-cal/BalanceMathCard.tsx,
 * the FoodScanEvent balanceMath payload (types/health-bus.ts) and the briefing
 * that opens Savage Fit AI all quote these same numbers.
 */

import type { BalanceMath } from "@/types/health-bus";

export const BALANCE_MODEL = {
  /** Reference body mass for the MET maths (no scale required at signup). */
  referenceWeightKg: 70,
  /** One meal's fair share of a 2,100 kcal maintenance day. */
  mealBudgetKcal: 700,
  /** Metabolic equivalents: isometric plank hold vs. slow jog. */
  plankMet: 4.0,
  jogMet: 7.0,
  /** A plank prescription is rounded up to a usable 15 s hold. */
  plankStepSeconds: 15,
} as const;

export interface BalanceInput {
  /** kcal the audited meal contained. */
  caloriesConsumed: number;
  /**
   * Wearable credit already earned today (Apple Watch / Garmin active energy).
   * Credited against the meal before any debt is declared, so a user who has
   * already trained is not told to train twice for the same calories.
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
 * The audit's balance sheet.
 *
 *   net = consumed - mealBudget - activeCaloriesBurned
 *
 * Anything still positive is the debt the atonement workout has to settle; it is
 * then expressed in the two currencies the bestie shouts at people.
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

/** One-line verdict printed under the audit total. */
export function describeBalance(math: BalanceMath): string {
  if (math.balanced) {
    return math.activeCaloriesBurned > 0
      ? `Nothing to burn - the ${math.activeCaloriesBurned} kcal you already moved today covers this one.`
      : "Nothing to burn. This one stays inside the meal budget, so enjoy it quietly.";
  }
  return `${math.targetBurnCalories} kcal over budget - that is ${formatPlankHold(
    math.suggestedPlankSeconds
  )} of planking, or ${math.suggestedRunMinutes} min of slow jog, to square it.`;
}

/**
 * The line folded into the roast briefing, so the voice coach quotes the same
 * workout target Savage Cal showed on screen. Kept short: the server caps the
 * untrusted briefing at HEALTH_CONTEXT_MAX_CHARS (320).
 */
export function balanceBriefingLine(math: BalanceMath): string {
  if (math.balanced) return "Atonement burn target: 0 kcal - already squared.";
  return `Atonement burn target: ${math.targetBurnCalories} kcal (${formatPlankHold(
    math.suggestedPlankSeconds
  )} plank / ${math.suggestedRunMinutes} min slow jog equivalents).`;
}
