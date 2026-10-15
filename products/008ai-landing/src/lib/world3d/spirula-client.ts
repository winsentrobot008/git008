/**
 * Client for the local Spirula reconstruction service
 * (`products/spirula-studio/server`, default http://127.0.0.1:8791).
 *
 * The engine runs on the visitor's own GPU, so the endpoint is opt-in: with
 * NEXT_PUBLIC_SPIRULA_API_URL unset the page keeps its built-in sample and never
 * touches the network. That keeps the deployed site working for everyone while a
 * machine with the engine attached gets real reconstructions.
 */

import type { StageId } from "./types";

/** Where the engine listens by default on the machine that is running the page. */
export const DEFAULT_LOCAL_ENGINE_URL = "http://127.0.0.1:8791";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Absolute base URL of the local service.
 *
 * An explicit NEXT_PUBLIC_SPIRULA_API_URL always wins. Without one, a page that is
 * itself being served from loopback - `npm run dev`, `npm start`, a local build -
 * talks to the default local port, which is what makes a local test need no
 * configuration at all. A deployed page gets no such default: it has to be built
 * with the variable set, because otherwise every visitor's browser would probe its
 * own loopback, fail, and log a network error for nothing.
 */
export function spirulaBaseUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_SPIRULA_API_URL;
  if (raw && raw.trim().length > 0) return raw.trim().replace(/\/+$/, "");
  if (typeof window !== "undefined" && LOOPBACK_HOSTS.has(window.location.hostname)) {
    return DEFAULT_LOCAL_ENGINE_URL;
  }
  return null;
}

/**
 * The build-time half of the same question, safe to call while rendering on the
 * server. The loopback default needs `window`, so it must not decide what the
 * first render shows - React would otherwise hydrate a different tree from the one
 * it was sent. Components seed state from this and refresh it in an effect.
 */
export const backendConfiguredByEnv = (): boolean => {
  const raw = process.env.NEXT_PUBLIC_SPIRULA_API_URL;
  return Boolean(raw && raw.trim().length > 0);
};

/** Stage ids the service reports. */
export type RemoteStage = "ingest" | "frames" | "sfm" | "cloud" | "dense" | "train";

export interface RemoteJob {
  id: string;
  kind: "image" | "video";
  state: "queued" | "running" | "succeeded" | "failed" | "canceled";
  stage: RemoteStage;
  progress: number;
  stages: { id: RemoteStage; label: string; state: string }[];
  source: { name: string; files?: number; bytes: number; type: string };
  artifact: { points: number; bytes: number; url: string } | null;
  error: { message: string; detail?: string } | null;
  log: string[];
}

/**
 * Maps the service's stages onto the timeline the page already renders.
 * The service has fewer, coarser stages than the animated placeholder, so the
 * tail of the bar is smoothed onto the remaining steps instead of idling.
 */
export function stageForRemote(stage: RemoteStage, progress: number): StageId {
  if (progress >= 1) return "ready";
  if (progress > 0.9) return "align";
  switch (stage) {
    case "ingest": return "decode";
    case "frames": return "camera";
    case "sfm": return progress > 0.75 ? "splat" : "camera";
    case "cloud": return "splat";
    case "dense": return progress > 0.85 ? "align" : "splat";
    case "train": return progress > 0.85 ? "align" : "splat";
    default: return "decode";
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; detail?: string };
    return [body.error, body.detail].filter(Boolean).join(" - ") || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

/** True when the service answers and its engine binary is present. */
export async function probeBackend(signal?: AbortSignal): Promise<boolean> {
  const base = spirulaBaseUrl();
  if (!base) return false;
  try {
    const response = await fetch(`${base}/api/v1/health`, { signal });
    if (!response.ok) return false;
    const body = (await response.json()) as { engine?: { available?: boolean } };
    return body.engine?.available !== false;
  } catch {
    return false;
  }
}

/**
 * The pipelines the server accepts. `preview` runs the same trainer as `splat`,
 * from the sparse points and for a few hundred steps: a thin but genuine splat
 * in seconds instead of minutes. `dense` and `splat` remain the way to get a
 * rich scene, and no pipeline here is a feed-forward generator.
 */
export type SpirulaPipeline = "sfm" | "dense" | "splat" | "preview";

/**
 * Uploads the capture and returns the queued job. Several photos are sent as one
 * multipart body: structure from motion needs more than one view.
 */
export async function startReconstruction(
  files: File[],
  options: { signal?: AbortSignal; pipeline?: SpirulaPipeline } = {}
): Promise<RemoteJob> {
  const base = spirulaBaseUrl();
  if (!base) throw new Error("no reconstruction service is configured");

  const form = new FormData();
  for (const file of files) form.append("file", file, file.name);

  const query = options.pipeline ? `?pipeline=${options.pipeline}` : "";
  const response = await fetch(`${base}/api/v1/reconstruct${query}`, {
    method: "POST",
    body: form,
    signal: options.signal,
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as RemoteJob;
}

export async function fetchJob(id: string, signal?: AbortSignal): Promise<RemoteJob> {
  const base = spirulaBaseUrl();
  if (!base) throw new Error("no reconstruction service is configured");
  const response = await fetch(`${base}/api/v1/jobs/${id}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as RemoteJob;
}

/**
 * Uploads, then polls until the job settles. Resolves with the finished job;
 * throws on an engine failure so the caller can fall back to the sample.
 */
export async function runReconstruction(
  files: File[],
  options: {
    signal?: AbortSignal;
    pipeline?: SpirulaPipeline;
    onProgress?: (progress: number, stage: RemoteStage) => void;
    intervalMs?: number;
    timeoutMs?: number;
  } = {}
): Promise<RemoteJob> {
  const interval = options.intervalMs ?? 800;
  // Longer than the service's own per-job ceiling (30 minutes, SPIRULA_JOB_TIMEOUT_MIN).
  // A client that gave up first abandoned a job the engine was still running and
  // handed the viewer the sample instead of the reconstruction that landed a few
  // minutes later - the timeout has to outlast the server it is waiting on.
  const deadline = Date.now() + (options.timeoutMs ?? 45 * 60 * 1000);

  let job = await startReconstruction(files, options);
  options.onProgress?.(job.progress, job.stage);

  while (job.state === "queued" || job.state === "running") {
    if (options.signal?.aborted) throw new Error("canceled");
    if (Date.now() > deadline) throw new Error("the reconstruction timed out");
    await new Promise((resolve) => setTimeout(resolve, interval));
    job = await fetchJob(job.id, options.signal);
    options.onProgress?.(job.progress, job.stage);
  }

  if (job.state !== "succeeded") {
    throw new Error(job.error?.message ?? "the reconstruction failed");
  }
  return job;
}

/** Absolute URL of the finished cloud: the artifact route, or its alias. */
export function artifactUrl(job: RemoteJob): string {
  const base = spirulaBaseUrl();
  if (!base) throw new Error("no reconstruction service is configured");
  return job.artifact ? `${base}${job.artifact.url}` : `${base}/api/v1/jobs/${job.id}/ply`;
}

/**
 * Downloads the finished point cloud into one buffer. The viewport reads it
 * through the chunked artifact cache instead when it can, which is what keeps a
 * large model off the JS heap; this stays for callers that want the bytes at once.
 */
export async function fetchArtifact(job: RemoteJob, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(artifactUrl(job), { signal });
  if (!response.ok) throw new Error(await readError(response));
  return await response.arrayBuffer();
}

/** Best-effort cancel; a service that is already gone is not an error. */
export async function cancelJob(id: string): Promise<void> {
  const base = spirulaBaseUrl();
  if (!base) return;
  try {
    await fetch(`${base}/api/v1/jobs/${id}`, { method: "DELETE" });
  } catch {
    // Nothing to do: the job is gone either way.
  }
}