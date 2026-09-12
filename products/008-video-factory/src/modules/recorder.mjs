/**
 * recorder — Playwright 自动 UI 录屏（CalorieAI 移动端真实操作流）
 *
 * 流程（约 8-10 秒）：
 *   a. 打开 Landing Page（优先 https://calorie-ai-seven.vercel.app，失败回退 localhost:3000）
 *      + 平滑向下滚动浏览 Hero / App 卡片；
 *   b. 模拟移动端点击图片上传按钮，载入测试食物图片（demo-food.jpg）；
 *   c. 触发 AI 识图，等待/展示卡路里识别结果卡片。
 *
 * 语言对齐：context 设置 locale: 'en-US'（navigator.language → en），
 * 请求头注入 Accept-Language: en-US,en;q=0.9，并在页面加载前注入
 * localStorage.calorieai_locale = 'en'（手动覆盖优先）+ documentElement.lang，
 * 录制过程中对 DOM 做中文关键词校验，发现中文立即终止报错。
 *
 * 录屏经 Playwright recordVideo（webm）→ ffmpeg 转 MP4
 * → 保存至 assets/captured/{product}/calorieai-ui.mp4，供渲染模块优先作为背景调用。
 */

import { chromium } from "playwright";
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORK_DIR = resolve(ROOT, "work");

// 优先使用 calorieai 项目自带的演示食物图；缺失时自动生成占位图
const DEMO_IMAGE_CANDIDATES = [
  resolve(ROOT, "..", "calorieai", "scripts", "assets", "demo-food.jpg"),
  resolve(ROOT, "..", "calorieai", "qa-logs", "food-plate.jpg"),
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 中文界面关键词（命中即视为语言锁失败） */
const ZH_KEYWORDS = [
  "记录饮食", "开始识图", "正在高级识别", "高级识别分析", "上传照片",
  "识别结果", "餐次", "积分", "语言", "设置", "登录", "注册", "卡路里助手",
];

function ensureDemoImage() {
  const workDemo = resolve(WORK_DIR, "demo-food.jpg");
  if (existsSync(workDemo)) return workDemo;
  mkdirSync(WORK_DIR, { recursive: true });
  for (const cand of DEMO_IMAGE_CANDIDATES) {
    if (existsSync(cand)) {
      copyFileSync(cand, workDemo);
      return workDemo;
    }
  }
  throw new Error("recorder: demo-food.jpg not found in calorieai project");
}

async function reachable(url, timeoutMs = 8000) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { method: "GET", signal: ctrl.signal, redirect: "follow" });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function pickTargetUrl() {
  const live = "https://calorie-ai-seven.vercel.app";
  const local = "http://localhost:3000";
  if (await reachable(live)) {
    console.log(`[recorder] target: ${live} (live)`);
    return live;
  }
  if (await reachable(local)) {
    console.log(`[recorder] target: ${local} (local dev)`);
    return local;
  }
  throw new Error(`recorder: 无法访问 ${live} 或 ${local}`);
}

/** 平滑滚动：分多步匀速滚动，模拟人手拖动 */
async function smoothScroll(page, distance, steps = 8, stepMs = 140) {
  const step = Math.max(40, Math.round(distance / steps));
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, step).catch(() => {});
    await sleep(stepMs);
  }
}

/**
 * 录制 CalorieAI UI 操作视频。
 * @param {{url?: string, demoImage?: string, output?: string, product?: string, headless?: boolean}} opts
 * @returns {Promise<{output: string, duration: number}>}
 */
export async function recordCalorieUi({
  url,
  demoImage,
  product = "calorieai",
  locale = "en-US",
  headless = true,
} = {}) {
  const capturedDir = resolve(ROOT, "assets", "captured", product);
  const output = resolve(capturedDir, "calorieai-ui.mp4");
  mkdirSync(capturedDir, { recursive: true });
  mkdirSync(WORK_DIR, { recursive: true });
  const targetUrl = url || (await pickTargetUrl());
  const demo = demoImage || ensureDemoImage();
  const out = resolve(output);
  const videoDir = resolve(WORK_DIR, "record");

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    extraHTTPHeaders: {
      "Accept-Language": `${locale},en;q=0.9`,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    recordVideo: {
      dir: videoDir,
      size: { width: 390, height: 844 },
    },
  });
  // CalorieAI 语言覆盖：localStorage 手动设置优先于 navigator.language
  await context.addInitScript(({ storageKey, storageValue }) => {
    try {
      window.localStorage.setItem(storageKey, storageValue);
    } catch {
      /* ignore storage errors */
    }
    try {
      document.documentElement.lang = storageValue === "zh" ? "zh-CN" : "en";
    } catch {
      /* ignore */
    }
  }, { storageKey: "calorieai_locale", storageValue: locale.startsWith("zh") ? "zh" : "en" });

  try {
    const page = await context.newPage();

    // 语言锁校验：录制全程 DOM 不得出现中文关键词
    const assertEnglish = async (stage) => {
      const hits = await page.evaluate((kws) => {
        const text = document.body?.innerText || "";
        return kws.filter((k) => text.includes(k));
      }, ZH_KEYWORDS);
      if (hits.length) {
        throw new Error(`recorder: 语言锁失败（${stage} 出现中文: ${hits.join(" / ")}）`);
      }
    };

    // a. Landing Page + 平滑滚动（Hero → App 卡片）
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await sleep(600);
    await assertEnglish("landing");
    await smoothScroll(page, 900); // 向下滚动浏览
    await sleep(400);
    await smoothScroll(page, -900); // 回到上传区
    await sleep(300);
    await assertEnglish("upload-area");

    // b. 点击图片上传按钮 + 载入测试食物图片
    const uploadBtn = page
      .locator('button:has-text("Upload Photo"), button:has-text("上传"), .upload-btn')
      .first();
    if (await uploadBtn.count()) {
      await uploadBtn.click();
    }
    await sleep(500);

    const galleryInput = page
      .locator('input[type="file"]:not([capture])')
      .first();
    await galleryInput.setInputFiles(demo);
    await sleep(700);
    await assertEnglish("after-upload");

    // c. 触发 AI 识图并等待结果
    const analyzeBtn = page
      .locator('button:has-text("Start AI Scan"), button:has-text("开始识图"), button:has-text("AI Scan"), button:has-text("开始 AI 识图")')
      .first();
    if (await analyzeBtn.count()) {
      await analyzeBtn.click();
    }

    // 等待结果卡片（卡路里/结果区域）；API 未配置时最多等 6 秒拍下上传+识别中画面
    const resultLocator = page.locator(
      'text=/kcal|卡路里|识别结果|recognition_result|Calories|🔥/i'
    ).first();
    await resultLocator.waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
    await assertEnglish("analyzing");
    await sleep(1200);

    console.log("[recorder] UI flow recorded");
  } finally {
    // recordVideo 仅在 context 关闭后落盘
    await context.close();
    await browser.close();
  }

  // 找到最新录制的 webm
  const { readdirSync } = await import("node:fs");
  const files = readdirSync(videoDir)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => resolve(videoDir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!files.length) throw new Error("recorder: 未找到录制产物");
  const webm = files[0];

  // webm → mp4
  await new Promise((resolvePromise, reject) => {
    execFile(
      "ffmpeg",
      ["-y", "-i", webm, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", out],
      (err) => (err ? reject(new Error(`recorder: ffmpeg 转码失败 ${err.message}`)) : resolvePromise())
    );
  });
  if (!existsSync(out)) throw new Error("recorder: MP4 输出缺失");
  const dur = await probeVideoDuration(out);
  console.log(`[recorder] saved ${out} (${(statSync(out).size / 1024 / 1024).toFixed(2)} MB · ${dur.toFixed(1)}s)`);
  return { output: out, duration: dur };
}

async function probeVideoDuration(file) {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file],
    { encoding: "utf-8" }
  ).trim();
  const n = Number(out);
  return Number.isFinite(n) ? n : 0;
}

/** 按产品返回录屏产物路径 */
export function recordingPath(product = "calorieai") {
  return resolve(ROOT, "assets", "captured", product, "calorieai-ui.mp4");
}

/** 检查某产品是否已有 UI 录屏（供管线跳过重复录制） */
export function hasRecording(product = "calorieai") {
  const path = recordingPath(product);
  return existsSync(path) && statSync(path).size > 0;
}
