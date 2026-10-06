/** 灵感 / 热点区：创意输入 + Agent-Reach 全网点取材一键回填。 */

import { t, onLangChange } from "../i18n.js";
import { esc, bindCommittedInput } from "../util.js";
import { api } from "../api.js";

const SOURCES = ["auto", "github", "v2ex", "rss", "web"];

export function mount(root, store, { toast }) {
  let topicResult = null;

  const render = () => {
    const s = store.get();
    const gen = s.generation || {};
    const tp = s.topic || {};
    root.innerHTML = `
      <div class="vf-card">
        <header class="vf-card__head">
          <h2>${esc(t("inspiration.title"))}</h2>
        </header>

        <label class="vf-field">
          <span>${esc(t("inspiration.ideaLabel"))}</span>
          <textarea id="vf-idea" rows="5" placeholder="${esc(t("inspiration.ideaPlaceholder"))}">${esc(s.idea || "")}</textarea>
        </label>

        <div class="vf-grid vf-grid--3">
          <label class="vf-field">
            <span>${esc(t("inspiration.style"))}</span>
            <select id="vf-style">
              ${["短剧", "漫剧"]
                .map(
                  (v) =>
                    `<option value="${esc(v)}"${s.style === v ? " selected" : ""}>${esc(
                      v === "短剧" ? t("inspiration.styleShortDrama") : t("inspiration.styleManga"),
                    )}</option>`,
                )
                .join("")}
            </select>
          </label>
          <label class="vf-field">
            <span>${esc(t("inspiration.duration"))}</span>
            <input id="vf-duration" type="number" min="6" max="120" step="1" value="${Number(s.duration ?? 15)}" />
          </label>
          <label class="vf-field">
            <span>${esc(t("inspiration.shots"))}</span>
            <input id="vf-shots" type="number" min="3" max="12" step="1" value="${Number(s.shots ?? 6)}" />
          </label>
        </div>

        <label class="vf-field">
          <span>${esc(t("inspiration.provider"))}</span>
          <select id="vf-provider">
            <option value="auto"${s.provider === "auto" ? " selected" : ""}>${esc(t("inspiration.providerAuto"))}</option>
            <option value="offline"${s.provider === "offline" ? " selected" : ""}>${esc(t("inspiration.providerOffline"))}</option>
          </select>
        </label>

        <div class="vf-subcard">
          <h3>${esc(t("inspiration.topicTitle"))}</h3>
          <div class="vf-row">
            <input id="vf-topic-query" type="text" placeholder="${esc(t("inspiration.topicQuery"))}" value="${esc(tp.query || "github")}" />
            <select id="vf-topic-source">
              ${SOURCES.map((v) => `<option value="${v}"${tp.source === v ? " selected" : ""}>${esc(v)}</option>`).join("")}
            </select>
            <button type="button" class="vf-btn" id="vf-fetch"${tp.loading ? " disabled" : ""}>
              ${esc(tp.loading ? t("inspiration.fetching") : t("inspiration.fetchTopic"))}
            </button>
          </div>
          ${
            tp.payload
              ? `<div class="vf-topic-preview"><span class="vf-tag">${esc(tp.payload.source)}</span><p>${esc(
                  (tp.payload.text || "").slice(0, 220),
                )}</p></div>`
              : ""
          }
        </div>

        <button type="button" class="vf-btn vf-btn--primary" id="vf-generate"${gen.loading ? " disabled" : ""}>
          ${esc(gen.loading ? t("inspiration.generating") : t("inspiration.generate"))}
        </button>
        ${gen.error ? `<p class="vf-error">${esc(gen.error)}</p>` : ""}
      </div>`;

    wire();
  };

  function wire() {
    bindCommittedInput(root.querySelector("#vf-idea"), (value) => store.set({ idea: value }));
    root.querySelector("#vf-style").addEventListener("change", (e) => store.set({ style: e.target.value }));
    root.querySelector("#vf-duration").addEventListener("change", (e) => store.set({ duration: Number(e.target.value) }));
    root.querySelector("#vf-shots").addEventListener("change", (e) => store.set({ shots: Number(e.target.value) }));
    root.querySelector("#vf-provider").addEventListener("change", (e) => store.set({ provider: e.target.value }));
    bindCommittedInput(root.querySelector("#vf-topic-query"), (value) =>
      store.set({ topic: { ...store.get().topic, query: value } }),
    );
    root.querySelector("#vf-topic-source").addEventListener("change", (e) =>
      store.set({ topic: { ...store.get().topic, source: e.target.value } }),
    );

    root.querySelector("#vf-fetch").addEventListener("click", async () => {
      const { topic } = store.get();
      store.set({ topic: { ...topic, loading: true } });
      try {
        const payload = await api.topic(topic.query, topic.source);
        topicResult = payload;
        // 用 await 后的最新 topic 合并，避免覆盖等待期间用户的输入
        store.set({
          topic: { ...store.get().topic, loading: false, payload },
          idea: payload.text || store.get().idea,
        });
        toast(t("inspiration.fetched", { source: payload.source, count: (payload.items || []).length }), "ok");
      } catch (err) {
        store.set({ topic: { ...store.get().topic, loading: false } });
        toast(`${t("toast.failed")}: ${err.message}`, "error");
      }
    });

    root.querySelector("#vf-generate").addEventListener("click", async () => {
      const s = store.get();
      if (!String(s.idea || "").trim()) {
        toast(t("inspiration.emptyIdea"), "error");
        return;
      }
      store.set({ generation: { loading: true, result: null, error: null } });
      try {
        const result = await api.idea({
          idea: s.idea,
          style: s.style,
          duration: Number(s.duration),
          shots: Number(s.shots),
          provider: s.provider === "offline" ? "offline" : null,
          seed_keywords: topicResult?.visual_keywords || null,
        });
        store.set({
          generation: { loading: false, result, error: null },
          script: result.director_script,
          storyboard: result.storyboard,
        });
      } catch (err) {
        store.set({ generation: { loading: false, result: null, error: err.message } });
        toast(`${t("toast.failed")}: ${err.message}`, "error");
      }
    });
  }

  store.subscribe((s, prev) => {
    // 只在结构性状态变化时重绘。
    // idea / topic.query 的逐字更新不重绘：否则会替换正在输入的 DOM 节点，
    // 导致失焦、光标跳到末尾，并直接中断中文 IME 合成。
    if (
      !prev ||
      prev.generation !== s.generation ||
      prev.topic.loading !== s.topic.loading ||
      prev.topic.payload !== s.topic.payload ||
      prev.topic.source !== s.topic.source
    ) {
      render();
    }
  });
  onLangChange(render);
  return render;
}