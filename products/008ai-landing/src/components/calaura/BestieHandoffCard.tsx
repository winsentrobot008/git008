"use client";

/**
 * BestieHandoffCard - the graceful cross-loop transition.
 *
 * The whole point of the merged product: the two besties pass the user to each
 * other instead of dropping them at the end of a task.
 *
 *   intake -> movement : "Great meal! To keep our Barbie line sleek, let's check
 *                         today's movement with Fit Bestie..."
 *   movement -> intake : "Awesome burn! What did you enjoy eating today? Let's
 *                         check the balance with Calorie Bestie..."
 *
 * Presentation only: the parent owns the actual tab switch and the context that
 * travels with it (see CalauraApp).
 */

import { ArrowRight, Sparkles } from "lucide-react";
import { BESTIES, otherBestie, type BestieId } from "@/lib/calaura/besties";
import { useLang } from "@/i18n/LanguageProvider";

export type HandoffDirection = "intake-to-movement" | "movement-to-intake";

export interface BestieHandoffCardProps {
  direction: HandoffDirection;
  onHandoff: () => void;
  disabled?: boolean;
}

export default function BestieHandoffCard({
  direction,
  onHandoff,
  disabled,
}: BestieHandoffCardProps) {
  const { t } = useLang();
  const from: BestieId = direction === "intake-to-movement" ? "calorie" : "fit";
  const to = otherBestie(from);
  const copy =
    direction === "intake-to-movement"
      ? {
          title: "calaura.handoffToFitTitle",
          body: "calaura.handoffToFitBody",
          cta: "calaura.handoffToFitCta",
        }
      : {
          title: "calaura.handoffToCalorieTitle",
          body: "calaura.handoffToCalorieBody",
          cta: "calaura.handoffToCalorieCta",
        };

  return (
    <section
      className={`mt-4 overflow-hidden rounded-[28px] border border-white/70 bg-gradient-to-br ${to.accent.from} ${to.accent.to} p-[1.5px] shadow-[0_24px_50px_-32px_rgba(169,132,144,0.75)]`}
    >
      <div className="rounded-[26px] bg-white/85 p-5 backdrop-blur">
        <p className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-[0.2em] text-mauve">
          <Sparkles className="h-3 w-3 text-brand" />
          {t("calaura.handoffEyebrow", { from: BESTIES[from].name, to: to.name })}
        </p>
        <h3 className="mt-2 text-base font-black leading-snug text-ink">
          {t(copy.title)}
        </h3>
        <p className="mt-1 text-[12px] font-semibold leading-relaxed text-ink-soft">
          {t(copy.body)}
        </p>
        <button
          type="button"
          onClick={onHandoff}
          disabled={disabled}
          className={`mt-4 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r ${to.accent.from} ${to.accent.to} px-4 text-sm font-extrabold text-white shadow-lg shadow-morandi-pink/50 transition hover:brightness-105 disabled:opacity-50`}
        >
          <span aria-hidden>{to.emoji}</span>
          {t(copy.cta)}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
