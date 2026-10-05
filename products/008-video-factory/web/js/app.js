/** 应用引导：装配 store、挂载四大分区、轮询系统状态、全局 toast。 */

import { initI18n, t, onLangChange } from "./i18n.js";
import { createStore } from "./store.js";
import { api } from "./api.js";
import { mount as mountTopbar } from "./components/topbar.js";
import { mount as mountInspiration } from "./components/inspiration.js";
import { mount as mountStoryboard } from "./components/storyboard.js";
import { mount as mountInspector } from "./components/inspector.js";
import { esc } from "./util.js";

const store = createStore({
  connected: false,
  busy: false,
  system: null,
  idea: "",
  style: "短剧",
  duration: 15,
  shots: 6,
  provider: "auto",
  topic: { query: "github", source: "auto", loading: false, payload: null },
  generation: { loading: false, result: null, error: null },
  script: null,
  storyboard: null,
  backend: "auto",
  resolution: "480x854",
  cover: true,
  render: { jobId: null, stage: "", progress: 0, logs: [], result: null, error: null, running: false },
  history: [],
});

const toasts = document.getElementById("vf-toasts");
function toast(message, tone = "ok") {
  const node = document.createElement("div");
  node.className = `vf-toast vf-toast--${tone}`;
  node.innerHTML = esc(message);
  toasts.appendChild(node);
  setTimeout(() => node.classList.add("is-out"), 4200);
  setTimeout(() => node.remove(), 5200);
}

async function pollSystem() {
  try {
    const system = await api.system(store.get().backend || "auto");
    store.set({ system, connected: true });
  } catch {
    store.set({ connected: false });
  }
}

async function boot() {
  await initI18n();
  document.title = t("topbar.title");
  onLangChange(() => {
    document.title = t("topbar.title");
  });

  mountTopbar(document.getElementById("vf-topbar"), store);
  mountInspiration(document.getElementById("vf-inspiration"), store, { toast });
  mountStoryboard(document.getElementById("vf-storyboard"), store, { toast });
  mountInspector(document.getElementById("vf-inspector"), store, { toast });

  await pollSystem();
  setInterval(pollSystem, 6000);

  // 供端到端测试与调试使用
  window.__VF_STORE__ = store;
  window.__VF_READY__ = true;
}

boot().catch((err) => {
  document.getElementById("vf-topbar").innerHTML = `<p class="vf-error">Boot failed: ${esc(err.message)}</p>`;
  window.__VF_BOOT_ERROR__ = String(err && err.message);
});