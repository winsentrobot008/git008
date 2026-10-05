/**
 * 轻量 i18n 核心（API 对齐 react-i18next 的 t()）。
 * 字典按语言缓存在内存，切换语言只做「重新渲染」而不重新请求，实现零卡顿无缝切换。
 */

const BASE = document.querySelector('meta[name="vf-base-path"]')?.content || "";
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

export function t(key, vars) {
  const dict = state.dicts.get(state.lang) || {};
  let value = lookup(dict, key);
  if (value === undefined) {
    const fallback = state.dicts.get("zh") || {};
    value = lookup(fallback, key);
  }
  if (value === undefined) return key;
  if (typeof value !== "string") return key;
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
  const res = await fetch(`${BASE}/locales/${lang}.json`, { cache: "force-cache" });
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