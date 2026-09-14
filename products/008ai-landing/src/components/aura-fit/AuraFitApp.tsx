"use client";

/**
 * AuraFitApp - the merged Aura Fit (知己轻体) product shell.
 *
 * One page, one day, two besties:
 *
 *   Entry A (intake)   CalorieBestiePanel  -> logs a meal -> bestie hand-off
 *   Entry B (movement) FitBestiePanel      -> logs a burn -> bestie hand-off
 *
 * The shell owns the shared state the two halves must agree on: which bestie is
 * active, the log that travelled with the hand-off, and the day's shaping
 * dashboard (SculptProgressCard) that both feeds and reads the shared health bus.
 *
 * Hydration discipline: the entry context is parsed from window.location.search
 * and the bus is read inside effects, so the SSR markup and the first client
 * render are identical.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import BestieSwitcher from "@/components/aura-fit/BestieSwitcher";
import SculptProgressCard from "@/components/aura-fit/SculptProgressCard";
import CalorieBestiePanel from "@/components/aura-fit/CalorieBestiePanel";
import FitBestiePanel from "@/components/aura-fit/FitBestiePanel";
import { BESTIES, DEFAULT_BESTIE_ID, type Bestie, type BestieId } from "@/lib/aura-fit/besties";
import { parseLoopContext, type LoopContext, type LoopLog } from "@/lib/aura-fit/loop";
import { useHealthBus } from "@/lib/shared/health-hooks";
import type { WorkoutCompletedEvent } from "@/types/health-bus";
import { useLang } from "@/i18n/LanguageProvider";

export interface AuraFitAppProps {
  /** Which half of the loop opens first (legacy routes preselect their side). */
  initialBestie?: BestieId;
}

/** True when an ISO timestamp falls on the current local calendar day. */
function isToday(iso: string, now: Date): boolean {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return false;
  return (
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate()
  );
}

export default function AuraFitApp({ initialBestie = DEFAULT_BESTIE_ID }: AuraFitAppProps) {
  const { t } = useLang();
  const { snapshot } = useHealthBus();

  const [activeBestie, setActiveBestie] = useState<BestieId>(initialBestie);
  const [fitEntry, setFitEntry] = useState<LoopContext | null>(null);

  // Referral entry: the query string is the cross-loop contract, so it wins over
  // the default tab. Parsed in an effect (never during render) so the route stays
  // statically prerendered.
  useEffect(() => {
    const fromUrl = parseLoopContext(window.location.search);
    if (!fromUrl) return;
    setActiveBestie(fromUrl.bestie);
    if (fromUrl.bestie === "fit") setFitEntry(fromUrl);
  }, []);

  /** kcal the Calorie Bestie logged today. */
  const consumedKcal = useMemo(() => {
    const now = new Date();
    return snapshot.events.reduce(
      (sum, event) =>
        event.kind === "food.scan" && isToday(event.at, now) ? sum + event.totalCalories : sum,
      0
    );
  }, [snapshot.events]);

  /** kcal the Fit Bestie logged today, plus any wearable credit. */
  const burnedKcal = useMemo(() => {
    const now = new Date();
    const logged = snapshot.events.reduce(
      (sum, event) =>
        event.kind === "workout.completed" && isToday(event.at, now)
          ? sum + ((event as WorkoutCompletedEvent).caloriesBurned ?? 0)
          : sum,
      0
    );
    return Math.round(logged + (snapshot.wearables?.activeCalories ?? 0));
  }, [snapshot.events, snapshot.wearables]);

  const selectBestie = useCallback((bestie: Bestie) => {
    setActiveBestie(bestie.id);
    if (bestie.id === "fit") setFitEntry(null);
  }, []);

  /** Calorie Bestie -> Fit Bestie: remember the meal and switch halves. */
  const handoffToFit = useCallback((log: LoopLog) => {
    setFitEntry({
      bestie: "fit",
      label: log.label,
      calories: log.calories,
      from: "calorie_bestie",
      hasLog: true,
    });
    setActiveBestie("fit");
  }, []);

  /** Fit Bestie -> Calorie Bestie: hand the burn back for the next meal. */
  const handoffToCalorie = useCallback(() => {
    setActiveBestie("calorie");
  }, []);

  const active = BESTIES[activeBestie];

  return (
    <div className="aura-shell min-h-[100dvh] w-full px-3 pb-10 pt-4 font-sans">
      <div className="mx-auto w-full max-w-[460px]">
        <header className="flex items-center justify-between gap-2">
          <a
            href="/"
            className="flex h-10 items-center gap-2 rounded-full border border-morandi-pink/70 bg-white/70 px-3 text-[11px] font-extrabold tracking-wide text-mauve backdrop-blur transition hover:border-brand/60 hover:text-brand"
          >
            <Sparkles className="h-3.5 w-3.5 text-brand" />
            {t("aura.brand")}
          </a>
          <LanguageSwitcher variant="light" />
        </header>

        <div className="mt-4 text-center">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.28em] text-mauve">
            {t("aura.brandFull")}
          </p>
          <h1 className="mt-1 text-2xl font-black leading-tight text-ink">{t("aura.heroLine")}</h1>
          <p className="mx-auto mt-1 max-w-[360px] text-[11px] font-semibold leading-relaxed text-ink-soft">
            {t("aura.heroBody")}
          </p>
        </div>

        <div className="mt-4">
          <BestieSwitcher activeId={activeBestie} onSelect={selectBestie} />
        </div>

        <p className="mt-3 text-center text-[11px] font-bold text-mauve" aria-live="polite">
          {t("aura.activeBestie", { bestie: active.name })}
        </p>

        <SculptProgressCard consumedKcal={consumedKcal} burnedKcal={burnedKcal} />

        <div className="mt-4">
          {activeBestie === "calorie" ? (
            <CalorieBestiePanel onHandoff={handoffToFit} />
          ) : (
            <FitBestiePanel entry={fitEntry} onHandoff={handoffToCalorie} />
          )}
        </div>
      </div>
    </div>
  );
}
