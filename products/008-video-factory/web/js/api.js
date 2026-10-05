/** API 客户端：REST + 作业 WebSocket（断线自动重连，靠 GET /api/jobs 补齐）。 */

const BASE = document.querySelector('meta[name="vf-base-path"]')?.content || "";
const API = `${BASE}/api`;

async function req(path, { method = "GET", body, timeout = 120000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err = data?.error || {};
      const error = new Error(err.message || `HTTP ${res.status}`);
      error.code = err.code || `HTTP_${res.status}`;
      error.detail = err.detail;
      error.status = res.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health: () => req("/health", { timeout: 5000 }),
  system: (prefer = "auto") => req(`/system?prefer=${encodeURIComponent(prefer)}`, { timeout: 20000 }),
  topic: (query, source = "auto") => req("/topic", { method: "POST", body: { query, source }, timeout: 90000 }),
  idea: (payload) => req("/idea", { method: "POST", body: payload, timeout: 180000 }),
  validate: (director_script) => req("/validate", { method: "POST", body: { director_script }, timeout: 30000 }),
  render: (payload) => req("/render", { method: "POST", body: payload, timeout: 30000 }),
  job: (id) => req(`/jobs/${id}`, { timeout: 15000 }),
  videos: () => req("/videos", { timeout: 15000 }),
};

/**
 * 订阅作业进度。返回 close()。
 * 事件：{type: snapshot|stage|log|done|error|ping}
 */
export function openJobSocket(jobId, handlers = {}) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}${BASE}/ws/jobs/${jobId}`;
  let ws = null;
  let closed = false;
  let retry = 0;

  const connect = () => {
    ws = new WebSocket(url);
    ws.onopen = () => {
      retry = 0;
      handlers.onOpen?.();
    };
    ws.onmessage = (evt) => {
      let payload;
      try {
        payload = JSON.parse(evt.data);
      } catch {
        return;
      }
      handlers.onEvent?.(payload);
    };
    ws.onclose = () => {
      if (closed) return;
      retry += 1;
      if (retry <= 5) setTimeout(connect, Math.min(4000, 400 * retry));
      else handlers.onClose?.();
    };
    ws.onerror = () => ws?.close();
  };
  connect();

  return () => {
    closed = true;
    ws?.close();
  };
}

export { BASE };