/**
 * batch — 量产 / A/B 测试批处理
 *
 * 两种入口：
 *   --batch config.json   读取 JSON 配置（支持多 Hook 文案、多音色、多画幅、多背景）
 *   --count N             对目标生成 N 条默认 A/B 变体
 *
 * 配置格式（config.json）：
 *   {
 *     "product": "calorieai",
 *     "target": "calorie-ai",
 *     "hooks": [
 *       { "id": "ab1", "lang": "en", "lines": [{ "text": "...", "voice": "en" }] },
 *       ...
 *     ],
 *     "jobs": [
 *       { "hook": "ab1", "resolution": "480x480", "background": "ui" },
 *       { "hook": "ab2", "resolution": "1080x1920", "background": "generated" }
 *     ]
 *   }
 *
 * 输出：products/008-video-factory/output/{product}_{hook_id}_{resolution}_{timestamp}.mp4
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { abVariants } from "./script.mjs";

function loadConfig(configFile) {
  const raw = readFileSync(resolve(configFile), "utf-8");
  return JSON.parse(raw);
}

/** 由默认 A/B 变体生成 jobs（--count 模式） */
function buildCountJobs({ count = 1, target = "calorie-ai", product, flags }) {
  const variants = abVariants(target, count);
  return variants.map((v, i) => ({
    target,
    product: product || target,
    hookId: v.id || `ab${i + 1}`,
    lang: v.lang,
    lines: v.lines.map((t) => ({ text: t, lang: v.lang })),
    resolution: i % 2 === 1 && flags.full ? "1080x1920" : "480x480",
    background: "ui",
  }));
}

/** 由配置文件生成 jobs */
function buildConfigJobs(config) {
  const target = config.target || "calorie-ai";
  const product = config.product || target;
  const hooks = (config.hooks || []).map((h) => ({
    id: h.id || "default",
    lang: h.lang,
    voice: h.voice,
    lines: h.lines || [],
    text: h.text,
  }));

  const jobs = (config.jobs || []).map((j) => {
    const hook = hooks.find((h) => h.id === j.hook) || {};
    const defaultVoice = hook.voice;
    const lines = (j.lines || hook.lines || []).map((l) => {
      const obj = typeof l === "string" ? { text: l } : { ...l };
      return { ...obj, voice: obj.voice || defaultVoice };
    });
    return {
      target: j.target || target,
      product: j.product || product,
      hookId: j.hook || hook.id || "default",
      lines,
      text: j.text || hook.text,
      lang: j.lang || hook.lang,
      resolution: j.resolution || config.resolution || "480x480",
      background: j.background || config.background || "ui",
      source: j.source || config.source || "ui",
    };
  });

  // 没有显式 jobs 时：每个 hook 一条
  if (!jobs.length) {
    for (const h of hooks) {
      const lines = (h.lines || []).map((l) => {
        const obj = typeof l === "string" ? { text: l } : { ...l };
        return { ...obj, voice: obj.voice || h.voice };
      });
      jobs.push({
        target,
        product,
        hookId: h.id,
        lines,
        text: h.text,
        lang: h.lang,
        resolution: config.resolution || "480x480",
        background: config.background || "ui",
        source: config.source || "ui",
      });
    }
  }
  return jobs;
}

/**
 * 批量执行渲染任务（顺序执行，逐条汇总）。
 * @param {{configFile?: string, count?: number, target?: string, flags?: object, renderJob?: Function}} opts
 */
export async function runBatch({ configFile, count, target, flags = {}, renderJob }) {
  if (!renderJob) {
    throw new Error("batch: renderJob 必须由调用方注入（避免循环依赖）");
  }

  let jobs;
  let source;
  if (configFile) {
    const config = loadConfig(configFile);
    jobs = buildConfigJobs(config);
    source = configFile;
  } else {
    jobs = buildCountJobs({ count, target, product: flags.product, flags });
    source = `--count ${count} (${target})`;
  }

  if (!jobs.length) {
    throw new Error(`batch: ${source} 未定义任何任务`);
  }
  console.log(`[batch] ${jobs.length} 个任务 · 来源 ${source}`);

  const results = [];
  for (let i = 0; i < jobs.length; i++) {
    console.log(`\n===== [batch] 任务 ${i + 1}/${jobs.length} · hook=${jobs[i].hookId} =====`);
    try {
      // 批量模式下仅首条任务强制重新录屏，其余复用（避免重复抓取拖慢流水线）
      const jobFlags = { ...flags, autocapture: i === 0 ? Boolean(flags.autocapture) : false };
      const r = await renderJob(jobs[i], jobFlags);
      results.push({ ...r, ok: true });
    } catch (err) {
      console.error(`[batch] 任务失败（hook=${jobs[i].hookId}）: ${err.message}`);
      results.push({ ok: false, hookId: jobs[i].hookId, error: err.message });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n[batch] 完成 ${okCount}/${jobs.length} 条`);
  for (const r of results) {
    if (r.ok) console.log(`  ✅ ${r.product}_${r.hookId}_${r.resolution} → ${r.output}`);
    else console.log(`  ❌ ${r.hookId}: ${r.error}`);
  }
  return results;
}
