"use client";

/**
 * GlassComposer - the one input surface of the immersive stage.
 *
 * A floating frosted bar that collects everything the loop needs without asking
 * the user to pick a mode first:
 *
 *   text   -> route the sentence (intake, movement, or a chat turn)
 *   mic    -> live voice, hands-free, spoken reply
 *   photo  -> plate or workout proof, read by the recognition bridge
 *
 * Purely presentational: the stage owns all state and side effects.
 */

import { useRef } from "react";
import { Camera, Loader2, Mic, MicOff, SendHorizontal } from "lucide-react";
import type { VoiceStatus } from "./use-voice-engine";

export interface GlassComposerLabels {
  placeholder: string;
  send: string;
  micStart: string;
  micStop: string;
  photo: string;
  hint: string;
}

export interface GlassComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onMicToggle: () => void;
  onPhoto: (file: File) => void;
  labels: GlassComposerLabels;
  state: VoiceStatus;
  busy?: boolean;
  micSupported?: boolean;
  /** Rendered directly above the bar: quick cards or the "waiting for kcal" row. */
  children?: React.ReactNode;
}

export default function GlassComposer({
  value,
  onChange,
  onSubmit,
  onMicToggle,
  onPhoto,
  labels,
  state,
  busy = false,
  micSupported = true,
  children,
}: GlassComposerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const listening = state === "listening";
  const canSend = value.trim().length > 0 && !busy;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[max(14px,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto w-full max-w-[520px]">
        {children ? <div className="mb-2 flex flex-wrap justify-center gap-2">{children}</div> : null}

        <div className="calaura-glass flex items-center gap-1.5 rounded-[26px] px-2 py-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            aria-label={labels.photo}
            title={labels.photo}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/60 text-mauve transition hover:border-brand/50 hover:text-brand disabled:opacity-50"
          >
            <Camera className="h-4.5 w-4.5" strokeWidth={2} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onPhoto(file);
              event.target.value = "";
            }}
          />

          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (canSend) onSubmit();
              }
            }}
            placeholder={labels.placeholder}
            aria-label={labels.placeholder}
            maxLength={280}
            className="min-w-0 flex-1 bg-transparent px-2 text-sm font-medium text-ink placeholder:text-ink-faint/90 focus:outline-none"
          />

          {value.trim().length > 0 ? (
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSend}
              aria-label={labels.send}
              title={labels.send}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-pink-400 to-rose-400 text-white shadow-lg shadow-pink-300/40 transition hover:brightness-105 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <SendHorizontal className="h-4.5 w-4.5" />}
            </button>
          ) : (
            <button
              type="button"
              onClick={onMicToggle}
              disabled={!micSupported || busy}
              aria-label={listening ? labels.micStop : labels.micStart}
              title={listening ? labels.micStop : labels.micStart}
              className={[
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-lg transition disabled:opacity-50",
                listening
                  ? "calaura-ring-live bg-gradient-to-br from-rose-400 to-pink-500 shadow-rose-300/50"
                  : "bg-gradient-to-br from-pink-400 to-rose-400 shadow-pink-300/40 hover:brightness-105",
              ].join(" ")}
            >
              {listening ? <MicOff className="h-4.5 w-4.5" /> : <Mic className="h-4.5 w-4.5" />}
            </button>
          )}
        </div>

        <p className="mt-2 text-center text-[10px] font-semibold tracking-wide text-mauve/80">
          {labels.hint}
        </p>
      </div>
    </div>
  );
}
