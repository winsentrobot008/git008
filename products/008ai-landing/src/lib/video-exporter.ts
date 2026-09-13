/**
 * video-exporter - 9:16 canvas recording & video synthesis.
 *
 * Takes a live canvas (already painting subtitles + waveform) plus the recorded
 * dialogue audio and muxes them into a single vertical clip:
 *
 *   canvas.captureStream(fps)  ─┐
 *                               ├─► MediaRecorder ─► Blob (webm/mp4)
 *   <audio> ─► MediaElementSource ─► MediaStreamDestination ─┘
 *
 * The audio graph is cached per <audio> element (createMediaElementSource may
 * only be called once per element), so previewing and exporting can alternate
 * without breaking playback.
 */

export interface ClipExportOptions {
  canvas: HTMLCanvasElement;
  /** null = video-only export (silent clip). */
  audio: HTMLAudioElement | null;
  durationSeconds: number;
  fps?: number;
  videoBitsPerSecond?: number;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

export interface ExportedClip {
  blob: Blob;
  url: string;
  mimeType: string;
  extension: "webm" | "mp4";
  width: number;
  height: number;
  durationSeconds: number;
  bytes: number;
}

/** Preference order: VP9 -> VP8 -> generic webm -> Safari's mp4. */
const RECORDER_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

export const DEFAULT_EXPORT_FPS = 30;
export const DEFAULT_VIDEO_BITRATE = 4_000_000;

interface AudioGraph {
  context: AudioContext;
  destination: MediaStreamAudioDestinationNode;
}

const audioGraphs = new WeakMap<HTMLAudioElement, AudioGraph>();

type AudioContextCtor = new () => AudioContext;

function resolveAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export function isClipExportSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof MediaRecorder === "undefined") return false;
  return typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype;
}

export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return RECORDER_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Route the element's audio through the graph so it can be recorded. */
function ensureAudioGraph(audio: HTMLAudioElement): AudioGraph | null {
  const existing = audioGraphs.get(audio);
  if (existing) return existing;
  const Ctor = resolveAudioContextCtor();
  if (!Ctor) return null;
  const context = new Ctor();
  const source = context.createMediaElementSource(audio);
  const destination = context.createMediaStreamDestination();
  source.connect(destination);
  source.connect(context.destination);
  const graph = { context, destination };
  audioGraphs.set(audio, graph);
  return graph;
}

function abortError(): Error {
  const error = new Error("Clip export aborted");
  error.name = "AbortError";
  return error;
}

/** Wait for the clip to finish playing, reporting progress along the way. */
function waitForClipEnd(
  audio: HTMLAudioElement | null,
  durationSeconds: number,
  onProgress?: (ratio: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const totalMs = Math.max(500, durationSeconds * 1000);
  return new Promise<void>((resolve, reject) => {
    const started = performance.now();
    let raf = 0;

    const cleanup = () => {
      if (raf) cancelAnimationFrame(raf);
      audio?.removeEventListener("ended", onEnded);
      signal?.removeEventListener("abort", onAbort);
    };
    const onEnded = () => {
      onProgress?.(1);
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };

    const tick = () => {
      const elapsed = performance.now() - started;
      const current = audio ? audio.currentTime : elapsed / 1000;
      onProgress?.(Math.min(1, current / durationSeconds));
      if (elapsed > totalMs + 600) {
        // Hard stop: some browsers never fire `ended` for short clips.
        cleanup();
        resolve();
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    audio?.addEventListener("ended", onEnded, { once: true });
    raf = requestAnimationFrame(tick);
  });
}

/**
 * Record one vertical clip. Throws when the browser cannot encode video, when
 * the canvas is missing, or with an AbortError when `signal` fires.
 */
export async function exportVerticalClip(options: ClipExportOptions): Promise<ExportedClip> {
  const { canvas, audio, durationSeconds, onProgress, signal } = options;
  const fps = options.fps ?? DEFAULT_EXPORT_FPS;
  const bitrate = options.videoBitsPerSecond ?? DEFAULT_VIDEO_BITRATE;

  if (!isClipExportSupported()) {
    throw new Error("This browser cannot encode video (MediaRecorder/captureStream missing)");
  }
  if (signal?.aborted) throw abortError();

  const mimeType = pickRecorderMimeType();
  const canvasStream = canvas.captureStream(fps);
  const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

  if (audio) {
    const graph = ensureAudioGraph(audio);
    if (!graph) throw new Error("Web Audio is unavailable in this browser");
    if (graph.context.state === "suspended") await graph.context.resume().catch(() => undefined);
    tracks.push(...graph.destination.stream.getAudioTracks());
  }

  const mixed = new MediaStream(tracks);
  const recorder = new MediaRecorder(
    mixed,
    mimeType ? { mimeType, videoBitsPerSecond: bitrate } : { videoBitsPerSecond: bitrate }
  );
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || "video/webm" }));
  });

  try {
    recorder.start(200);
    if (audio) {
      audio.currentTime = 0;
      await audio.play();
    }
    await waitForClipEnd(audio, durationSeconds, onProgress, signal);
  } finally {
    if (audio && !audio.paused) audio.pause();
    if (recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* already stopping */
      }
    }
  }

  const blob = await stopped;
  canvasStream.getTracks().forEach((track) => track.stop());

  if (blob.size === 0) throw new Error("Encoding produced an empty clip - try a longer recording");

  const resolvedMime = mimeType || "video/webm";
  return {
    blob,
    url: URL.createObjectURL(blob),
    mimeType: resolvedMime,
    extension: resolvedMime.includes("mp4") ? "mp4" : "webm",
    width: canvas.width,
    height: canvas.height,
    durationSeconds,
    bytes: blob.size,
  };
}

/** Trigger a browser download for an exported clip. */
export function downloadClip(clip: ExportedClip, baseName: string): void {
  if (typeof document === "undefined") return;
  const anchor = document.createElement("a");
  anchor.href = clip.url;
  anchor.download = `${baseName}.${clip.extension}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** Web Share the clip when the platform supports file sharing. */
export async function shareClip(clip: ExportedClip, title: string): Promise<boolean> {
  const nav = typeof navigator === "undefined" ? null : navigator;
  if (!nav || typeof nav.share !== "function" || typeof File === "undefined") return false;
  const file = new File([clip.blob], `${title}.${clip.extension}`, { type: clip.mimeType });
  const canShare = typeof nav.canShare === "function" ? nav.canShare({ files: [file] }) : true;
  if (!canShare) return false;
  try {
    await nav.share({ files: [file], title });
    return true;
  } catch {
    return false;
  }
}

/** Release the object URL of a clip that is being replaced. */
export function revokeClip(clip: ExportedClip | null): void {
  if (clip && typeof URL !== "undefined") URL.revokeObjectURL(clip.url);
}
