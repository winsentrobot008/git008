"use client";

/**
 * CalauraApp - the CALauraAI composition root.
 *
 * Layout of responsibilities:
 *
 *   CalauraStage   the immersive surface: one avatar, one glass composer, the
 *                  live conversation, and the writes to the shared health bus.
 *   drawer         the optional fine-tune sheet (photo review, voice studio,
 *                  movement log, shaping dashboard, paywall restore) that the
 *                  panels below still own. It mounts on demand so the immersive
 *                  view never boots a second voice engine.
 *
 * The shell itself owns only what both halves must agree on: which bestie is
 * active, the log that travelled with the hand-off, and today's ledger.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, Sparkles, X } from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import CalauraStage from "@/components/calaura/CalauraStage";
import CalorieBestiePanel from "@/components/calaura/CalorieBestiePanel";
import FitBestiePanel from "@/components/calaura/FitBestiePanel";
import SculptProgressCard from "@/components/calaura/SculptProgressCard";
import BestieSwitcher from "@/components/calaura/BestieSwitcher";
import { BESTIES, DEFAULT_BESTIE_ID, type BestieId } from "@/lib/calaura/besties";
import { parseLoopContext, type LoopContext, type LoopLog } from "@/lib/calaura/loop";
import { useHealthBus } from "@/lib/shared/health-hooks";
import type { WorkoutCompletedEvent } from "@/types/health-bus";
import { useLang } from "@/i18n/LanguageProvider";

export interface CalauraAppProps {
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

export default function CalauraApp({ initialBestie = DEFAULT_BESTIE_ID }: CalauraAppProps) {
  const { t } = useLang();
  const { snapshot } = useHealthBus();

  const [bestieId, setBestieId] = useState<BestieId>(initialBestie);
  const [entry, setEntry] = useState<LoopContext | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Loop hand-off: the query string is the cross-loop contract, so it wins over
  // the default bestie. Parsed in an effect so the route stays prerendered.
  useEffect(() => {
    const fromUrl = parseLoopContext(window.location.search);
    if (!fromUrl) return;
    setBestieId(fromUrl.bestie);
    setEntry(fromUrl);
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

  const active = BESTIES[bestieId];

  /** The fine-tune drawer hands a meal to the Fit Bestie exactly like the stage. */
  const handoffToFit = useCallback((log: LoopLog) => {
    setEntry({ bestie: "fit", label: log.label, calories: log.calories, from: "calorie_bestie", hasLog: true });
    setBestieId("fit");
  }, []);

  return (
    <div className="calaura-shell relative min-h-[100dvh] w-full font-sans">
      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 px-4 pt-[max(14px,env(safe-area-inset-top))]">
        <a
          href="/"
          className="flex h-9 items-center gap-1.5 rounded-full border border-white/70 bg-white/55 px-3 text-[11px] font-extrabold tracking-wide text-mauve backdrop-blur-xl transition hover:text-brand"
        >
          <Sparkles className="h-3.5 w-3.5 text-brand" />
          {t("calaura.brand")}
        </a>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawerOpen((open) => !open)}
            aria-expanded={drawerOpen}
            aria-label={drawerOpen ? t("stage.detailsClose") : t("stage.detailsOpen")}
            title={drawerOpen ? t("stage.detailsClose") : t("stage.detailsOpen")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-white/55 text-mauve backdrop-blur-xl transition hover:text-brand"
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>
          <LanguageSwitcher variant="light" />
        </div>
      </header>

      <CalauraStage
        bestieId={bestieId}
        onBestieChange={setBestieId}
        consumedKcal={consumedKcal}
        burnedKcal={burnedKcal}
        entry={entry}
      />

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/25 backdrop-blur-sm">
          <section
            aria-label={t("stage.detailsOpen")}
            className="calaura-rise max-h-[82dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[30px] border border-white/70 bg-cream/95 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-4 shadow-[0_-20px_60px_-25px_rgba(169,132,144,0.65)]"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[11px] font-black uppercase tracking-[0.28em] text-mauve">
                {active.name}
              </p>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label={t("stage.detailsClose")}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-morandi-pink/70 bg-white/70 text-mauve transition hover:text-brand"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-3">
              <BestieSwitcher activeId={bestieId} onSelect={(bestie) => setBestieId(bestie.id)} />
            </div>

            <SculptProgressCard consumedKcal={consumedKcal} burnedKcal={burnedKcal} />

            <div className="mt-3">
              {bestieId === "calorie" ? (
                <CalorieBestiePanel onHandoff={handoffToFit} />
              ) : (
                <FitBestiePanel entry={entry} onHandoff={() => setBestieId("calorie")} />
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
