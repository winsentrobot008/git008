/**
 * render — FFmpeg 核心命令（封装 RoastBro tools/video/auto_reframe.py + remotion_caption_burn.py）
 *
 * 保留能力：
 *   - 480x480 1:1 正方形低清预览（默认：crop=min(iw,ih) → scale=480:480）
 *   - 9:16 竖屏裁切（中心裁切 crop → scale 1080x1920）
 *   - ASS 字幕烧录（subtitles 滤镜，libass）
 *   - 音视频合成（-shortest + aac）
 *   - ffmpeg 生成渐变背景（素材缺失时兜底）
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

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
    execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} exited ${err.code}: ${(stderr || stdout || "").toString().slice(-1500)}`));
        return;
      }
      resolvePromise(stdout.toString());
    });
  });
}

/** 读取视频尺寸（ffprobe） */
export async function probeSize(file) {
  const out = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0:s=x",
    resolve(file),
  ]);
  const [w, h] = out.trim().split("x").map(Number);
  if (!w || !h) throw new Error(`probeSize: invalid video ${file}`);
  return { width: w, height: h };
}

/** 读取音频时长（秒） */
export async function probeDuration(file) {
  const out = await run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    resolve(file),
  ]);
  const n = Number(out.trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error(`probeDuration: invalid duration for ${file}`);
  return n;
}

/**
 * 9:16 竖屏裁切 + 音视频合成。
 * 采用 RoastBro auto_reframe 的静态中心裁切策略：
 *   crop=w:h:x:y（保持目标比例）→ scale=1080:1920 → 混音 → aac。
 */
export async function composeVertical({
  input,
  output,
  audio,
  subtitles,
  width = 1080,
  height = 1920,
  mode = "vertical",
  crf = 20,
  preset = "fast",
}) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error("composeVertical: ffmpeg not found");
  const out = resolve(output);
  mkdirSync(dirname(out), { recursive: true });
  if (!existsSync(resolve(input))) throw new Error(`composeVertical: input missing ${input}`);
  if (!existsSync(resolve(audio))) throw new Error(`composeVertical: audio missing ${audio}`);

  const { width: sw, height: sh } = await probeSize(input);
  let vf;
  if (mode === "square") {
    // 1:1 正方形：取短边居中裁切 → 缩放 480x480
    vf = `crop=min(iw\\,ih):min(iw\\,ih),scale=${width}:${height}`;
  } else {
    // 9:16 竖屏：目标比例 9:16；源更宽则裁高，源更高则裁宽（保持中心）
    const targetRatio = width / height;
    const srcRatio = sw / sh;
    let cropW, cropH;
    if (targetRatio > srcRatio) {
      cropW = sw;
      cropH = Math.floor(sw / targetRatio);
    } else {
      cropH = sh;
      cropW = Math.floor(sh * targetRatio);
    }
    cropW -= cropW % 2;
    cropH -= cropH % 2;
    const cropX = Math.floor((sw - cropW) / 2);
    const cropY = Math.floor((sh - cropH) / 2);
    vf = `crop=${cropW}:${cropH}:${cropX}:${cropY},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`;
  }

  if (subtitles && existsSync(resolve(subtitles))) {
    const ass = resolve(subtitles).replace(/\\/g, "/").replace(/:/g, "\\:");
    vf += `,subtitles='${ass}'`;
  }

  await run(ffmpeg, [
    "-y",
    "-i", resolve(input),
    "-i", resolve(audio),
    "-vf", vf,
    "-c:v", "libx264", "-preset", preset, "-crf", String(crf), "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k",
    "-shortest",
    "-movflags", "+faststart",
    out,
  ]);
  if (!existsSync(out)) throw new Error("composeVertical: output missing");
  return { output: out };
}

/**
 * 生成竖屏渐变背景视频（素材缺失兜底）。
 * 原逻辑参考 RoastBro fallback_video 的 lavfi 方案，改用更利于投放的粉紫渐变。
 */
export async function generateBackground({ output, durationSeconds = 15 }) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error("generateBackground: ffmpeg not found");
  const out = resolve(output);
  mkdirSync(dirname(out), { recursive: true });
  const dur = Number.isFinite(durationSeconds) ? durationSeconds : 15;
  await run(ffmpeg, [
    "-y",
    "-f", "lavfi",
    "-i", `gradients=s=1080x1920:d=${dur}:c0=0xEC4899:c1=0x8B5CF6:c2=0x1E1B4B:x0=0:y0=0:x1=1080:y1=1920`,
    "-f", "lavfi",
    "-i", `anullsrc=r=44100:cl=stereo`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest",
    out,
  ]);
  if (!existsSync(out)) throw new Error("generateBackground: output missing");
  return { output: out };
}

/**
 * 多段真人素材拼接：每段先循环补足目标时长，再统一 1080x1920（或 480x480）
 * 后按序 concat，输出一段连续背景视频（供 timeline 卡点 / PIP 使用）。
 * @param {{videos: Array<string>, output: string, targetDuration: number, width?: number, height?: number}} opts
 */
export async function concatSegments({ videos, output, targetDuration = 15, width = 1080, height = 1920 }) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error("concatSegments: ffmpeg not found");
  const out = resolve(output);
  mkdirSync(dirname(out), { recursive: true });
  if (!videos?.length) throw new Error("concatSegments: videos empty");

  const per = targetDuration / videos.length;
  // 用 -stream_loop 输入循环避免 loop 滤镜 size 上限（32767 帧）
  const parts = [];
  const chain = [];
  const inputs = [];
  for (let i = 0; i < videos.length; i++) {
    const src = resolve(videos[i]);
    if (!existsSync(src)) throw new Error(`concatSegments: input missing ${src}`);
    const srcDur = await probeDuration(src);
    const loopTimes = Math.max(1, Math.ceil(per / Math.max(srcDur, 0.1)) + 1);
    inputs.push("-stream_loop", String(loopTimes), "-i", src);
    chain.push(
      `[${i}:v]trim=duration=${per.toFixed(3)},setpts=PTS-STARTPTS,` +
        `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black[v${i}]`
    );
    parts.push(`[v${i}]`);
  }
  const filter = chain.join(";") + `;${parts.join("")}concat=n=${videos.length}:v=1:a=0[vout]`;
  await run(ffmpeg, [
    "-y", ...inputs,
    "-filter_complex", filter,
    "-map", "[vout]",
    "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
    out,
  ]);
  if (!existsSync(out)) throw new Error("concatSegments: output missing");
  return { output: out, segments: videos.length, perSegment: per };
}

/**
 * PIP 画中画：真人背景 + UI 录屏悬浮（默认底部居中，45% 宽，圆角 + 白边）。
 * @param {{background: string, overlay: string, output: string, width?: number, height?: number,
 *          overlayWidthRatio?: number, position?: "bottom"|"center"}} opts
 */
export async function composePip({
  background,
  overlay,
  output,
  duration,
  width = 1080,
  height = 1920,
  overlayWidthRatio = 0.45,
  position = "bottom",
}) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error("composePip: ffmpeg not found");
  const out = resolve(output);
  mkdirSync(dirname(out), { recursive: true });
  if (!existsSync(resolve(background))) throw new Error(`composePip: background missing ${background}`);
  if (!existsSync(resolve(overlay))) throw new Error(`composePip: overlay missing ${overlay}`);

  const pipW = Math.round(width * overlayWidthRatio);
  const pipH = Math.round(pipW * (844 / 390)); // 录屏 390x844 比例
  // 直接算像素坐标，避免 ffmpeg 表达式括号转义问题
  const x = Math.round((width - pipW) / 2);
  const y = position === "center" ? Math.round((height - pipH) / 2) : height - pipH - Math.round(height * 0.08);
  const r = Math.min(24, Math.round(pipW * 0.1)); // 圆角半径
  // 背景时长（用于 UI 画中画循环对齐；缺省取背景实际时长）
  const bgDur = duration || (await probeDuration(resolve(background)));

  const filter =
    // loop 滤镜在画布内循环 UI 录屏（size 上限 32767 帧 > 65s@25fps）；
    // tpad=stop_mode=clone 将末帧延展（86400s≈无限），确保任何时刻都有有效画面，
    // 杜绝 Alpha 空白 / 白框底色暴露；总时长由输出 -t 与 shortest=1 收敛
    `[1:v]loop=loop=-1:size=32767:start=0,` +
    `trim=duration=${bgDur.toFixed(3)},setpts=PTS-STARTPTS,` +
    `tpad=stop_mode=clone:stop_duration=86400,` +
    `scale=${pipW}:${pipH},format=rgba,` +
    `geq=r='if(lte(abs(X-(${pipW}/2)),(${pipW}/2)-${r})*lte(abs(Y-(${pipH}/2)),(${pipH}/2)-${r})` +
    `+lte(hypot(abs(X-(${pipW}/2))-(${pipW}/2-${r}),abs(Y-(${pipH}/2))-(${pipH}/2-${r})),${r}),255,0)':` +
    `a='if(lte(abs(X-(${pipW}/2)),(${pipW}/2)-${r})*lte(abs(Y-(${pipH}/2)),(${pipH}/2)-${r})` +
    `+lte(hypot(abs(X-(${pipW}/2))-(${pipW}/2-${r}),abs(Y-(${pipH}/2))-(${pipH}/2-${r})),${r}),255,0)'[pip];` +
    `[0:v][pip]overlay=${x}:${y}:shortest=1,` +
    `drawbox=x=${x}:y=${y}:w=${pipW}:h=${pipH}:color=white@0.85:t=3[vout]`;

  await run(ffmpeg, [
    "-y",
    "-i", resolve(background),
    "-i", resolve(overlay),
    "-filter_complex", filter,
    "-map", "[vout]",
    "-t", bgDur.toFixed(3),
    "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
    out,
  ]);
  if (!existsSync(out)) throw new Error("composePip: output missing");
  return { output: out, pipW, pipH };
}

/**
 * 生成 ASS 字幕（RoastBro remotion_caption_burn 的 FFmpeg fallback 风格）。
 * 位置：底部（MarginV=100），白字描边，逐行显示。
 */
export function buildAssFromScript(script, durationSeconds = 15, width = 480, height = 480) {
  const lines = Array.isArray(script) ? script : [script];
  const n = lines.length || 1;
  const per = durationSeconds / n;
  // 480x480 画布：字号按 1080p 的 54 等比缩小至 24，底边距同步缩小
  const fontScale = Math.min(width, height) / 1080;
  const fontSize = Math.max(16, Math.round(54 * fontScale));
  const marginV = Math.max(24, Math.round(140 * fontScale));
  const header = `[Script Info]
Title: 008-video-factory
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Segoe UI,${fontSize},&H00FFFFFF,&H000000FF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,${Math.round(60 * fontScale)},${Math.round(60 * fontScale)},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = lines
    .map((item, i) => {
      const text = (typeof item === "string" ? item : item.text || item.hook || "").replace(/\n/g, "\\N");
      const startSec = i * per;
      const endSec = Math.min(startSec + per, durationSeconds);
      const toTs = (s) => {
        const h = String(Math.floor(s / 3600)).padStart(1, "0");
        const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
        const sec = String(Math.floor(s % 60)).padStart(2, "0");
        const cs = String(Math.floor((s % 1) * 100)).padStart(2, "0");
        return `${h}:${m}:${sec}.${cs}`;
      };
      return `Dialogue: 0,${toTs(startSec)},${toTs(endSec)},Default,,0,0,0,,${text}`;
    })
    .join("\n");
  return `${header}${events}\n`;
}

export function writeAssFile(script, outputPath, durationSeconds = 15, width = 480, height = 480) {
  const out = resolve(outputPath);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buildAssFromScript(script, durationSeconds, width, height), "utf-8");
  return out;
}
