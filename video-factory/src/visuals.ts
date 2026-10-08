/**
 * B-roll acquisition: the ComfyUI / SVD bridge and its fallbacks.
 *
 * Ladder, in order:
 *   1. `comfyui` - the local SVD graph (`svd_img2vid.json`) driven over the ComfyUI HTTP API on
 *      `127.0.0.1:8188`. The node ids patched here are the same ones `008/run_svd.py` patches, so
 *      the API path and the CLI path cannot drift.
 *   2. `run_svd.py` - the repository's one-shot SVD runner, which drives the identical graph through
 *      the Python client and lets FFmpeg encode the result.
 *   3. `gradient` - a deterministic animated gradient derived from the token address. This is the
 *      offline rung that keeps a render possible with no local AI at all.
 *
 * Every rung is reported in the result, so a caller can tell a real AI render from a degraded one.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

import { encode, ensureDir, REPO_ROOT, resolveBinary, run, runChecked, ToolchainError } from "./tooling.js";
import { DEFAULT_COMFYUI_URL, type EncoderKind, type PromoShot, type VisualProvider } from "./types.js";

/** SVD graph shipped with the repo; `008/run_svd.py` patches the same ids. */
export const SVD_WORKFLOW = resolve(REPO_ROOT, "products", "RoastBro", "tools", "_comfyui", "workflows", "svd_img2vid.json");
/** One-shot SVD runner used as the second rung. */
export const RUN_SVD_SCRIPT = resolve(REPO_ROOT, "008", "run_svd.py");

const COMFY_TIMEOUT_MS = 30 * 60 * 1000;
const POLL_INTERVAL_MS = 3_000;

export interface ShotRequest {
  shot: PromoShot;
  width: number;
  height: number;
  fps: number;
  /** Frames per SVD clip; the clip is looped/trimmed to `seconds` during normalization. */
  frames: number;
  steps: number;
  seed: number;
  /** Seconds the normalized shot must occupy. */
  seconds: number;
  workDir: string;
  comfyUrl?: string;
  /** Deterministic two-stop palette, derived from the token address by the pipeline. */
  palette: readonly [string, string];
}

/**
 * SVD is trained on 576x1024-class canvases; generating at the 1080x1920 delivery size wastes
 * VRAM and looks worse. The clip is upscaled during normalization instead.
 */
function svdSourceSize(width: number, height: number): { width: number; height: number } {
  const long = 1024;
  const short = Math.round((Math.min(width, height) / Math.max(width, height)) * long / 8) * 8;
  return height >= width ? { width: short, height: long } : { width: long, height: short };
}

export interface RawShot {
  path: string;
  provider: VisualProvider;
  /** Set when a preferred rung was skipped, explaining why. */
  note?: string;
}

interface ComfyArtifact {
  filename: string;
  subfolder?: string;
  type?: string;
}

/** True when the local ComfyUI server answers `/system_stats`. */
export async function isComfyAvailable(baseUrl: string = DEFAULT_COMFYUI_URL): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/system_stats`, {
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function uploadImage(baseUrl: string, file: string): Promise<string> {
  const body = new FormData();
  body.append("image", new Blob([readFileSync(file)], { type: "image/png" }), "maotang_shot.png");
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/upload/image`, { method: "POST", body });
  if (!response.ok) {
    throw new ToolchainError(`ComfyUI image upload failed with HTTP ${response.status}`, "comfyui", response.status, "");
  }
  const payload = (await response.json()) as { name?: string };
  if (typeof payload.name !== "string" || payload.name === "") {
    throw new ToolchainError("ComfyUI image upload returned no name", "comfyui", -1, "");
  }
  return payload.name;
}

/** Applies the same node patches as `008/run_svd.py`, so both paths render identically. */
function patchWorkflow(workflow: Record<string, { inputs?: Record<string, unknown> }>, request: ShotRequest, uploaded: string): void {
  const shotNode = workflow["3"];
  const samplerNode = workflow["5"];
  const loadNode = workflow["2"];
  if (!shotNode?.inputs || !samplerNode?.inputs || !loadNode?.inputs) {
    throw new ToolchainError("svd_img2vid.json is missing nodes 2/3/5", "comfyui", -1, "");
  }
  const source = svdSourceSize(request.width, request.height);
  loadNode.inputs.image = uploaded;
  shotNode.inputs.width = source.width;
  shotNode.inputs.height = source.height;
  shotNode.inputs.video_frames = request.frames;
  shotNode.inputs.fps = request.fps;
  shotNode.inputs.motion_bucket_id = request.shot.motionBucketId ?? 127;
  shotNode.inputs.augmentation_level = 0;
  samplerNode.inputs.seed = request.seed;
  samplerNode.inputs.steps = request.steps;
  for (const id of ["7", "8"]) {
    const node = workflow[id];
    if (node?.inputs) {
      node.inputs.fps = request.fps;
    }
  }
}

async function renderViaComfyUi(request: ShotRequest): Promise<RawShot> {
  const image = request.shot.image;
  if (!image || !existsSync(image)) {
    throw new ToolchainError(`shot ${request.shot.id} has no source image for SVD`, "comfyui", -1, "");
  }
  const baseUrl = (request.comfyUrl ?? DEFAULT_COMFYUI_URL).replace(/\/$/, "");
  const workflow = JSON.parse(readFileSync(SVD_WORKFLOW, "utf8")) as Record<string, { inputs?: Record<string, unknown> }>;
  const uploaded = await uploadImage(baseUrl, image);
  patchWorkflow(workflow, request, uploaded);

  const submit = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: workflow }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!submit.ok) {
    throw new ToolchainError(`ComfyUI /prompt failed with HTTP ${submit.status}`, "comfyui", submit.status, "");
  }
  const { prompt_id: promptId } = (await submit.json()) as { prompt_id?: string };
  if (typeof promptId !== "string" || promptId === "") {
    throw new ToolchainError("ComfyUI returned no prompt_id", "comfyui", -1, "");
  }

  const deadline = Date.now() + COMFY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
    const history = await fetch(`${baseUrl}/history/${promptId}`, { signal: AbortSignal.timeout(10_000) });
    if (!history.ok) {
      continue;
    }
    const payload = (await history.json()) as Record<string, { outputs?: Record<string, { videos?: ComfyArtifact[]; gifs?: ComfyArtifact[] }> }>;
    const outputs = payload[promptId]?.outputs;
    if (!outputs) {
      continue;
    }
    for (const nodeId of ["9", "7"]) {
      const node = outputs[nodeId];
      const artifact = node?.videos?.[0] ?? node?.gifs?.[0];
      if (artifact) {
        const query = new URLSearchParams({
          filename: artifact.filename,
          subfolder: artifact.subfolder ?? "",
          type: artifact.type ?? "output",
        });
        const download = await fetch(`${baseUrl}/view?${query.toString()}`, { signal: AbortSignal.timeout(120_000) });
        if (!download.ok) {
          throw new ToolchainError(`ComfyUI /view failed with HTTP ${download.status}`, "comfyui", download.status, "");
        }
        const dest = join(request.workDir, `${request.shot.id}-comfyui.mp4`);
        writeFileSync(dest, Buffer.from(await download.arrayBuffer()));
        return { path: dest, provider: "comfyui" };
      }
    }
  }
  throw new ToolchainError(`ComfyUI did not finish ${request.shot.id} within the timeout`, "comfyui", -1, "");
}

async function renderViaRunSvd(request: ShotRequest): Promise<RawShot> {
  const image = request.shot.image;
  if (!image || !existsSync(image)) {
    throw new ToolchainError(`shot ${request.shot.id} has no source image for SVD`, "run_svd.py", -1, "");
  }
  if (!existsSync(RUN_SVD_SCRIPT)) {
    throw new ToolchainError(`missing ${RUN_SVD_SCRIPT}`, "run_svd.py", -1, "");
  }
  const python = resolveBinary("python", ["PYTHON_BIN", "PYTHON_PATH"]);
  if (python === null) {
    throw new ToolchainError("python is not on PATH", "python", -1, "");
  }
  const source = svdSourceSize(request.width, request.height);
  const result = await runChecked(
    python,
    [
      RUN_SVD_SCRIPT,
      image,
      "--width",
      String(source.width),
      "--height",
      String(source.height),
      "--frames",
      String(request.frames),
      "--fps",
      String(request.fps),
      "--steps",
      String(request.steps),
      "--motion",
      String(request.shot.motionBucketId ?? 127),
      "--output",
      "mp4",
    ],
    { timeoutMs: COMFY_TIMEOUT_MS },
  );

  // `run_svd.py` prints a trailing JSON line: {"output": ["<abs path>"]}
  const line = result.stdout
    .split(/\r?\n/)
    .reverse()
    .find((candidate) => candidate.trim().startsWith("{") && candidate.includes("\"output\""));
  if (line === undefined) {
    throw new ToolchainError("run_svd.py printed no output manifest", "run_svd.py", 0, "");
  }
  const manifest = JSON.parse(line) as { output?: string[] };
  const produced = manifest.output?.[0];
  if (typeof produced !== "string" || !existsSync(produced)) {
    throw new ToolchainError("run_svd.py reported an output file that does not exist", "run_svd.py", 0, "");
  }
  const dest = join(request.workDir, `${request.shot.id}-svd.mp4`);
  copyFileSync(produced, dest);
  return { path: dest, provider: "run_svd.py" };
}

/** Deterministic animated gradient, derived from the palette the pipeline keyed off the token address. */
async function renderGradient(request: ShotRequest): Promise<RawShot> {
  const dest = join(request.workDir, `${request.shot.id}-gradient.mp4`);
  const [start, end] = request.palette;
  const graph = `gradients=s=${request.width}x${request.height}:d=${request.seconds.toFixed(3)}:speed=0.02:nb_colors=2:c0=${start}:c1=${end}`;
  try {
    await encode(["-f", "lavfi", "-i", graph, "-t", request.seconds.toFixed(3), "-an"], dest);
  } catch {
    await encode(
      ["-f", "lavfi", "-i", `color=c=${start}:s=${request.width}x${request.height}:d=${request.seconds.toFixed(3)}`, "-an"],
      dest,
    );
  }
  return { path: dest, provider: "gradient" };
}

/** Walks the rung ladder and returns the first b-roll that rendered. */
export async function renderShot(request: ShotRequest): Promise<RawShot> {
  const notes: string[] = [];
  const comfyUrl = request.comfyUrl ?? DEFAULT_COMFYUI_URL;

  if (request.shot.image && existsSync(request.shot.image)) {
    if (await isComfyAvailable(comfyUrl)) {
      try {
        return await renderViaComfyUi(request);
      } catch (error) {
        notes.push(`comfyui: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      notes.push(`comfyui: no server at ${comfyUrl}`);
    }
    try {
      return { ...(await renderViaRunSvd(request)), note: notes.join("; ") };
    } catch (error) {
      notes.push(`run_svd.py: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    notes.push(`shot ${request.shot.id} has no source image; SVD rungs skipped`);
  }

  const gradient = await renderGradient(request);
  return { ...gradient, note: notes.join("; ") };
}

/** Scales, crops and time-fits a raw shot onto the target canvas. */
export async function normalizeShot(rawPath: string, outputFile: string, request: ShotRequest): Promise<EncoderKind> {
  ensureDir(request.workDir);
  const filter = [
    `scale=${request.width}:${request.height}:force_original_aspect_ratio=increase`,
    `crop=${request.width}:${request.height}`,
    `fps=${request.fps}`,
    "format=yuv420p",
  ].join(",");
  return encode(["-stream_loop", "-1", "-i", rawPath, "-t", request.seconds.toFixed(3), "-vf", filter, "-an"], outputFile);
}

/** Removes an intermediate artifact, ignoring an already-absent file. */
export function discard(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Intermediate files are best-effort.
  }
}