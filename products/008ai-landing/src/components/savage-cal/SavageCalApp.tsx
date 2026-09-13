"use client";

/**
 * SavageCalApp - the food intake audit surface (hop 1 of the Savage Bestie loop).
 *
 *   photo -> POST /api/savage-cal/recognize -> FoodScanEvent on the shared bus
 *         -> rating (green / yellow / red)
 *         -> flagged? CTA into /savage-fit?food=..&calories=..&from=savage_cal
 *
 * Free sessions get FREE_FOOD_SCANS photo audits; the next one opens the shared
 * 008AI Total Health Bundle modal. There is no mock fallback: when the bridge
 * route reports RECOGNITION_NOT_CONFIGURED the UI says so rather than inventing
 * food items (repo rule for every AI route).
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowLeft, Flame, Loader2, Lock, RefreshCw, ScanLine } from "lucide-react";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import BalanceMathCard from "@/components/savage-cal/BalanceMathCard";
import RoastCard from "@/components/savage-cal/RoastCard";
import PaywallModal from "@/components/savage-fit/PaywallModal";
import { balanceBriefingLine, computeBalance } from "@/lib/savage-cal/balance";
import { FREE_FOOD_SCANS } from "@/lib/savage-cal/config";
import { RATING_META, needsAtonement, rateFood } from "@/lib/savage-cal/rating";
import { DEFAULT_PERSONA_ID, getPersona } from "@/lib/savage-fit/personas";
import { getSessionId } from "@/lib/savage-fit/quota";
import { trackSavageEvent } from "@/lib/shared/analytics";
import { buildRoastBriefing, setPendingBriefing } from "@/lib/shared/health-bus";
import { useHealthBus, useHealthGate } from "@/lib/shared/health-hooks";
import {
  buildAtonementHref,
  REFERRAL_SOURCE,
} from "@/lib/shared/referral";
import type { FoodScanEvent, FoodScanItem, MealType, RecognizeResponse } from "@/types/health-bus";
import { useLang } from "@/i18n/LanguageProvider";

/** Mirrors the route's own cap so a huge upload never leaves the browser. */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const MEAL_OPTIONS: { id: MealType; labelKey: string }[] = [
  { id: "breakfast", labelKey: "cal.mealBreakfast" },
  { id: "lunch", labelKey: "cal.mealLunch" },
  { id: "dinner", labelKey: "cal.mealDinner" },
  { id: "snack", labelKey: "cal.mealSnack" },
  { id: "unknown", labelKey: "cal.mealUnknown" },
];

/** The dish the roast leads with: the biggest contributor on the plate. */
function topFoodName(items: FoodScanItem[]): string {
  if (items.length === 0) return "";
  return items.reduce((worst, item) => (item.calories > worst.calories ? item : worst), items[0])
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

export default function SavageCalApp() {
  const persona = getPersona(DEFAULT_PERSONA_ID);
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

  // Falling back to the bus means an audit from earlier in this session can still
  // start the atonement - that hand-off is the entire point of the loop.
  const latest = scanEvent ?? snapshot.latestFoodScan;

  /** Whichever audit is on screen, fresh or remembered. */
  const audited = useMemo(() => {
    if (result) {
      return { items: result.items, totalCalories: result.totalCalories };
    }
    if (latest) {
      return { items: latest.items, totalCalories: latest.totalCalories };
    }
    return null;
  }, [latest, result]);

  const rating = audited ? rateFood(audited.totalCalories) : null;
  const ratingMeta = rating ? RATING_META[rating] : null;
  const atonementHref = audited
    ? buildAtonementHref({ food: topFoodName(audited.items), calories: audited.totalCalories })
    : null;

  // The intake/burn ledger. Wearable credit (Apple Watch / Garmin / Whoop) is part
  // of the math: active energy already earned today pays for this meal before the
  // bestie orders a single plank. One helper feeds both the card and the event we
  // publish, so the log can never disagree with what the user just read.
  const burnCredit = snapshot.wearables?.activeCalories ?? 0;
  const balanceFor = useCallback(
    (totalCalories: number) =>
      computeBalance({ caloriesConsumed: totalCalories, activeCaloriesBurned: burnCredit }),
    [burnCredit]
  );
  const balance = useMemo(
    () => (audited ? balanceFor(audited.totalCalories) : null),
    [audited, balanceFor]
  );

  const pickFile = useCallback(async (file: File | undefined) => {
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
  }, [t]);

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
      const response = await fetch("/api/savage-cal/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: preview, mealType, sessionId: getSessionId() }),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      // The server owns the count: 402 means the free audits are gone.
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
      const auditBalance = balanceFor(parsed.totalCalories);
      const pushed = publish({
        kind: "food.scan",
        source: "photo",
        mealType,
        items: parsed.items,
        totalCalories: parsed.totalCalories,
        provider: parsed.provider,
        ...(parsed.model ? { model: parsed.model } : {}),
        balanceMath: auditBalance,
      });
      if (pushed.kind === "food.scan") setScanEvent(pushed);

      // Funnel hop 1: what the audit saw, and what it costs to atone for.
      trackSavageEvent("savage_cal_scan_complete", {
        rating: rateFood(parsed.totalCalories).toUpperCase(),
        consumedKcal: auditBalance.caloriesConsumed,
        burnDebtKcal: auditBalance.targetBurnCalories,
        netKcal: auditBalance.netCalories,
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
  }, [consume, lock, locked, mealType, preview, publish, scanning, t]);

  /**
   * Leaves the bus briefing behind as well as the query params: the referral link
   * is the contract, the briefing is the fallback if the coach is opened
   * directly without the params.
   */
  const handleAtonementClick = useCallback(() => {
    if (latest) {
      // The briefing carries the same ledger line the card shows, so the coach
      // opens on the exact workout target the user just read.
      setPendingBriefing(
        buildRoastBriefing(latest, balance ? balanceBriefingLine(balance) : undefined)
      );
    }
    if (!audited || !rating) return;
    // Funnel hop 1 -> 2: the click-through from the audit into the atonement.
    trackSavageEvent("savage_cal_cta_click", {
      food: topFoodName(audited.items),
      calories: Math.round(audited.totalCalories),
      rating: rating.toUpperCase(),
      burnDebtKcal: balance?.targetBurnCalories ?? 0,
      from: REFERRAL_SOURCE,
      hasBurnTarget: (balance?.targetBurnCalories ?? 0) > 0,
    });
  }, [audited, balance, latest, rating]);

  const reset = useCallback(() => {
    setPreview(null);
    setFileName("");
    setResult(null);
    setScanEvent(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  const remainingLabel = entitled
    ? t("cal.unlimitedAudits")
    : t("cal.freeAuditsLeft", { remaining: Math.max(0, gate.remaining), total: FREE_FOOD_SCANS });

  return (
    <div className="relative min-h-[100dvh] w-full bg-[#0b0d14] px-3 pb-6 pt-3 font-sans text-slate-100">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-20 top-6 h-56 w-56 rounded-full bg-amber-500/20 blur-[90px]" />
        <div className="absolute -right-16 bottom-10 h-64 w-64 rounded-full bg-rose-600/20 blur-[100px]" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100dvh-24px)] w-full max-w-[430px] flex-col">
        <header className="flex items-center justify-between gap-2">
          <a
            href="/"
            className="flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 text-[11px] font-bold text-slate-300 backdrop-blur transition hover:border-amber-400/60 hover:text-amber-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            008AI
          </a>
          <div className="text-center">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-amber-400">
              {t("cal.series")}
            </p>
            <h1 className="text-base font-black leading-tight text-white">
              {t("cal.productName")}
            </h1>
          </div>
          <div className="flex items-center gap-1.5">
            <LanguageSwitcher variant="dark" compact />
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[10px] font-extrabold ${
                locked
                  ? "border-rose-400/30 bg-rose-500/15 text-rose-300"
                  : "border-white/10 bg-white/5 text-slate-300"
              }`}
            >
              {locked ? <Lock className="h-3 w-3" /> : <ScanLine className="h-3 w-3" />}
              {remainingLabel}
            </span>
          </div>
        </header>

        <p className="mt-2 text-center text-[10px] font-semibold text-slate-500">
          {t("cal.tagline")}
        </p>

        <label
          htmlFor="meal-photo"
          className="mt-3 flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-3xl border border-dashed border-white/15 bg-white/[0.04] px-4 py-8 text-center backdrop-blur transition hover:border-amber-400/50"
        >
          {preview ? (
            <img
              src={preview}
              alt={t("cal.previewAlt")}
              className="max-h-56 w-full rounded-2xl object-cover"
            />
          ) : (
            <>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-rose-500 text-white shadow-lg shadow-amber-500/25">
                <Flame className="h-6 w-6" />
              </span>
              <span className="text-sm font-extrabold text-white">{t("cal.addPhoto")}</span>
              <span className="text-[11px] font-medium text-slate-400">
                {t("cal.addPhotoHint")}
              </span>
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
          <p className="mt-1.5 truncate px-1 text-[10px] font-semibold text-slate-500">{fileName}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-1.5">
          {MEAL_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setMealType(option.id)}
              className={`rounded-full border px-3 py-1.5 text-[11px] font-bold transition ${
                option.id === mealType
                  ? "border-amber-400/70 bg-amber-400/15 text-amber-200"
                  : "border-white/10 bg-white/5 text-slate-400 hover:border-white/25"
              }`}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>

        {error ? (
          <p className="mt-3 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-[11px] font-semibold leading-snug text-rose-200">
            {error}
          </p>
        ) : null}

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void scan()}
            disabled={scanning || !preview}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-rose-500 text-sm font-extrabold text-white shadow-lg shadow-amber-500/25 transition hover:brightness-105 disabled:opacity-40"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
            {scanning
              ? t("cal.readingDamage")
              : locked
                ? t("cal.unlockToAudit")
                : t("cal.runAudit")}
          </button>
          <button
            type="button"
            onClick={reset}
            aria-label={t("cal.reset")}
            className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300 transition hover:border-white/25"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {audited ? (
          <section className="mt-3 rounded-3xl border border-white/10 bg-white/[0.05] p-4 backdrop-blur">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                  Total
                </p>
                <p className="text-3xl font-black leading-none text-white">
                  {Math.round(audited.totalCalories)}
                  <span className="ml-1 text-xs font-bold text-slate-400">kcal</span>
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
              <p className="mt-2 text-[11px] font-semibold leading-snug text-slate-300">
                {ratingMeta.verdict}
              </p>
            ) : null}

            <ul className="mt-3 space-y-1.5">
              {audited.items.map((item, index) => (
                <li
                  key={`${item.name}-${index}`}
                  className="flex items-baseline justify-between gap-3 rounded-xl bg-black/25 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-xs font-bold text-slate-200">
                    {item.name}
                    {item.quantity ? (
                      <span className="ml-1 font-medium text-slate-500">{item.quantity}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs font-extrabold text-amber-300">
                    {Math.round(item.calories)} kcal
                  </span>
                </li>
              ))}
            </ul>

            {result ? (
              <p className="mt-2 text-right text-[10px] font-semibold text-slate-500">
                {result.provider}
                {result.model ? ` - ${result.model}` : ""} · {result.latencyMs} ms
              </p>
            ) : null}
          </section>
        ) : null}

        {balance ? <BalanceMathCard math={balance} /> : null}

        {audited && rating && needsAtonement(rating) ? (
          <RoastCard
            category={rating === "red" ? "FOOD_OVEREAT" : "FOOD_FALSE_HEALTHY"}
            entitled={entitled}
          />
        ) : null}

        {atonementHref && rating && needsAtonement(rating) ? (
          <a
            href={atonementHref}
            onClick={handleAtonementClick}
            className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-rose-500 px-4 py-2 text-center text-[13px] font-extrabold leading-snug text-white shadow-lg shadow-rose-500/25 transition hover:brightness-105"
          >
            {t("cal.atonementCta")}
          </a>
        ) : null}

        <p className="mt-2 text-center text-[10px] font-semibold text-slate-500">
          {!audited
            ? t("cal.statusEmpty")
            : needsAtonement(rating ?? "green")
              ? t("cal.statusAtonement", {
                  kcal: Math.round(audited.totalCalories),
                  persona: persona.name,
                })
              : t("cal.statusApproved", { persona: persona.name })}
        </p>

        <p className="mt-3 text-center text-[10px] font-semibold leading-relaxed text-slate-600">
          {t("cal.disclaimer", { free: FREE_FOOD_SCANS })}
        </p>
      </div>

      <PaywallModal
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        persona={persona}
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
