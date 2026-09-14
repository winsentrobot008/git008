"use client";

/**
 * LanguageSwitcher - the one language control for every header on the site
 * (landing and /aura-fit). It reads and writes the shared language
 * state, so a choice made in any sub-app is the choice the others boot with.
 *
 * `variant` only changes the palette: the landing and Aura Fit headers sit on
 * the pink glass surface ("light"), the legacy intake surface sits on the deeper
 * ("dark").
 */

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Languages } from "lucide-react";
import { LANGUAGES, type Lang } from "@/i18n/config";
import { useLang } from "@/i18n/LanguageProvider";

type Variant = "light" | "dark";

const STYLES: Record<Variant, { trigger: string; panel: string; active: string; idle: string }> = {
  light: {
    trigger:
      "border-pink-200/70 bg-white/70 text-slate-700 backdrop-blur hover:border-pink-400 hover:bg-pink-50",
    panel: "border-pink-200/60 bg-white/95 text-slate-800 shadow-xl shadow-pink-100/60",
    active: "bg-pink-50 text-pink-600",
    idle: "text-slate-700 hover:bg-pink-50 hover:text-pink-600",
  },
  dark: {
    trigger:
      "border-white/10 bg-white/5 text-slate-300 backdrop-blur hover:border-amber-400/60 hover:text-amber-300",
    panel: "border-white/10 bg-[#111420]/95 text-slate-200 shadow-xl shadow-black/40",
    active: "bg-white/10 text-amber-300",
    idle: "text-slate-300 hover:bg-white/5 hover:text-amber-300",
  },
};

export default function LanguageSwitcher({
  variant = "light",
  compact = false,
  className = "",
}: {
  variant?: Variant;
  /** Sub-app headers are compact rails, so the trigger drops to the 36px scale. */
  compact?: boolean;
  className?: string;
}) {
  const { lang, setLang, t } = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const styles = STYLES[variant];
  const size = compact ? "h-9 gap-1 px-2.5 text-[11px]" : "h-11 gap-1.5 px-3 text-xs";
  const iconSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = LANGUAGES.find((item) => item.id === lang) ?? LANGUAGES[0];

  const select = (next: Lang) => {
    setLang(next);
    setOpen(false);
  };

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={t("common.switchLanguage")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`flex items-center rounded-full border font-extrabold transition ${size} ${styles.trigger}`}
      >
        <Languages className={iconSize} />
        {current.label}
        <ChevronDown
          className={`${iconSize} transition ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("common.language")}
          className={`absolute right-0 top-12 z-50 w-40 overflow-hidden rounded-2xl border p-1.5 backdrop-blur-xl ${styles.panel}`}
        >
          {LANGUAGES.map((option) => {
            const selected = option.id === lang;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => select(option.id)}
                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  selected ? styles.active : styles.idle
                }`}
              >
                {option.label}
                {selected ? <Check className="h-4 w-4" /> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
