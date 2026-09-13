"use client";

/**
 * SavageFitApp - the 9:16 vertical voice companion shell.
 *
 * Wires the four product pillars together:
 *   1. voice dialogue + hands-free streaming loop  (use-voice-engine)
 *   2. persona switcher (3 prompt templates)       (PersonaSwitcher)
 *   3. hard paywall at 3 free turns                (use-session-quota + PaywallModal)
 *   4. 9:16 dialogue clip generator                (SnippetStudio)
 *
 * Entry contract: /savage-fit?food=..&calories=..&from=savage_cal arrives from
 * Savage Cal AI and makes the bestie speak first (opening roast) instead of
 * waiting for a microphone tap.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Film, Flame, Hand, Infinity as InfinityIcon, Lock, Sparkles, Volume2 } from "lucide-react";
import {
  FREE_VOICE_TURNS,
  resolveLanguage,
  type LanguageOption,
} from "@/lib/savage-fit/config";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLang } from "@/i18n/LanguageProvider";
import { DEFAULT_PERSONA_ID, getPersona, type Persona } from "@/lib/savage-fit/personas";
import { trackSavageEvent } from "@/lib/shared/analytics";
import { readPrivateRoastConfig, type PrivateRoastConfig } from "@/lib/shared/roast-db";
import { getHealthBus, HEALTH_LIMITS, takePendingBriefing } from "@/lib/shared/health-bus";
import {
  entryOpeningLine,
  parseEntryContext,
  type SavageEntryContext,
} from "@/lib/shared/referral";
import { getSessionId, markLifetimePass } from "@/lib/savage-fit/quota";
import { CoachApiError, type DialogueTurn, type VoiceUtterance } from "@/lib/savage-fit/types";
import type { RoastBriefing } from "@/types/health-bus";
import PaywallModal from "./PaywallModal";
import PersonaSwitcher from "./PersonaSwitcher";
import PrivateRoastSettingsModal from "./PrivateRoastSettingsModal";
import SnippetStudio from "./SnippetStudio";
import VoiceStage from "./VoiceStage";
import { useSessionQuota } from "./use-session-quota";
import { useVoiceEngine } from "./use-voice-engine";

const PERSONA_KEY = "savage-fit:persona:v1";

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

export default function SavageFitApp() {
  const { lang, t } = useLang();
  const [persona, setPersona] = useState<Persona>(() => getPersona(DEFAULT_PERSONA_ID));
  const [handsFree, setHandsFree] = useState(false);
  const [turns, setTurns] = useState<DialogueTurn[]>([]);
  const [coachReply, setCoachReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [roastConfig, setRoastConfig] = useState<PrivateRoastConfig | null>(null);

  // The voice engine still speaks one language at a time; it now follows the
  // site-wide choice instead of a second, app-local toggle.
  const language = resolveLanguage(lang);

  const { quota, ready, entitled, consume, refund, lock } = useSessionQuota();
  const [briefing, setBriefing] = useState<RoastBriefing | null>(null);
  const [entry, setEntry] = useState<SavageEntryContext | null>(null);
  const briefingRef = useRef<RoastBriefing | null>(null);
  const autoOpenRef = useRef(false);
  const paywallLoggedRef = useRef(false);
  const turnsRef = useRef<DialogueTurn[]>([]);
  const quotaLockedRef = useRef(false);
  const personaRef = useRef<Persona>(persona);
  const languageRef = useRef<LanguageOption>(language);
  const roastConfigRef = useRef<PrivateRoastConfig | null>(null);
  const modalDismissedRef = useRef(false);

  turnsRef.current = turns;
  quotaLockedRef.current = quota.locked;
  personaRef.current = persona;
  languageRef.current = language;
  roastConfigRef.current = roastConfig;

  // Persisted preferences (read in an effect: SSR markup stays default).
  useEffect(() => {
    try {
      const storedPersona = window.localStorage.getItem(PERSONA_KEY);
      if (storedPersona) setPersona(getPersona(storedPersona));
    } catch {
      /* private mode */
    }
    // The food audit leaves a roast briefing behind: consume it once here (never
    // during render) so the first spoken turn can call out the meal that
    // triggered the atonement workout.
    const pending = takePendingBriefing();
    if (pending) {
      briefingRef.current = pending;
      setBriefing(pending);
    }

    // Referral entry: the query string is the contract, so it wins over any stale
    // bus briefing. Parsed from window.location.search in an effect (never during
    // render) so this route stays statically prerendered.
    const fromUrl = parseEntryContext(window.location.search);
    if (fromUrl) {
      const kcalLabel = fromUrl.calories > 0 ? `${fromUrl.calories} kcal` : "unknown calories";
      const opened: RoastBriefing = {
        scanId: `entry-${Date.now().toString(36)}`,
        totalCalories: fromUrl.calories,
        items: fromUrl.food ? [fromUrl.food] : [],
        minutesAgo: 0,
        text: `Latest food audit: ${kcalLabel} from ${fromUrl.food || "an unlogged meal"} (logged 0 minute(s) ago).`,
      };
      briefingRef.current = opened;
      setBriefing(opened);
      setEntry(fromUrl);
      autoOpenRef.current = true;
    }
  }, []);

  // Paid tier: load the private roast bank as soon as the pass state is known,
  // so every turn sends it from session state instead of re-reading storage.
  useEffect(() => {
    if (!ready || !entitled) return;
    setRoastConfig(readPrivateRoastConfig());
  }, [entitled, ready]);

  const selectPersona = useCallback((next: Persona) => {
    setPersona(next);
    try {
      window.localStorage.setItem(PERSONA_KEY, next.id);
    } catch {
      /* ignore */
    }
  }, []);

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
      trackSavageEvent("savage_fit_paywall_triggered", {
        status: 402,
        gate: "voiceTurns",
        turn: used + 1,
        used: cappedUsed,
        limit: HEALTH_LIMITS.voiceTurns,
        personaId: personaRef.current.id,
      });
    }
  }, []);

  /** Pass holders open the customization drawer; everyone else gets the offer. */
  const openSettings = useCallback(() => {
    if (!entitled) {
      openPaywall();
      return;
    }
    setSettingsOpen(true);
  }, [entitled, openPaywall]);

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
          personaId: personaRef.current.id,
          at: Date.now(),
        },
      ]);

      const next = consume();
      const history = turnsRef.current.slice(-8).map((turn) => ({ role: turn.role, text: turn.text }));
      // Session context: the private bank saved from the settings drawer. Null
      // for free users, and the route re-verifies entitlement before using it.
      const activeRoast = roastConfigRef.current;

      try {
        const response = await fetch("/api/savage-fit/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "reply",
            personaId: personaRef.current.id,
            transcript: utterance.text,
            history,
            language: languageRef.current.id,
            sessionId: getSessionId(),
            healthContext: briefingRef.current?.text,
            ...(activeRoast ? { roastConfig: activeRoast } : {}),
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
            typeof data.detail === "string" ? data.detail : `Coaching model error (${response.status})`;
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
          throw new CoachApiError("UPSTREAM_ERROR", "The coach had nothing to say - try again", 502);
        }

        setTurns((previous) => [
          ...previous,
          {
            id: makeId("coach"),
            role: "coach",
            text: reply,
            personaId: personaRef.current.id,
            at: Date.now(),
          },
        ]);
        setCoachReply(reply);
        getHealthBus().publish({
          kind: "coach.turn",
          personaId: personaRef.current.id,
          transcript: utterance.text,
          reply,
          haltedByPaywall: next.locked,
        });
        // Funnel hop 2: one completed voice turn (1..3 inside the free tier).
        trackSavageEvent("savage_fit_turn_completed", {
          turn: next.used,
          personaId: personaRef.current.id,
          locked: next.locked,
        });

        if (next.locked) {
          // Third free turn just finished: surface the paywall once the coach
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
    [consume, lock, openPaywall, refund]
  );

  const sendTurnRef = useRef(sendTurn);
  sendTurnRef.current = sendTurn;

  const engine = useVoiceEngine({
    persona,
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
        personaId: personaRef.current.id,
        at: Date.now(),
      };
      try {
        const reply = await sendTurnRef.current(utterance, () => undefined);
        if (reply) await speakText(reply);
      } catch {
        /* errors already surfaced by sendTurn */
      }
    },
    [speakText]
  );

  /**
   * Opening roast. Arriving from the food audit means the bestie talks first: the
   * referral line is sent as the opening user turn, so the first thing the visitor
   * hears is the roast they clicked for. Waits for the paywall state to be read,
   * so a locked session never auto-spends a turn.
   */
  useEffect(() => {
    if (!ready || !entry || !autoOpenRef.current) return;
    autoOpenRef.current = false;
    if (quota.locked) return;

    const utterance: VoiceUtterance = {
      id: makeId("entry"),
      text: entryOpeningLine(entry),
      audioUrl: "",
      mimeType: "",
      durationMs: 0,
      levels: [],
      personaId: personaRef.current.id,
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
  }, [entry, quota.locked, ready, speakText]);

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

  // Stop the hands-free loop once the paywall engages. The engine keeps the
  // final reply alive until it has finished speaking, then idles out.
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

  const turnsUsed = useMemo(() => turns.filter((turn) => turn.role === "user").length, [turns]);
  const remainingLabel = quota.locked
    ? t("fit.passRequired")
    : t("fit.freeLeft", { remaining: Math.max(0, quota.limit - quota.used) });

  return (
    <div className="relative min-h-[100dvh] w-full bg-gradient-to-br from-[#ffd6e8] via-[#fff0f6] to-[#e8d5ff] px-3 pb-4 pt-3 font-sans text-slate-800">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-16 top-10 h-56 w-56 rounded-full bg-pink-400/25 blur-[80px]" />
        <div className="absolute -right-16 bottom-24 h-64 w-64 rounded-full bg-purple-400/25 blur-[90px]" />
      </div>

      <div className="relative mx-auto flex min-h-[calc(100dvh-28px)] w-full max-w-[430px] flex-col">
        <header className="flex items-center justify-between gap-2">
          <a
            href="/"
            className="flex h-9 items-center gap-1.5 rounded-full border border-white/70 bg-white/60 px-3 text-[11px] font-bold text-slate-600 backdrop-blur transition hover:border-pink-300 hover:text-pink-600"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            008AI
          </a>
          <div className="text-center">
            <p className="text-[10px] font-extrabold tracking-[0.18em] text-pink-600">
              {t("fit.series")}
            </p>
            <h1 className="text-base font-black leading-tight text-slate-900">
              {t("fit.productName")}
            </h1>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={openSettings}
              aria-label={t("fit.settings")}
              title={t("fit.settings")}
              className={`flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur transition ${
                entitled
                  ? "border-pink-300 bg-pink-500/90 text-white"
                  : "border-white/70 bg-white/60 text-slate-400 hover:border-pink-300"
              }`}
            >
              {entitled ? <Sparkles className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </button>
            <LanguageSwitcher compact />
            <button
              type="button"
              onClick={toggleHandsFree}
              aria-pressed={handsFree}
              title={t("fit.handsFree")}
              className={`flex h-9 w-9 items-center justify-center rounded-full border backdrop-blur transition ${
                handsFree
                  ? "border-emerald-300 bg-emerald-400/90 text-white"
                  : "border-white/70 bg-white/60 text-slate-600 hover:border-pink-300"
              }`}
            >
              <Hand className="h-4 w-4" />
            </button>
          </div>
        </header>

        <p className="mt-2 text-center text-[10px] font-semibold text-slate-500">
          {t("fit.tagline")}
        </p>

        <div className="mt-3">
          <PersonaSwitcher activeId={persona.id} onSelect={selectPersona} />
        </div>

        <div className="mt-2 flex items-center justify-between px-1">
          <p className="text-[10px] font-bold text-slate-500">
            {persona.emoji} {language.id === "zh" ? persona.nameZh : persona.name} -{" "}
            {language.id === "zh" ? persona.taglineZh : persona.tagline}
          </p>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
              quota.locked ? "bg-rose-100 text-rose-600" : "bg-white/70 text-slate-600"
            }`}
          >
            {quota.locked ? <Lock className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
            {remainingLabel}
          </span>
        </div>

        {briefing ? (
          <div className="mt-2 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50/80 px-3 py-2 backdrop-blur">
            <Flame className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            <p className="text-[10px] font-bold leading-snug text-amber-800">
              Atonement queued: {Math.round(briefing.totalCalories)} kcal
              {briefing.items.length > 0
                ? ` from ${briefing.items.slice(0, 3).join(", ")}`
                : ""}{" "}
              {(briefing.targetBurnCalories ?? 0) > 0
                ? `- ${briefing.targetBurnCalories} kcal to burn (~${briefing.suggestedRunMinutes ?? 0} min slow jog). `
                : "-"}{" "}
              {persona.name} has thoughts.
            </p>
            <button
              type="button"
              onClick={() => {
                briefingRef.current = null;
                setBriefing(null);
              }}
              className="ml-auto shrink-0 text-[10px] font-extrabold text-amber-600 transition hover:text-amber-800"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <VoiceStage
          persona={persona}
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
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border border-white/80 bg-white/70 text-xs font-extrabold text-slate-700 backdrop-blur transition hover:border-pink-300 hover:text-pink-600 disabled:opacity-50"
          >
            <Film className="h-4 w-4" />
            Create 9:16 reel from last turn
          </button>
          <button
            type="button"
            onClick={() => setStudioOpen(true)}
            className="flex h-11 items-center justify-center gap-1.5 rounded-2xl bg-slate-900 px-4 text-xs font-extrabold text-white transition hover:bg-slate-800"
          >
            <InfinityIcon className="h-4 w-4" />
            {turnsUsed}/{FREE_VOICE_TURNS}
          </button>
        </div>

        <p className="mt-2 text-center text-[10px] font-semibold text-slate-500">
          Coach replies are AI generated and spoken aloud. Fitness guidance only - not medical
          advice.
        </p>
        <p className="mt-1 text-center text-[10px] font-semibold text-slate-500">
          <a href="/savage-cal" className="font-extrabold text-pink-600 hover:text-pink-700">
            {t("fit.crossSellCal")}
          </a>{" "}
          - the bestie roasts what you actually ate.
        </p>
      </div>

      <SnippetStudio
        open={studioOpen}
        onClose={() => setStudioOpen(false)}
        persona={persona}
        utterance={lastUtterance}
        coachReply={coachReply}
      />

      <PrivateRoastSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialConfig={roastConfig}
        onSaved={setRoastConfig}
      />

      <PaywallModal
        open={modalOpen}
        onClose={closePaywall}
        persona={persona}
        used={quota.used}
        limit={quota.limit}
        onUnlocked={handleUnlocked}
      />
    </div>
  );
}
