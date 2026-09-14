/**
 * captions - auto-generated subtitle cues and waveform helpers for the 9:16
 * snippet renderer.
 *
 * The transcript of a recorded turn is chunked into short caption cues and
 * spread across the clip duration by character weight (longer lines stay on
 * screen longer), then the renderer animates a karaoke word highlight inside
 * the active cue. Everything here is pure so it can also run on the server for
 * the `mode: "snippet"` copy pass.
 */

import { SNIPPET_BARS } from "./config";
import type { Bestie, BestieId } from "./besties";
import type { CaptionCue, SnippetCopy } from "./types";

/** Sentence-ish splitter (no lookbehind - Safari < 16.4 would fail to parse it). */
export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?\u3002\uff01\uff1f\u2026]+[.!?\u3002\uff01\uff1f\u2026]*/g);
  return (parts ?? [text]).map((part) => part.trim()).filter(Boolean);
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Chunk a transcript into caption cues and time them across the clip.
 * Empty text or a non-positive duration returns an empty track.
 */
export function buildCaptionCues(
  text: string,
  durationSeconds: number,
  maxWordsPerCue = 5
): CaptionCue[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return [];

  const chunks: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    chunks.push(buffer.join(" "));
    buffer = [];
  };

  for (const sentence of splitSentences(clean)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    for (const word of words) {
      buffer.push(word);
      const endsSentence = /\u3002$|[.!?\u3002\uff01\uff1f\u2026]$/.test(word);
      if (buffer.length >= maxWordsPerCue || (endsSentence && buffer.length >= 2)) flush();
    }
    if (buffer.length > 0) flush();
  }
  flush();

  if (chunks.length === 0) return [];

  // Time each cue by character weight, then normalise to the clip duration.
  const weights = chunks.map((chunk) => Math.max(1, chunk.replace(/\s/g, "").length));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;

  return chunks.map((chunk, index) => {
    const share = (weights[index] / total) * durationSeconds;
    const start = cursor;
    const end = index === chunks.length - 1 ? durationSeconds : Math.min(durationSeconds, start + share);
    cursor = end;
    return { text: chunk, start, end };
  });
}

/** Active cue index for a playback position (-1 when the track is empty). */
export function cueIndexAt(cues: CaptionCue[], seconds: number): number {
  if (cues.length === 0) return -1;
  for (let i = 0; i < cues.length; i += 1) {
    if (seconds >= cues[i].start && seconds < cues[i].end) return i;
  }
  return seconds < cues[0].start ? 0 : cues.length - 1;
}

/** 0..1 progress inside a cue - drives the karaoke word highlight. */
export function cueProgress(cue: CaptionCue | undefined, seconds: number): number {
  if (!cue) return 0;
  const span = Math.max(0.001, cue.end - cue.start);
  return Math.min(1, Math.max(0, (seconds - cue.start) / span));
}

/** Resample recorded per-frame RMS into fixed-width bars (peak, not mean). */
export function waveformBuckets(levels: number[], bars: number = SNIPPET_BARS): number[] {
  const clean = levels.filter((value) => Number.isFinite(value)).map((value) => Math.min(1, Math.max(0, value)));
  if (clean.length === 0) {
    return new Array(bars).fill(0.06) as number[];
  }
  const out: number[] = [];
  for (let bar = 0; bar < bars; bar += 1) {
    const start = Math.floor((bar / bars) * clean.length);
    const end = Math.max(start + 1, Math.floor(((bar + 1) / bars) * clean.length));
    let peak = 0;
    for (let i = start; i < end && i < clean.length; i += 1) peak = Math.max(peak, clean[i]);
    out.push(peak);
  }
  return out;
}

/** Deterministic pseudo-waveform so a clip without metering still renders. */
export function syntheticLevels(seed: string, count: number): number[] {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    hash = Math.imul(hash ^ (i + 1), 16777619);
    const unit = ((hash >>> 8) & 0xffff) / 0xffff;
    const envelope = 0.35 + 0.65 * Math.sin((Math.PI * i) / Math.max(1, count - 1));
    out.push(Math.min(1, 0.12 + unit * 0.88 * envelope));
  }
  return out;
}

export function levelAtProgress(levels: number[], progress: number): number {
  if (levels.length === 0) return 0;
  const index = Math.min(levels.length - 1, Math.max(0, Math.floor(progress * levels.length)));
  return levels[index];
}

/** Shrink a string to a word budget, appending an ellipsis when clipped. */
export function truncateWords(text: string, maxWords: number): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}\u2026`;
}

const BESTIE_HOOKS: Record<BestieId, string> = {
  calorie: "Logged with love, balanced with ease.",
  fit: "Graceful strength, one loop at a time.",
};

/**
 * Deterministic fallback copy derived from the user's own transcript.
 * Marked `source: "local"` so it is never presented as model output.
 */
export function localSnippetCopy(text: string, bestie: Bestie, handle: string): SnippetCopy {
  const title = truncateWords(text || bestie.tagline, 7) || bestie.tagline;
  return {
    title,
    hook: BESTIE_HOOKS[bestie.id] || bestie.tagline,
    hashtags: [bestie.id === "calorie" ? "#healthyfood" : "#pilates", "#wellness", `#${bestie.id}`, handle],
    source: "local",
  };
}
