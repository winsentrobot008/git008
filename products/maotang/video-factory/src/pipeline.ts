/**
 * Video Factory v2 - the local AI short-video render pipeline.
 *
 * One call turns a creator token plus a narration script into a 9:16 promotional short:
 *
 *   Edge-TTS voiceover  ->  ComfyUI/SVD b-roll (NVENC FFmpeg fallback)  ->  concat + watermark
 *   ->  YouTube Shorts / TikTok metadata JSON
 *
 * Design constraints inherited from the rest of the repository:
 *   - Local first. Nothing leaves the machine; the only network calls are to `127.0.0.1:8188`.
 *   - Every capability degrades explicitly. Voiceover falls back to silence, b-roll falls back to a
 *     gradient, and encoding falls back from NVENC to libx264 - each with a note in the result.
 *   - Non-public. Generated metadata can only carry `unlisted`/`private` visibility.
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildPromoMetadata, writePromoMetadata } from "./metadata.js";
import { encode, ensureDir, ffmpegBinary, probeDuration, runChecked } from "./tooling.js";
import {
  DEFAULT_FPS,
  DEFAULT_HEIGHT,
  DEFAULT_SHORT_SECONDS,
  DEFAULT_VOICE,
  DEFAULT_WIDTH,
  type CreatorTokenRef,
  type EncoderKind,
  type PlatformTarget,
  type PromoVideoRequest,
  type PromoVideoResult,
  type ShotRender,
} from "./types.js";
import { discard, normalizeShot, renderShot, type ShotRequest } from "./visuals.js";
import { synthesizeVoiceoverWithFallback } from "./voiceover.js";
import { WATERMARK_MARGIN, buildWatermark, watermarkTextFilters } from "./watermark.js";

/** Base URL the watermark QR points at. Override with `MAOTANG_SHARE_BASE_URL`. */
const DEFAULT_SHARE_BASE_URL = "https://maotang.example";
/** Frames per SVD clip; the clip is looped to fill its shot during normalization. */
const SVD_FRAMES = Number.parseInt(process.env.MAOTANG_SVD_FRAMES ?? "14", 10) || 14;
const SVD_STEPS = Number.parseInt(process.env.MAOTANG_SVD_STEPS ?? "20", 10) || 20;

interface ResolvedConfig {
  token: CreatorTokenRef;
  hook: string;
  script: string;
  shots: PromoVideoRequest["shots"];
  outputDir: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  voice: string;
  ticker: string;
  brand: string;
  shareUrl: string;
  comfyUrl?: string;
  platforms: PlatformTarget[];
  privacyStatus: "unlisted" | "private";
  palette: readonly [string, string];
  notes: string[];
}

/** Deterministic two-stop palette keyed off the token address, so a token always looks the same. */
function derivePalette(address: string): readonly [string, string] {
  const digest = createHash("sha256").update(address.toLowerCase()).digest();
  const hue = ((digest[0] ?? 0) / 255) * 360;
  return [toHex(hue, 0.72, 0.16), toHex((hue + 42) % 360, 0.85, 0.58)];
}

/** HSL to `0xRRGGBB`, the colour form FFmpeg's `gradients` source accepts. */
function toHex(hueDegrees: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = hueDegrees / 60;
  const secondary = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const [r1, g1, b1] =
    huePrime < 1
      ? [chroma, secondary, 0]
      : huePrime < 2
        ? [secondary, chroma, 0]
        : huePrime < 3
          ? [0, chroma, secondary]
          : huePrime < 4
            ? [0, secondary, chroma]
            : huePrime < 5
              ? [secondary, 0, chroma]
              : [chroma, 0, secondary];
  const match = lightness - chroma / 2;
  const channel = (value: number) => Math.round((value + match) * 255).toString(16).padStart(2, "0");
  return `0x${channel(r1)}${channel(g1)}${channel(b1)}`;
}

/** Scales declared shot durations so the cut lands exactly on the requested length. */
function fitShotDurations(shots: PromoVideoRequest["shots"], totalSeconds: number): number[] {
  const declared = shots.map((shot) => Math.max(0.5, shot.durationSeconds));
  const sum = declared.reduce((accumulator, value) => accumulator + value, 0);
  const scaled = declared.map((value) => (value / sum) * totalSeconds);
  // Push the rounding drift onto the final shot so the sum is exactly `totalSeconds`.
  const rounded = scaled.map((value) => Number(value.toFixed(3)));
  const drift = totalSeconds - rounded.reduce((accumulator, value) => accumulator + value, 0);
  const last = rounded.length - 1;
  rounded[last] = Number(((rounded[last] ?? 0) + drift).toFixed(3));
  return rounded;
}

function defaultShareUrl(token: CreatorTokenRef): { url: string; usedDefault: boolean } {
  const base = process.env.MAOTANG_SHARE_BASE_URL?.trim();
  const target = token.curveAddress ?? token.address;
  const path = token.curveAddress ? "curve" : "token";
  if (!base) {
    return { url: `${DEFAULT_SHARE_BASE_URL}/${path}/${target}`, usedDefault: true };
  }
  return { url: `${base.replace(/\/$/, "")}/${path}/${target}`, usedDefault: false };
}

/** Fills in every default the caller omitted. */
function resolveConfig(request: PromoVideoRequest): ResolvedConfig {
  const notes: string[] = [];
  if (request.shots.length === 0) {
    throw new Error("a promo render needs at least one shot");
  }
  const share = request.shareUrl?.trim()
    ? { url: request.shareUrl.trim(), usedDefault: false }
    : defaultShareUrl(request.token);
  if (share.usedDefault) {
    notes.push("watermark QR uses the placeholder share base; set MAOTANG_SHARE_BASE_URL or shareUrl");
  }
  return {
    token: request.token,
    hook: request.hook,
    script: request.script,
    shots: request.shots,
    outputDir: request.outputDir,
    durationSeconds: request.durationSeconds ?? DEFAULT_SHORT_SECONDS,
    width: request.width ?? DEFAULT_WIDTH,
    height: request.height ?? DEFAULT_HEIGHT,
    fps: request.fps ?? DEFAULT_FPS,
    voice: request.voice?.trim() || DEFAULT_VOICE,
    ticker: request.ticker?.trim() || `$${request.token.symbol}`,
    brand: request.brand?.trim() || "MAOTANG",
    shareUrl: share.url,
    comfyUrl: request.comfyUrl,
    platforms: request.platforms ?? ["youtube-shorts", "tiktok"],
    privacyStatus: request.privacyStatus ?? "unlisted",
    palette: derivePalette(request.token.address),
    notes,
  };
}

/** Concatenates normalized shots into one silent video. */
async function concatShots(shotFiles: readonly string[], listFile: string, outputFile: string): Promise<void> {
  const body = shotFiles
    .map((file) => `file '${file.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
    .join("\n");
  writeFileSync(listFile, `${body}\n`, "utf8");
  try {
    await runChecked(ffmpegBinary(), ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outputFile], {
      timeoutMs: 10 * 60 * 1000,
    });
  } catch {
    // Identical codecs should always copy; a re-encode is the safe rung.
    await encode(["-f", "concat", "-safe", "0", "-i", listFile], outputFile);
  }
}

/**
 * Renders a 9:16 promotional short plus its posting metadata.
 *
 * @returns absolute paths to the video, thumbnail and metadata, the encoder that won, and one note
 *          per fallback rung that was used.
 */
export async function renderPromoVideo(request: PromoVideoRequest): Promise<PromoVideoResult> {
  const config = resolveConfig(request);
  const dir = ensureDir(config.outputDir);
  const workDir = ensureDir(join(dir, "work"));
  const notes = config.notes;

  const durations = fitShotDurations(config.shots, config.durationSeconds);

  // 1. Narration (Edge-TTS, with an explicit silent rung).
  const voiceFile = join(dir, "voiceover.mp3");
  const voiceover = await synthesizeVoiceoverWithFallback(
    { text: config.script, outFile: voiceFile, voice: config.voice },
    config.durationSeconds,
  );
  if (voiceover.provider === "silence") {
    notes.push("edge-tts unavailable; rendered a silent track instead of narration");
  }

  // 2. B-roll, one rung per shot.
  const shotRenders: ShotRender[] = [];
  for (const [index, shot] of config.shots.entries()) {
    const seconds = durations[index] ?? config.durationSeconds / config.shots.length;
    const shotRequest: ShotRequest = {
      shot,
      width: config.width,
      height: config.height,
      fps: config.fps,
      frames: SVD_FRAMES,
      steps: SVD_STEPS,
      seed: createHash("sha256").update(`${config.token.address}:${shot.id}`).digest().readUInt32BE(0),
      seconds,
      workDir,
      palette: config.palette,
      ...(config.comfyUrl ? { comfyUrl: config.comfyUrl } : {}),
    };
    const raw = await renderShot(shotRequest);
    if (raw.note) {
      notes.push(`${shot.id} (${raw.provider}): ${raw.note}`);
    }
    const normalized = join(workDir, `${shot.id}-normalized.mp4`);
    const encoder = await normalizeShot(raw.path, normalized, shotRequest);
    discard(raw.path);
    shotRenders.push({ shotId: shot.id, path: normalized, provider: raw.provider, seconds, encoder });
  }

  // 3. Watermark asset.
  const watermark = await buildWatermark({
    shareUrl: config.shareUrl,
    ticker: config.ticker,
    brand: config.brand,
    outDir: dir,
  });

  // 4. Assemble: concat, overlay, mix.
  const listFile = join(workDir, "concat.txt");
  const silent = join(workDir, "silent.mp4");
  await concatShots(shotRenders.map((render) => render.path), listFile, silent);

  const duration = config.durationSeconds.toFixed(3);
  const chains = [
    `[0:v]trim=duration=${duration},setpts=PTS-STARTPTS,fps=${config.fps}[base]`,
    `[base][2:v]overlay=W-w-${WATERMARK_MARGIN}:H-h-${WATERMARK_MARGIN}:format=auto[v1]`,
  ];
  const textFilters = watermarkTextFilters(watermark, config.width, config.height);
  let videoLabel = "v1";
  for (const [index, filter] of textFilters.entries()) {
    const next = `vt${index}`;
    chains.push(`[${videoLabel}]${filter}[${next}]`);
    videoLabel = next;
  }
  chains.push(`[1:a]apad,atrim=duration=${duration},asetpts=N/SR/TB[aout]`);

  const videoFile = join(dir, `${config.token.symbol.toLowerCase()}-promo-9x16.mp4`);
  const encoder: EncoderKind = await encode(
    [
      "-i",
      silent,
      "-i",
      voiceover.path,
      "-loop",
      "1",
      "-i",
      watermark.qrPath,
      "-filter_complex",
      chains.join(";"),
      "-map",
      `[${videoLabel}]`,
      "-map",
      "[aout]",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-t",
      duration,
    ],
    videoFile,
  );
  if (textFilters.length === 0) {
    notes.push("no TrueType font found; watermark rendered without the ticker/brand text");
  }

  // 5. Thumbnail + metadata.
  const thumbnail = join(dir, "thumbnail.jpg");
  await runChecked(ffmpegBinary(), ["-y", "-ss", "1", "-i", videoFile, "-frames:v", "1", "-q:v", "2", thumbnail], {
    timeoutMs: 60_000,
  });

  const measured = await probeDuration(videoFile);
  const metadata = buildPromoMetadata({
    token: config.token,
    hook: config.hook,
    script: config.script,
    shareUrl: config.shareUrl,
    ticker: config.ticker,
    brand: config.brand,
    videoFile,
    durationSeconds: measured,
    width: config.width,
    height: config.height,
    fps: config.fps,
    platforms: config.platforms,
    privacyStatus: config.privacyStatus,
    coverTimestampMs: 1_000,
  });
  const metadataPath = writePromoMetadata(metadata, join(dir, "metadata.json"));

  discard(listFile);
  discard(silent);

  return {
    token: config.token,
    video: videoFile,
    thumbnail,
    metadataPath,
    durationSeconds: measured,
    encoder,
    shots: shotRenders,
    voiceover,
    watermark,
    metadata,
    notes,
  };
}

export { derivePalette };