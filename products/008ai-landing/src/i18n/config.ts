/**
 * i18n config - locale registry and the persistence contract shared by every
 * surface of 008ai.online (landing, /savage-cal, /savage-fit).
 *
 * English is the default: the app must render identically to the pre-i18n build
 * for a first-time visitor, so DEFAULT_LANG is what SSR emits and what the first
 * client render agrees on. The stored / detected choice is applied in an effect
 * (see LanguageProvider) - resolving it during render would desync the client
 * tree from the server HTML and trip React #418.
 */

export const LANGUAGES = [
  { id: "en", label: "EN", speech: "en-US" },
  { id: "zh", label: "\u4e2d\u6587", speech: "zh-CN" },
] as const;

export type Lang = (typeof LANGUAGES)[number]["id"];

export const DEFAULT_LANG: Lang = "en";

/** Explicit choice, written by the switcher and read on every sub-app boot. */
export const LANG_STORAGE_KEY = "app_lang";

/**
 * Legacy per-app key (Savage Fit shipped its own toggle before the global
 * switcher existed). Read once as a migration fallback, never written again.
 */
export const LANG_LEGACY_STORAGE_KEY = "savage-fit:language:v1";

/** Cookie mirror so the choice survives a cleared localStorage and is visible server-side. */
export const LANG_COOKIE_KEY = "NEXT_LOCALE";
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Anything starting with "zh" (zh, zh-CN, zh-Hans, zh-TW) maps to the Chinese build. */
export function resolveLang(raw: string | null | undefined): Lang {
  const value = String(raw || "").trim().toLowerCase();
  return value.startsWith("zh") ? "zh" : DEFAULT_LANG;
}

function readStoredLang(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Resolution order: explicit choice -> legacy per-app choice -> browser
 * language -> English.
 */
export function detectLang(): Lang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  const stored = readStoredLang(LANG_STORAGE_KEY);
  if (stored) return resolveLang(stored);
  const legacy = readStoredLang(LANG_LEGACY_STORAGE_KEY);
  if (legacy) return resolveLang(legacy);
  const browser = typeof navigator === "undefined" ? "" : navigator.language || "";
  return browser.toLowerCase().startsWith("zh") ? "zh" : DEFAULT_LANG;
}

/** Persist to localStorage (sub-apps) and the NEXT_LOCALE cookie (server hint). */
export function persistLang(lang: Lang): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* private mode: the cookie below is the remaining fallback */
  }
  try {
    document.cookie = `${LANG_COOKIE_KEY}=${lang}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; samesite=lax`;
  } catch {
    /* ignore */
  }
}

/** BCP-47 tag applied to <html lang> so screen readers and fonts follow the choice. */
export function htmlLang(lang: Lang): string {
  return lang === "zh" ? "zh-CN" : "en";
}
