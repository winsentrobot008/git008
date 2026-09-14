/**
 * loop - the contract that wires the Aura Fit (知己轻体) dual-bestie cross-loop.
 *
 *   Calorie Bestie  --(generous meal logged)-->  Fit Bestie
 *      /aura-fit?bestie=fit&food=Pad+Thai&calories=860&from=calorie_bestie
 *
 *   Fit Bestie      --(movement logged)------->  Calorie Bestie
 *      /aura-fit?bestie=calorie&activity=Pilates&calories=210&from=fit_bestie
 *
 * Both halves import this file, so the query-string shape is defined once: one
 * bestie writes the link, the other parses it and opens the conversation.
 *
 * Parsing happens on the client from window.location.search (never during
 * render), which keeps /aura-fit statically prerendered and the SSR markup
 * identical to the first client render.
 */

import type { BestieId } from "./besties";

/** Canonical merged route. Legacy routes /savage-cal and /savage-fit alias here. */
export const AURA_FIT_PATH = "/aura-fit";

/** Values written into `from`; they identify the referring bestie, not the user. */
export const LOOP_SOURCE = {
  calorie: "calorie_bestie",
  fit: "fit_bestie",
} as const;

/** Longest label we will echo back into the UI or a prompt. */
const MAX_LABEL_CHARS = 60;
const MAX_CALORIES = 20_000;
const MAX_SOURCE_CHARS = 40;

export interface LoopLog {
  /** The meal or activity that was logged. */
  label: string;
  /** kcal of that log. */
  calories: number;
}

export interface LoopContext extends LoopLog {
  /** Which bestie should open the conversation. */
  bestie: BestieId;
  /** Which bestie sent the visitor. */
  from: string;
  /** true when the params actually carried a log. */
  hasLog: boolean;
}

/** The hand-off the Calorie Bestie puts behind "let's check today's movement". */
export function buildMovementHandoffHref({ label, calories }: LoopLog): string {
  const params = new URLSearchParams({
    bestie: "fit",
    food: label.trim().slice(0, MAX_LABEL_CHARS),
    calories: String(Math.max(0, Math.round(calories))),
    from: LOOP_SOURCE.calorie,
  });
  return `${AURA_FIT_PATH}?${params.toString()}`;
}

/** The hand-off the Fit Bestie puts behind "what did you enjoy eating today?". */
export function buildIntakeHandoffHref({ label, calories }: LoopLog): string {
  const params = new URLSearchParams({
    bestie: "calorie",
    activity: label.trim().slice(0, MAX_LABEL_CHARS),
    calories: String(Math.max(0, Math.round(calories))),
    from: LOOP_SOURCE.fit,
  });
  return `${AURA_FIT_PATH}?${params.toString()}`;
}

/** Tolerant parse: unknown/blank params yield null instead of a bogus opening. */
export function parseLoopContext(search: string): LoopContext | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const meal = (params.get("food") || "").trim();
  const activity = (params.get("activity") || "").trim();
  const label = (meal || activity).slice(0, MAX_LABEL_CHARS);
  const parsedCalories = Number.parseFloat(params.get("calories") || "");
  const calories = Number.isFinite(parsedCalories)
    ? Math.min(Math.max(Math.round(parsedCalories), 0), MAX_CALORIES)
    : 0;
  const from = (params.get("from") || "").trim().slice(0, MAX_SOURCE_CHARS);
  const requested = (params.get("bestie") || "").trim();

  // The receiving bestie is whoever the link names; when it is absent we infer it
  // from the sender so an old hand-written link still lands on the right side.
  const bestie: BestieId =
    requested === "calorie" || requested === "fit"
      ? requested
      : from === LOOP_SOURCE.fit
        ? "calorie"
        : "fit";

  const hasLog = Boolean(label) || calories > 0 || Boolean(from);
  if (!hasLog) return null;
  return { bestie, label, calories, from, hasLog };
}

/**
 * The synthetic first user turn that opens the conversation when someone arrives
 * from the other half of the loop. Spoken-utterance shaped: it is sent as the
 * user's own words.
 */
export function entryOpeningLine(ctx: LoopContext): string {
  const what = ctx.label || "something I logged earlier";
  if (ctx.bestie === "fit") {
    return ctx.calories > 0
      ? `I just logged ${what}, about ${ctx.calories} calories. Let's shape a short, elegant session for it together.`
      : `I just logged ${what}. Let's shape a short, elegant session together.`;
  }
  return ctx.calories > 0
    ? `I just finished ${what}, about ${ctx.calories} calories of movement. What should I enjoy eating today?`
    : `I just finished ${what}. What should I enjoy eating today?`;
}
