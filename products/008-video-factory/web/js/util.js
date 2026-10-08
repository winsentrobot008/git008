/** 通用工具：HTML 转义、数字格式化、防抖。 */

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function fmtNum(value, digits = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function pct(used, total) {
  const u = Number(used);
  const t = Number(total);
  if (!Number.isFinite(u) || !Number.isFinite(t) || t <= 0) return 0;
  return Math.max(0, Math.min(100, (u / t) * 100));
}

export function debounce(fn, wait = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function byId(id) {
  return document.getElementById(id);
}

/**
 * 绑定文本输入（支持中文/日文 IME）。
 * 合成期间不提交状态，避免逐字触发重绘、失焦与光标跳动；
 * 合成结束（compositionend）后才提交一次完整文本。
 * @returns 解绑函数
 */
export function bindCommittedInput(el, commit) {
  if (!el) return () => {};
  let composing = false;

  const onStart = () => {
    composing = true;
  };
  const onEnd = (e) => {
    composing = false;
    commit(e.target.value);
  };
  const onInput = (e) => {
    // 双重保护：自己的标志位 + 原生 isComposing
    if (composing || e.isComposing) return;
    commit(e.target.value);
  };

  el.addEventListener("compositionstart", onStart);
  el.addEventListener("compositionend", onEnd);
  el.addEventListener("input", onInput);
  return () => {
    el.removeEventListener("compositionstart", onStart);
    el.removeEventListener("compositionend", onEnd);
    el.removeEventListener("input", onInput);
  };
}