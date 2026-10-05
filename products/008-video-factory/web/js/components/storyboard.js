/** 可视化导演分镜画布：逐镜头卡片，标注资产锁定 / 轴线方位 / 景别与运镜。 */

import { t, onLangChange } from "../i18n.js";
import { esc, fmtNum } from "../util.js";

const AXIS_TONE = { left: "ok", right: "accent", neutral: "muted" };
const AXIS_LABEL = { left: "storyboard.axisLeft", right: "storyboard.axisRight", neutral: "storyboard.axisNeutral" };

function axisOf(shot) {
  const side = String(shot?.camera?.side || "neutral").toLowerCase();
  return AXIS_LABEL[side] ? side : "neutral";
}

function lockIndex(storyboard) {
  const meta = storyboard?.director_meta || {};
  const map = new Map();
  (meta.asset_locks || []).forEach((lock) => map.set(lock.shot, lock));
  (meta.violations || []).forEach((v) => map.set(`!${v}`, v));
  return { locks: map, violations: meta.violations || [], warnings: meta.warnings || [] };
}

function shotCard(shot, index, locks, violations) {
  const side = axisOf(shot);
  const lock = locks.get(shot.id || shot.scene_id);
  const isViolation = violations.some((v) => String(v).includes(shot.id || "__none__"));
  const camera = shot.camera || {};
  return `
    <article class="vf-shot${isViolation ? " is-violation" : ""}">
      <header class="vf-shot__head">
        <span class="vf-shot__index">#${String(index + 1).padStart(2, "0")}</span>
        <span class="vf-tag">${esc(shot.kind || shot.type || "shot")}</span>
        <span class="vf-pill vf-pill--${isViolation ? "danger" : AXIS_TONE[side]}">
          ${esc(t("storyboard.axis"))} · ${esc(t(AXIS_LABEL[side]))}
        </span>
        ${
          lock
            ? `<span class="vf-pill vf-pill--lock" title="${esc(t("storyboard.lock"))}">🔒 ${esc(t("storyboard.locked"))}</span>`
            : `<span class="vf-pill vf-pill--muted">${esc(t("storyboard.free"))}</span>`
        }
      </header>

      <p class="vf-shot__text">${esc(shot.text || "—")}</p>
      ${shot.subtitle ? `<p class="vf-shot__sub">${esc(shot.subtitle)}</p>` : ""}

      <dl class="vf-shot__meta">
        <div><dt>${esc(t("storyboard.duration"))}</dt><dd>${fmtNum(shot.duration_s, 1)}${esc(t("storyboard.seconds"))}</dd></div>
        <div><dt>${esc(t("storyboard.shotSize"))}</dt><dd>${esc(camera.shot_size || "—")}</dd></div>
        <div><dt>${esc(t("storyboard.movement"))}</dt><dd>${esc(camera.movement || camera.motion || "—")}</dd></div>
        ${isViolation ? `<div><dt>${esc(t("storyboard.violation"))}</dt><dd class="vf-danger">⚠</dd></div>` : ""}
      </dl>

      ${
        (shot.asset_queries || []).length
          ? `<footer class="vf-shot__queries">${(shot.asset_queries || [])
              .map((q) => `<span class="vf-chip">${esc(q)}</span>`)
              .join("")}</footer>`
          : ""
      }
    </article>`;
}

export function mount(root, store) {
  const render = () => {
    const { script, storyboard, generation } = store.get();
    const shots = script?.shots || [];
    const { locks, violations, warnings } = lockIndex(storyboard);
    const metrics = storyboard?.director_meta || {};

    root.innerHTML = `
      <div class="vf-card vf-card--canvas">
        <header class="vf-card__head">
          <h2>${esc(t("storyboard.title"))}</h2>
          ${
            shots.length
              ? `<div class="vf-metrics">
                   <span>${esc(t("storyboard.metrics.shots"))} <b>${metrics.shot_count ?? shots.length}</b></span>
                   <span>${esc(t("storyboard.metrics.duration"))} <b>${fmtNum(metrics.duration_seconds, 1)}</b></span>
                   <span>${esc(t("storyboard.metrics.locks"))} <b>${(metrics.asset_locks || []).length}</b></span>
                   <span class="${violations.length ? "vf-danger" : ""}">${esc(t("storyboard.metrics.violations"))} <b>${violations.length}</b></span>
                 </div>`
              : ""
          }
        </header>

        ${
          generation?.result?.repairs?.length
            ? `<div class="vf-banner vf-banner--warn"><b>${esc(t("storyboard.repairs"))}</b><ul>${generation.result.repairs
                .map((r) => `<li>${esc(r)}</li>`)
                .join("")}</ul></div>`
            : ""
        }
        ${
          warnings.length
            ? `<div class="vf-banner"><b>${esc(t("storyboard.warning"))}</b><ul>${warnings
                .map((w) => `<li>${esc(w)}</li>`)
                .join("")}</ul></div>`
            : ""
        }

        <div class="vf-canvas">
          ${shots.length ? shots.map((shot, i) => shotCard(shot, i, locks, violations)).join("") : `<p class="vf-empty">${esc(t("storyboard.empty"))}</p>`}
        </div>
      </div>`;
  };

  store.subscribe((s, prev) => {
    if (!prev || prev.script !== s.script || prev.storyboard !== s.storyboard || prev.generation !== s.generation) render();
  });
  onLangChange(render);
  return render;
}