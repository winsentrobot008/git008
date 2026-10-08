/**
 * 轻量 i18n 核心（API 对齐 react-i18next 的 t()）。
 * 字典按语言缓存在内存，切换语言只做「重新渲染」而不重新请求，实现零卡顿无缝切换。
 */

const BASE = document.querySelector('meta[name="vf-base-path"]')?.content || "";
// Asset version injected by server/app.py; used to cache-bust the locale JSON.
const ASSET_VERSION = document.querySelector('meta[name="vf-asset-version"]')?.content || "";
const STORAGE_KEY = "vf.lang";
const DEFAULT_LANG = "zh";
const LANGS = { zh: "中文", en: "English" };

const state = {
  lang: "zh",
  dicts: new Map(),
  listeners: new Set(),
};

function lookup(dict, key) {
  return key.split(".").reduce((acc, part) => (acc && typeof acc === "object" ? acc[part] : undefined), dict);
}

const missingKeys = new Set();

function humanizeKey(key) {
  const leaf = String(key).split(".").pop() || String(key);
  const words = leaf
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : leaf;
}

export function t(key, vars) {
  let value = lookup(state.dicts.get(state.lang) || {}, key);
  if (value === undefined) value = lookup(state.dicts.get("zh") || {}, key);
  if (value === undefined) value = lookup(state.dicts.get("en") || {}, key);
  if (value === undefined || typeof value !== "string") {
    // Graceful degradation: never leak a raw dotted key into the UI.
    if (!missingKeys.has(key)) {
      missingKeys.add(key);
      console.warn(`[i18n] missing key: ${key}`);
    }
    return humanizeKey(key);
  }
  if (!vars) return value;
  return value.replace(/\{(\w+)\}/g, (_, name) => (vars[name] !== undefined ? String(vars[name]) : `{${name}}`));
}

export function getLang() {
  return state.lang;
}

export function availableLangs() {
  return { ...LANGS };
}

async function loadDict(lang) {
  if (state.dicts.has(lang)) return state.dicts.get(lang);
  const query = ASSET_VERSION ? `?v=${encodeURIComponent(ASSET_VERSION)}` : "";
  // no-store: a stale disk-cached locale JSON is what leaked raw i18n keys into the UI.
  const res = await fetch(`${BASE}/locales/${lang}.json${query}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`locale ${lang} HTTP ${res.status}`);
  const dict = await res.json();
  state.dicts.set(lang, dict);
  return dict;
}

export async function setLang(lang, { persist = true } = {}) {
  if (!LANGS[lang]) lang = "zh";
  await loadDict(lang);
  state.lang = lang;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* 隐私模式下忽略 */
    }
  }
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  applyI18n();
  state.listeners.forEach((fn) => fn(lang));
  return lang;
}

export async function initI18n() {
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    saved = null;
  }
  // 008 面向中文用户，产品默认中文；英文仅由用户显式切换并持久化。
  // 刻意不依据 navigator.language 自动切到英文，保证首屏与无头/CI 环境行为确定。
  const guess = saved || DEFAULT_LANG;
  await Promise.all([loadDict("zh"), loadDict("en")]);
  return setLang(LANGS[guess] ? guess : "zh", { persist: false });
}

export function onLangChange(fn) {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

/** 把 data-i18n / data-i18n-[attr] 声明式地应用到静态 DOM。 */
export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.setAttribute("placeholder", t(node.getAttribute("data-i18n-placeholder")));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((node) => {
    node.setAttribute("title", t(node.getAttribute("data-i18n-title")));
  });
}

export { BASE };