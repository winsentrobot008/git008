/**
 * Dictionary registry. `en` is the source of truth for the key shape: every
 * other locale is asserted against it, so a missing or misspelled key is a
 * compile error rather than a silently untranslated string.
 */

import en from "./locales/en.json";
import zh from "./locales/zh.json";
import type { Lang } from "./config";

export type Dictionary = typeof en;

export const DICTIONARIES: Record<Lang, Dictionary> = {
  en,
  zh: zh as Dictionary,
};
