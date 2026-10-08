/** 播放与质检面板：渲染控制、阶段进度、实时日志、ffprobe 明细、成片与封面。 */

import { t, onLangChange } from "../i18n.js";
import { esc, fmtNum } from "../util.js";
import { api, openJobSocket, BASE } from "../api.js";

const RESOLUTIONS = ["480x480", "480x854", "1080x1080", "1080x1920"];
let socketClose = null;
const HIGHRES_RESOLUTION = "1080x1920";

export function mount(root, store, { toast }) {
  const render = () => {
    const s = store.get();
    const r = s.render || {};
    const busy = Boolean(r.running);
    const result = r.result;
    const checks = result?.checks || {};
    root.innerHTML = `
      <div class="vf-card">
        <header class="vf-card__head">
          <h2>${esc(t("inspector.title"))}</h2>
          ${
            r.stage
              ? `<span class="vf-pill vf-pill--${r.stage === "failed" ? "danger" : r.stage === "completed" ? "ok" : "accent"}">
                   ${esc(t(`inspector.stage.${r.stage}`) || r.stage)} · ${Number(r.progress || 0)}%
                 </span>`
              : ""
          }
        </header>

        <div class="vf-grid vf-grid--3">
          <label class="vf-field">
            <span>${esc(t("inspector.backend"))}</span>
            <select id="vf-backend"${busy ? " disabled" : ""}>
              ${["auto", "comfyui", "ffmpeg"]
                .map((v) => `<option value="${v}"${s.backend === v ? " selected" : ""}>${esc(v)}</option>`)
                .join("")}
            </select>
          </label>
          <label class="vf-field">
            <span>${esc(t("inspector.resolution"))}</span>
            <select id="vf-resolution"${busy ? " disabled" : ""}>
              ${RESOLUTIONS.map((v) => `<option value="${v}"${s.resolution === v ? " selected" : ""}>${esc(v)}</option>`).join("")}
            </select>
          </label>
          <label class="vf-field vf-field--check">
            <span>${esc(t("inspector.coverToggle"))}</span>
            <input id="vf-cover" type="checkbox"${s.cover !== false ? " checked" : ""}${busy ? " disabled" : ""} />
          </label>
        </div>

        <button type="button" class="vf-btn ${busy ? "vf-btn--danger" : "vf-btn--primary"}" id="vf-render"${!s.script && !busy ? " disabled" : ""}>
          ${esc(busy ? t("inspector.cancel") : t("inspector.render"))}
        </button>
        ${r.error ? `<p class="vf-error">${esc(r.error.message || r.error)}</p>` : ""}

        <div class="vf-progress"><i style="width:${Number(r.progress || 0)}%"></i></div>

        <div class="vf-subcard">
          <h3>${esc(t("inspector.logs"))}</h3>
          <pre class="vf-logs" id="vf-logs">${esc((r.logs || []).slice(-120).map((l) => l.line ?? l).join("\n")) || "—"}</pre>
        </div>

        ${
          result
            ? `<div class="vf-subcard">
                 <h3>${esc(t("inspector.checks"))}</h3>
                 ${
                   Object.keys(checks).length
                     ? `<table class="vf-table">
                          <thead><tr><th>${esc(t("inspector.check"))}</th><th>${esc(t("inspector.result"))}</th><th>${esc(t("inspector.detail"))}</th></tr></thead>
                          <tbody>
                            ${Object.entries(checks)
                              .map(
                                ([name, info]) => `<tr>
                                  <td>${esc(t(`check.${name}`) === `check.${name}` ? name : t(`check.${name}`))}</td>
                                  <td>${info?.ok ? `✅ ${esc(t("inspector.pass"))}` : `❌ ${esc(t("inspector.fail"))}`}</td>
                                  <td>${esc(info?.detail || "")}</td>
                                </tr>`,
                              )
                              .join("")}
                          </tbody>
                        </table>
                        <p class="${result.inspect_ok ? "vf-ok" : "vf-danger"}">${esc(
                          result.inspect_ok ? t("inspector.allPass") : t("inspector.someFail"),
                        )}</p>`
                     : ""
                 }
                 <div class="vf-preview">
                   ${
                     result.output_url
                       ? `<div><h4>${esc(t("inspector.video"))}</h4>
                            <video controls preload="metadata" src="${esc(BASE + result.output_url)}"></video>
                            <a class="vf-btn" href="${esc(BASE + result.output_url)}" download>${esc(t("inspector.download"))}</a>
                          </div>`
                       : ""
                   }
                   ${
                     result.cover_url
                       ? `<div><h4>${esc(t("inspector.cover"))}</h4>
                            <img class="vf-cover" src="${esc(BASE + result.cover_url)}" alt="${esc(t("inspector.cover"))}" />
                          </div>`
                       : ""
                   }
                 </div>
               </div>`
            : `<p class="vf-empty">${esc(t("inspector.empty"))}</p>`
        }

        ${reviewPanel(r, busy)}

        <div class="vf-subcard">
          <h3>${esc(t("inspector.history"))}</h3>
          ${
            (s.history || []).length
              ? `<ul class="vf-history">${(s.history || [])
                  .slice(0, 8)
                  .map(
                    (item) => `<li>
                      <a href="${esc(BASE + item.url)}" target="_blank" rel="noopener">${esc(item.name)}</a>
                      <span>${fmtNum(item.size_mb, 2)} MB</span>
                    </li>`,
                  )
                  .join("")}</ul>`
              : `<p class="vf-empty">${esc(t("inspector.historyEmpty"))}</p>`
          }
        </div>
      </div>`;

    wire();
    const logs = root.querySelector("#vf-logs");
    if (logs) logs.scrollTop = logs.scrollHeight;
  };

  /** 审核 / 发布钩子：Pass 通过、打回重做，或请求 1080x1920 高清导出。 */
  function reviewPanel(r, busy) {
    if (!r.result || !r.jobId || busy) return "";
    const reviewed = r.review
      ? `<p class="vf-ok">${esc(
          t("inspector.reviewed", { decision: t(`inspector.decision.${r.review.decision}`) }),
        )}</p>`
      : "";
    return `<div class="vf-subcard">
        <h3>${esc(t("inspector.review"))}</h3>
        <p class="vf-hint">${esc(t("inspector.reviewHint"))}</p>
        <div class="vf-actions">
          <button type="button" class="vf-btn" id="vf-reject">${esc(t("inspector.rejectBtn"))}</button>
          <button type="button" class="vf-btn vf-btn--primary" id="vf-pass">${esc(t("inspector.passBtn"))}</button>
          <button type="button" class="vf-btn" id="vf-highres">${esc(t("inspector.highresBtn"))}</button>
        </div>
        ${reviewed}
      </div>`;
  }
  function wire() {
    const backend = root.querySelector("#vf-backend");
    if (backend) backend.addEventListener("change", (e) => store.set({ backend: e.target.value }));
    const res = root.querySelector("#vf-resolution");
    if (res) res.addEventListener("change", (e) => store.set({ resolution: e.target.value }));
    const cover = root.querySelector("#vf-cover");
    if (cover) cover.addEventListener("change", (e) => store.set({ cover: e.target.checked }));

    const btn = root.querySelector("#vf-render");
    if (btn) btn.addEventListener("click", () => (store.get().render?.running ? cancelRender() : startRender()));
    const pass = root.querySelector("#vf-pass");
    if (pass) pass.addEventListener("click", () => reviewJob("pass"));
    const reject = root.querySelector("#vf-reject");
    if (reject) reject.addEventListener("click", () => reviewJob("reject"));
    const highres = root.querySelector("#vf-highres");
    if (highres) highres.addEventListener("click", () => requestHighres());
  }

  async function startRender() {
    const s = store.get();
    if (!s.script) return;
    store.set({
      render: { jobId: null, stage: "queued", progress: 0, logs: [], result: null, error: null, running: true },
      busy: true,
    });
    try {
      const { job_id: jobId } = await api.render({
        director_script: s.script,
        backend: s.backend || "auto",
        cover: s.cover !== false,
        resolution: s.resolution || "480x480",
        fps: 24,
      });
      store.set({ render: { ...store.get().render, jobId } });
      toast(t("toast.renderStarted", { id: jobId }), "ok");
      attachSocket(jobId);
    } catch (err) {
      store.set({ render: { ...store.get().render, running: false, error: err }, busy: false });
      toast(`${t("toast.renderFailed")}: ${err.message}`, "error");
    }
  }

  async function cancelRender() {
    const current = store.get().render || {};
    if (!current.running) return;
    try {
      await api.cancelRender(current.jobId || null);
      toast(t("toast.renderCancelled"), "ok");
    } catch (err) {
      toast(`${t("toast.renderFailed")}: ${err.message}`, "error");
    } finally {
      resetToIdle(current);
    }
  }

  async function reviewJob(decision) {
    const current = store.get().render || {};
    if (!current.jobId) return;
    try {
      const { review } = await api.review(current.jobId, decision);
      store.set({ render: { ...store.get().render, review } });
      toast(t(decision === "pass" ? "toast.reviewPassed" : "toast.reviewRejected"), "ok");
    } catch (err) {
      toast(`${t("toast.failed")}: ${err.message}`, "error");
    }
  }

  /** 审核通过后复用草稿分镜另起一个 1080x1920 高清作业。 */
  async function requestHighres() {
    const current = store.get().render || {};
    if (!current.jobId) return;
    try {
      const { job_id: jobId, resolution } = await api.renderHighres({
        job_id: current.jobId,
        resolution: HIGHRES_RESOLUTION,
      });
      store.set({
        resolution,
        render: { jobId, stage: "queued", progress: 0, logs: [], result: null, error: null, running: true },
        busy: true,
      });
      toast(t("toast.highresStarted", { id: jobId }), "ok");
      attachSocket(jobId);
    } catch (err) {
      toast(`${t("toast.renderFailed")}: ${err.message}`, "error");
    }
  }
  /** 停止本地渲染态：断开作业 socket、清空进度，按钮回到“开始渲染”。 */
  function resetToIdle(current = {}) {
    socketClose?.();
    socketClose = null;
    store.set({
      render: { ...current, jobId: null, running: false, stage: "", progress: 0, error: null },
      busy: false,
    });
  }

  function attachSocket(jobId) {
    socketClose?.();
    socketClose = openJobSocket(jobId, {
      onEvent(event) {
        const current = store.get().render || {};
        if (event.type === "log") {
          store.set({ render: { ...current, logs: [...(current.logs || []), { line: event.line }] } });
          return;
        }
        if (event.type === "stage" || event.type === "snapshot") {
          store.set({ render: { ...current, stage: event.stage, progress: event.progress } });
          return;
        }
        if (event.type === "done") {
          store.set({
            render: { ...current, running: false, stage: "completed", progress: 100, result: event.result },
            busy: false,
          });
          toast(t("toast.renderDone"), "ok");
          refreshHistory();
          return;
        }
        if (event.type === "error") {
          store.set({ render: { ...current, running: false, stage: "failed", error: event.error }, busy: false });
          toast(`${t("toast.renderFailed")}: ${event.error?.message || ""}`, "error");
          return;
        }
        if (event.type === "cancelled") {
          if (!current.running) return; // 本地已复位，避免重复提示
          resetToIdle(current);
          toast(t("toast.renderCancelled"), "ok");
        }
      },
    });
  }

  async function refreshHistory() {
    try {
      const { items } = await api.videos();
      store.set({ history: items || [] });
    } catch {
      /* 历史列表失败不影响主流程 */
    }
  }

  store.subscribe((s, prev) => {
    if (!prev || prev.render !== s.render || prev.history !== s.history || prev.script !== s.script) render();
  });
  onLangChange(render);
  refreshHistory();
  return render;
}
