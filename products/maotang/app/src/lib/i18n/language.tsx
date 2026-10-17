"use client";

/**
 * The active language, and the one place it changes.
 *
 * The server picks the first paint from `Accept-Language` (`layout.tsx` -> `parseAcceptLanguage`) and hands
 * it here as `initialLanguage`, so the HTML that arrives is already in the right language and nothing has
 * to be re-laid-out after hydration. The client then resolves the *final* answer once, on mount:
 *
 *   1. an explicit choice stored under `LANGUAGE_STORAGE_KEY` wins;
 *   2. otherwise `navigator.language` / `navigator.languages`, which is the signal the C-end auto-detect
 *      requirement names and is more accurate than the header;
 *   3. otherwise the server's `Accept-Language` guess already in state.
 *
 * Because (2) and the server's guess apply the same `zh*` rule, step 1 is normally the only one that
 * changes anything - and only for someone who deliberately picked a language. That is what keeps the
 * switch from jumping the layout: a resolved language never re-resolves itself.
 *
 * A blocked `localStorage` (Safari private mode, an embedded webview) is not an error here: it just means
 * "no stored choice", so the detected language stands.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  detectLanguage,
  isLanguagePreference,
  LANGUAGE_STORAGE_KEY,
  translate,
  type Language,
  type LanguagePreference,
  type MessageKey,
  type MessageVars,
} from "@/lib/i18n/dictionary";

export interface LanguageController {
  /** The concrete language in use. Never `"auto"`. */
  readonly language: Language;
  /** The owner's choice, which may be `"auto"`. */
  readonly preference: LanguagePreference;
  readonly setPreference: (next: LanguagePreference) => void;
  /** Look up a key in the active language. Never returns an empty string. */
  readonly t: (key: MessageKey, vars?: MessageVars) => string;
}

const LanguageContext = createContext<LanguageController | null>(null);

/** `navigator.languages` when the browser offers it, else the single `navigator.language`. */
function browserLanguages(): readonly string[] {
  const { languages, language } = window.navigator;
  if (Array.isArray(languages) && languages.length > 0) {
    return languages;
  }
  return typeof language === "string" && language !== "" ? [language] : [];
}

export interface LanguageProviderProps {
  /** Chosen by the server from `Accept-Language`; the pre-hydration value. */
  readonly initialLanguage: Language;
  readonly children: ReactNode;
}

export function LanguageProvider({ initialLanguage, children }: LanguageProviderProps) {
  const [preference, setPreferenceState] = useState<LanguagePreference>("auto");
  const [language, setLanguage] = useState<Language>(initialLanguage);

  // Resolve once. `initialLanguage` is already the server's answer, so a `"auto"` resolution that agrees
  // with it is a no-op `setState` and React does not re-render.
  useEffect(() => {
    let stored: LanguagePreference = "auto";
    try {
      const raw = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (isLanguagePreference(raw)) {
        stored = raw;
      }
    } catch {
      // No storage access means no stored choice; the detected language stands.
    }
    setPreferenceState(stored);
    // `"auto"` follows the browser tag, and the server already guessed from the header, so in the common
    // case this writes back the language that is already on screen.
    setLanguage(stored === "auto" ? detectLanguage(browserLanguages()) : stored);
  }, []);

  // Keep the document language in step, so a screen reader and the browser's own hyphenation follow the
  // copy that is actually rendered.
  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  const setPreference = useCallback((next: LanguagePreference) => {
    setPreferenceState(next);
    setLanguage(next === "auto" ? detectLanguage(browserLanguages()) : next);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // Remembering the choice is a convenience; failing to must not block the switch.
    }
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: MessageVars) => translate(language, key, vars),
    [language],
  );

  const value = useMemo<LanguageController>(
    () => ({ language, preference, setPreference, t }),
    [language, preference, setPreference, t],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/**
 * The active language for any client component under {@link LanguageProvider}.
 *
 * Throws outside the provider on purpose: a silent English fallback would look like a working page while
 * every string on it ignored the owner's choice.
 */
export function useLanguage(): LanguageController {
  const controller = useContext(LanguageContext);
  if (controller === null) {
    throw new Error("useLanguage() requires a <LanguageProvider> above it");
  }
  return controller;
}