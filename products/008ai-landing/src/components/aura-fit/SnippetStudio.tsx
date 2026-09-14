"use client";

/**
 * SnippetStudio - the 9:16 vertical clip generator.
 *
 * Pairs the recorded dialogue audio with:
 *   - auto-generated animated subtitles (karaoke word highlight, timed by
 *     character weight across the clip), and
 *   - a waveform driven by the per-frame RMS levels captured while recording.
 *
 * Everything is drawn on a real 720x1280 canvas, so the same renderer doubles as
 * the encoder input: canvas.captureStream + the audio graph are muxed into a
 * downloadable webm/mp4 clip.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, Loader2, Mic, Pause, Play, Sparkles, Wand2, X } from "lucide-react";
import {
  BRAND_HANDLE,
  APP_NAME,
  SNIPPET_BARS,
  SNIPPET_FPS,
  SNIPPET_HEIGHT,
  SNIPPET_MAX_SECONDS,
  SNIPPET_WIDTH,
} from "@/lib/aura-fit/config";
import {
  buildCaptionCues,
  cueIndexAt,
  cueProgress,
  localSnippetCopy,
  syntheticLevels,
  truncateWords,
  waveformBuckets,
} from "@/lib/aura-fit/captions";
import type { Bestie } from "@/lib/aura-fit/besties";
import type { SnippetCopy, VoiceUtterance } from "@/lib/aura-fit/types";
import {
  downloadClip,
  exportVerticalClip,
  isClipExportSupported,
  revokeClip,
  type ExportedClip,
} from "@/lib/video-exporter";
import { trackAuraEvent } from "@/lib/shared/analytics";
import { getHealthBus } from "@/lib/shared/health-bus";

const CAPTION_FONT_SIZE = 56;
const BRAND_FONT_SIZE = 24;
const FOOTER_FONT_SIZE = 26;

export interface SnippetStudioProps {
  open: boolean;
  onClose: () => void;
  bestie: Bestie;
  utterance: VoiceUtterance | null;
  coachReply: string;
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.length > 0) {
    const consumed = lines.join(" ").split(/\s+/).length;
    if (consumed < words.length) lines[maxLines - 1] = `${lines[maxLines - 1]}\u2026`;
  }
  return lines;
}

export default function SnippetStudio({
  open,
  onClose,
  bestie,
  utterance,
  coachReply,
}: SnippetStudioProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastClipRef = useRef<ExportedClip | null>(null);

  const [copy, setCopy] = useState<SnippetCopy | null>(null);
  const [generating, setGenerating] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [showReply, setShowReply] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clipSeconds = useMemo(() => {
    const raw = (utterance?.durationMs ?? 0) / 1000;
    return Math.min(SNIPPET_MAX_SECONDS, Math.max(1.5, raw || 4));
  }, [utterance?.durationMs]);

  const transcript = utterance?.text ?? "";
  const cues = useMemo(
    () => buildCaptionCues(transcript, clipSeconds),
    [clipSeconds, transcript]
  );
  const bars = useMemo(() => {
    if (!utterance) return new Array(SNIPPET_BARS).fill(0.05) as number[];
    const levels =
      utterance.levels.length > 12 ? utterance.levels : syntheticLevels(transcript || utterance.id, 180);
    return waveformBuckets(levels, SNIPPET_BARS);
  }, [transcript, utterance]);

  const headerText = useMemo(() => copy?.title || truncateWords(transcript, 6), [copy?.title, transcript]);

  useEffect(() => {
    if (!utterance) {
      setCopy(null);
      return;
    }
    setCopy(localSnippetCopy(transcript, bestie, BRAND_HANDLE));
    setExportUrl(null);
    setStatus(null);
    setError(null);
  }, [bestie, transcript, utterance]);

  // ── Renderer ───────────────────────────────────────────────────────────

  const draw = useCallback(
    (seconds: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const width = SNIPPET_WIDTH;
      const height = SNIPPET_HEIGHT;
      const t = Math.max(0, Math.min(clipSeconds, seconds));
      const progress = clipSeconds > 0 ? t / clipSeconds : 0;

      const background = ctx.createLinearGradient(0, 0, width * 0.4, height);
      background.addColorStop(0, bestie.accent.canvasTop);
      background.addColorStop(1, bestie.accent.canvasBottom);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      const glow = ctx.createRadialGradient(width / 2, height * 0.32, 40, width / 2, height * 0.32, width * 0.95);
      glow.addColorStop(0, `${bestie.accent.canvasAccent}44`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // Frame
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 3;
      ctx.strokeRect(28, 28, width - 56, height - 56);

      // Header: brand + bestie
      ctx.font = `800 ${BRAND_FONT_SIZE}px sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.textAlign = "left";
      ctx.fillText(truncateWords(headerText || APP_NAME, 8).toUpperCase(), 56, 108);
      ctx.font = `600 ${BRAND_FONT_SIZE - 4}px sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.fillText(`${bestie.emoji} ${bestie.name}`, 56, 148);

      // Subtitles (karaoke word highlight on the active cue)
      const index = cueIndexAt(cues, t);
      const active = index >= 0 ? cues[index] : undefined;
      const slotTop = height * 0.30;
      ctx.textAlign = "center";
      if (active) {
        const words = active.text.split(/\s+/).filter(Boolean);
        const cueT = cueProgress(active, t);
        const spoken = Math.min(words.length, Math.max(1, Math.ceil(cueT * words.length)));

        ctx.font = `900 ${CAPTION_FONT_SIZE}px sans-serif`;
        const lines = wrapLines(ctx, active.text, width - 200, 3);
        let wordCursor = 0;
        let y = slotTop;

        const boxPadding = 28;
        const lineHeight = CAPTION_FONT_SIZE * 1.22;
        const boxTop = slotTop - CAPTION_FONT_SIZE - boxPadding;
        const boxHeight = lines.length * lineHeight + boxPadding * 2;
        ctx.fillStyle = "rgba(10,8,14,0.35)";
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(70, boxTop, width - 140, boxHeight, 32);
        } else {
          ctx.rect(70, boxTop, width - 140, boxHeight);
        }
        ctx.fill();

        for (const line of lines) {
          const lineWords = line.replace(/\u2026$/, "").split(/\s+/).filter(Boolean);
          const widths = lineWords.map((word) => ctx.measureText(word).width);
          const spaceWidth = ctx.measureText(" ").width;
          const total = widths.reduce((sum, value) => sum + value, 0) + spaceWidth * Math.max(0, lineWords.length - 1);
          let x = width / 2 - total / 2;

          lineWords.forEach((word, wordIndex) => {
            const globalIndex = wordCursor + wordIndex;
            const isSpoken = globalIndex < spoken;
            const isActiveWord = globalIndex === spoken - 1;
            ctx.fillStyle = isActiveWord
              ? bestie.accent.canvasAccent
              : isSpoken
                ? "rgba(255,255,255,0.96)"
                : "rgba(255,255,255,0.5)";
            if (isActiveWord) {
              ctx.save();
              ctx.translate(x + widths[wordIndex] / 2, y);
              ctx.scale(1.06, 1.06);
              ctx.fillText(word, -widths[wordIndex] / 2, 0);
              ctx.restore();
            } else {
              ctx.fillText(word, x, y);
            }
            x += widths[wordIndex] + spaceWidth;
          });
          wordCursor += lineWords.length;
          y += lineHeight;
        }
      }

      // Waveform
      const waveTop = height * 0.63;
      const waveHeight = 190;
      const barWidth = (width - 160) / bars.length;
      const playedBars = Math.round(progress * bars.length);
      bars.forEach((amplitude, barIndex) => {
        const barHeight = Math.max(6, amplitude * waveHeight);
        const x = 80 + barIndex * barWidth;
        const y = waveTop + (waveHeight - barHeight) / 2;
        const playedBar = barIndex <= playedBars;
        ctx.fillStyle = playedBar ? bestie.accent.canvasAccent : "rgba(255,255,255,0.24)";
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(x, y, Math.max(3, barWidth - 4), barHeight, 4);
        } else {
          ctx.rect(x, y, Math.max(3, barWidth - 4), barHeight);
        }
        ctx.fill();
      });

      // Coach reply line
      if (showReply && coachReply) {
        ctx.font = `700 ${FOOTER_FONT_SIZE}px sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.86)";
        const replyLines = wrapLines(ctx, coachReply, width - 160, 2);
        replyLines.forEach((line, lineIndex) => {
          ctx.fillText(line, width / 2, height * 0.83 + lineIndex * (FOOTER_FONT_SIZE * 1.3));
        });
      }

      // Progress + footer
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(80, height - 150, width - 160, 10);
      ctx.fillStyle = bestie.accent.canvasAccent;
      ctx.fillRect(80, height - 150, (width - 160) * progress, 10);
      ctx.textAlign = "center";
      ctx.font = `700 ${FOOTER_FONT_SIZE}px sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText(`${APP_NAME} ${BRAND_HANDLE}`, width / 2, height - 92);
    },
    [bars, clipSeconds, coachReply, cues, headerText, bestie, showReply]
  );

  // Static frame whenever inputs change.
  useEffect(() => {
    if (!open) return;
    draw(0);
  }, [draw, open]);

  // Animation loop follows the audio element clock.
  useEffect(() => {
    if (!open || !playing) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    const tick = () => {
      const audio = audioRef.current;
      if (audio) draw(audio.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [draw, open, playing]);

  useEffect(() => {
    if (!open) {
      audioRef.current?.pause();
      setPlaying(false);
    }
  }, [open]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    if (audio.currentTime >= clipSeconds - 0.05) audio.currentTime = 0;
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setError("Playback was blocked by the browser. Tap play again.");
    }
  }, [clipSeconds, playing]);

  const generateCopy = useCallback(async () => {
    if (!transcript) return;
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch("/api/aura-fit/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "snippet",
          bestieId: bestie.id,
          transcript,
          language: /[\u4e00-\u9fa5]/.test(transcript) ? "zh" : "en",
        }),
      });
      const data = (await response.json()) as { copy?: SnippetCopy; detail?: string };
      if (!response.ok || !data.copy) {
        setError(data.detail || "Copy generation failed.");
        return;
      }
      setCopy({ ...data.copy, source: "model" });
      setStatus("AI caption ready");
    } catch {
      setError("Copy generation failed.");
    } finally {
      setGenerating(false);
    }
  }, [bestie.id, transcript]);

  const shareCopy = useCallback(async () => {
    if (!copy) return;
    const text = `${copy.title}\n${copy.hook}\n${copy.hashtags.join(" ")}`;
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Caption copied");
    } catch {
      setStatus("Copy failed - select the caption manually");
    }
  }, [copy]);

  const exportClip = useCallback(async () => {
    const canvas = canvasRef.current;
    const audio = audioRef.current;
    if (!canvas || !audio) return;
    if (!utterance?.audioUrl) {
      setError("Record a voice turn first - the clip needs your dialogue audio.");
      return;
    }
    if (!isClipExportSupported()) {
      setError("This browser cannot encode video. Try Chrome or Safari 16+.");
      return;
    }

    setExporting(true);
    setError(null);
    setStatus("Rendering 9:16 clip...");
    setPlaying(true);
    try {
      const clip = await exportVerticalClip({
        canvas,
        audio,
        durationSeconds: clipSeconds,
        fps: SNIPPET_FPS,
        onProgress: (ratio) => setProgress(ratio),
      });
      if (lastClipRef.current) revokeClip(lastClipRef.current);
      lastClipRef.current = clip;
      setExportUrl(clip.url);
      setStatus(`Clip ready (${(clip.bytes / 1024 / 1024).toFixed(1)} MB, ${clip.extension})`);
      downloadClip(clip, `aurafit-${bestie.id}-${Date.now().toString(36)}`);
      // Hop 4 of the loop: the export closes the intake -> note -> movement ->
      // reel circuit, so it belongs on the bus even before anything reads it.
      getHealthBus().publish({
        kind: "video.exported",
        mimeType: clip.mimeType,
        durationSeconds: clip.durationSeconds,
        width: clip.width,
        height: clip.height,
        bytes: clip.bytes,
      });
      // Funnel hop 4: the exported 9:16 reel that closes (and shares) the loop.
      trackAuraEvent("aura_snippet_exported", {
        bestieId: bestie.id,
        width: clip.width,
        height: clip.height,
        durationSeconds: Math.round(clip.durationSeconds * 100) / 100,
        bytes: clip.bytes,
        mimeType: clip.mimeType,
        extension: clip.extension,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Clip export failed.";
      setError(message.includes("aborted") ? "Export cancelled." : message);
      setStatus(null);
    } finally {
      setPlaying(false);
      setExporting(false);
      setProgress(0);
    }
  }, [clipSeconds, bestie.id, utterance?.audioUrl]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-md">
      <div className="relative flex h-full max-h-[860px] w-full max-w-[420px] flex-col overflow-hidden rounded-[28px] border border-white/60 bg-white/85 backdrop-blur-2xl">
        <div className="flex items-center justify-between border-b border-white/60 px-4 py-3">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-pink-600">
              9:16 Studio
            </p>
            <h2 className="text-sm font-extrabold text-slate-900">Dialogue Reel</h2>
          </div>
          <button
            type="button"
            aria-label="Close studio"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/5 text-slate-600 transition hover:bg-slate-900/10"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto w-full max-w-[300px]">
            <div className="relative overflow-hidden rounded-2xl border border-white/70 bg-slate-900 shadow-lg">
              <canvas
                ref={canvasRef}
                width={SNIPPET_WIDTH}
                height={SNIPPET_HEIGHT}
                className="block h-auto w-full"
              />
              {!utterance?.audioUrl && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-900/70 text-center text-white">
                  <Mic className="h-6 w-6" />
                  <p className="px-6 text-[11px] font-bold leading-relaxed">
                    Record a voice turn to generate your 9:16 clip
                  </p>
                </div>
              )}
            </div>

            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => void togglePlay()}
                disabled={!utterance?.audioUrl}
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-slate-900 px-4 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-40"
              >
                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {playing ? "Pause" : "Preview"}
              </button>
              <button
                type="button"
                onClick={() => setShowReply((value) => !value)}
                className={`inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-xs font-bold transition ${
                  showReply
                    ? "border-pink-400 bg-pink-50 text-pink-600"
                    : "border-slate-200 bg-white text-slate-500"
                }`}
              >
                Coach line
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-2 rounded-2xl border border-slate-200/70 bg-white/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                Caption {copy?.source === "model" ? "\u00b7 AI" : "\u00b7 local draft"}
              </p>
              <button
                type="button"
                onClick={() => void generateCopy()}
                disabled={generating || !transcript}
                className="inline-flex h-7 items-center gap-1 rounded-full border border-pink-200 bg-pink-50 px-2.5 text-[10px] font-bold text-pink-600 transition hover:border-pink-400 disabled:opacity-50"
              >
                {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                AI copy
              </button>
            </div>
            {copy && (
              <>
                <p className="text-sm font-extrabold leading-snug text-slate-900">{copy.title}</p>
                <p className="text-[11px] leading-relaxed text-slate-600">{copy.hook}</p>
                <p className="text-[11px] font-semibold text-pink-600">{copy.hashtags.join(" ")}</p>
                <button
                  type="button"
                  onClick={() => void shareCopy()}
                  className="text-[10px] font-bold text-slate-500 underline decoration-dotted transition hover:text-slate-800"
                >
                  Copy caption text
                </button>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => void exportClip()}
            disabled={exporting || !utterance?.audioUrl}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-500 text-sm font-extrabold text-white shadow-lg shadow-pink-500/30 transition hover:brightness-105 disabled:opacity-50"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {exporting ? `Rendering clip... ${Math.round(progress * 100)}%` : "Export 9:16 clip"}
          </button>

          {exportUrl && (
            <a
              href={exportUrl}
              download="aurafit-reel.webm"
              className="mt-2 block text-center text-[11px] font-bold text-pink-600 underline decoration-dotted"
            >
              Download again
            </a>
          )}

          <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[10px] text-slate-500">
            <Sparkles className="h-3 w-3 text-pink-500" />
            Subtitles animate word by word from your transcript; the waveform is your real
            microphone levels.
          </p>
          {status && <p className="mt-1 text-center text-[10px] font-bold text-emerald-600">{status}</p>}
          {error && <p className="mt-1 text-center text-[10px] font-bold text-rose-500">{error}</p>}
        </div>

        {utterance?.audioUrl && (
          <audio ref={audioRef} src={utterance.audioUrl} preload="auto" playsInline className="hidden" />
        )}
      </div>
    </div>
  );
}
