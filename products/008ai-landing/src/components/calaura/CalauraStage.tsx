"use client";

/**
 * CalauraStage - the immersive surface of CALauraAI.
 *
 * One doll, one composer, one continuous conversation. The dual loop still runs
 * underneath: whichever bestie is active, everything the user says or shows is
 * routed, logged on the shared health bus, and answered with a hand-off line
 * that moves the conversation to the other half of the loop.
 *
 *   photo / "I had a 700 kcal brunch"  -> Calorie Bestie logs intake
 *                                      -> hand-off copy -> Fit Bestie asks for movement
 *   "walked, 180 kcal"                 -> Fit Bestie logs the burn
 *                                      -> hand-off copy -> Calorie Bestie takes over
 *
 * Hydration discipline: the query string is read in an effect and the bus is
 * touched only inside callbacks, so SSR and the first client render agree.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useLang } from "@/i18n/LanguageProvider";
import { BESTIES, type BestieId } from "@/lib/calaura/besties";
import { MAX_IMAGE_BYTES, resolveLanguage } from "@/lib/calaura/config";
import { balanceBriefingLine, computeBalance, computeSculpt } from "@/lib/calaura/balance";
import {
  INTAKE_PRESETS,
  MOVEMENT_PRESETS,
  detectLoopIntent,
  extractBareNumber,
  extractKcal,
  labelFromText,
} from "@/lib/calaura/intent";
import { entryOpeningLine, type LoopContext, type LoopLog } from "@/lib/calaura/loop";
import { getSessionId } from "@/lib/calaura/quota";
import { CoachApiError, type VoiceUtterance } from "@/lib/calaura/types";
import { buildLoopBriefing, setPendingBriefing } from "@/lib/shared/health-bus";
import { trackCalauraEvent } from "@/lib/shared/analytics";
import { useHealthBus, useHealthGate } from "@/lib/shared/health-hooks";
import type { FoodScanItem, HealthGateKind, MealType, RecognizeResponse } from "@/types/health-bus";
import DreamDistrict from "./DreamDistrict";
import GlassComposer from "./GlassComposer";
import LumiAvatar from "./LumiAvatar";
import PaywallModal from "./PaywallModal";
import { useVoiceEngine, type VoiceStatus } from "./use-voice-engine";

interface StageLine {
  id: string;
  role: "user" | "lumi";
  text: string;
}

interface Awaiting {
  kind: "intake" | "movement";
  label: string;
}

interface IntakeOptions {
  mealType?: MealType;
  source?: "photo" | "text" | "external-app";
  provider?: string;
  model?: string;
  items?: FoodScanItem[];
}

export interface CalauraStageProps {
  bestieId: BestieId;
  onBestieChange: (id: BestieId) => void;
  consumedKcal: number;
  burnedKcal: number;
  /** The log that arrived through the loop hand-off, if any. */
  entry?: LoopContext | null;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that image"));
    reader.readAsDataURL(file);
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

/** The dish the sentence leads with: the biggest line on the plate. */
function topFoodName(items: FoodScanItem[]): string {
  if (items.length === 0) return "";
  return items.reduce((biggest, item) => (item.calories > biggest.calories ? item : biggest), items[0])
    .name;
}

export default function CalauraStage({
  bestieId,
  onBestieChange,
  consumedKcal,
  burnedKcal,
  entry = null,
}: CalauraStageProps) {
  const { lang, t } = useLang();
  const locale = resolveLanguage(lang);
  const { publish } = useHealthBus();
  const { gates, consume, refund, lock } = useHealthGate();

  const bestie = BESTIES[bestieId];
  const [thread, setThread] = useState<StageLine[]>([]);
  const [awaiting, setAwaiting] = useState<Awaiting | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [paywallGate, setPaywallGate] = useState<HealthGateKind>("voiceTurns");

  const historyRef = useRef<{ role: "user" | "coach"; text: string }[]>([]);
  const gatesRef = useRef(gates);
  const burnedRef = useRef(burnedKcal);
  const awaitingRef = useRef<Awaiting | null>(null);
  const bestieRef = useRef(bestieId);
  const localeRef = useRef(locale);
  const paywallAfterSpeechRef = useRef(false);
  const greetedRef = useRef(false);

  gatesRef.current = gates;
  burnedRef.current = burnedKcal;
  awaitingRef.current = awaiting;
  bestieRef.current = bestieId;
  localeRef.current = locale;

  const sculpt = useMemo(
    () => computeSculpt(consumedKcal, burnedKcal),
    [consumedKcal, burnedKcal]
  );

  const pushLine = useCallback((role: StageLine["role"], text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setThread((previous) => [...previous, { id: makeId(role), role, text: clean }].slice(-8));
  }, []);

  const openPaywall = useCallback((gate: HealthGateKind) => {
    setPaywallGate(gate);
    setModalOpen(true);
    publish({ kind: "paywall.hit", gate, used: gatesRef.current[gate].used, limit: gatesRef.current[gate].limit });
    trackCalauraEvent("calaura_paywall_triggered", {
      gate,
      status: 402,
      bestieId: bestieRef.current,
    });
  }, [publish]);

  // ── The two loggers: every write to the bus goes through these ─────────────

  const logIntake = useCallback(
    (log: LoopLog, options: IntakeOptions = {}) => {
      const balance = computeBalance({
        caloriesConsumed: log.calories,
        activeCaloriesBurned: burnedRef.current,
      });
      const items: FoodScanItem[] =
        options.items && options.items.length > 0
          ? options.items
          : [{ name: log.label, calories: Math.round(log.calories) }];
      const event = publish({
        kind: "food.scan",
        source: options.source ?? "text",
        mealType: options.mealType ?? "unknown",
        items,
        totalCalories: Math.round(log.calories),
        provider: options.provider ?? "lumi",
        ...(options.model ? { model: options.model } : {}),
        balanceMath: balance,
      });
      if (event.kind === "food.scan") {
        setPendingBriefing(buildLoopBriefing(event, balanceBriefingLine(balance)));
      }
      trackCalauraEvent("calaura_intake_logged", {
        consumedKcal: balance.caloriesConsumed,
        gapKcal: balance.targetBurnCalories,
        items: items.length,
        source: options.source ?? "text",
      });
      pushLine("lumi", t("stage.loggedIntake", { kcal: Math.round(log.calories), label: log.label }));
      trackCalauraEvent("calaura_intake_handoff", {
        food: log.label,
        calories: Math.round(log.calories),
        gapKcal: balance.targetBurnCalories,
        from: "calorie_bestie",
      });
      setAwaiting({ kind: "movement", label: log.label });
      pushLine(
        "lumi",
        `${t("calaura.handoffToFitTitle")} ${t("calaura.handoffToFitBody")}`
      );
      onBestieChange("fit");
    },
    [onBestieChange, publish, pushLine, t]
  );

  const logMovement = useCallback(
    (log: LoopLog) => {
      const calories = Math.round(log.calories);
      publish({
        kind: "workout.completed",
        bestieId: "fit",
        durationSeconds: 0,
        caloriesBurned: calories,
        label: log.label,
      });
      trackCalauraEvent("calaura_movement_logged", {
        caloriesBurned: calories,
        label: log.label,
        bestieId: "fit",
      });
      pushLine("lumi", t("stage.loggedMovement", { kcal: calories, label: log.label }));
      trackCalauraEvent("calaura_movement_handoff", {
        activity: log.label,
        calories,
        from: "fit_bestie",
      });
      setAwaiting(null);
      pushLine(
        "lumi",
        `${t("calaura.handoffToCalorieTitle")} ${t("calaura.handoffToCalorieBody")}`
      );
      onBestieChange("calorie");
    },
    [onBestieChange, publish, pushLine, t]
  );

  // ── Coaching turns (voice + typed share one pipeline) ─────────────────────

  const sendTurn = useCallback(
    async (utterance: VoiceUtterance, emit: (chunk: string) => void): Promise<string> => {
      if (gatesRef.current.voiceTurns.locked) {
        openPaywall("voiceTurns");
        throw new CoachApiError("PAYWALL_REACHED", t("fit.sessionLocked"), 402);
      }
      setError(null);
      const next = consume("voiceTurns");
      try {
        const response = await fetch("/api/calaura/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "reply",
            bestieId: bestieRef.current,
            transcript: utterance.text,
            history: historyRef.current.slice(-8),
            language: localeRef.current.id,
            sessionId: getSessionId(),
          }),
        });

        if (response.status === 402) {
          const data = await readJson(response);
          lock("voiceTurns");
          openPaywall("voiceTurns");
          throw new CoachApiError(
            "PAYWALL_REACHED",
            typeof data.detail === "string" ? data.detail : t("fit.sessionLocked"),
            402
          );
        }

        if (!response.ok) {
          const data = await readJson(response);
          const code = typeof data.code === "string" ? data.code : "UPSTREAM_ERROR";
          const detail = typeof data.detail === "string" ? data.detail : t("fit.statusError");
          if (code === "AI_KEY_MISSING") refund("voiceTurns");
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
          refund("voiceTurns");
          throw new CoachApiError("UPSTREAM_ERROR", t("fit.statusError"), 502);
        }

        const pair: { role: "user" | "coach"; text: string }[] = [
          { role: "user", text: utterance.text },
          { role: "coach", text: reply },
        ];
        historyRef.current = [...historyRef.current, ...pair].slice(-8);
        publish({
          kind: "coach.turn",
          bestieId: bestieRef.current,
          transcript: utterance.text,
          reply,
          haltedByPaywall: next.voiceTurns.locked,
        });
        trackCalauraEvent("calaura_fit_turn_completed", {
          turn: next.voiceTurns.used,
          bestieId: bestieRef.current,
          locked: next.voiceTurns.locked,
        });
        if (next.voiceTurns.locked) paywallAfterSpeechRef.current = true;
        return reply;
      } catch (cause) {
        if (!(cause instanceof CoachApiError) || cause.code !== "PAYWALL_REACHED") {
          refund("voiceTurns");
          setError(cause instanceof Error ? cause.message : String(cause));
        }
        throw cause;
      }
    },
    [consume, lock, openPaywall, publish, refund, t]
  );

  const sendTurnRef = useRef(sendTurn);
  sendTurnRef.current = sendTurn;

  const voice = useVoiceEngine({
    bestie,
    language: locale,
    enabled: !gates.voiceTurns.locked,
    handsFree: false,
    onUtterance: (utterance, emit) => {
      pushLine("user", utterance.text);
      return sendTurnRef.current(utterance, emit);
    },
    onCoachReply: (text) => pushLine("lumi", text),
    onError: (message) => setError(message),
    onPaywall: () => openPaywall("voiceTurns"),
  });

  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  // The free tier runs out mid-sentence: let her finish, then ask for the pass.
  useEffect(() => {
    if (!paywallAfterSpeechRef.current) return;
    if (voice.status !== "idle") return;
    paywallAfterSpeechRef.current = false;
    openPaywall("voiceTurns");
  }, [openPaywall, voice.status]);

  const askCoach = useCallback(
    async (text: string) => {
      const utterance: VoiceUtterance = {
        id: makeId("typed"),
        text,
        audioUrl: "",
        mimeType: "",
        durationMs: 0,
        levels: [],
        bestieId: bestieRef.current,
        at: Date.now(),
      };
      setBusy(true);
      try {
        const reply = await sendTurnRef.current(utterance, () => {});
        pushLine("lumi", reply);
        void voiceRef.current.speakText(reply);
      } catch {
        /* sendTurn already surfaced the paywall or the error line */
      } finally {
        setBusy(false);
      }
    },
    [pushLine]
  );

  // ── Entry from the other half of the loop ─────────────────────────────────

  useEffect(() => {
    if (greetedRef.current || !entry?.hasLog) return;
    greetedRef.current = true;
    if (entry.bestie === "fit") {
      pushLine("user", entryOpeningLine(entry));
      pushLine("lumi", `${t("calaura.handoffToFitTitle")} ${t("calaura.handoffToFitBody")}`);
      setAwaiting({ kind: "movement", label: entry.label || t("cal.totalLabel") });
    } else {
      pushLine("user", entryOpeningLine(entry));
      pushLine("lumi", `${t("calaura.handoffToCalorieTitle")} ${t("calaura.handoffToCalorieBody")}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.hasLog]);

  // ── Text, voice and photo all land in the same router ─────────────────────

  const handleSubmit = useCallback(() => {
    const raw = draft.trim();
    if (!raw || busy) return;
    setDraft("");
    pushLine("user", raw);

    const pending = awaitingRef.current;
    const explicit = extractKcal(raw);

    if (pending) {
      const kcal = explicit ?? extractBareNumber(raw);
      if (!kcal) {
        pushLine("lumi", t("stage.needNumber"));
        return;
      }
      if (pending.kind === "intake") logIntake({ label: pending.label, calories: kcal });
      else logMovement({ label: pending.label, calories: kcal });
      return;
    }

    const intent = detectLoopIntent(raw);
    if (intent === "movement") {
      if (explicit) {
        logMovement({ label: labelFromText(raw), calories: explicit });
        return;
      }
      setAwaiting({ kind: "movement", label: labelFromText(raw) });
      pushLine("lumi", t("stage.askMovementKcal", { label: labelFromText(raw) }));
      return;
    }
    if (intent === "intake") {
      if (explicit) {
        logIntake({ label: labelFromText(raw), calories: explicit });
        return;
      }
      setAwaiting({ kind: "intake", label: labelFromText(raw) });
      pushLine("lumi", t("stage.askIntakeKcal"));
      return;
    }
    void askCoach(raw);
  }, [askCoach, busy, draft, logIntake, logMovement, pushLine, t]);

  const handlePhoto = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        pushLine("lumi", t("cal.errNotImage"));
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        pushLine("lumi", t("cal.errTooLarge"));
        return;
      }
      if (gatesRef.current.foodScans.locked) {
        openPaywall("foodScans");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const image = await readAsDataUrl(file);
        const response = await fetch("/api/calaura/recognize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image, mealType: "unknown", sessionId: getSessionId() }),
        });
        const data = await readJson(response);
        if (response.status === 402) {
          lock("foodScans");
          openPaywall("foodScans");
          return;
        }
        if (!response.ok) {
          pushLine(
            "lumi",
            typeof data.detail === "string"
              ? data.detail
              : t("cal.errRecognitionFailed", { status: response.status })
          );
          return;
        }
        const parsed = data as unknown as RecognizeResponse;
        consume("foodScans");
        logIntake(
          { label: topFoodName(parsed.items) || t("cal.totalLabel"), calories: parsed.totalCalories },
          {
            source: "photo",
            provider: parsed.provider,
            ...(parsed.model ? { model: parsed.model } : {}),
            items: parsed.items,
          }
        );
      } catch (cause) {
        pushLine("lumi", cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(false);
      }
    },
    [consume, lock, logIntake, openPaywall, pushLine, t]
  );

  /** One tap on a card: the number the avatar was waiting for. */
  const handlePreset = useCallback(
    (kcal: number, labelKey: string) => {
      const pending = awaitingRef.current;
      const label = pending?.label ?? t(labelKey);
      if (pending?.kind === "movement" || bestieId === "fit") {
        logMovement({ label, calories: kcal });
        return;
      }
      logIntake({ label, calories: kcal });
    },
    [bestieId, logIntake, logMovement, t]
  );

  const state: VoiceStatus = error ? "error" : busy ? "thinking" : voice.status;
  const statusKey =
    state === "listening"
      ? "fit.statusListening"
      : state === "thinking"
        ? "fit.statusThinking"
        : state === "speaking"
          ? "fit.statusSpeaking"
          : state === "error"
            ? "fit.statusError"
            : "fit.statusIdle";

  const sculptStateKey =
    sculpt.state === "radiant"
      ? "calaura.sculptStateRadiant"
      : sculpt.state === "aligned"
        ? "calaura.sculptStateAligned"
        : "calaura.sculptStateShaping";

  // Minimal surface: the last exchange, or Lumi's opening line before anything
  // has been logged. The dictionary supplies both, so the greeting follows the
  // language switcher without extra state.
  const visible: StageLine[] =
    thread.length > 0 ? thread.slice(-2) : [{ id: "intro", role: "lumi", text: t("stage.intro") }];

  const chips = awaiting
    ? awaiting.kind === "intake"
      ? INTAKE_PRESETS
      : MOVEMENT_PRESETS
    : bestieId === "fit"
      ? MOVEMENT_PRESETS
      : [];

  return (
    <>
      <DreamDistrict />

      <main className="relative mx-auto flex min-h-[100dvh] w-full max-w-[560px] flex-col items-center justify-between px-4 pb-40 pt-20">
        <div className="flex flex-col items-center">
          <LumiAvatar
            state={state}
            mood={bestie.domain === "intake" ? "intake" : "movement"}
            progress={sculpt.progress}
            level={voice.level}
            alt={t("stage.avatarAlt", { percent: Math.round(sculpt.progress * 100) })}
          />

          <p className="mt-1 text-[11px] font-extrabold uppercase tracking-[0.3em] text-mauve">
            {t("stage.avatarName")}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-ink-soft" aria-live="polite">
            {error ?? t(statusKey)}
          </p>
        </div>

        <div className="mt-6 w-full space-y-2" aria-live="polite">
          {visible.map((line) =>
            line.role === "lumi" ? (
              <p
                key={line.id}
                className="calaura-rise mx-auto max-w-[420px] rounded-[22px] rounded-bl-md border border-white/70 bg-white/55 px-4 py-3 text-center text-[13px] font-semibold leading-relaxed text-ink shadow-[0_10px_30px_-18px_rgba(169,132,144,0.75)] backdrop-blur-xl"
              >
                {line.text}
              </p>
            ) : (
              <p
                key={line.id}
                className="calaura-rise ml-auto max-w-[340px] rounded-[20px] rounded-br-md bg-gradient-to-br from-pink-400/90 to-rose-400/90 px-4 py-2.5 text-right text-[12px] font-semibold leading-relaxed text-white shadow-lg shadow-pink-300/40"
              >
                {line.text}
              </p>
            )
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-[10px] font-bold text-mauve">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/50 px-3 py-1.5 backdrop-blur">
            <Sparkles className="h-3 w-3 text-brand" />
            {t("calaura.sculptTitle")} · {Math.round(sculpt.progress * 100)}%
          </span>
          <span className="rounded-full border border-white/70 bg-white/50 px-3 py-1.5 backdrop-blur">
            {t(sculptStateKey)}
          </span>
          <span className="rounded-full border border-white/70 bg-white/50 px-3 py-1.5 backdrop-blur">
            {t("calaura.sculptConsumed")} {sculpt.consumedKcal} / {t("calaura.sculptBurned")}{" "}
            {sculpt.burnedKcal}
          </span>
        </div>
      </main>

      <GlassComposer
        value={draft}
        onChange={setDraft}
        onSubmit={handleSubmit}
        onMicToggle={() => {
          if (voice.status === "listening") voice.abortAll();
          else voice.beginTurn();
        }}
        onPhoto={(file) => void handlePhoto(file)}
        labels={{
          placeholder: t("stage.composerPlaceholder"),
          send: t("stage.send"),
          micStart: t("stage.micStart"),
          micStop: t("stage.micStop"),
          photo: t("stage.photo"),
          hint: t("stage.hint"),
        }}
        state={state}
        busy={busy}
        micSupported={voice.recognitionSupported}
      >
        {chips.map((chip) => (
          <button
            key={chip.labelKey}
            type="button"
            onClick={() => handlePreset(chip.kcal, chip.labelKey)}
            className="rounded-full border border-white/70 bg-white/45 px-3 py-1.5 text-[11px] font-bold text-ink-soft backdrop-blur transition hover:border-brand/50 hover:text-brand"
          >
            {t(chip.labelKey)} · {chip.kcal}
          </button>
        ))}
      </GlassComposer>

      <PaywallModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        bestie={bestie}
        gate={paywallGate}
        used={gates[paywallGate].used}
        limit={gates[paywallGate].limit}
        onUnlocked={() => {
          setModalOpen(false);
          pushLine("lumi", t("stage.unlocked"));
        }}
      />
    </>
  );
}
