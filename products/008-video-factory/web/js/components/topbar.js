/** 监控顶栏：GPU 显存/负载、ComfyUI 心跳、自适应路由、语言切换、连接状态。 */

import { t, onLangChange, getLang, availableLangs, setLang } from "../i18n.js";
import { esc, fmtNum, pct } from "../util.js";

function meter(label, value, percent, tone) {
  return `
    <div class="vf-meter">
      <div class="vf-meter__head"><span>${esc(label)}</span><b>${esc(value)}</b></div>
      <div class="vf-meter__track"><i class="vf-meter__fill tone-${tone}" style="width:${percent.toFixed(1)}%"></i></div>
    </div>`;
}

function pill(text, tone, dot = false) {
  return `<span class="vf-pill vf-pill--${tone}">${dot ? '<i class="vf-dot"></i>' : ""}${esc(text)}</span>`;
}

export function mount(root, store) {
  const render = () => {
    const { system, connected, busy } = store.get();
    const gpu = system?.gpu || {};
    const comfy = system?.comfyui || {};
    const backend = system?.backend || {};
    const device = (gpu.devices && gpu.devices[0]) || gpu;

    // 标签恒显 GPU（i18n 稳定），设备型号作为附加信息拼接，避免顶栏丢失 GPU 标识。
    const gpuLabel = gpu.available
      ? `${t("topbar.gpu")} \u00b7 ${escapedGpuName(device.name)}`
      : t("topbar.gpu");
    const gpuValue = gpu.available
      ? `${fmtNum(device.vram_used_mb)} / ${fmtNum(device.vram_total_mb)} MB`
      : t("topbar.unavailable");
    const vramPercent = gpu.available ? pct(device.vram_used_mb, device.vram_total_mb) : 0;
    const utilPercent = gpu.available ? Number(device.util_pct || 0) : 0;

    root.innerHTML = `
      <div class="vf-topbar__brand">
        <span class="vf-logo">008</span>
        <div>
          <h1>${esc(t("topbar.title"))}</h1>
          <p>${esc(t("topbar.subtitle"))}</p>
        </div>
      </div>

      <div class="vf-topbar__meters">
        ${meter(
          gpuLabel,
          gpuValue,
          vramPercent,
          vramPercent > 85 ? "danger" : "accent",
        )}
        ${meter(t("topbar.util"), gpu.available ? `${fmtNum(utilPercent, 1)}%` : "—", utilPercent, "ok")}
      </div>

      <div class="vf-topbar__pills">
        ${pill(
          `${t("topbar.comfyui")} · ${comfy.available ? t("topbar.comfyuiOnline") : t("topbar.comfyuiOffline")}`,
          comfy.available ? "ok" : "muted",
          true,
        )}
        ${comfy.available ? pill(`${t("topbar.svdReady")}: ${comfy.svd_ready ? t("common.yes") : t("common.no")}`, "muted") : ""}
        ${pill(`${t("topbar.backend")}: ${backend.selected || "—"}`, backend.selected === "comfyui" ? "accent" : "muted")}
        ${system?.ffmpeg?.nvenc ? pill(t("topbar.nvenc"), "ok") : ""}
        ${busy ? pill(t("topbar.busy"), "accent", true) : ""}
        ${pill(connected ? t("topbar.connected") : t("topbar.disconnected"), connected ? "ok" : "danger", true)}
      </div>

      <div class="vf-topbar__lang">
        <div class="vf-seg" role="group" aria-label="${esc(t("common.switchLanguage"))}">
          ${Object.entries(availableLangs())
            .map(
              ([code, label]) =>
                `<button type="button" class="vf-seg__btn${code === getLang() ? " is-active" : ""}" data-lang="${code}">${esc(label)}</button>`,
            )
            .join("")}
        </div>
      </div>`;

    root.querySelectorAll("[data-lang]").forEach((btn) => {
      btn.addEventListener("click", () => setLang(btn.dataset.lang));
    });
  };

  function escapedGpuName(name) {
    return String(name || t("topbar.gpu")).replace(/NVIDIA\s+/i, "");
  }

  store.subscribe(render);
  onLangChange(render);
  return render;
}