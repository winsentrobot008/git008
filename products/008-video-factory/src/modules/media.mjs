/**
 * media — Pexels API 检索 + 本地素材标签匹配（封装 MediaIndexerPro sources/pexels_search.py + workflow/asset_selector.py）
 *
 * 能力：
 *   - searchPexels(keywords): Pexels 照片/视频检索（PEXELS_API_KEY 环境变量）
 *   - matchLocalAssets(dir, keywords): 本地目录素材按文件名关键词打分
 *   - selectMedia({ keywords, localDirs }): 本地 → Pexels 有序回退
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STOCK_DIR = resolve(ROOT, "assets", "stock");
mkdirSync(STOCK_DIR, { recursive: true });

const VIDEO_EXT = new Set([".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

/** MediaIndexerPro 同款关键词打分：全词 +1，分词 +0.5 */
export function keywordMatchScore(name, keywords) {
  const lower = String(name).toLowerCase();
  let score = 0;
  for (const kw of keywords || []) {
    const k = String(kw).toLowerCase();
    if (k && lower.includes(k)) score += 1;
    for (const word of k.split(/\s+/)) {
      if (word && lower.includes(word)) score += 0.5;
    }
  }
  return score;
}

/** 扫描本地素材目录（视频优先） */
export function scanLocalAssets(dir) {
  const root = resolve(dir);
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const ext = extname(e.name).toLowerCase();
        if (VIDEO_EXT.has(ext) || IMAGE_EXT.has(ext)) {
          out.push({ path: p, name: e.name, ext, kind: VIDEO_EXT.has(ext) ? "video" : "image" });
        }
      }
    }
  };
  if (statSync(root, { throwIfNoEntry: false })?.isDirectory()) walk(root);
  return out;
}

/** 本地素材匹配：按关键词打分排序，返回最佳项 */
export function matchLocalAssets(dir, keywords) {
  const assets = scanLocalAssets(dir);
  const scored = assets
    .map((a) => ({ ...a, score: keywordMatchScore(a.name, keywords) }))
    .filter((a) => a.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Pexels 检索（视频 + 图片）。
 * 参考 MediaIndexerPro：Authorization 头只放 key；无 key 返回空数组。
 */
export async function searchPexels(keywords, { perPage = 5, timeoutMs = 15000 } = {}) {
  const apiKey = loadPexelsKey();
  if (!apiKey) return [];
  const results = [];
  const seen = new Set();

  for (const kw of keywords || []) {
    const q = encodeURIComponent(kw);
    // 视频
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(`https://api.pexels.com/videos/search?query=${q}&per_page=${perPage}`, {
        headers: { Authorization: apiKey },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      for (const v of data.videos || []) {
        const pageUrl = v.url || "";
        if (!pageUrl || seen.has(pageUrl)) continue;
        seen.add(pageUrl);
        const files = v.video_files || [];
        const hd = files.find((f) => f.quality === "hd") || files.find((f) => f.quality === "sd") || files[0];
        results.push({
          title: String(v.url?.split("/").pop() || kw),
          url: hd?.link || pageUrl,
          thumbnail: v.image || "",
          source: "Pexels",
          type: "video",
          duration: v.duration ? `${v.duration}s` : null,
          keywords: [kw],
        });
      }
    } catch {
      /* network / key errors degrade gracefully */
    }
    // 图片（竖屏定向）
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(
        `https://api.pexels.com/v1/search?query=${q}&per_page=${perPage}&orientation=portrait`,
        { headers: { Authorization: apiKey }, signal: ctrl.signal }
      );
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      for (const p of data.photos || []) {
        const pageUrl = p.url || "";
        if (!pageUrl || seen.has(pageUrl)) continue;
        seen.add(pageUrl);
        results.push({
          title: p.alt || kw,
          url: pageUrl,
          thumbnail: p.src?.medium || p.src?.tiny || "",
          source: "Pexels",
          type: "image",
          duration: null,
          keywords: [kw],
        });
      }
    } catch {
      /* degrade */
    }
  }
  return results;
}

/**
 * 统一素材选择：本地目录匹配 → Pexels（可选）→ 空（由 render 生成背景兜底）。
 */
export async function selectMedia({ keywords, localDirs = [], usePexels = true, perPage = 5 }) {
  for (const dir of localDirs) {
    const matches = matchLocalAssets(dir, keywords);
    if (matches.length) {
      return { kind: "local", item: matches[0], candidates: matches };
    }
  }
  if (usePexels) {
    const results = await searchPexels(keywords, { perPage });
    const videos = results.filter((r) => r.type === "video");
    const pick = videos[0] || results[0];
    if (pick) return { kind: "pexels", item: pick, candidates: results };
  }
  return { kind: "none", item: null, candidates: [] };
}

// ─── 真人出镜素材（Pexels HD 短视频 + 本地缓存）────────────────────────

/**
 * 旁白文案 → 人物场景关键词映射表（Hook / Value / CTA）。
 * 轮询取词：默认按 0/1/2 对应 hook/value/cta，超出循环。
 */
export const STOCK_KEYWORD_MAP = {
  hook: [
    "person looking at phone frustrated",
    "person scale weight",
    "woman checking phone annoyed",
  ],
  value: [
    "woman eating salad",
    "man typing phone healthy food",
    "person eating healthy meal",
    "healthy food bowl hands",
    "woman working out gym",
    "person cooking healthy food kitchen",
  ],
  cta: [
    "happy person smiling smartphone",
    "fitness motivation",
    "woman running healthy lifestyle",
  ],
};

/**
 * 第 index 段（0 起）应使用的场景关键词。
 * 顺序分配 + 跳过已用词，保证同一批次内各段使用不同视频：
 *   - 首段 hook（看手机发愁）、末段 cta（开心/健身）；
 *   - 中间 value 段在词池内依次推进（已用词自动跳过，避免相邻段重复画面）。
 */
export function stockKeywordsForSegment(index, used = [], valueSlot = 0) {
  if (index === 0) return STOCK_KEYWORD_MAP.hook[0];
  if (index % 3 === 2) return STOCK_KEYWORD_MAP.cta[Math.floor(index / 3) % STOCK_KEYWORD_MAP.cta.length];
  const pool = STOCK_KEYWORD_MAP.value;
  const taken = new Set(used.map((k) => String(k).toLowerCase()));
  const candidates = pool.filter((k) => !taken.has(k.toLowerCase()));
  const usable = candidates.length ? candidates : pool;
  // 按 value 槽位推进，且跳过已用关键词
  return usable[valueSlot % usable.length];
}

/** 关键词 → 缓存文件（assets/stock/{sha1 前12位}.mp4） */
export function stockCachePath(keyword) {
  const hash = createHash("sha1").update(String(keyword).toLowerCase()).digest("hex").slice(0, 12);
  return resolve(STOCK_DIR, `${hash}.mp4`);
}

/** 从 Pexels video 对象中挑 HD 直链（优先 hd/uhd，其次最大分辨率） */
function pickVideoFile(video) {
  const files = video?.video_files || [];
  const preferred =
    files.find((f) => f.quality === "hd") ||
    files.find((f) => f.quality === "uhd");
  const fallback = [...files].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  return preferred || fallback || null;
}

async function downloadToFile(url, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(outPath, buf);
  return outPath;
}

/**
 * 下载/复用一条关键词的 HD 真人短视频（assets/stock 缓存复用）。
 * @param {string} keyword
 * @param {{force?: boolean}} opts
 */
export async function fetchStockVideo(keyword, { force = false } = {}) {
  const cache = stockCachePath(keyword);
  if (!force && existsSync(cache) && statSync(cache).size > 10_000) {
    return { path: cache, keyword, cached: true };
  }
  const apiKey = loadPexelsKey();
  if (!apiKey) throw new Error(`fetchStockVideo: PEXELS_API_KEY 未配置（关键词: ${keyword}）`);

  const q = encodeURIComponent(keyword);
  const res = await fetch(
    `https://api.pexels.com/videos/search?query=${q}&per_page=5&orientation=portrait`,
    { headers: { Authorization: apiKey } }
  );
  if (!res.ok) throw new Error(`Pexels API HTTP ${res.status}`);
  const data = await res.json();
  const video = (data.videos || [])[0];
  if (!video) throw new Error(`Pexels 无结果: ${keyword}`);
  const file = pickVideoFile(video);
  if (!file?.link) throw new Error(`Pexels 结果无直链: ${keyword}`);
  await downloadToFile(file.link, cache);
  return { path: cache, keyword, cached: false, url: file.link };
}

/**
 * 按旁白段数批量获取真人素材（每段一个场景关键词，首段 hook、末段 cta、中间 value）。
 * @param {Array} lines 脚本行
 * @param {{force?: boolean}} opts
 */
export async function stockVideosForLines(lines, { force = false } = {}) {
  const total = Math.max(1, (lines || []).length || 1);
  const videos = [];
  const usedKeywords = [];
  let valueSlot = 0;
  for (let i = 0; i < total; i++) {
    const isValue = i !== 0 && i % 3 !== 2;
    const keyword = stockKeywordsForSegment(i, usedKeywords, isValue ? valueSlot : 0);
    if (isValue) valueSlot += 1;
    const v = await fetchStockVideo(keyword, { force });
    usedKeywords.push(keyword);
    const role = i === 0 ? "hook" : i === total - 1 ? "cta" : "value";
    console.log(`[stock] ${role} → "${keyword}" (${v.cached ? "缓存" : "新下载"})`);
    videos.push(v);
  }
  return videos;
}

/** 简易 .env 读取（PEXELS_API_KEY），兼容 process.env 注入 */
export function loadPexelsKey() {
  if (process.env.PEXELS_API_KEY) return process.env.PEXELS_API_KEY;
  try {
    const envFile = resolve(ROOT, ".env");
    if (existsSync(envFile)) {
      const raw = readFileSync(envFile, "utf-8");
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*PEXELS_API_KEY\s*=\s*"?([^"\s]+)"?\s*$/);
        if (m && m[1]) return m[1].trim();
      }
    }
  } catch {
    /* ignore */
  }
  return "";
}
