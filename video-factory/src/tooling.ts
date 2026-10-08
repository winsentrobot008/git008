/**
 * Process and binary-resolution helpers shared by every Video Factory v2 stage.
 *
 * This mirrors the resolution order the Python factory already uses (`src/core/ffmpeg.py`):
 * an explicit environment override, then a repository-local bundle, then `PATH`. NVENC detection is
 * capability-probing rather than assumption - a machine can list `h264_nvenc` and still fail to
 * encode with it, so callers treat hardware encoding as an attempt with a software fallback.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { EncoderKind } from "./types.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
/** `video-factory` package directory, whether running from `src/` or `dist/`. */
export const PACKAGE_DIR = resolve(MODULE_DIR, "..");
/** Repository root; the pipeline resolves `008/`, ComfyUI workflows and the frontend from here. */
export const REPO_ROOT = resolve(PACKAGE_DIR, "..");

/** Raised when an external tool is missing or exits non-zero. */
export class ToolchainError extends Error {
  readonly command: string;
  readonly code: number;
  readonly stderr: string;

  constructor(message: string, command: string, code: number, stderr: string) {
    super(message);
    this.name = "ToolchainError";
    this.command = command;
    this.code = code;
    this.stderr = stderr;
  }
}

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  input?: string;
}

export interface CommandResult {
  command: string;
  args: string[];
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Removes credentials and API keys from text that is about to be logged or surfaced in an error.
 *
 * Child-process stderr frequently echoes the full invocation, so redaction happens here rather
 * than at each log site.
 */
export function redact(text: string): string {
  return text
    .replace(/([?&][^=&#\s]*(?:key|token|secret|password|auth|sig|signature)[^=&#\s]*=)[^&#\s]+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk|AIza|gsk)-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED]")
    .replace(/(https?:\/\/)([^/@\s]+)@/g, "$1[REDACTED]@");
}

/** Runs a process to completion, capturing stdout/stderr. Never rejects on a non-zero exit. */
export function run(command: string, args: readonly string[], options: CommandOptions = {}): Promise<CommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          if (!settled) {
            child.kill();
            settled = true;
            rejectPromise(new ToolchainError(`timed out after ${options.timeoutMs}ms`, command, -1, redact(stderr)));
          }
        }, options.timeoutMs)
      : undefined;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      rejectPromise(new ToolchainError(`cannot launch ${command}: ${error.message}`, command, -1, ""));
    });
    child.on("close", (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolvePromise({ command, args: [...args], code: code ?? -1, stdout, stderr });
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

/** Runs a process and throws a redacted {@link ToolchainError} on a non-zero exit. */
export async function runChecked(
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    const tail = redact(result.stderr).trim().split("\n").slice(-6).join("\n");
    throw new ToolchainError(
      `${command} exited with code ${result.code}${tail ? `:\n${tail}` : ""}`,
      command,
      result.code,
      redact(result.stderr),
    );
  }
  return result;
}

/** Scans `PATH` for an executable, honouring the platform's executable suffix. */
function searchPath(name: string): string | null {
  const suffixes = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const entries = (process.env.PATH ?? "").split(delimiter).filter((entry) => entry !== "");
  for (const entry of entries) {
    for (const suffix of suffixes) {
      const candidate = join(entry, `${name}${suffix}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

/**
 * Resolves an external binary: environment overrides first (absolute, or relative to the repo
 * root), then caller-supplied candidates, then `PATH`.
 */
export function resolveBinary(name: string, envKeys: readonly string[], candidates: readonly string[] = []): string | null {
  for (const key of envKeys) {
    const raw = process.env[key]?.trim();
    if (!raw) {
      continue;
    }
    const direct = isAbsolute(raw) ? raw : resolve(REPO_ROOT, raw);
    if (existsSync(direct)) {
      return direct;
    }
    const inBin = join(direct, `${name}${process.platform === "win32" ? ".exe" : ""}`);
    if (existsSync(inBin)) {
      return inBin;
    }
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return searchPath(name);
}

/** Resolves a binary or throws with the environment keys that would have configured it. */
export function requireBinary(name: string, envKeys: readonly string[], candidates: readonly string[] = []): string {
  const resolved = resolveBinary(name, envKeys, candidates);
  if (resolved === null) {
    throw new ToolchainError(
      `cannot find ${name}; install it on PATH or set ${envKeys.join(" / ")}`,
      name,
      -1,
      "",
    );
  }
  return resolved;
}

/** Resolves FFmpeg using the same override contract as the Python factory. */
export function ffmpegBinary(): string {
  return requireBinary("ffmpeg", ["FFMPEG_PATH", "FFMPEG_BIN"], [
    join(REPO_ROOT, "runtime_data", "video-runtime", "ffmpeg", "bin", "ffmpeg.exe"),
  ]);
}

/** Resolves ffprobe using the same override contract as the Python factory. */
export function ffprobeBinary(): string {
  return requireBinary("ffprobe", ["FFPROBE_PATH", "FFPROBE_BIN"], [
    join(REPO_ROOT, "runtime_data", "video-runtime", "ffmpeg", "bin", "ffprobe.exe"),
  ]);
}

const nvencCache = new Map<string, boolean>();

/** True when the resolved FFmpeg advertises the H.264 NVENC encoder and it has not been disabled. */
export async function nvencEnabled(ffmpeg: string): Promise<boolean> {
  const disabled = ["1", "true", "yes"].includes((process.env.FFMPEG_DISABLE_NVENC ?? "").trim().toLowerCase());
  if (disabled) {
    return false;
  }
  const cached = nvencCache.get(ffmpeg);
  if (cached !== undefined) {
    return cached;
  }
  let available = false;
  try {
    const result = await run(ffmpeg, ["-hide_banner", "-encoders"]);
    available = /h264_nvenc/.test(result.stdout);
  } catch {
    available = false;
  }
  nvencCache.set(ffmpeg, available);
  return available;
}

const NVENC_PRESETS: Record<string, string> = {
  ultrafast: "p1",
  superfast: "p1",
  veryfast: "p2",
  faster: "p3",
  fast: "p4",
  medium: "p5",
  slow: "p6",
  slower: "p7",
  veryslow: "p7",
};

/** Video-encoder arguments: `h264_nvenc` when requested, otherwise `libx264`. */
export function encoderArgs(crf: number, preset: string, useNvenc: boolean): string[] {
  if (useNvenc) {
    return ["-c:v", "h264_nvenc", "-preset", NVENC_PRESETS[preset] ?? "p4", "-rc", "vbr", "-cq", String(crf), "-b:v", "0"];
  }
  return ["-c:v", "libx264", "-preset", preset, "-crf", String(crf)];
}

/**
 * Encodes with NVENC when it is advertised, retrying in software if the hardware attempt fails.
 *
 * Encoder presence is not runtime readiness: the drivers can expose `h264_nvenc` and still refuse
 * a session. The retry is therefore unconditional, and the caller learns which path won.
 */
export async function encode(inputArgs: readonly string[], outputFile: string): Promise<EncoderKind> {
  const ffmpeg = ffmpegBinary();
  const hardware = await nvencEnabled(ffmpeg);
  const attempts: boolean[] = hardware ? [true, false] : [false];
  let lastError: unknown;

  for (const useNvenc of attempts) {
    const args = ["-y", ...(useNvenc ? ["-hwaccel", "cuda"] : []), ...inputArgs, ...encoderArgs(23, "fast", useNvenc), outputFile];
    try {
      await runChecked(ffmpeg, args, { timeoutMs: 30 * 60 * 1000 });
      return useNvenc ? "h264_nvenc" : "libx264";
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new ToolchainError("ffmpeg encode failed", ffmpeg, -1, "");
}

/** Media duration in seconds via ffprobe. */
export async function probeDuration(file: string): Promise<number> {
  const ffprobe = ffprobeBinary();
  const result = await runChecked(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const seconds = Number.parseFloat(result.stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new ToolchainError(`ffprobe reported a non-positive duration for ${file}`, ffprobe, -1, result.stdout);
  }
  return seconds;
}

/** Creates a directory tree if it does not exist yet. */
export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}