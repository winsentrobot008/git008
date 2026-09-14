/**
 * intent - how one Lumi input line is routed back into the dual loop.
 *
 * The immersive stage shows a single avatar and a single composer, so the app
 * has to decide which half of the loop a sentence belongs to before anything is
 * written to the shared health bus:
 *
 *   "I had a matcha cake"          -> intake   (Calorie Bestie logs it)
 *   "walked 40 minutes, 180 kcal"  -> movement (Fit Bestie logs it)
 *
 * The router is deliberately small and explainable: movement/meal vocabulary in
 * English and Chinese, plus an energy parser that only accepts a number which is
 * actually labelled as energy - so "40 minutes" is never read as 40 kcal.
 * Anything it cannot classify stays "unknown" and is answered by the coaching
 * model instead of being silently logged.
 */

export type LoopIntent = "intake" | "movement" | "unknown";

/**
 * Movement vocabulary. The CJK entries are written as unicode escapes so this
 * module stays inside the CALauraAI i18n gate (no hardcoded CJK in src/lib/**).
 */
const MOVEMENT_WORDS: readonly string[] = [
  "walk", "walked", "walking", "run", "ran", "running", "jog", "jogged", "jogging",
  "pilates", "yoga", "dance", "danced", "dancing", "strength", "lift", "lifted",
  "gym", "cycle", "cycled", "cycling", "spin", "swim", "swam", "swimming", "hike",
  "hiked", "hiking", "cardio", "workout", "trained", "training", "reformer",
  "stretch", "stretching", "steps", "treadmill", "row", "rowed",
  "\u8d70\u8def", "\u6563\u6b65", "\u8dd1\u6b65", "\u6162\u8dd1", "\u5feb\u8d70", "\u745c\u4f3d", "\u666e\u62c9\u63d0", "\u8df3\u821e", "\u821e\u8e48", "\u5065\u8eab", "\u8bad\u7ec3", "\u8fd0\u52a8", "\u529b\u91cf", "\u9a91\u8f66", "\u5355\u8f66", "\u6e38\u6cf3", "\u722c\u5c71", "\u5f92\u6b65", "\u953b\u70bc", "\u4e3e\u94c1", "\u62c9\u4f38", "\u692d\u5706\u673a", "\u5212\u8239\u673a", "\u6b65\u6570", "\u6d88\u8017",
];

/** Meal vocabulary, used only to break ties in favour of the Calorie Bestie. */
const INTAKE_WORDS: readonly string[] = [
  "ate", "eat", "eating", "had", "breakfast", "brunch", "lunch", "dinner", "supper",
  "snack", "snacked", "dessert", "cake", "cookie", "coffee", "latte", "matcha",
  "bubble tea", "milk tea", "pizza", "burger", "fries", "pasta", "noodles", "ramen",
  "rice", "salad", "sushi", "chocolate", "ice cream", "croissant", "pastry",
  "smoothie", "juice", "cooked", "ordered", "takeout",
  "\u5403\u4e86", "\u5403", "\u559d\u4e86", "\u559d", "\u65e9\u9910", "\u5348\u9910", "\u665a\u9910", "\u591c\u5bb5", "\u4e0b\u5348\u8336", "\u52a0\u9910", "\u96f6\u98df", "\u5976\u8336", "\u5496\u5561", "\u86cb\u7cd5", "\u751c\u70b9", "\u9762\u5305", "\u7c73\u996d", "\u9762\u6761", "\u706b\u9505", "\u62ab\u8428", "\u6c49\u5821", "\u6c99\u62c9", "\u5bff\u53f8", "\u5de7\u514b\u529b", "\u51b0\u6dc7\u6dcb", "\u70b9\u4e86", "\u5916\u5356",
];

export const MOVEMENT_PRESETS = [
  { labelKey: "fit.presetWalk", kcal: 90 },
  { labelKey: "fit.presetPilates", kcal: 150 },
  { labelKey: "fit.presetDance", kcal: 210 },
  { labelKey: "fit.presetStrength", kcal: 240 },
] as const;

/**
 * The three gentle "how much roughly" cards offered while the avatar waits for
 * an intake estimate. They are deliberately rounded - the user is guessing.
 */
export const INTAKE_PRESETS = [
  { labelKey: "stage.kcalLight", kcal: 320 },
  { labelKey: "stage.kcalBalanced", kcal: 520 },
  { labelKey: "stage.kcalGenerous", kcal: 780 },
] as const;

/** kcal in a kJ world. */
const KJ_PER_KCAL = 4.184;

const KCAL_PATTERN =
  /(\d{1,4}(?:[.,]\d{1,2})?)\s*(kcal|kilocalories?|calories?|cals?|kj|kilojoules?|\u5343\u5361|\u5927\u5361|\u5361\u8def\u91cc|\u5361)/i;

const KJ_PATTERN = /(kj|kilojoules?|\u5343\u7126)/i;

function normalise(value: string): string {
  return value.toLowerCase().replace(/[.,](?=\d{3}\b)/g, "");
}

/**
 * Energy explicitly labelled in the sentence ("520 kcal", "520 千卡"). Returns
 * null when the number is not attached to an energy unit.
 */
export function extractKcal(text: string): number | null {
  const match = KCAL_PATTERN.exec(text);
  if (!match) return null;
  const amount = Number.parseFloat(normalise(match[1]));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const kilojoules = KJ_PATTERN.test(match[2]);
  return Math.round(kilojoules ? amount / KJ_PER_KCAL : amount);
}

/** A bare number, accepted only while the avatar is explicitly asking for kcal. */
export function extractBareNumber(text: string): number | null {
  const match = /(\d{1,4})/.exec(text);
  if (!match) return null;
  const amount = Number.parseInt(match[1], 10);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function contains(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => needle.length > 0 && haystack.includes(needle));
}

function score(text: string, words: readonly string[]): number {
  return words.reduce((total, word) => (text.includes(word) ? total + 1 : total), 0);
}

/**
 * Route a sentence. Movement wins ties: someone who mentions training usually
 * wants it logged as movement, and the Calorie Bestie hears about it on the
 * way back through the loop anyway.
 */
export function detectLoopIntent(text: string): LoopIntent {
  const haystack = normalise(text);
  const movement = score(haystack, MOVEMENT_WORDS);
  const intake = score(haystack, INTAKE_WORDS);
  if (movement > 0 && movement >= intake) return "movement";
  if (intake > 0) return "intake";
  return "unknown";
}

/** Trim a log label to something that reads well in a spoken sentence. */
export function labelFromText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean;
}
