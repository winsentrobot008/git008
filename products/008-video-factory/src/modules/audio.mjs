/**
 * audio — Edge-TTS 旁白生成 + Pydub 音频混音（封装 VOICE22 src/generate.py 逻辑）
 *
 * 能力：
 *   - narration({ lines, output, mode }): 多句旁白按时间轴合成单轨 MP3
 *   - probeDuration(file): ffprobe 读取音频时长（timeline 对齐用）
 *   - fallbackTone({ output, durationMs }): 纯 ffmpeg 正弦占位（离线兜底）
 *
 * 运行时依赖（可选）：
 *   - Python 3 + edge-tts + pydub：真实 TTS 与混音
 *   - ffmpeg：时长探测 / 占位音
 * 缺失时返回可读错误，不静默产出空文件。
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HELPER = resolve(ROOT, "scripts", "voice_mix_helper.py");

export function findPython() {
  for (const cmd of ["python", "python3", "py"]) {
    try {
      const out = execFileSync(cmd, ["--version"], { stdio: "pipe" });
      if (out.toString()) return cmd;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function findFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "pipe" });
    return "ffmpeg";
  } catch {
    return null;
  }
}

function run(cmd, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        const detail = (stderr || stdout || "").toString().slice(-1200);
        reject(new Error(`${cmd} exited ${err.code}: ${detail}`));
        return;
      }
      resolvePromise(stdout.toString());
    });
  });
}

/**
 * 生成旁白 MP3。
 * @param {{lines: Array<{text: string, voice?: string, start_ms?: number, duration_ms?: number, gain_db?: number, pitch?: number}>, output: string, mode?: "auto"|"sine"}} opts
 */
export async function narration({ lines, output, mode = "auto" }) {
  if (!lines?.length) throw new Error("narration: lines is empty");
  const out = resolve(output);
  const python = findPython();
  if (!python) throw new Error("narration: Python not found (edge-tts/pydub unavailable)");

  const payload = JSON.stringify({ lines, output: out, mode });
  const result = await new Promise((resolvePromise, reject) => {
    const child = execFile(
      python,
      [HELPER],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error((stderr || err.message).toString().slice(-1200)));
          return;
        }
        resolvePromise(stdout.toString());
      }
    );
    child.stdin.end(payload);
  });

  if (!existsSync(out)) throw new Error(`narration: output missing ${out}`);
  return { output: out, log: result.trim().split("\n").slice(-3) };
}

/** ffprobe 音频时长（秒） */
export async function probeDuration(file) {
  const target = resolve(file);
  const out = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    target,
  ]);
  const n = Number(out.trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error(`probeDuration: invalid duration for ${file}`);
  return n;
}

/** 纯 ffmpeg 生成正弦占位音（Edge-TTS 不可用时的最后兜底） */
export async function fallbackTone({ output, durationMs = 3000, freq = 220 }) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error("fallbackTone: ffmpeg not found");
  const seconds = (durationMs / 1000).toFixed(3);
  await run(ffmpeg, [
    "-y",
    "-f", "lavfi",
    "-i", `sine=frequency=${freq}:duration=${seconds}`,
    "-c:a", "libmp3lame",
    "-b:a", "128k",
    resolve(output),
  ]);
  return { output: resolve(output) };
}
