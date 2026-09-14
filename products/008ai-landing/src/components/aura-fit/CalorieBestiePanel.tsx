"use client";

/**
 * CalorieBestiePanel - the intake half of the Aura Fit dual-bestie loop.
 *
 *   photo -> POST /api/aura-cal/recognize -> FoodScanEvent on the shared bus
 *         -> warm rating (light / balanced / generous)
 *         -> generous? soft hand-off to the Fit Bestie ("let's check today's
 *            movement"), carrying the same ledger line the card just showed.
 *
 * Free sessions get FREE_FOOD_SCANS photo logs; the next one opens the shared
 * 008AI Aura Fit Bundle modal. There is no mock fallback: when the bridge route
 * reports RECOGNITION_NOT_CONFIGURED the UI says so rather than inventing food
 * items (repo rule for every AI route).
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowLeft, Camera, Loader2, Lock, RefreshCw } from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import SculptBalanceCard from "@/components/aura-fit/SculptBalanceCard";
import BestieNoteCard from "@/components/aura-fit/BestieNoteCard";
import BestieHandoffCard from "@/components/aura-fit/BestieHandoffCard";
import PaywallModal from "@/components/aura-fit/PaywallModal";
import { balanceBriefingLine, computeBalance } from "@/lib/aura-fit/balance";
import { FREE_FOOD_SCANS, MAX_IMAGE_BYTES } from "@/lib/aura-fit/config";
import { RATING_META, invitesMovement, rateFood } from "@/lib/aura-fit/rating";
import { BESTIES, type Bestie } from "@/lib/aura-fit/besties";
import { getSessionId } from "@/lib/aura-fit/quota";
import { buildLoopBriefing, setPendingBriefing } from "@/lib/shared/health-bus";
import { useHealthBus, useHealthGate } from "@/lib/shared/health-hooks";
import { LOOP_SOURCE, type LoopLog } from "@/lib/aura-fit/loop";
import { trackAuraEvent } from "@/lib/shared/analytics";
import type { FoodScanEvent, FoodScanItem, MealType, RecognizeResponse } from "@/types/health-bus";
import { useLang } from "@/i18n/LanguageProvider";

const MEAL_OPTIONS: { id: MealType; labelKey: string }[] = [
  { id: "breakfast", labelKey: "cal.mealBreakfast" },
  { id: "lunch", labelKey: "cal.mealLunch" },
  { id: "dinner", labelKey: "cal.mealDinner" },
  { id: "snack", labelKey: "cal.mealSnack" },
  { id: "unknown", labelKey: "cal.mealUnknown" },
];

/** The dish the note leads with: the biggest contributor on the plate. */
function topFoodName(items: FoodScanItem[]): string {
  if (items.length === 0) return "";
  return items.reduce((biggest, item) => (item.calories > biggest.calories ? item : biggest), items[0])
    .name;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that image"));
    reader.readAsDataURL(file);
  });
}

export interface CalorieBestiePanelProps {
  /** Called when the user accepts the hand-off to the Fit Bestie. */
  onHandoff?: (log: LoopLog) => void;
  /** The bestie driving this half of the loop. */
  bestie?: Bestie;
}

export default function CalorieBestiePanel({
  onHandoff,
  bestie = BESTIES.calorie,
}: CalorieBestiePanelProps) {
  const { snapshot, publish } = useHealthBus();
  const { entitled, gates, consume, lock } = useHealthGate();
  const { t } = useLang();

  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [mealType, setMealType] = useState<MealType>("unknown");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RecognizeResponse | null>(null);
  const [scanEvent, setScanEvent] = useState<FoodScanEvent | null>(null);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const gate = gates.foodScans;
  const locked = !entitled && gate.locked;

  // Falling back to the bus means a log from earlier in this session can still
  // start the movement half - that hand-off is the entire point of the loop.
  const latest = scanEvent ?? snapshot.latestFoodScan;

  /** Whichever log is on screen, fresh or remembered. */
  const logged = useMemo(() => {
    if (result) return { items: result.items, totalCalories: result.totalCalories };
    if (latest) return { items: latest.items, totalCalories: latest.totalCalories };
    return null;
  }, [latest, result]);

  const rating = logged ? rateFood(logged.totalCalories) : null;
  const ratingMeta = rating ? RATING_META[rating] : null;

  // The intake/movement ledger. Wearable credit (Apple Watch / Garmin / Whoop) is
  // part of the maths: movement already logged today carries this meal before the
  // bestie suggests a single plank. One helper feeds both the card and the event
  // we publish, so the log can never disagree with what the user just read.
  const burnCredit = snapshot.wearables?.activeCalories ?? 0;
  const balanceFor = useCallback(
    (totalCalories: number) =>
      computeBalance({ caloriesConsumed: totalCalories, activeCaloriesBurned: burnCredit }),
    [burnCredit]
  );
  const balance = useMemo(
    () => (logged ? balanceFor(logged.totalCalories) : null),
    [logged, balanceFor]
  );

  const pickFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError(t("cal.errNotImage"));
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setError(t("cal.errTooLarge"));
        return;
      }
      try {
        const dataUrl = await readAsDataUrl(file);
        setPreview(dataUrl);
        setFileName(file.name);
        setResult(null);
        setScanEvent(null);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [t]
  );

  const scan = useCallback(async () => {
    if (scanning) return;
    if (!preview) {
      setError(t("cal.errNoPhoto"));
      return;
    }
    if (locked) {
      setPaywallOpen(true);
      return;
    }

    setScanning(true);
    setError(null);
    try {
      const response = await fetch("/api/aura-cal/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: preview, mealType, sessionId: getSessionId() }),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      // The server owns the count: 402 means the free logs are gone.
      if (response.status === 402) {
        lock("foodScans");
        setPaywallOpen(true);
        return;
      }
      if (!response.ok) {
        setError(
          typeof data.detail === "string"
            ? data.detail
            : t("cal.errRecognitionFailed", { status: response.status })
        );
        return;
      }

      const parsed = data as unknown as RecognizeResponse;
      setResult(parsed);
      consume("foodScans");
      const logBalance = balanceFor(parsed.totalCalories);
      const pushed = publish({
        kind: "food.scan",
        source: "photo",
        mealType,
        items: parsed.items,
        totalCalories: parsed.totalCalories,
        provider: parsed.provider,
        ...(parsed.model ? { model: parsed.model } : {}),
        balanceMath: logBalance,
      });
      if (pushed.kind === "food.scan") setScanEvent(pushed);

      // Funnel hop 1: what the log saw, and how much shaping it invites.
      trackAuraEvent("aura_intake_logged", {
        rating: rateFood(parsed.totalCalories),
        consumedKcal: logBalance.caloriesConsumed,
        gapKcal: logBalance.targetBurnCalories,
        netKcal: logBalance.netCalories,
        items: parsed.items.length,
        mealType,
        provider: parsed.provider,
        ...(parsed.model ? { model: parsed.model } : {}),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setScanning(false);
    }
  }, [balanceFor, consume, lock, locked, mealType, preview, publish, scanning, t]);

  /**
   * Hand the ledger to the Fit Bestie. The bus briefing is left behind as well
   * as the query params: the hand-off card is the contract, the briefing is the
   * fallback if the Fit Bestie half is opened without them.
   */
  const handleHandoff = useCallback(() => {
    if (!logged || !rating) return;
    const label = topFoodName(logged.items);
    if (latest) {
      setPendingBriefing(buildLoopBriefing(latest, balance ? balanceBriefingLine(balance) : undefined));
    }
    trackAuraEvent("aura_intake_handoff", {
      food: label,
      calories: Math.round(logged.totalCalories),
      rating,
      gapKcal: balance?.targetBurnCalories ?? 0,
      from: LOOP_SOURCE.calorie,
    });
    onHandoff?.({ label, calories: Math.round(logged.totalCalories) });
  }, [balance, latest, logged, onHandoff, rating]);

  const reset = useCallback(() => {
    setPreview(null);
    setFileName("");
    setResult(null);
    setScanEvent(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const remainingLabel = entitled
    ? t("cal.unlimited")
    : t("cal.freeLeft", { remaining: Math.max(0, gate.remaining), total: FREE_FOOD_SCANS });

  return (
    <div className="px-3 pb-6 pt-3 font-sans">
      <div className="mx-auto flex w-full max-w-[430px] flex-col">
        <header className="flex items-center justify-between gap-2">
          <a
            href="/"
            className="flex h-9 items-center gap-1.5 rounded-full border border-morandi-pink/70 bg-white/70 px-3 text-[11px] font-bold text-ink-soft backdrop-blur transition hover:border-brand/60 hover:text-brand"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            008AI
          </a>
          <div className="text-center">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-mauve">
              {t("cal.series")}
            </p>
            <h1 className="text-base font-black leading-tight text-ink">{t("cal.productName")}</h1>
          </div>
          <div className="flex items-center gap-1.5">
            <LanguageSwitcher variant="light" compact />
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[10px] font-extrabold ${
                locked
                  ? "border-rose-300/70 bg-rose-50 text-rose-500"
                  : "border-morandi-pink/70 bg-white/70 text-mauve"
              }`}
            >
              {locked ? <Lock className="h-3 w-3" /> : <Camera className="h-3 w-3" />}
              {remainingLabel}
            </span>
          </div>
        </header>

        <p className="mt-2 text-center text-[10px] font-semibold text-ink-faint">{t("cal.tagline")}</p>

        <label
          htmlFor="meal-photo"
          className="mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-[28px] border border-dashed border-morandi-pink/80 bg-white/60 px-4 py-8 text-center backdrop-blur transition hover:border-brand/60"
        >
          {preview ? (
            <img src={preview} alt={t("cal.previewAlt")} className="max-h-56 w-full rounded-2xl object-cover" />
          ) : (
            <>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-rose-200 to-pink-400 text-white shadow-lg shadow-morandi-pink/50">
                <Camera className="h-6 w-6" />
              </span>
              <span className="text-sm font-extrabold text-ink">{t("cal.addPhoto")}</span>
              <span className="text-[11px] font-medium text-ink-soft">{t("cal.addPhotoHint")}</span>
            </>
          )}
          <input
            ref={fileRef}
            id="meal-photo"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => void pickFile(event.target.files?.[0])}
          />
        </label>

        {fileName ? (
          <p className="mt-1.5 truncate px-1 text-[10px] font-semibold text-ink-faint">{fileName}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {MEAL_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setMealType(option.id)}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-bold transition ${
                option.id === mealType
                  ? "border-brand/70 bg-brand/10 text-brand"
                  : "border-morandi-pink/60 bg-white/60 text-ink-soft hover:border-brand/50"
              }`}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>

        {error ? (
          <p className="mt-3 rounded-2xl border border-rose-200/80 bg-rose-50/80 px-3 py-2 text-[11px] font-bold text-rose-500">
            {error}
          </p>
        ) : null}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void scan()}
            disabled={scanning}
            className="flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-rose-300 to-pink-500 px-4 text-sm font-extrabold text-white shadow-lg shadow-morandi-pink/60 transition hover:brightness-105 disabled:opacity-50"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            {scanning ? t("cal.reading") : locked ? t("cal.unlockToLog") : t("cal.logMeal")}
          </button>
          <button
            type="button"
            onClick={reset}
            aria-label={t("cal.reset")}
            className="flex h-12 w-12 items-center justify-center rounded-2xl border border-morandi-pink/70 bg-white/70 text-ink-soft transition hover:border-brand/50"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {logged ? (
          <section className="aura-card mt-4 rounded-[28px] p-5">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-ink-faint">
                  {t("cal.totalLabel")}
                </p>
                <p className="text-3xl font-black leading-none text-ink">
                  {Math.round(logged.totalCalories)}
                  <span className="ml-1 text-xs font-bold text-ink-faint">kcal</span>
                </p>
              </div>
              {ratingMeta ? (
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-extrabold ${ratingMeta.badgeClass}`}
                >
                  {ratingMeta.emoji} {ratingMeta.label} · {ratingMeta.labelZh}
                </span>
              ) : null}
            </div>

            {ratingMeta ? (
              <p className="mt-2 text-[11px] font-semibold leading-snug text-ink-soft">
                {ratingMeta.verdict}
              </p>
            ) : null}

            <ul className="mt-3 space-y-1.5">
              {logged.items.map((item, index) => (
                <li
                  key={`${item.name}-${index}`}
                  className="flex items-baseline justify-between gap-3 rounded-xl bg-cream-deep/70 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-xs font-bold text-ink">
                    {item.name}
                    {item.quantity ? (
                      <span className="ml-1 font-medium text-ink-faint">{item.quantity}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs font-extrabold text-brand">
                    {Math.round(item.calories)} kcal
                  </span>
                </li>
              ))}
            </ul>

            {result ? (
              <p className="mt-2 text-right text-[10px] font-semibold text-ink-faint">
                {result.provider}
                {result.model ? ` - ${result.model}` : ""} · {result.latencyMs} ms
              </p>
            ) : null}
          </section>
        ) : null}

        {balance ? <SculptBalanceCard math={balance} /> : null}

        {logged && rating ? (
          <BestieNoteCard category={rating === "light" ? "MEAL_LIGHT_CHOICE" : "MEAL_GENEROUS"} />
        ) : null}

        {logged && rating && invitesMovement(rating) && onHandoff ? (
          <BestieHandoffCard
            direction="intake-to-movement"
            onHandoff={handleHandoff}
            disabled={locked}
          />
        ) : null}

        <p className="mt-3 text-center text-[10px] font-semibold text-ink-faint">
          {!logged
            ? t("cal.statusEmpty")
            : invitesMovement(rating ?? "light")
              ? t("cal.statusInvite", {
                  kcal: balance?.targetBurnCalories ?? 0,
                  bestie: bestie.name,
                })
              : t("cal.statusLogged", { bestie: bestie.name })}
        </p>

        <p className="mt-3 text-center text-[10px] font-semibold leading-relaxed text-ink-faint">
          {t("cal.disclaimer", { free: FREE_FOOD_SCANS })}
        </p>
      </div>

      <PaywallModal
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        bestie={bestie}
        gate="foodScans"
        used={gate.used}
        limit={FREE_FOOD_SCANS}
        onUnlocked={() => {
          setPaywallOpen(false);
          setError(null);
        }}
      />
    </div>
  );
}
