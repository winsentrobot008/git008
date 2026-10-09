"use client";

/**
 * The active language, and the one place it changes.
 *
 * The server always renders English (`layout.tsx` -> `DEFAULT_LANGUAGE`) and hands that here as
 * `initialLanguage`, so the HTML that arrives is already the global face and nothing is re-laid-out after
 * hydration. The client then resolves the *final* answer once, on mount:
 *
 *   1. an explicit choice stored under `LANGUAGE_STORAGE_KEY` wins;
 *   2. otherwise English - the global default, regardless of the browser tag.
 *
 * There is deliberately no locale sniffing any more: the consumer face is the global edition, so a
 * zh-CN browser must not be guessed into a Chinese console it did not ask for. `中文` in the drawer is
 * how a reader opts in.
 *
 * A blocked `localStorage` (Safari private mode, an embedded webview) is not an error here: it just means
 * "no stored choice", so the detected language stands.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import {
  DEFAULT_LANGUAGE,
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
    // `"auto"` is English, not the browser tag: the console is the global edition. The Chinese face is
    // one explicit tap away in the drawer, so a zh-CN visitor is never guessed into it.
    setLanguage(stored === "auto" ? DEFAULT_LANGUAGE : stored);
  }, []);

  // Keep the document language in step, so a screen reader and the browser's own hyphenation follow the
  // copy that is actually rendered.
  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  const setPreference = useCallback((next: LanguagePreference) => {
    setPreferenceState(next);
    setLanguage(next === "auto" ? DEFAULT_LANGUAGE : next);
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