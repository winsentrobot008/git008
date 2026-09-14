"use client";

/**
 * VoiceStage - the 9:16 vertical dialogue surface.
 *
 * Mobile-web first: a scrollable dialogue column, a live waveform meter, one
 * large record button, and a typed fallback for browsers without speech
 * recognition (or for demoing on desktop).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Keyboard, Mic, MicOff, Send, Square } from "lucide-react";
import type { Bestie } from "@/lib/calaura/besties";
import type { DialogueTurn, QuotaState } from "@/lib/calaura/types";
import { unlockAudioContext, type VoiceStatus } from "./use-voice-engine";
import { useLang } from "@/i18n/LanguageProvider";

const STATUS_LABEL_KEY: Record<VoiceStatus, string> = {
  idle: "fit.statusIdle",
  listening: "fit.statusListening",
  thinking: "fit.statusThinking",
  speaking: "fit.statusSpeaking",
  error: "fit.statusError",
};

const METER_BARS = 24;

export interface VoiceStageProps {
  bestie: Bestie;
  status: VoiceStatus;
  interim: string;
  level: number;
  turns: DialogueTurn[];
  quota: QuotaState;
  locked: boolean;
  ready: boolean;
  handsFree: boolean;
  error: string | null;
  recognitionSupported: boolean;
  onToggleRecord: () => void;
  onTypedTurn: (text: string) => void;
}

export default function VoiceStage({
  bestie,
  status,
  interim,
  level,
  turns,
  quota,
  locked,
  ready,
  handsFree,
  error,
  recognitionSupported,
  onToggleRecord,
  onTypedTurn,
}: VoiceStageProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const { t } = useLang();
  const listening = status === "listening";

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns.length, interim, status]);

  const meter = useMemo(() => {
    const active = listening || status === "speaking" ? Math.max(0.08, level) : 0.05;
    return Array.from({ length: METER_BARS }, (_, index) => {
      const distance = Math.abs(index - (METER_BARS - 1) / 2) / ((METER_BARS - 1) / 2);
      const falloff = 1 - distance * 0.72;
      const jitter = 0.55 + 0.45 * Math.abs(Math.sin(index * 1.7 + level * 9));
      return Math.max(0.06, Math.min(1, active * falloff * jitter * 2.1));
    });
  }, [level, listening, status]);

  function submitDraft() {
    const text = draft.trim();
    if (!text) return;
    onTypedTurn(text);
    setDraft("");
    setTyping(false);
  }

  /**
   * iOS Safari hands back a suspended AudioContext and only lets a genuine user
   * gesture resume it. Unlock the shared context here, synchronously, before the
   * engine starts: once it awaits getUserMedia we are outside the tap's
   * activation window and the resume() would be ignored.
   */
  function handleRecordTap() {
    unlockAudioContext();
    onToggleRecord();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 pb-3"
      >
        {turns.length === 0 && (
          <div className="rounded-3xl border border-white/70 bg-white/60 p-4 backdrop-blur-md">
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
              {bestie.name} is ready
            </p>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-800">
              {bestie.opener}
            </p>
          </div>
        )}
        {turns.map((turn) => (
          <div
            key={turn.id}
            className={turn.role === "coach" ? "flex justify-start" : "flex justify-end"}
          >
            <div
              className={[
                "max-w-[86%] rounded-3xl px-4 py-3 text-sm font-semibold leading-relaxed shadow-sm backdrop-blur-md",
                turn.role === "coach"
                  ? `border border-white/70 bg-gradient-to-br ${bestie.accent.from} ${bestie.accent.to} text-white`
                  : "border border-white/80 bg-white/80 text-slate-800",
              ].join(" ")}
            >
              {turn.text}
            </div>
          </div>
        ))}
        {interim && (
          <div className="flex justify-end">
            <div className="max-w-[86%] rounded-3xl border border-dashed border-pink-300 bg-white/60 px-4 py-3 text-sm font-semibold italic text-slate-500">
              {interim}
            </div>
          </div>
        )}
      </div>

      <div className="mt-1 rounded-3xl border border-white/70 bg-white/60 px-4 pb-4 pt-3 backdrop-blur-xl">
        <div className="flex h-10 items-end justify-center gap-[3px]" aria-hidden>
          {meter.map((value, index) => (
            <span
              key={index}
              className={`w-[4px] rounded-full transition-[height,background-color] duration-75 ${
                listening ? "bg-pink-500" : status === "speaking" ? "bg-emerald-400" : "bg-slate-300"
              }`}
              style={{ height: `${Math.round(value * 36) + 3}px` }}
            />
          ))}
        </div>

        <p className="mt-2 text-center text-[11px] font-bold text-slate-500">
          {locked ? t("fit.sessionLocked") : t(STATUS_LABEL_KEY[status])}
        </p>

        <div className="mt-3 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleRecordTap}
            aria-label={listening ? t("fit.stopRecording") : t("fit.startRecording")}
            className={[
              "relative flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg transition-all duration-200 active:scale-95",
              locked
                ? "bg-slate-400 shadow-slate-300/50"
                : listening
                  ? "bg-rose-500 shadow-rose-500/40 ring-4 ring-rose-200"
                  : `bg-gradient-to-br ${bestie.accent.from} ${bestie.accent.to} shadow-pink-500/40`,
            ].join(" ")}
          >
            {listening ? <Square className="h-6 w-6" /> : locked ? <MicOff className="h-6 w-6" /> : <Mic className="h-7 w-7" />}
            {listening && (
              <span className="absolute inset-0 animate-ping rounded-full bg-rose-400/40" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setTyping((value) => !value)}
            aria-label={t("fit.typeInstead")}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/80 bg-white/70 text-slate-600 backdrop-blur transition hover:border-pink-300 hover:text-pink-600"
          >
            <Keyboard className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-center text-[10px] font-semibold text-slate-500">
          {ready
            ? t("fit.freeSessionLeft", {
                remaining: Math.max(0, quota.limit - quota.used),
                limit: quota.limit,
              })
            : t("fit.freeSessionFull", { limit: quota.limit })}
          {handsFree ? t("fit.handsFreeOn") : ""}
        </p>

        {!recognitionSupported && (
          <p className="mt-2 flex items-start gap-1.5 rounded-2xl bg-amber-50/80 px-3 py-2 text-[10px] font-semibold leading-relaxed text-amber-700">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {t("fit.recognitionUnavailable")}
          </p>
        )}
        {error && (
          <p className="mt-2 rounded-2xl bg-rose-50/80 px-3 py-2 text-[10px] font-semibold text-rose-600">
            {error}
          </p>
        )}

        {typing && (
          <div className="mt-3 flex items-center gap-2">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitDraft();
              }}
              placeholder={t("fit.typePlaceholder")}
              className="h-11 min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-pink-400"
            />
            <button
              type="button"
              onClick={submitDraft}
              disabled={locked}
              aria-label={t("fit.send")}
              className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white transition hover:bg-slate-800 disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
