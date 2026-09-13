/**
 * rating - the Savage Cal AI verdict on an audited meal.
 *
 * The rating is what turns a bare calorie number into a decision:
 *   GREEN  - the bestie is (grudgingly) satisfied,
 *   YELLOW - side-eye, plus an invitation to work it off,
 *   RED    - full roast, and the referral into Savage Fit AI's atonement workout.
 */

export type FoodRating = "green" | "yellow" | "red";

/** Bands are kcal for the whole audited meal. */
export const RATING_BANDS = {
  greenMax: 450,
  yellowMax: 850,
} as const;

export function rateFood(totalCalories: number): FoodRating {
  const kcal = Number.isFinite(totalCalories) ? Math.max(0, totalCalories) : 0;
  if (kcal <= RATING_BANDS.greenMax) return "green";
  if (kcal <= RATING_BANDS.yellowMax) return "yellow";
  return "red";
}

/** A flagged meal earns the referral CTA; green stays in App 1. */
export function needsAtonement(rating: FoodRating): boolean {
  return rating !== "green";
}

export interface RatingMeta {
  emoji: string;
  label: string;
  labelZh: string;
  /** One-line verdict printed under the audit result. */
  verdict: string;
  /** Tailwind classes for the badge. */
  badgeClass: string;
}

export const RATING_META: Record<FoodRating, RatingMeta> = {
  green: {
    emoji: "\u{1F7E2}",
    label: "Green",
    labelZh: "过关",
    verdict: "Fine. I am not impressed, but I am not calling anyone either.",
    badgeClass: "border-emerald-400/30 bg-emerald-500/15 text-emerald-200",
  },
  yellow: {
    emoji: "\u{1F7E1}",
    label: "Yellow",
    labelZh: "警告",
    verdict: "That is a lot of calories for someone with your history of excuses.",
    badgeClass: "border-amber-400/30 bg-amber-500/15 text-amber-200",
  },
  red: {
    emoji: "\u{1F534}",
    label: "Red",
    labelZh: "失控",
    verdict: "Caught. That was not a snack, that was a whole personality.",
    badgeClass: "border-rose-400/30 bg-rose-500/15 text-rose-200",
  },
};