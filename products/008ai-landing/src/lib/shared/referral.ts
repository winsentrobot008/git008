/**
 * referral - the contract that links App 1 (Savage Cal AI) to App 2 (Savage Fit AI).
 *
 *   /savage-fit?food=Cheeseburger&calories=860&from=savage_cal
 *
 * Both apps import this file, so the query-string shape is defined once: Savage
 * Cal writes the link, Savage Fit parses it and opens the roast.
 *
 * Parsing happens on the client from window.location.search (never during
 * render), which keeps /savage-fit statically prerendered and the SSR markup
 * identical to the first client render.
 */

export const SAVAGE_CAL_PATH = "/savage-cal";
export const SAVAGE_FIT_PATH = "/savage-fit";

/** Value written into `from`; identifies the referring app, not the user. */
export const REFERRAL_SOURCE = "savage_cal";

/** CTA copy shown on a flagged (yellow/red) audit result. */
export const ATONEMENT_CTA_LABEL = "🔥 偷吃被发现了吧？让毒舌健美闺蜜带你开练 →";

const MAX_FOOD_CHARS = 60;
const MAX_CALORIES = 20_000;
const MAX_SOURCE_CHARS = 40;

export interface AtonementReferral {
  /** The dish the audit flagged (top item by calories). */
  food: string;
  /** kcal of the audited meal. */
  calories: number;
}

export interface SavageEntryContext extends AtonementReferral {
  /** Which app sent the visitor. */
  from: string;
  /** true when the params actually carry a food audit. */
  fromAudit: boolean;
}

/** Build the referral link Savage Cal puts behind its CTA. */
export function buildAtonementHref({ food, calories }: AtonementReferral): string {
  const params = new URLSearchParams({
    food: food.trim().slice(0, MAX_FOOD_CHARS),
    calories: String(Math.max(0, Math.round(calories))),
    from: REFERRAL_SOURCE,
  });
  return `${SAVAGE_FIT_PATH}?${params.toString()}`;
}

/** Tolerant parse: unknown/blank params yield null instead of a bogus roast. */
export function parseEntryContext(search: string): SavageEntryContext | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const food = (params.get("food") || "").trim().slice(0, MAX_FOOD_CHARS);
  const parsedCalories = Number.parseFloat(params.get("calories") || "");
  const calories = Number.isFinite(parsedCalories)
    ? Math.min(Math.max(Math.round(parsedCalories), 0), MAX_CALORIES)
    : 0;
  const from = (params.get("from") || "").trim().slice(0, MAX_SOURCE_CHARS);

  const fromAudit = Boolean(food) || calories > 0 || Boolean(from);
  if (!fromAudit) return null;
  return { food, calories, from, fromAudit };
}

/**
 * The synthetic first user turn that opens the roast when someone arrives from
 * the food audit. Spoken-utterance shaped: it is sent as the user's own words.
 */
export function entryOpeningLine(entry: SavageEntryContext): string {
  const food = entry.food || "a meal I am not proud of";
  if (entry.calories > 0) {
    return `I just ate ${food}, about ${entry.calories} calories. Roast me, then tell me what to do about it right now.`;
  }
  return `I just ate ${food}. Roast me, then tell me what to do about it right now.`;
}