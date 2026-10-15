/**
 * world3d pipeline - everything between "the visitor handed us a file" and "the
 * viewport has a splat cloud to draw".
 *
 * IMPORTANT: the reconstruction is simulated. There is no network call and no
 * model here. It exists so the page is fully usable - upload, progress, orbit,
 * inspect - before the real service lands, and so the UI's loading / failure /
 * success states are exercised in production rather than only in a dashboard.
 *
 * To go live, replace `previewCloudFor` with a fetch against the reconstruction
 * endpoint and keep the job/progress contract: the composer and the viewport
 * depend on nothing else.
 */

import type {
  DensityId,
  DensityPreset,
  ReconstructionJob,
  ReconstructionStage,
  SourceKind,
  StageId,
  SplatCloud,
  UploadDescriptor,
  UploadErrorCode,
} from "./types";
import { buildSubwayCloud } from "./subway-sample";
import { parsePlyStream } from "./ply";
import { openArtifact } from "./artifact-cache";
import { traceStep } from "./telemetry";
import {
  artifactUrl,
  runReconstruction as runEngineJob,
  spirulaBaseUrl,
  stageForRemote,
  type SpirulaPipeline,
} from "./spirula-client";

/** 12 MB is comfortably above a phone photo and well under a Vercel body limit. */
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
/** 200 MB covers a walkthrough of a whole room; the local engine is the only
 * place the file is sent, and it never transits a server we operate. */
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

const IMAGE_MIME = ["image/jpeg", "image/jpg", "image/png"];
const VIDEO_MIME = ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm"];
const IMAGE_EXT = [".jpg", ".jpeg", ".png"];
const VIDEO_EXT = [".mp4", ".mov", ".mkv", ".webm"];

/** `accept` for the hidden <input type="file">. Mirrors the validators below. */
export const ACCEPT_ATTRIBUTE = ".jpg,.jpeg,.png,.mp4,.mov,.mkv,.webm,image/jpeg,image/png,video/mp4,video/quicktime,video/webm,video/x-matroska";

/** Prefix used in the upload UI so the limits are never written twice. */
export const ACCEPTED_LABEL = "JPG / PNG / MP4 / MOV / MKV / WEBM";

/**
 * Simulated stages. Weights sum to 100 and drive the single progress bar, so the
 * bar is monotonic even though each stage ticks at its own rate.
 */
export const STAGES: readonly ReconstructionStage[] = [
  { id: "decode", weight: 18, durationMs: 900 },
  { id: "camera", weight: 26, durationMs: 1500 },
  { id: "splat", weight: 34, durationMs: 2100 },
  { id: "align", weight: 16, durationMs: 1100 },
  { id: "ready", weight: 6, durationMs: 300 },
];

export const DENSITIES: readonly DensityPreset[] = [
  { id: "draft", multiplier: 0.45 },
  { id: "standard", multiplier: 1 },
  { id: "high", multiplier: 1.8 },
];

/** Seed for the built-in demo scene. Fixed so every visitor sees the same car. */
export const SAMPLE_SEED = 15892737;

export function densityMultiplier(id: DensityId): number {
  const preset = DENSITIES.find((entry) => entry.id === id);
  return preset ? preset.multiplier : 1;
}

/** Best-effort classification: trust the MIME when the browser supplies one. */
export function classifyFile(file: File): { kind: SourceKind; mime: string } | null {
  const name = (file.name || "").toLowerCase();
  const mime = (file.type || "").toLowerCase();

  if (IMAGE_MIME.includes(mime) || IMAGE_EXT.some((ext) => name.endsWith(ext))) {
    return { kind: "image", mime: mime || "image/jpeg" };
  }
  if (VIDEO_MIME.includes(mime) || VIDEO_EXT.some((ext) => name.endsWith(ext))) {
    return { kind: "video", mime: mime || "video/mp4" };
  }
  return null;
}

export function validateUpload(file: File): UploadErrorCode | null {
  if (!file || file.size === 0) return "empty";
  const classified = classifyFile(file);
  if (!classified) return "unsupportedType";
  const limit = classified.kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  return file.size > limit ? "tooLarge" : null;
}

export function limitFor(kind: SourceKind): number {
  return kind === "video" ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * FNV-1a over the name plus the byte length. Same file in, same scene out - which
 * is what lets a visitor re-open the page and find the car they were inspecting.
 */
export function seedFromUpload(name: string, bytes: number, kind: SourceKind): number {
  let hash = 2166136261;
  const key = `${kind}:${bytes}:${name.toLowerCase()}`;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

export function createJob(descriptor: UploadDescriptor, seed: number): ReconstructionJob {
  return {
    id: `jt-${seed.toString(16)}-${descriptor.bytes.toString(16)}`,
    seed,
    kind: descriptor.kind,
    status: "running",
    progress: 0,
    stage: null,
  };
}

export interface StageUpdate {
  progress: number;
  stage: StageId;
}

export interface RunningJob {
  promise: Promise<void>;
  cancel: () => void;
}

/**
 * Walks the stage list on a timer, reporting one monotonic 0..1 progress value.
 * Cancelling resolves the promise rather than rejecting it, so the caller's
 * cleanup path stays a single `await` instead of a try/catch.
 */
export function runReconstruction(
  onUpdate: (update: StageUpdate) => void
): RunningJob {
  const totalWeight = STAGES.reduce((sum, entry) => sum + entry.weight, 0);
  const TICK_MS = 60;

  let cancelled = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Captured out of the executor so `cancel` can settle the promise itself: the
  // timer it just cleared was the only thing that would have resolved it.
  let settle: () => void = () => {};

  const promise = new Promise<void>((resolve) => {
    settle = () => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      resolve();
    };

    let index = 0;
    let completedWeight = 0;
    let elapsed = 0;

    const step = (): void => {
      if (cancelled) {
        settle();
        return;
      }
      const entry = STAGES[index];
      if (!entry) {
        onUpdate({ progress: 1, stage: "ready" });
        settle();
        return;
      }

      elapsed += TICK_MS;
      const local = Math.min(1, elapsed / entry.durationMs);
      const progress = Math.min(1, (completedWeight + entry.weight * local) / totalWeight);
      onUpdate({ progress, stage: entry.id });

      if (local >= 1) {
        completedWeight += entry.weight;
        index += 1;
        elapsed = 0;
      }
      timer = setTimeout(step, TICK_MS);
    };

    step();
  });

  return {
    promise,
    cancel: () => {
      cancelled = true;
      settle();
    },
  };
}

const POSTER_MAX_EDGE = 720;
const VIDEO_FRAME_TIMEOUT_MS = 8000;

function drawToPoster(
  source: CanvasImageSource,
  width: number,
  height: number
): string | null {
  const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round(width * scale));
  canvas.height = Math.max(2, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = url;
  });
}

function captureVideoFrame(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;

    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute("src");
      resolve(value);
    };

    const timer = window.setTimeout(() => finish(null), VIDEO_FRAME_TIMEOUT_MS);

    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onerror = () => finish(null);

    // Some MP4s report an unknown duration (streaming layouts); 0.1s is a safe
    // first frame either way and still avoids the black leader frame.
    video.onloadeddata = () => {
      try {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        video.currentTime = duration > 0.4 ? Math.min(0.25, duration * 0.05) : 0;
      } catch {
        finish(null);
      }
    };
    video.onseeked = () => {
      try {
        finish(
          drawToPoster(
            video,
            video.videoWidth || 640,
            video.videoHeight || 360
          )
        );
      } catch {
        finish(null);
      }
    };

    video.src = url;
  });
}

/**
 * Optional preview image for the source panel. Never throws and never blocks the
 * job: a browser that refuses to decode the file just shows the fallback panel.
 */
export async function capturePreview(
  file: File,
  kind: SourceKind
): Promise<string | null> {
  if (typeof document === "undefined" || typeof window === "undefined") return null;
  try {
    if (kind === "video") return await captureVideoFrame(file);
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImageElement(url);
      return drawToPoster(img, img.naturalWidth || 640, img.naturalHeight || 480);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

/**
 * Resolves the cloud a job produced.
 *
 * Simulation note: every source currently previews the demo subway interior,
 * re-seeded from the upload so two different files visibly differ. Video sources
 * are sampled a little denser to stand in for the extra frames a real pipeline
 * would fuse.
 */
export function previewCloudFor(
  seed: number,
  density: DensityId,
  kind: SourceKind
): SplatCloud {
  const scale = densityMultiplier(density) * (kind === "video" ? 1.12 : 1);
  return buildSubwayCloud(seed, scale);
}

/** The cloud shown before any interaction: never uploads, never fails. */
export function sampleCloud(density: DensityId = "standard"): SplatCloud {
  return buildSubwayCloud(SAMPLE_SEED, densityMultiplier(density));
}

/**
 * The engine's answer, or the sample when the engine could not deliver one.
 *
 * `engine` distinguishes the two so the UI can say which one is on screen instead
 * of implying a reconstruction that did not happen.
 */
export interface ReconstructionOutcome {
  cloud: SplatCloud;
  engine: boolean;
  /** Why the sample is on screen instead. Null when the engine produced the cloud. */
  fallbackReason: string | null;
  points: number | null;
}

/**
 * Runs the capture through the local engine. Never throws for an engine-side
 * problem: every failure resolves to the procedural sample plus a reason, so the
 * viewport always has something to draw. Only a caller-initiated abort propagates.
 */
export async function reconstructWithEngine(
  files: File[],
  options: {
    seed: number;
    density: DensityId;
    kind: SourceKind;
    signal?: AbortSignal;
    pipeline?: SpirulaPipeline;
    onProgress?: (progress: number, stage: StageId) => void;
  }
): Promise<ReconstructionOutcome> {
  const sample = (fallbackReason: string | null): ReconstructionOutcome => ({
    cloud: previewCloudFor(options.seed, options.density, options.kind),
    engine: false,
    fallbackReason,
    points: null,
  });

  if (spirulaBaseUrl() === null) return sample(null);

  try {
    const job = await runEngineJob(files, {
      signal: options.signal,
      pipeline: options.pipeline,
      onProgress: (progress, stage) =>
        options.onProgress?.(progress, stageForRemote(stage, progress)),
    });
    // Streamed, not buffered: the transport writes the model to disk chunk by
    // chunk and the parser reads it back a window at a time, so a large
    // reconstruction costs frames of detail instead of a frozen page.
    const stopOpen = traceStep("pipeline", "artifact-open");
    const source = await openArtifact(artifactUrl(job), { signal: options.signal, key: job.id });
    stopOpen();
    const stopParse = traceStep("pipeline", "artifact-parse");
    try {
      const cloud = await parsePlyStream(source, { signal: options.signal });
      stopParse();
      return { cloud, engine: true, fallbackReason: null, points: cloud.count };
    } finally {
      source.close();
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return sample(error instanceof Error ? error.message : String(error));
  }
}