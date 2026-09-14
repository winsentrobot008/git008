"use client";

/**
 * SculptProgressCard - the CALauraAI balance dashboard.
 *
 * The merged product never shows a harsh surplus/deficit error. Instead the day
 * is drawn as an elegant silhouette that fills gently toward its ideal line:
 *
 *   RADIANT  - the day is lighter than the ideal line: already sleek,
 *   ALIGNED  - intake sits within 15% of the ideal line,
 *   SHAPING  - a short, gentle session settles it (never framed as debt).
 *
 * Pure presentation: every number comes from lib/calaura/balance.ts
 * (computeSculpt), so the dashboard, the per-meal card and the Fit Bestie
 * briefing can never disagree.
 */

import { Sparkles } from "lucide-react";
import { computeSculpt, type SculptProgress } from "@/lib/calaura/balance";
import { useLang } from "@/i18n/LanguageProvider";

export interface SculptProgressCardProps {
  /** kcal logged today by the Calorie Bestie. */
  consumedKcal: number;
  /** Movement kcal logged today by the Fit Bestie. */
  burnedKcal?: number;
}

const VIEW_WIDTH = 120;
const VIEW_HEIGHT = 260;

/** A poised dress-form silhouette: the "ideal proportion" the day is shaping. */
const SILHOUETTE = [
  "M60 8c8 0 14 6 14 14s-6 13-14 13-14-5-14-13S52 8 60 8Z",
  "M52 36h16v9c8 5 18 13 22 29 4 16 2 30-2 42-3 9-9 17-13 26-6 14-9 42-7 70H28c2-28-1-56-7-70-4-9-10-17-13-26-4-12-6-26-2-42 4-16 14-24 22-29v-9Z",
].join(" ");

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/60 px-2 py-2 text-center">
      <p className="text-[9px] font-extrabold uppercase tracking-widest text-ink-faint">{label}</p>
      <p className="mt-0.5 text-sm font-black text-ink">
        {value}
        <span className="ml-0.5 text-[9px] font-bold text-ink-faint">{unit}</span>
      </p>
    </div>
  );
}

export default function SculptProgressCard({ consumedKcal, burnedKcal = 0 }: SculptProgressCardProps) {
  const { t } = useLang();
  const sculpt: SculptProgress = computeSculpt(consumedKcal, burnedKcal);

  const stateKey =
    sculpt.state === "radiant"
      ? "calaura.sculptStateRadiant"
      : sculpt.state === "aligned"
        ? "calaura.sculptStateAligned"
        : "calaura.sculptStateShaping";

  const fillTop = VIEW_HEIGHT - VIEW_HEIGHT * sculpt.progress;
  const percent = Math.round(sculpt.progress * 100);

  return (
    <section className="calaura-card mt-4 rounded-[28px] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-mauve">
            {t("calaura.sculptTitle")}
          </p>
          <h3 className="mt-1 text-base font-black text-ink">{t("calaura.sculptSubtitle")}</h3>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-morandi-pink/80 bg-white/70 px-3 py-1 text-[10px] font-extrabold text-mauve">
          <Sparkles className="h-3 w-3 text-brand" />
          {t(stateKey)}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-5">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
          className="calaura-silhouette-glow h-40 w-[76px] shrink-0"
          role="img"
          aria-label={t("calaura.sculptSilhouetteAlt")}
        >
          <defs>
            <linearGradient id="calaura-sculpt-fill" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#e6c3cd" />
              <stop offset="60%" stopColor="#d9a7b6" />
              <stop offset="100%" stopColor="#ec4899" />
            </linearGradient>
            <clipPath id="calaura-sculpt-clip">
              <path d={SILHOUETTE} />
            </clipPath>
          </defs>
          <path d={SILHOUETTE} fill="rgba(244, 227, 218, 0.8)" />
          <g clipPath="url(#calaura-sculpt-clip)">
            <rect x="0" y={fillTop} width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="url(#calaura-sculpt-fill)" />
          </g>
          <path
            d={SILHOUETTE}
            fill="none"
            stroke="rgba(169, 132, 144, 0.55)"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>

        <div className="min-w-0 flex-1">
          <p className="text-4xl font-black leading-none text-ink">
            {percent}
            <span className="ml-1 text-sm font-bold text-ink-faint">%</span>
          </p>
          <p className="mt-1 text-[11px] font-semibold text-ink-soft">{t("calaura.sculptProgressLabel")}</p>
          <p className="mt-3 text-[12px] font-bold leading-snug text-mauve">
            {sculpt.state === "shaping"
              ? t("calaura.sculptMinutes", { minutes: sculpt.movementMinutes })
              : t("calaura.sculptSettled")}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Stat label={t("calaura.sculptConsumed")} value={String(sculpt.consumedKcal)} unit="kcal" />
        <Stat
          label={t("calaura.sculptBurned")}
          value={sculpt.burnedKcal > 0 ? String(sculpt.burnedKcal) : "-"}
          unit={sculpt.burnedKcal > 0 ? "kcal" : ""}
        />
        <Stat label={t("calaura.sculptIdeal")} value={String(sculpt.idealKcal)} unit="kcal" />
      </dl>

      <p className="mt-3 text-[10px] font-semibold leading-relaxed text-ink-faint">
        {t("calaura.sculptFootnote")}
      </p>
    </section>
  );
}
