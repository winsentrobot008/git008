/**
 * 008-video-factory — Prompt 驱动的自动化视频工厂（统一 CLI 入口）
 *
 * 流水线：脚本 → 语音 → 素材（UI 录屏优先）→ 卡点 → 字幕 → 合成
 *
 * 用法：
 *   单条： node src/index.mjs --target calorie-ai [--autocapture] [--full]
 *   批量： node src/index.mjs --batch config.json
 *          node src/index.mjs --count 3 --target calorie-ai
 *
 * 产出归档：products/008-video-factory/output/{product}_{hook_id}_{resolution}_{timestamp}.mp4
 *
 * 模块来源：
 *   audio.mjs    ← VOICE22（Edge-TTS + Pydub）
 *   render.mjs   ← RoastBro（FFmpeg 9:16/1:1 裁切 + ASS 烧录）
 *   media.mjs    ← MediaIndexerPro（Pexels 检索 + 本地素材匹配）
 *   recorder.mjs ← Playwright 自动 UI 录屏（自建）
 *   script.mjs   ← 自建（CalorieAI / 008AI Pass 15s Hook + A/B 变体）
 *   timeline.mjs ← 自建（音频时长驱动卡点切分）
 *   batch.mjs    ← 自建（量产 / A/B 批处理）
 */

import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { narration, fallbackTone, probeDuration as probeAudio } from "./modules/audio.mjs";
import {
  composeVertical,
  composePip,
  concatSegments,
  generateBackground,
  probeDuration as probeVideo,
  writeAssFile,
} from "./modules/render.mjs";
import { selectMedia, stockVideosForLines } from "./modules/media.mjs";
import { generateScript, listTargets } from "./modules/script.mjs";
import { buildTimeline } from "./modules/timeline.mjs";
import { hasRecording, recordCalorieUi, recordingPath } from "./modules/recorder.mjs";
import { runBatch } from "./modules/batch.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = resolve(ROOT, "output");
const WORK_DIR = resolve(ROOT, "work");
const DEFAULT_MEDIA_DIR = resolve(ROOT, "media");
const REPO_ROOT = resolve(ROOT, "..", "..");
const INSPECTOR_CLI = resolve(REPO_ROOT, "src", "core", "inspector.py");
const INSPECTOR_LOG = resolve(REPO_ROOT, "runtime_data", "logs", "inspector.log");

/**
 * 渲染产物质检门禁：ffprobe 校验通过 → 落盘 output/；失败 → 记录日志并拦截。
 * @param {{staged: string, final: string, width: number, height: number, fps?: number, requireAudio?: boolean}} opts
 */
function inspectAndFinalize({ staged, final, width, height, fps, requireAudio = true }) {
  const py = process.env.PYTHON || "python";
  const args = [
    INSPECTOR_CLI,
    staged,
    "--width", String(width),
    "--height", String(height),
    "--fps", String(fps ?? 0),
  ];
  if (!requireAudio) args.push("--allow-no-audio");

  const proc = spawnSync(py, args, { encoding: "utf-8", timeout: 300_000 });
  let report = null;
  try {
    const out = (proc.stdout || "").trim();
    const start = out.indexOf("{");
    const end = out.lastIndexOf("}");
    if (start !== -1 && end > start) report = JSON.parse(out.slice(start, end + 1));
  } catch {
    report = null;
  }

  const passed = proc.status === 0 && report?.ok === true;
  if (!passed) {
    const tail = (proc.stderr || proc.stdout || "").slice(-1200);
    console.error(`[inspector] ❌ 质检未通过，已拦截 ${staged}`);
    if (report) console.error(`[inspector] 问题: ${(report.issues || []).join("; ")}`);
    else console.error(`[inspector] 输出: ${tail}`);
    throw new Error(
      `ffprobe 质检拦截：${staged} 未通过（详情见 ${INSPECTOR_LOG}）`
    );
  }

  mkdirSync(dirname(final), { recursive: true });
  renameSync(staged, final);
  console.log(
    `[inspector] ✅ 质检通过（${report.video.width}x${report.video.height} @ ${Number(report.video.fps).toFixed(2)}fps · av偏差 ≤0.2s · 无黑屏/静音断层）→ ${final}`
  );
  return report;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (["--target", "--text", "--media-dir", "--url", "--batch", "--count", "--product", "--hook", "--background", "--resolution", "--source"].includes(a)) {
      args[a.slice(2)] = a === "--count" ? Number(argv[i + 1]) : argv[i + 1];
      i++;
    } else if (
      a === "--mock-voice" || a === "--no-subtitles" || a === "--no-pexels" ||
      a === "--full" || a === "--hd" || a === "--autocapture" || a === "--help"
    ) {
      args[a.slice(2)] = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`008-video-factory — Prompt 驱动的自动化视频工厂

Usage:
  node src/index.mjs --target <target> [options]      # 单条
  node src/index.mjs --batch config.json              # 批量（配置文件）
  node src/index.mjs --count N --target <target>      # 批量（N 条 A/B 变体，默认 1）

Targets:
  ${listTargets().join(", ")}

Options:
  --target <name>     hook 模板（calorie-ai | 008ai-pass）
  --text "<sentence>" 自定义单句旁白（覆盖内置 hook）
  --product <name>    归档产品名（输出文件名前缀，默认取 target）
  --hook <id>         hook 编号（默认 default）
  --resolution <res>  480x480 | 1080x1920（默认 480x480；--full/--hd 等价 1080x1920）
  --source <mode>      ui（UI 录屏）| pexels（真人素材）| hybrid（真人 + UI 画中画）
  --background <mode>  ui | generated | auto（默认 ui：优先 UI 录屏）
  --batch <file>      批量 JSON 配置（hooks + jobs，支持多文案/多音色/多画幅）
  --count <n>         对目标批量生成 n 条 A/B 变体（默认 1；不传 --count/--batch 时仅单条出片）
  --url <url>         录屏目标地址（默认 https://calorie-ai-seven.vercel.app）
  --autocapture       强制重新 Playwright 录屏 UI
  --mock-voice        跳过 Edge-TTS，使用正弦占位音（离线测试）
  --no-pexels         不调用 Pexels API
  --no-subtitles      不烧录 ASS 字幕
  --help              显示本帮助`);
}

function ts() {
  return new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
}

async function makeVoice(lines, output, mock) {
  if (!mock) {
    try {
      const r = await narration({ lines, output, mode: "auto" });
      console.log(`[voice] Edge-TTS narration → ${r.output}`);
      return { path: r.output, engine: "edge-tts+pydub" };
    } catch (err) {
      console.warn(`[voice] Edge-TTS 不可用（${err.message.slice(0, 160)}），回退正弦占位音`);
    }
  } else {
    console.log("[voice] --mock-voice：使用正弦占位音");
  }
  const totalMs = Math.max(
    1000,
    lines.reduce((acc, l) => Math.max(acc, (Number(l.start_ms) || 0) + (Number(l.duration_ms) || 0)), 0)
  );
  await fallbackTone({ output, durationMs: totalMs });
  return { path: output, engine: "ffmpeg-sine" };
}

async function downloadToFile(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outPath, buf);
  return outPath;
}

function resolveResolution(res) {
  const key = String(res || "480x480").toLowerCase();
  if (key.includes("1080") || key === "hd" || key === "full" || key.includes("9:16")) {
    return { width: 1080, height: 1920, label: "1080x1920", mode: "vertical", preset: "fast" };
  }
  return { width: 480, height: 480, label: "480x480", mode: "square", preset: "ultrafast" };
}

function normProduct(name) {
  return String(name || "calorieai").toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

/**
 * 单任务渲染管线（单跑与批量共用）。
 * @param {{target?: string, product?: string, hookId?: string, text?: string,
 *          lines?: Array<{text: string, voice?: string, lang?: string, duration_ms?: number, start_ms?: number}>,
 *          lang?: string, resolution?: string, background?: "ui"|"generated"|"auto",
 *          source?: "ui"|"pexels"|"hybrid"}} job
 * @param {{mockVoice?: boolean, noPexels?: boolean, noSubtitles?: boolean, url?: string, autocapture?: boolean}} flags
 */
export async function renderJob(job = {}, flags = {}) {
  const target = job.target || "calorie-ai";
  const product = normProduct(job.product || target);
  const hookId = job.hookId || "default";
  const resolution = resolveResolution(job.resolution);
  const backgroundMode = job.background || "ui";
  const sourceMode = job.source || (backgroundMode === "generated" ? "generated" : "ui");
  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync(WORK_DIR, { recursive: true });

  // 1. 脚本（支持批量多音色 lines 覆盖）
  const script = generateScript({
    target,
    text: job.text,
    lines: job.lines,
    lang: job.lang,
  });
  console.log(`\n[script] product=${product} hook=${hookId} target=${script.target} · ${script.lines.length} 句旁白`);
  for (const l of script.lines) console.log(`  - [${l.start_ms}ms] ${l.voice} ${l.text}`);

  // 2. 语音
  const voiceOut = resolve(WORK_DIR, `${product}_${hookId}_voice.mp3`);
  const voice = await makeVoice(script.lines, voiceOut, Boolean(flags.mockVoice));
  const voiceDuration = await probeAudio(voice.path).catch(() => 15);
  console.log(`[voice] engine=${voice.engine} · duration=${voiceDuration.toFixed(2)}s`);

  // 3. 素材：source 决定背景来源（ui 录屏 / pexels 真人 / hybrid 真人+PIP）
  const uiPath = recordingPath(product);
  const forceGenerated = sourceMode === "generated" || backgroundMode === "generated";
  let uiRecordingPath = null;
  if (!forceGenerated && sourceMode !== "pexels" && (flags.autocapture || !hasRecording(product))) {
    try {
      const rec = await recordCalorieUi({ url: flags.url, product });
      uiRecordingPath = rec.output;
    } catch (err) {
      console.warn(`[recorder] 录屏失败（${err.message.slice(0, 160)}），继续使用其他素材`);
    }
  } else if (!forceGenerated && sourceMode !== "pexels" && hasRecording(product)) {
    uiRecordingPath = uiPath;
    console.log(`[recorder] 复用已有录屏: ${uiPath}`);
  }

  let bgPath = null;
  if (sourceMode === "pexels" || sourceMode === "hybrid") {
    // 真人素材：按旁白段数抓取 → 拼接为连续背景
    console.log(`[stock] 抓取真人素材（${script.lines.length} 段）…`);
    const stocks = await stockVideosForLines(script.lines, { force: false });
    const res = resolveResolution(job.resolution);
    const merged = resolve(WORK_DIR, `${product}_${hookId}_stock.mp4`);
    await concatSegments({
      videos: stocks.map((s) => s.path),
      output: merged,
      targetDuration: voiceDuration,
      width: res.width,
      height: res.height,
    });
    bgPath = merged;
    if (sourceMode === "hybrid") {
      // 画中画：真人背景 + UI 录屏悬浮
      if (!uiRecordingPath) {
        uiRecordingPath = uiPath;
        if (!existsSync(uiPath)) {
          const rec = await recordCalorieUi({ url: flags.url, product });
          uiRecordingPath = rec.output;
        }
      }
      const pipOut = resolve(WORK_DIR, `${product}_${hookId}_pip.mp4`);
      await composePip({
        background: merged,
        overlay: uiRecordingPath,
        output: pipOut,
        duration: voiceDuration,
        width: res.width,
        height: res.height,
        overlayWidthRatio: 0.45,
        position: "bottom",
      });
      bgPath = pipOut;
    }
  } else if (uiRecordingPath && existsSync(uiRecordingPath)) {
    console.log(`[media] 使用 UI 录屏背景: ${uiRecordingPath}`);
    bgPath = uiRecordingPath;
  } else if (forceGenerated) {
    console.log("[media] background=generated：ffmpeg 生成粉紫渐变背景");
    bgPath = resolve(WORK_DIR, `bg_${product}.mp4`);
    await generateBackground({ output: bgPath, durationSeconds: 20 });
  } else {
    const selection = await selectMedia({
      keywords: script.keywords,
      localDirs: [DEFAULT_MEDIA_DIR].filter((d) => existsSync(d)),
      usePexels: !flags.noPexels,
    });
    if (selection.kind === "local") {
      console.log(`[media] 本地素材: ${selection.item.path}`);
      bgPath = selection.item.path;
    } else if (selection.kind === "pexels" && selection.item?.url) {
      console.log(`[media] Pexels: ${selection.item.title}`);
      const ext = selection.item.url.split("?")[0].split(".").pop() || "mp4";
      const dl = resolve(WORK_DIR, `${product}_${hookId}_pexels.${ext}`);
      try {
        await downloadToFile(selection.item.url, dl);
        bgPath = dl;
      } catch (err) {
        console.warn(`[media] Pexels 下载失败（${err.message.slice(0, 120)}），改用生成背景`);
        bgPath = resolve(WORK_DIR, `bg_${product}.mp4`);
        await generateBackground({ output: bgPath, durationSeconds: 20 });
      }
    } else {
      console.log("[media] 无可用素材，ffmpeg 生成粉紫渐变背景");
      bgPath = resolve(WORK_DIR, `bg_${product}.mp4`);
      await generateBackground({ output: bgPath, durationSeconds: 20 });
    }
  }

  // 4. 时间轴卡点（音频时长驱动）
  const timeline = await buildTimeline({
    background: bgPath,
    output: resolve(WORK_DIR, `${product}_${hookId}_beat.mp4`),
    lines: script.lines,
    audio: voice.path,
  });
  console.log(`[timeline] duration=${timeline.durationSeconds.toFixed(2)}s · cuts=${timeline.cuts.length}`);

  // 5. 字幕（ASS，画布对齐输出分辨率）
  let assPath = null;
  if (!flags.noSubtitles) {
    assPath = writeAssFile(
      script.lines,
      resolve(WORK_DIR, `${product}_${hookId}.ass`),
      timeline.durationSeconds,
      resolution.width,
      resolution.height
    );
    console.log(`[subtitle] ASS → ${assPath}`);
  }

  // 6. 合成（规范化归档命名）
  const stamp = ts();
  const finalOut = resolve(OUTPUT_DIR, `${product}_${hookId}_${resolution.label}_${stamp}.mp4`);
  const stagedOut = resolve(WORK_DIR, `${product}_${hookId}_${resolution.label}_${stamp}.staged.mp4`);
  console.log(`[render] mode=${resolution.mode} ${resolution.width}x${resolution.height} preset=${resolution.preset}`);
  await composeVertical({
    input: timeline.output,
    output: stagedOut,
    audio: voice.path,
    subtitles: assPath,
    width: resolution.width,
    height: resolution.height,
    mode: resolution.mode,
    preset: resolution.preset,
  });

  // 7. ffprobe 质检门禁 → 通过才落盘 output/
  const inspectReport = inspectAndFinalize({
    staged: stagedOut,
    final: finalOut,
    width: resolution.width,
    height: resolution.height,
    fps: 0, // 合成未强制帧率，沿用素材；质检仅报告、不硬断言
    requireAudio: true,
  });
  const sizeMB = (statSync(finalOut).size / 1024 / 1024).toFixed(2);
  const finalDur = await probeVideo(finalOut);
  console.log(`[done] ${finalOut} (${sizeMB} MB · ${finalDur.toFixed(2)}s · ${resolution.width}x${resolution.height})`);
  return {
    ok: true,
    output: finalOut,
    duration: finalDur,
    sizeMB: Number(sizeMB),
    inspector: {
      ok: inspectReport.ok,
      checks: inspectReport.checks,
      issues: inspectReport.issues,
    },
    voice: voice.engine,
    product,
    hookId,
    resolution: resolution.label,
  };
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { ok: true, help: true };
  }
  const flags = {
    mockVoice: Boolean(args["mock-voice"]),
    noPexels: Boolean(args["no-pexels"]),
    noSubtitles: Boolean(args["no-subtitles"]),
    url: args.url,
    autocapture: Boolean(args.autocapture),
  };

  // 批量模式：--batch <config.json> 或 --count <n>
  if (args.batch || args.count) {
    const results = await runBatch({
      configFile: args.batch,
      count: args.count,
      target: args.target,
      flags,
      renderJob,
    });
    const failed = results.filter((r) => !r.ok);
    return { ok: failed.length === 0, batch: results };
  }

  // 单条模式
  const target = args.target || "calorie-ai";
  if (!listTargets().includes(target)) {
    console.warn(`[script] 未知 target "${target}"，使用默认模板`);
  }
  const job = {
    target,
    product: args.product || target,
    hookId: args.hook || "default",
    text: args.text,
    resolution: args.resolution || (args.full || args.hd ? "1080x1920" : "480x480"),
    background: args.background || "ui",
    source: args.source || "ui",
  };
  return renderJob(job, flags);
}

// CLI 直跑
if (import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  run()
    .then((r) => {
      if (!r.ok) process.exitCode = 1;
    })
    .catch((err) => {
      console.error(`[error] ${err.message}`);
      process.exitCode = 1;
    });
}

export { run, runBatch, ROOT, OUTPUT_DIR, WORK_DIR };
