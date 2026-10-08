/**
 * Edge-TTS voiceover synthesis.
 *
 * The default voice is `zh-CN-YunxiNeural` - a Mandarin mainland male narration voice - because
 * MAOTANG's primary audience is Chinese-speaking. Synthesis shells out to the local `edge-tts`
 * CLI; when that is unavailable the caller may opt into a silent track so the rest of the render
 * still runs offline. The fallback is explicit and reported, never silent.
 */

import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_VOICE, type VoiceoverResult } from "./types.js";
import { ensureDir, ffmpegBinary, probeDuration, resolveBinary, runChecked, ToolchainError } from "./tooling.js";

export interface VoiceoverOptions {
  text: string;
  outFile: string;
  voice?: string;
  /** Edge-TTS rate string, for example `+10%`. */
  rate?: string;
  /** Edge-TTS pitch string, for example `+2Hz`. */
  pitch?: string;
  timeoutMs?: number;
}

interface Invocation {
  command: string;
  prefix: string[];
}

/**
 * Locates Edge-TTS, preferring the CLI and falling back to `python -m edge_tts`.
 *
 * The Python module is the same implementation the CLI wraps, so accepting it avoids a hard
 * dependency on the console-script shim landing on PATH.
 */
export function edgeTtsInvocation(): Invocation | null {
  const cli = resolveBinary("edge-tts", ["EDGE_TTS_BIN", "EDGE_TTS_PATH"]);
  if (cli !== null) {
    return { command: cli, prefix: [] };
  }
  const python = resolveBinary("python", ["PYTHON_BIN", "PYTHON_PATH"], [
    "C:\\Python312\\python.exe",
  ]);
  if (python !== null) {
    return { command: python, prefix: ["-m", "edge_tts"] };
  }
  return null;
}

/** True when Edge-TTS can be invoked at all, so callers can plan their fallback before rendering. */
export function edgeTtsAvailable(): boolean {
  return edgeTtsInvocation() !== null;
}

/** Synthesizes narration to `outFile` and returns its measured duration. */
export async function synthesizeVoiceover(options: VoiceoverOptions): Promise<VoiceoverResult> {
  const invocation = edgeTtsInvocation();
  if (invocation === null) {
    throw new ToolchainError(
      "edge-tts is not installed; `pip install edge-tts` or set EDGE_TTS_BIN",
      "edge-tts",
      -1,
      "",
    );
  }
  const text = options.text.trim();
  if (text === "") {
    throw new ToolchainError("voiceover script is empty", "edge-tts", -1, "");
  }
  const voice = options.voice?.trim() || DEFAULT_VOICE;
  ensureDir(dirname(options.outFile));

  const args = [
    ...invocation.prefix,
    "--voice",
    voice,
    "--rate",
    options.rate ?? "+0%",
    "--pitch",
    options.pitch ?? "+0Hz",
    "--text",
    text,
    "--write-media",
    options.outFile,
  ];
  await runChecked(invocation.command, args, { timeoutMs: options.timeoutMs ?? 180_000 });

  if (!existsSync(options.outFile)) {
    throw new ToolchainError("edge-tts produced no media file", invocation.command, -1, "");
  }
  return { path: options.outFile, seconds: await probeDuration(options.outFile), voice, provider: "edge-tts" };
}

/**
 * Writes a silent AAC track of exactly `seconds`.
 *
 * This is the offline rung: it keeps the assembly, watermarking and metadata stages exercisable on
 * a machine without Edge-TTS, and the returned `provider` marks the result as un-narrated.
 */
export async function synthesizeSilence(outFile: string, seconds: number): Promise<VoiceoverResult> {
  ensureDir(dirname(outFile));
  // MP3 cannot carry AAC, so the container decides the codec. The caller names the file.
  const codec = outFile.toLowerCase().endsWith(".mp3")
    ? ["-c:a", "libmp3lame", "-b:a", "192k"]
    : ["-c:a", "aac", "-b:a", "192k"];
  await runChecked(
    ffmpegBinary(),
    [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-t",
      seconds.toFixed(3),
      "-ar",
      "44100",
      "-ac",
      "2",
      ...codec,
      outFile,
    ],
    { timeoutMs: 120_000 },
  );
  return { path: outFile, seconds, voice: DEFAULT_VOICE, provider: "silence" };
}

/** Best-effort voiceover: Edge-TTS when present, otherwise a silent track. */
export async function synthesizeVoiceoverWithFallback(options: VoiceoverOptions, durationSeconds: number): Promise<VoiceoverResult> {
  try {
    return await synthesizeVoiceover(options);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await synthesizeSilence(options.outFile, durationSeconds);
    return {
      path: options.outFile,
      seconds: durationSeconds,
      voice: options.voice?.trim() || DEFAULT_VOICE,
      provider: "silence",
    };
  }
}
