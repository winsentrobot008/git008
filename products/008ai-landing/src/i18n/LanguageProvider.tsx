"use client";

/**
 * LanguageProvider - one language state for the whole site.
 *
 * Hydration contract: SSR and the first client render both emit DEFAULT_LANG
 * ("en"), and the stored / detected locale is applied in an effect. That is the
 * same pattern use-session-quota and CalauraApp use, and it is what keeps the
 * markup byte-identical across the boundary (React #418 protection).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_LANG, detectLang, htmlLang, persistLang, type Lang } from "./config";
import { DICTIONARIES } from "./dictionaries";

type Vars = Record<string, string | number>;

export interface LanguageContextValue {
  lang: Lang;
  setLang: (next: Lang) => void;
  /** Dot-path lookup with {placeholder} interpolation; falls back to English, then the key. */
  t: (key: string, vars?: Vars) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function lookup(source: unknown, key: string): string | undefined {
  const hit = key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
  return typeof hit === "string" ? hit : undefined;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match
  );
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    setLangState(detectLang());
  }, []);

  useEffect(() => {
    document.documentElement.lang = htmlLang(lang);
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    persistLang(next);
  }, []);

  const t = useCallback(
    (key: string, vars?: Vars) => {
      const hit = lookup(DICTIONARIES[lang], key) ?? lookup(DICTIONARIES[DEFAULT_LANG], key);
      return interpolate(hit ?? key, vars);
    },
    [lang]
  );

  const value = useMemo<LanguageContextValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLang(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLang must be used inside <LanguageProvider>");
  return context;
}
