"use client";

/**
 * BestieSwitcher - the two-bestie selector of the merged CALauraAI app.
 *
 * Calorie Bestie owns the intake half, Fit Bestie owns the movement half. The
 * switch is deliberately two-sided (not a persona list): the product IS the pair,
 * and the cross-loop hand-off is what moves the user between them.
 */

import { Check } from "lucide-react";
import { BESTIE_LIST, type Bestie, type BestieId } from "@/lib/calaura/besties";
import { useLang } from "@/i18n/LanguageProvider";

export interface BestieSwitcherProps {
  activeId: BestieId;
  onSelect: (bestie: Bestie) => void;
  disabled?: boolean;
}

export default function BestieSwitcher({ activeId, onSelect, disabled }: BestieSwitcherProps) {
  const { lang, t } = useLang();

  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t("calaura.switcherLabel")}>
      {BESTIE_LIST.map((bestie) => {
        const active = bestie.id === activeId;
        return (
          <button
            key={bestie.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onSelect(bestie)}
            className={[
              "relative flex flex-col items-center gap-1 rounded-3xl border px-3 py-3 text-center transition-all duration-200",
              active
                ? `border-white bg-gradient-to-br ${bestie.accent.from} ${bestie.accent.to} text-white shadow-lg shadow-morandi-pink/50`
                : "border-morandi-pink/60 bg-white/60 text-ink-soft hover:border-morandi-pink hover:bg-white/85",
              disabled ? "cursor-not-allowed opacity-60" : "",
            ].join(" ")}
          >
            {active && (
              <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-white/90">
                <Check className="h-2.5 w-2.5 text-mauve" />
              </span>
            )}
            <span className="text-lg leading-none">{bestie.emoji}</span>
            <span className="text-[11px] font-extrabold leading-tight">
              {lang === "zh" ? bestie.nameZh : bestie.name}
            </span>
            <span className={`text-[9px] font-semibold leading-tight ${active ? "text-white/85" : "text-ink-faint"}`}>
              {lang === "zh" ? bestie.taglineZh : bestie.tagline}
            </span>
          </button>
        );
      })}
    </div>
  );
}
