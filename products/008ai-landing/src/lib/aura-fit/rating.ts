/**
 * rating - the Calorie Bestie's read on a logged meal.
 *
 * The rating turns a bare calorie number into an encouraging next step:
 *   LIGHT    - a light, lovely meal; plenty of room later in the day,
 *   BALANCED - right in the sweet spot that keeps energy even,
 *   GENEROUS - a big, joyful meal; a graceful movement invite follows.
 *
 * Nothing here is a punishment or a "cheat" verdict. The bands are kcal for the
 * whole meal and are deliberately gentle: the app coaches habits, never shame.
 */

export type FoodRating = "light" | "balanced" | "generous";

/** Bands are kcal for the whole logged meal. */
export const RATING_BANDS = {
  lightMax: 450,
  balancedMax: 850,
} as const;

export function rateFood(totalCalories: number): FoodRating {
  const kcal = Number.isFinite(totalCalories) ? Math.max(0, totalCalories) : 0;
  if (kcal <= RATING_BANDS.lightMax) return "light";
  if (kcal <= RATING_BANDS.balancedMax) return "balanced";
  return "generous";
}

/** A generous meal earns the hand-off to the Fit Bestie; the rest stay put. */
export function invitesMovement(rating: FoodRating): boolean {
  return rating === "generous";
}

export interface RatingMeta {
  emoji: string;
  label: string;
  labelZh: string;
  /** One-line, encouraging note printed under the logged total. */
  verdict: string;
  /** Tailwind classes for the badge. */
  badgeClass: string;
}

export const RATING_META: Record<FoodRating, RatingMeta> = {
  light: {
    emoji: "\u{1F338}",
    label: "Light",
    labelZh: "轻盈",
    verdict: "Light and lovely - there is room for a proper afternoon treat later.",
    badgeClass: "border-emerald-300/60 bg-emerald-50 text-emerald-700",
  },
  balanced: {
    emoji: "\u{1F495}",
    label: "Balanced",
    labelZh: "均衡",
    verdict: "Beautifully balanced - this is the rhythm that keeps your energy even.",
    badgeClass: "border-pink-300/70 bg-pink-50 text-pink-600",
  },
  generous: {
    emoji: "\u{1F49D}",
    label: "Generous",
    labelZh: "丰盛",
    verdict: "A generous, joyful meal - let us give that energy somewhere graceful to go.",
    badgeClass: "border-fuchsia-300/70 bg-fuchsia-50 text-fuchsia-700",
  },
};
