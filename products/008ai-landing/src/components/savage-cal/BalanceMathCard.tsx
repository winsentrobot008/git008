"use client";

/**
 * BalanceMathCard - "so what does it take to square it" panel of a food audit.
 *
 * Sits under the calorie total on every audit: the intake/consumption gap, the
 * wearable credit that gap absorbed, and the two workout equivalents the
 * atonement order is built from (plank hold, slow jog).
 *
 * Pure presentation - every number comes from lib/savage-cal/balance.ts, so the
 * card, the FoodScanEvent log and the roast briefing can never disagree.
 */

import { Activity, Timer } from "lucide-react";
import { BALANCE_MODEL, describeBalance, formatPlankHold } from "@/lib/savage-cal/balance";
import type { BalanceMath } from "@/types/health-bus";
import { useLang } from "@/i18n/LanguageProvider";

export interface BalanceMathCardProps {
  math: BalanceMath;
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-2xl bg-black/25 px-2 py-2">
      <dt className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-black text-white">
        {value}
        <span className="ml-0.5 text-[9px] font-bold text-slate-500">{unit}</span>
      </dd>
    </div>
  );
}

function Equivalent({
  icon,
  label,
  value,
  hint,
}: {
  icon: typeof Timer;
  label: string;
  value: string;
  hint: string;
}) {
  const Icon = icon;
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-2.5 py-2">
      <span className="flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-widest text-amber-300">
        <Icon className="h-3 w-3" />
        {label}
      </span>
      <p className="mt-1 text-base font-black leading-none text-white">{value}</p>
      <p className="mt-1 text-[9px] font-semibold text-slate-500">{hint}</p>
    </div>
  );
}

export default function BalanceMathCard({ math }: BalanceMathCardProps) {
  const overBudget = !math.balanced;
  const { t } = useLang();

  return (
    <section className="mt-3 rounded-3xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
          {t("cal.balanceTitle")}
        </p>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-extrabold ${
            overBudget
              ? "border-rose-400/30 bg-rose-500/15 text-rose-200"
              : "border-emerald-400/30 bg-emerald-500/15 text-emerald-200"
          }`}
        >
          {overBudget
            ? t("cal.balanceToBurn", { kcal: math.targetBurnCalories })
            : t("cal.balanceInBalance")}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label={t("cal.statThisMeal")} value={String(math.caloriesConsumed)} unit="kcal" />
        <Stat label={t("cal.statAllowance")} value={String(math.mealBudgetKcal)} unit="kcal" />
        <Stat
          label={t("cal.statBurnedToday")}
          value={math.activeCaloriesBurned > 0 ? String(math.activeCaloriesBurned) : "-"}
          unit={math.activeCaloriesBurned > 0 ? "kcal" : ""}
        />
      </dl>

      {overBudget ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Equivalent
            icon={Timer}
            label={t("cal.equivPlankHold")}
            value={formatPlankHold(math.suggestedPlankSeconds)}
            hint={`${math.plankKcalPerSecond} kcal/s`}
          />
          <Equivalent
            icon={Activity}
            label={t("cal.equivSlowJog")}
            value={`${math.suggestedRunMinutes} min`}
            hint={`${math.jogKcalPerMinute} kcal/min`}
          />
        </div>
      ) : null}

      <p
        className={`mt-3 text-[11px] font-semibold leading-snug ${
          overBudget ? "text-rose-200" : "text-emerald-200"
        }`}
      >
        {describeBalance(math)}
      </p>

      <p className="mt-2 text-[10px] font-semibold leading-relaxed text-slate-500">
        {t("cal.balanceFootnote", {
          plankMet: BALANCE_MODEL.plankMet.toFixed(1),
          jogMet: BALANCE_MODEL.jogMet.toFixed(1),
          weightKg: BALANCE_MODEL.referenceWeightKg,
        })}
      </p>
    </section>
  );
}
