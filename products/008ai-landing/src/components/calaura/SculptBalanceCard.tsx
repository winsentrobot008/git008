"use client";

/**
 * SculptBalanceCard - "how does this meal shape the rest of the day" panel.
 *
 * Sits under the logged total: the intake/movement gap, the movement energy it
 * already absorbed, and the two gentle equivalents the Fit Bestie hand-off is
 * built from (plank hold, easy jog). Excess is never an error - it is simply
 * more shaping, and the copy says so kindly.
 *
 * Pure presentation - every number comes from lib/calaura/balance.ts, so the
 * card, the FoodScanEvent log and the loop briefing can never disagree.
 */

import { Activity, Timer } from "lucide-react";
import { BALANCE_MODEL, formatPlankHold } from "@/lib/calaura/balance";
import type { BalanceMath } from "@/types/health-bus";
import { useLang } from "@/i18n/LanguageProvider";

export interface SculptBalanceCardProps {
  math: BalanceMath;
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/65 px-2 py-2 text-center">
      <dt className="text-[9px] font-extrabold uppercase tracking-widest text-ink-faint">{label}</dt>
      <dd className="mt-0.5 text-sm font-black text-ink">
        {value}
        <span className="ml-0.5 text-[9px] font-bold text-ink-faint">{unit}</span>
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
    <div className="rounded-2xl border border-morandi-pink/60 bg-white/70 px-2.5 py-2">
      <span className="flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-widest text-mauve">
        <Icon className="h-3 w-3 text-brand" />
        {label}
      </span>
      <p className="mt-1 text-base font-black leading-none text-ink">{value}</p>
      <p className="mt-1 text-[9px] font-semibold text-ink-faint">{hint}</p>
    </div>
  );
}

export default function SculptBalanceCard({ math }: SculptBalanceCardProps) {
  const { t } = useLang();
  const shaping = !math.balanced;

  return (
    <section className="calaura-card mt-4 rounded-[28px] p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-mauve">
          {t("cal.balanceTitle")}
        </p>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-extrabold ${
            shaping
              ? "border-morandi-pink/80 bg-white/70 text-mauve"
              : "border-emerald-300/70 bg-emerald-50 text-emerald-700"
          }`}
        >
          {shaping
            ? t("cal.balanceToBurn", { kcal: math.targetBurnCalories })
            : t("cal.balanceInBalance")}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2">
        <Stat label={t("cal.statThisMeal")} value={String(math.caloriesConsumed)} unit="kcal" />
        <Stat label={t("cal.statAllowance")} value={String(math.mealBudgetKcal)} unit="kcal" />
        <Stat
          label={t("cal.statBurnedToday")}
          value={math.activeCaloriesBurned > 0 ? String(math.activeCaloriesBurned) : "-"}
          unit={math.activeCaloriesBurned > 0 ? "kcal" : ""}
        />
      </dl>

      {shaping ? (
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

      <p className="mt-3 text-[11px] font-semibold leading-snug text-ink-soft">
        {math.balanced
          ? math.activeCaloriesBurned > 0
            ? t("cal.balanceNoteCovered", { kcal: math.activeCaloriesBurned })
            : t("cal.balanceNoteInBalance")
          : t("cal.balanceNoteShaping", {
              kcal: math.targetBurnCalories,
              plank: formatPlankHold(math.suggestedPlankSeconds),
              minutes: math.suggestedRunMinutes,
            })}
      </p>

      <p className="mt-2 text-[10px] font-semibold leading-relaxed text-ink-faint">
        {t("cal.balanceFootnote", {
          plankMet: BALANCE_MODEL.plankMet.toFixed(1),
          jogMet: BALANCE_MODEL.jogMet.toFixed(1),
          weightKg: BALANCE_MODEL.referenceWeightKg,
        })}
      </p>
    </section>
  );
}
