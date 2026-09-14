"use client";

/**
 * FitBestiePanel - the movement half of the Aura Fit dual-bestie loop.
 *
 * Wires the movement pillars together:
 *   1. voice dialogue + hands-free streaming loop  (use-voice-engine)
 *   2. hard paywall at 3 free turns                (use-session-quota + PaywallModal)
 *   3. movement log -> WorkoutCompletedEvent       (the burn the day gets credit for)
 *   4. 9:16 dialogue clip generator                (SnippetStudio)
 *
 * Cross-loop entry: arriving from the Calorie Bestie (entry prop or ?food=&calories=
 * query) makes the Fit Bestie speak first - a warm, specific opening about the meal
 * that was just logged. Logging a movement then offers the graceful hand-off back
 * to the Calorie Bestie ("what did you enjoy eating today?").
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Film,
  Flame,
  Hand,
  Infinity as InfinityIcon,
  Lock,
  Sparkles,
  Volume2,
} from "lucide-react";
import {
  FREE_VOICE_TURNS,
  MAX_TURN_CHARS,
  resolveLanguage,
  type LanguageOption,
} from "@/lib/aura-fit/config";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLang } from "@/i18n/LanguageProvider";
import { BESTIES } from "@/lib/aura-fit/besties";
import { trackAuraEvent } from "@/lib/shared/analytics";
import { getHealthBus, HEALTH_LIMITS, takePendingBriefing } from "@/lib/shared/health-bus";
import { buildIntakeHandoffHref, entryOpeningLine, parseLoopContext, type LoopContext, type LoopLog } from "@/lib/aura-fit/loop";
import { getSessionId, markLifetimePass } from "@/lib/aura-fit/quota";
import { CoachApiError, type DialogueTurn, type VoiceUtterance } from "@/lib/aura-fit/types";
import type { LoopBriefing } from "@/types/health-bus";
import BestieHandoffCard from "./BestieHandoffCard";
import PaywallModal from "./PaywallModal";
import SnippetStudio from "./SnippetStudio";
import VoiceStage from "./VoiceStage";
import { useSessionQuota } from "./use-session-quota";
import { useVoiceEngine } from "./use-voice-engine";

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Quick movement presets: label key + the energy a typical session earns. */
const MOVEMENT_PRESETS = [
  { labelKey: "fit.presetWalk", kcal: 90 },
  { labelKey: "fit.presetPilates", kcal: 150 },
  { labelKey: "fit.presetDance", kcal: 210 },
  { labelKey: "fit.presetStrength", kcal: 240 },
] as const;

export interface FitBestiePanelProps {
  /** Cross-loop context: the meal the Calorie Bestie just handed over. */
  entry?: LoopContext | null;
  /** Called when the user accepts the hand-off back to the Calorie Bestie. */
  onHandoff?: (log: LoopLog) => void;
}

export default function FitBestiePanel({ entry: entryProp = null, onHandoff }: FitBestiePanelProps) {
  const { lang, t } = useLang();
  const bestie = BESTIES.fit;
  const [handsFree, setHandsFree] = useState(false);
  const [turns, setTurns] = useState<DialogueTurn[]>([]);
  const [coachReply, setCoachReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [burnLabel, setBurnLabel] = useState("");
  const [burnKcal, setBurnKcal] = useState("");
  const [burnNote, setBurnNote] = useState<string | null>(null);
  const [burnError, setBurnError] = useState<string | null>(null);

  // The voice engine still speaks one language at a time; it follows the
  // site-wide choice instead of a second, app-local toggle.
  const language = resolveLanguage(lang);

  const { quota, ready, consume, refund, lock } = useSessionQuota();
  const [briefing, setBriefing] = useState<LoopBriefing | null>(null);
  const [entry, setEntry] = useState<LoopContext | null>(entryProp);
  const briefingRef = useRef<LoopBriefing | null>(null);
  const autoOpenRef = useRef(false);
  const paywallLoggedRef = useRef(false);
  const turnsRef = useRef<DialogueTurn[]>([]);
  const quotaLockedRef = useRef(false);
  const languageRef = useRef<LanguageOption>(language);
  const modalDismissedRef = useRef(false);

  turnsRef.current = turns;
  quotaLockedRef.current = quota.locked;
  languageRef.current = language;

  // The intake half leaves a briefing behind: consumed once here (never during
  // render) so the first spoken turn can reference the meal that invited it.
  useEffect(() => {
    const pending = takePendingBriefing();
    if (pending) {
      briefingRef.current = pending;
      setBriefing(pending);
    }
  }, []);

  // Referral entry: a hand-off prop from the merged shell wins; on the legacy
  // route we parse window.location.search in an effect so the page stays static.
  useEffect(() => {
    if (entryProp) {
      setEntry(entryProp);
      autoOpenRef.current = true;
      return;
    }
    const fromUrl = parseLoopContext(window.location.search);
    if (!fromUrl || fromUrl.bestie !== "fit") return;
    setEntry(fromUrl);
    autoOpenRef.current = true;
  }, [entryProp]);

  const openPaywall = useCallback(() => {
    modalDismissedRef.current = false;
    setModalOpen(true);
    // One paywall.hit per session: the event is loop telemetry, not a counter.
    if (!paywallLoggedRef.current) {
      paywallLoggedRef.current = true;
      const used = turnsRef.current.filter((turn) => turn.role === "user").length;
      const cappedUsed = Math.min(used, HEALTH_LIMITS.voiceTurns);
      getHealthBus().publish({
        kind: "paywall.hit",
        gate: "voiceTurns",
        used: cappedUsed,
        limit: HEALTH_LIMITS.voiceTurns,
      });
      // Funnel hop 3: turn 4 is refused - the free tier is spent (HTTP 402).
      trackAuraEvent("aura_fit_paywall_triggered", {
        status: 402,
        gate: "voiceTurns",
        turn: used + 1,
        used: cappedUsed,
        limit: HEALTH_LIMITS.voiceTurns,
        bestieId: bestie.id,
      });
    }
  }, [bestie.id]);

  /**
   * One dialogue turn: paywall -> stream -> transcript.
   * `emit` receives every streamed chunk so the engine can speak sentences
   * while the model is still generating.
   */
  const sendTurn = useCallback(
    async (utterance: VoiceUtterance, emit: (chunk: string) => void): Promise<string> => {
      if (quotaLockedRef.current) {
        openPaywall();
        throw new CoachApiError("PAYWALL_REACHED", "Free voice turns used", 402);
      }

      setError(null);
      setTurns((previous) => [
        ...previous,
        {
          id: makeId("user"),
          role: "user",
          text: utterance.text,
          bestieId: bestie.id,
          at: Date.now(),
        },
      ]);

      const next = consume();
      const history = turnsRef.current.slice(-8).map((turn) => ({ role: turn.role, text: turn.text }));

      try {
        const response = await fetch("/api/aura-fit/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "reply",
            bestieId: bestie.id,
            transcript: utterance.text,
            history,
            language: languageRef.current.id,
            sessionId: getSessionId(),
            healthContext: briefingRef.current?.text,
          }),
        });

        if (response.status === 402) {
          const data = await readJson(response);
          lock();
          openPaywall();
          throw new CoachApiError(
            "PAYWALL_REACHED",
            typeof data.detail === "string" ? data.detail : "Free session finished",
            402
          );
        }

        if (!response.ok) {
          const data = await readJson(response);
          const code = typeof data.code === "string" ? data.code : "UPSTREAM_ERROR";
          const detail =
            typeof data.detail === "string"
              ? data.detail
              : `Coaching model error (${response.status})`;
          if (code === "AI_KEY_MISSING") {
            refund();
          }
          throw new CoachApiError(code as CoachApiError["code"], detail, response.status);
        }

        const reader = response.body?.getReader();
        let full = "";
        if (!reader) {
          full = await response.text();
          if (full) emit(full);
        } else {
          const decoder = new TextDecoder();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            if (chunk) {
              full += chunk;
              emit(chunk);
            }
          }
        }

        const reply = full.trim();
        if (!reply) {
          refund();
          throw new CoachApiError("UPSTREAM_ERROR", "The bestie had nothing to say - try again", 502);
        }

        setTurns((previous) => [
          ...previous,
          {
            id: makeId("coach"),
            role: "coach",
            text: reply,
            bestieId: bestie.id,
            at: Date.now(),
          },
        ]);
        setCoachReply(reply);
        getHealthBus().publish({
          kind: "coach.turn",
          bestieId: bestie.id,
          transcript: utterance.text,
          reply,
          haltedByPaywall: next.locked,
        });
        // Funnel hop 2: one completed voice turn (1..3 inside the free tier).
        trackAuraEvent("aura_fit_turn_completed", {
          turn: next.used,
          bestieId: bestie.id,
          locked: next.locked,
        });

        if (next.locked) {
          // Third free turn just finished: surface the paywall once the bestie
          // stops speaking (handled by the effect below).
          quotaLockedRef.current = true;
        }
        return reply;
      } catch (cause) {
        if (!(cause instanceof CoachApiError) || cause.code !== "PAYWALL_REACHED") {
          refund();
          const message = cause instanceof Error ? cause.message : String(cause);
          setError(message);
        }
        throw cause;
      }
    },
    [bestie.id, consume, lock, openPaywall, refund]
  );

  const sendTurnRef = useRef(sendTurn);
  sendTurnRef.current = sendTurn;

  const engine = useVoiceEngine({
    bestie,
    language,
    enabled: !quota.locked,
    handsFree,
    onUtterance: (utterance, emit) => sendTurnRef.current(utterance, emit),
    onCoachReply: (text) => setCoachReply(text),
    onError: (message) => setError(message),
    onPaywall: openPaywall,
  });

  const { status, interim, level, lastUtterance, beginTurn, endTurn, abortAll, speakText } = engine;

  // Typed fallback: same turn pipeline, reply spoken after the stream lands.
  const handleTypedTurn = useCallback(
    async (text: string) => {
      const utterance: VoiceUtterance = {
        id: makeId("typed"),
        text,
        audioUrl: "",
        mimeType: "",
        durationMs: 0,
        levels: [],
        bestieId: bestie.id,
        at: Date.now(),
      };
      try {
        const reply = await sendTurnRef.current(utterance, () => undefined);
        if (reply) await speakText(reply);
      } catch {
        /* errors already surfaced by sendTurn */
      }
    },
    [bestie.id, speakText]
  );

  /**
   * Opening turn. Arriving from the intake half means the bestie talks first: the
   * hand-off line is sent as the opening user turn, so the first thing the visitor
   * hears is about the meal they just logged. Waits for the paywall state to be
   * read, so a locked session never auto-spends a turn.
   */
  useEffect(() => {
    if (!ready || !entry || !autoOpenRef.current) return;
    autoOpenRef.current = false;
    if (quota.locked) return;

    const utterance: VoiceUtterance = {
      id: makeId("entry"),
      text: entryOpeningLine({ ...entry, bestie: "fit" }),
      audioUrl: "",
      mimeType: "",
      durationMs: 0,
      levels: [],
      bestieId: bestie.id,
      at: Date.now(),
    };
    void (async () => {
      try {
        const reply = await sendTurnRef.current(utterance, () => undefined);
        if (reply) await speakText(reply);
      } catch {
        /* errors already surfaced by sendTurn */
      }
    })();
  }, [bestie.id, entry, quota.locked, ready, speakText]);

  const toggleRecord = useCallback(() => {
    if (quota.locked) {
      openPaywall();
      return;
    }
    if (status === "listening") endTurn();
    else beginTurn();
  }, [beginTurn, endTurn, openPaywall, quota.locked, status]);

  const toggleHandsFree = useCallback(() => {
    if (quota.locked) {
      openPaywall();
      return;
    }
    setHandsFree((value) => {
      const next = !value;
      if (!next) abortAll();
      return next;
    });
  }, [abortAll, openPaywall, quota.locked]);

  // Stop the hands-free loop once the paywall engages. The engine keeps the final
  // reply alive until it has finished speaking, then idles out.
  useEffect(() => {
    if (quota.locked && handsFree) setHandsFree(false);
  }, [handsFree, quota.locked]);

  // Fire the subscription modal right after the last free turn is spoken.
  useEffect(() => {
    if (!ready || !quota.locked || modalDismissedRef.current) return;
    if (status !== "idle") return;
    if (turns.filter((turn) => turn.role === "user").length < FREE_VOICE_TURNS) return;
    setModalOpen(true);
  }, [quota.locked, ready, status, turns]);

  const closePaywall = useCallback(() => {
    modalDismissedRef.current = true;
    setModalOpen(false);
  }, []);

  const handleUnlocked = useCallback(() => {
    markLifetimePass();
    paywallLoggedRef.current = false;
    modalDismissedRef.current = true;
    setModalOpen(false);
    setError(null);
  }, []);

  /** Log the movement the user just did, then offer the Calorie hand-off. */
  const logMovement = useCallback(() => {
    const label = burnLabel.trim().slice(0, MAX_TURN_CHARS);
    const kcal = Math.round(Number.parseFloat(burnKcal));
    if (!label || !Number.isFinite(kcal) || kcal <= 0) {
      setBurnError(t("fit.burnInvalid"));
      return;
    }
    setBurnError(null);
    getHealthBus().publish({
      kind: "workout.completed",
      bestieId: bestie.id,
      durationSeconds: 0,
      caloriesBurned: kcal,
      label,
    });
    trackAuraEvent("aura_movement_logged", { label, caloriesBurned: kcal, bestieId: bestie.id });
    setBurnNote(t("fit.burnLogged", { kcal, label }));
  }, [bestie.id, burnKcal, burnLabel, t]);

  const handoffToCalorie = useCallback(() => {
    const kcal = Math.round(Number.parseFloat(burnKcal));
    const label = burnLabel.trim();
    trackAuraEvent("aura_movement_handoff", { label, calories: kcal, from: "fit_bestie" });
    onHandoff?.({ label, calories: Number.isFinite(kcal) ? kcal : 0 });
  }, [burnKcal, burnLabel, onHandoff]);

  const turnsUsed = useMemo(() => turns.filter((turn) => turn.role === "user").length, [turns]);
  const remainingLabel = quota.locked
    ? t("fit.passRequired")
    : t("fit.freeLeft", { remaining: Math.max(0, quota.limit - quota.used) });

  return (
    <div className="font-sans">
      <div className="mx-auto flex w-full max-w-[460px] flex-col">
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
              {t("fit.series")}
            </p>
            <h1 className="text-base font-black leading-tight text-ink">{t("fit.productName")}</h1>
          </div>
          <div className="flex items-center gap-1.5">
            <LanguageSwitcher variant="light" compact />
            <button
              type="button"
              onClick={toggleHandsFree}
              aria-pressed={handsFree}
              title={t("fit.handsFree")}
              className={`flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur transition ${
                handsFree
                  ? "border-emerald-300 bg-emerald-400/90 text-white"
                  : "border-morandi-pink/70 bg-white/70 text-ink-soft hover:border-brand/50"
              }`}
            >
              <Hand className="h-4 w-4" />
            </button>
          </div>
        </header>

        <p className="mt-2 text-center text-[10px] font-semibold text-ink-faint">{t("fit.tagline")}</p>

        <div className="mt-3 flex items-center justify-between px-1">
          <p className="text-[10px] font-bold text-ink-soft">
            {bestie.emoji} {language.id === "zh" ? bestie.nameZh : bestie.name} -{" "}
            {language.id === "zh" ? bestie.taglineZh : bestie.tagline}
          </p>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
              quota.locked ? "bg-rose-100 text-rose-500" : "bg-white/70 text-ink-soft"
            }`}
          >
            {quota.locked ? <Lock className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
            {remainingLabel}
          </span>
        </div>

        {briefing ? (
          <div className="mt-2 flex items-start gap-2 rounded-2xl border border-morandi-pink/70 bg-white/70 px-3 py-2 backdrop-blur">
            <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
            <p className="text-[10px] font-bold leading-snug text-ink-soft">
              {t("fit.briefingQueued", {
                kcal: Math.round(briefing.totalCalories),
                items: briefing.items.slice(0, 3).join(", "),
              })}{" "}
              {(briefing.targetBurnCalories ?? 0) > 0
                ? t("fit.briefingTarget", {
                    kcal: briefing.targetBurnCalories ?? 0,
                    minutes: briefing.suggestedRunMinutes ?? 0,
                  })
                : ""}
            </p>
            <button
              type="button"
              onClick={() => {
                briefingRef.current = null;
                setBriefing(null);
              }}
              className="ml-auto shrink-0 text-[10px] font-extrabold text-mauve transition hover:text-brand"
            >
              {t("fit.dismiss")}
            </button>
          </div>
        ) : null}

        <VoiceStage
          bestie={bestie}
          status={status}
          interim={interim}
          level={level}
          turns={turns}
          quota={quota}
          locked={quota.locked}
          ready={ready}
          handsFree={handsFree}
          error={engine.error || error}
          recognitionSupported={engine.recognitionSupported}
          onToggleRecord={toggleRecord}
          onTypedTurn={(text) => void handleTypedTurn(text)}
        />

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStudioOpen(true)}
            disabled={!lastUtterance}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-morandi-pink/70 bg-white/70 text-xs font-extrabold text-ink-soft backdrop-blur transition hover:border-brand/50 hover:text-brand disabled:opacity-50"
          >
            <Film className="h-4 w-4" />
            {t("fit.reelCta")}
          </button>
          <button
            type="button"
            onClick={() => setStudioOpen(true)}
            className="flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-fuchsia-300 to-pink-500 px-4 text-xs font-extrabold text-white shadow-lg shadow-morandi-pink/50 transition hover:brightness-105"
          >
            <InfinityIcon className="h-4 w-4" />
            {turnsUsed}/{FREE_VOICE_TURNS}
          </button>
        </div>

        <section className="aura-card mt-4 rounded-[28px] p-5">
          <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.2em] text-mauve">
            <Activity className="h-3 w-3 text-brand" />
            {t("fit.burnTitle")}
          </p>
          <p className="mt-1 text-[11px] font-semibold leading-relaxed text-ink-soft">
            {t("fit.burnHint")}
          </p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {MOVEMENT_PRESETS.map((preset) => (
              <button
                key={preset.labelKey}
                type="button"
                onClick={() => {
                  setBurnLabel(t(preset.labelKey));
                  setBurnKcal(String(preset.kcal));
                  setBurnError(null);
                }}
                className="rounded-full border border-morandi-pink/60 bg-white/70 px-3 py-1.5 text-[11px] font-bold text-ink-soft transition hover:border-brand/50 hover:text-brand"
              >
                {t(preset.labelKey)} · {preset.kcal}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <input
              value={burnLabel}
              onChange={(event) => setBurnLabel(event.target.value)}
              placeholder={t("fit.burnLabelPlaceholder")}
              className="h-11 min-w-0 flex-1 rounded-2xl border border-morandi-pink/70 bg-white/80 px-3 text-xs font-semibold text-ink outline-none transition placeholder:text-ink-faint focus:border-brand/60"
            />
            <input
              value={burnKcal}
              onChange={(event) => setBurnKcal(event.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              placeholder={t("fit.burnKcalPlaceholder")}
              className="h-11 w-24 rounded-2xl border border-morandi-pink/70 bg-white/80 px-3 text-center text-xs font-semibold text-ink outline-none transition placeholder:text-ink-faint focus:border-brand/60"
            />
          </div>

          {burnError ? (
            <p className="mt-2 text-[11px] font-bold text-rose-500">{burnError}</p>
          ) : null}

          <button
            type="button"
            onClick={logMovement}
            className="mt-3 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-300 to-pink-500 px-4 text-sm font-extrabold text-white shadow-lg shadow-morandi-pink/50 transition hover:brightness-105"
          >
            <Sparkles className="h-4 w-4" />
            {t("fit.burnSubmit")}
          </button>

          {burnNote ? (
            <p className="mt-2 text-center text-[11px] font-bold text-mauve">{burnNote}</p>
          ) : null}
        </section>

        {burnNote && onHandoff ? (
          <BestieHandoffCard direction="movement-to-intake" onHandoff={handoffToCalorie} />
        ) : null}

        <p className="mt-3 text-center text-[10px] font-semibold leading-relaxed text-ink-faint">
          {t("fit.disclaimer")}
        </p>
        <p className="mt-1 text-center text-[10px] font-semibold text-ink-faint">
          <a href={buildIntakeHandoffHref({ label: burnLabel || "today", calories: Number.parseInt(burnKcal, 10) || 0 })} className="font-extrabold text-brand hover:opacity-80">
            {t("fit.backToCalorie")}
          </a>
        </p>
      </div>

      <SnippetStudio
        open={studioOpen}
        onClose={() => setStudioOpen(false)}
        bestie={bestie}
        utterance={lastUtterance}
        coachReply={coachReply}
      />

      <PaywallModal
        open={modalOpen}
        onClose={closePaywall}
        bestie={bestie}
        used={quota.used}
        limit={quota.limit}
        onUnlocked={handleUnlocked}
      />
    </div>
  );
}
