/**
 * timeline — 按音频时长自动对齐并裁剪背景视频（卡点）
 *
 * 策略：
 *   1. ffprobe 读音频时长 duration（缺失时按脚本行和估算）；
 *   2. 背景视频不足时长 → 交替正序/倒序无限循环（concat demuxer）；
 *   3. 按脚本行数均分切点 → 用 select 滤镜精确裁剪 N 段 → concat 合成
 *      "卡点"视频（每段边界恰好落在旁白句切换处）。
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { probeDuration } from "./render.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function run(cmd, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} exited ${err.code}: ${(stderr || stdout || "").toString().slice(-1000)}`));
      else resolvePromise(stdout.toString());
    });
  });
}

function ensureEven(n) {
  return Math.max(2, n - (n % 2));
}

/** 估算音频时长：优先 probe，失败用脚本行总和 */
export async function estimateAudioDuration({ audio, lines }) {
  if (audio && existsSync(resolve(audio))) {
    try {
      return await probeDuration(resolve(audio));
    } catch {
      /* fall through */
    }
  }
  const sum = (lines || []).reduce((acc, l) => acc + (Number(l.duration_ms) || 0), 0);
  return sum > 0 ? sum / 1000 : 15;
}

/**
 * 生成时长 >= targetDuration 的背景视频。
 * 若素材更短，则交替正/倒放拼接至足够长（ffmpeg concat demuxer 无损循环）。
 */
export async function loopToDuration({ input, output, targetDuration }) {
  const src = resolve(input);
  const out = resolve(output);
  if (!existsSync(src)) throw new Error(`loopToDuration: input missing ${input}`);
  const sourceDur = await probeDuration(src);
  const need = Math.max(targetDuration, sourceDur) + 1;
  if (sourceDur >= need) {
    await run("ffmpeg", ["-y", "-i", src, "-c", "copy", out]);
    return { output: out, sourceDuration: sourceDur, segments: 1 };
  }

  const tmpDir = resolve(dirname(out), "work");
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(tmpDir, { recursive: true });

  // 生成倒放副本（无缝循环）
  const reversed = resolve(tmpDir, "bg_reversed.mp4");
  await run("ffmpeg", ["-y", "-i", src, "-vf", "reverse", "-af", "anull", "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p", reversed]);

  const concatList = resolve(tmpDir, "loop.txt");
  const parts = [];
  let total = 0;
  let forward = true;
  while (total < need) {
    parts.push(forward ? src : reversed);
    total += sourceDur;
    forward = !forward;
  }
  writeFileSync(concatList, parts.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"), "utf-8");
  await run("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0",
    "-i", concatList,
    "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
    out,
  ]);
  return { output: out, sourceDuration: sourceDur, segments: parts.length };
}

/**
 * 卡点切分：把背景按脚本行边界切成 N 段并拼接（切点=旁白句切换点）。
 * 输出竖屏已裁切视频，供 composeVertical 直接合成。
 */
export async function cutToScriptBeats({ input, output, lines, totalDuration }) {
  const src = resolve(input);
  const out = resolve(output);
  const duration = Number(totalDuration) || 15;
  const n = Math.max(1, (lines || []).length || 1);

  // 计算每句的起止（毫秒）
  const points = [0];
  for (const l of lines || []) {
    const end = (Number(l.start_ms) || 0) + (Number(l.duration_ms) || 0);
    if (end > points[points.length - 1]) points.push(end);
  }
  if (points[points.length - 1] < duration * 1000) points.push(duration * 1000);
  // 去重 + 排序
  const sorted = [...new Set(points.map((p) => p / 1000))].sort((a, b) => a - b);
  const cuts = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i];
    const e = sorted[i + 1];
    if (e > s) cuts.push({ start: s, end: e });
  }

  // 用 select 滤镜逐段裁切（关键帧对齐 + 精度足够）
  const segExprs = cuts
    .map((c, i) => {
      const expr = `between(t,${c.start.toFixed(3)},${c.end.toFixed(3)})`;
      return `[0:v]trim=start=${c.start.toFixed(3)}:end=${c.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}];`;
    })
    .join("");
  const concatPart = cuts.map((_, i) => `[v${i}]`).join("");
  const vf = `${segExprs}${concatPart}concat=n=${cuts.length}:v=1:a=0[vout]`;

  const tmpDir = resolve(dirname(out), "work");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(tmpDir, { recursive: true });

  await run("ffmpeg", [
    "-y", "-i", src,
    "-filter_complex", vf,
    "-map", "[vout]",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
    out,
  ]);
  return { output: out, cuts: cuts.map((c) => ({ ...c })), total: duration };
}

/** 统一入口：背景 → 循环 → 卡点切分 */
export async function buildTimeline({ background, output, lines, audio }) {
  const duration = await estimateAudioDuration({ audio, lines });
  const tmpDir = resolve(dirname(output), "work");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(tmpDir, { recursive: true });

  const looped = resolve(tmpDir, "bg_looped.mp4");
  await loopToDuration({ input: background, output: looped, targetDuration: duration });
  const beat = resolve(tmpDir, "bg_beats.mp4");
  const cut = await cutToScriptBeats({ input: looped, output: beat, lines, totalDuration: duration });
  return { ...cut, durationSeconds: duration };
}

export { ROOT };
