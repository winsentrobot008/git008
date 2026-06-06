const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

// ============================================================
// Constants
// ============================================================
const ROOT_DIR = () => {
  const folders = vscode.workspace.workspaceFolders;
  return folders ? folders[0].uri.fsPath : "";
};
const ANTI_FREEZE_DIR = () => path.join(ROOT_DIR(), "Cline-anti-freeze");
const FAULT_BLACKBOX_PATH = () => path.join(ANTI_FREEZE_DIR(), "fault_blackbox.json");
const GLOBAL_CONTROLS_PATH = () => path.join(ANTI_FREEZE_DIR(), "global_controls.json");
const INSTANCE_REGISTRY_PATH = () => path.join(ANTI_FREEZE_DIR(), ".instance_registry.json");
const POLL_INTERVAL_MS = 3000;
const NOTIFY_COOLDOWN_MS = 30000; // 两次相同告警间隔
const SILENCE_PERIOD_MS = 60000; // 告警静默期：单项目忽略后60秒内不再弹窗
const HEARTBEAT_CORRUPT_THRESHOLD_SEC = 3600; // 心跳数据损坏阈值：超过1小时视为脏数据
const HEARTBEAT_RECOVERING_THRESHOLD_SEC = 60; // 心跳 TTL：超过60秒标记为 recovering

// ============================================================
// State
// ============================================================
let currentView = null;
let pollTimer = null;
let lastNotifyStatus = "healthy";
let lastNotifyTime = 0;
/** @type {Map<string, number>} 项目名 -> 静默到期时间戳 (ms) */
const projectSilenceUntil = new Map();

// ============================================================
// Data Loaders
// ============================================================
function readJsonSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    }
  } catch (_) {}
  return null;
}

function writeJsonSafe(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2, { flag: "w" }), "utf-8");
    return true;
  } catch (_) {}
  return false;
}

function discoverSubprojects() {
  const root = ROOT_DIR();
  if (!root || !fs.existsSync(root)) return [];
  const discovered = [];
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const govEntry = path.join(root, entry.name, ".governance_entry.py");
      if (fs.existsSync(govEntry)) {
        const hbFile = path.join(root, entry.name, ".heartbeat");
        discovered.push({
          name: entry.name,
          path: path.join(root, entry.name),
          heartbeat_file: hbFile,
          heartbeat_exists: fs.existsSync(hbFile),
        });
      }
    }
  } catch (_) {}
  return discovered.sort((a, b) => a.name.localeCompare(b.name));
}

function loadGlobalControls() {
  const defaults = {
    pause_all_production: false,
    risk_threshold: 0.7,
    heartbeat_timeout_sec: 120,
    auto_self_heal: true,
    alert_broadcast: true,
  };
  const stored = readJsonSafe(GLOBAL_CONTROLS_PATH());
  if (stored) {
    for (const k of Object.keys(defaults)) {
      if (!(k in stored)) stored[k] = defaults[k];
    }
    return stored;
  }
  return { ...defaults };
}

function saveGlobalControls(controls) {
  writeJsonSafe(GLOBAL_CONTROLS_PATH(), controls);
}

function loadFaultBlackbox() {
  const data = readJsonSafe(FAULT_BLACKBOX_PATH());
  return data || { version: "1.0", last_updated: null, projects: {} };
}

function checkHeartbeat(project) {
  const hbPath = project.heartbeat_file;
  const result = {
    name: project.name,
    status: "UNKNOWN",
    last_heartbeat_ago_sec: null,
    last_heartbeat_ts: null,
    health_score: 0.0,
  };
  if (fs.existsSync(hbPath)) {
    const stat = fs.statSync(hbPath);
    let ago = (Date.now() - stat.mtimeMs) / 1000;

    // 异常数据过滤：心跳时间超过1小时视为数据损坏，强制重置为0
    if (ago > HEARTBEAT_CORRUPT_THRESHOLD_SEC) {
      ago = 0;
      // 将 .heartbeat 文件 mtime 重置为当前时间以修复后续轮询
      try {
        const now = new Date();
        fs.utimesSync(hbPath, now, now);
      } catch (_) {}
    }

    result.last_heartbeat_ago_sec = Math.round(ago * 10) / 10;
    result.last_heartbeat_ts = stat.mtime.toISOString();
    const timeout = loadGlobalControls().heartbeat_timeout_sec || 120;

    if (ago > HEARTBEAT_RECOVERING_THRESHOLD_SEC && ago <= timeout) {
      result.status = "RECOVERING";
      result.health_score = Math.max(0.0, 1.0 - ago / timeout);
    } else if (ago > timeout) {
      result.status = "HANG";
      result.health_score = Math.max(0.0, 1.0 - ago / timeout);
    } else {
      result.status = "OK";
      result.health_score = Math.max(0.0, 1.0 - ago / timeout);
    }
  }
  return result;
}

function computeReport() {
  const projects = discoverSubprojects();
  const blackbox = loadFaultBlackbox();
  const controls = loadGlobalControls();

  const projectStatuses = [];
  let hangingCount = 0;
  let totalHealth = 0.0;

  for (const proj of projects) {
    const status = checkHeartbeat(proj);

    // Blackbox cross-check
    const bbEntry = (blackbox.projects || {})[proj.name] || {};
    if (bbEntry.status === "HANG") {
      status.status = "HANG";
      status.blackbox_confirmed = true;
      status.detected_hang_at = bbEntry.detected_hang_at || null;
    }

    if (status.status === "HANG") {
      hangingCount++;
    }
    totalHealth += status.health_score;
    projectStatuses.push(status);
  }

  const overallHealth =
    projectStatuses.length > 0
      ? Math.round((totalHealth / projectStatuses.length) * 1000) / 10
      : 100.0;

  let overallStatus = "healthy";
  if (hangingCount > 0) {
    overallStatus = "critical";
  }

  return {
    timestamp: new Date().toISOString(),
    overall_status: overallStatus,
    overall_health_score: overallHealth,
    project_count: projectStatuses.length,
    hanging_count: hangingCount,
    projects: projectStatuses,
    controls: controls,
  };
}

// ============================================================
// Native Notification (右下角气泡)
// ============================================================
async function showNativeAlert(report) {
  const now = Date.now();
  const rawStatus = report.overall_status;

  // 过滤静默期内的项目：不从 notify 列表中移除，但跳过弹窗
  const hangingProjects = report.projects.filter((p) => {
    if (p.status !== "HANG") return false;
    // 若该项目在静默期内，则排除
    const silenceUntil = projectSilenceUntil.get(p.name);
    if (silenceUntil && now < silenceUntil) return false;
    return true;
  });
  const activeHangingCount = hangingProjects.length;

  // 若所有 HANG 项目都在静默期，则视为 healthy 不做告警
  let effectiveStatus = rawStatus;
  if (rawStatus === "critical" && activeHangingCount === 0) {
    effectiveStatus = "healthy";
  }

  // 只在状态变化时通知，且有冷却
  if (effectiveStatus === lastNotifyStatus && now - lastNotifyTime < NOTIFY_COOLDOWN_MS) {
    return;
  }

  if (effectiveStatus === "critical" && activeHangingCount > 0) {
    lastNotifyStatus = "critical";
    lastNotifyTime = now;
    const projectsHanging = hangingProjects
      .map((p) => p.name)
      .join(", ");
    const selection = await vscode.window.showWarningMessage(
      `⚠️ 治理告警 - ${activeHangingCount} 个项目卡死: ${projectsHanging}`,
      { modal: false },
      "查看治理面板",
      "忽略",
    );
    if (selection === "查看治理面板") {
      vscode.commands.executeCommand("cline-governance.openView");
    } else if (selection === "忽略") {
      // 静默所有当前告警项目 60 秒
      const silenceUntil = now + SILENCE_PERIOD_MS;
      for (const p of hangingProjects) {
        projectSilenceUntil.set(p.name, silenceUntil);
      }
      // 同时将黑盒中的项目标记为已确认处理
      const blackbox = loadFaultBlackbox();
      for (const p of hangingProjects) {
        blackbox.projects[p.name] = {
          status: "ACKNOWLEDGED",
          acknowledged_at: new Date().toISOString(),
        };
      }
      blackbox.last_updated = new Date().toISOString();
      writeJsonSafe(FAULT_BLACKBOX_PATH(), blackbox);
      vscode.window.showInformationMessage(
        `🔇 已忽略 ${hangingProjects.length} 个告警项目，${SILENCE_PERIOD_MS / 1000} 秒内不再提醒`,
      );
    }
  } else if (effectiveStatus === "healthy" && lastNotifyStatus === "critical") {
    lastNotifyStatus = "healthy";
    lastNotifyTime = now;
    vscode.window.showInformationMessage(
      "✅ 治理恢复 - 所有项目健康",
      { modal: false },
    );
  }
}

// ============================================================
// WebviewView Provider
// ============================================================
class GovernancePanelProvider {
  constructor() {
    this._view = null;
  }

  resolveWebviewView(webviewView) {
    this._view = webviewView;
    currentView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };

    webviewView.webview.html = this.getHtmlContent();
    webviewView.webview.onDidReceiveMessage((message) => {
      this.handleMessage(message, webviewView);
    });

    // Immediately send initial report
    this.sendReport(webviewView);
  }

  handleMessage(message, webviewView) {
    switch (message.command) {
      case "refresh":
        // 重新读取 .heartbeat 数据并发送给前端
        this.sendReport(webviewView);
        break;
      case "updateControl": {
        const controls = loadGlobalControls();
        if (message.key in controls) {
          controls[message.key] = message.value;
          saveGlobalControls(controls);
        }
        this.sendReport(webviewView);
        break;
      }
      case "clearBlackbox": {
        // 清空 fault_blackbox.json
        writeJsonSafe(FAULT_BLACKBOX_PATH(), {
          version: "1.0",
          last_updated: null,
          projects: {},
        });
        vscode.window.showInformationMessage("🧹 黑盒已清空");
        this.sendReport(webviewView);
        break;
      }
      case "resetAllHeartbeats": {
        // 强制重置所有项目心跳：清空黑盒 + 重置所有 .heartbeat 文件 mtime
        const root = ROOT_DIR();
        if (root) {
          const projects = discoverSubprojects();
          const now = new Date();
          let resetCount = 0;
          for (const proj of projects) {
            if (proj.heartbeat_exists && fs.existsSync(proj.heartbeat_file)) {
              try {
                // 重置心跳文件 mtime 为当前时间，内容写入 healthy
                fs.writeFileSync(proj.heartbeat_file, JSON.stringify({ status: "healthy", last_update: 0 }), "utf-8");
                fs.utimesSync(proj.heartbeat_file, now, now);
                resetCount++;
              } catch (_) {}
            }
          }
          // 清空黑盒
          writeJsonSafe(FAULT_BLACKBOX_PATH(), {
            version: "1.0",
            last_updated: null,
            projects: {},
          });
          // 清除静默期
          projectSilenceUntil.clear();
          lastNotifyStatus = "healthy";
          lastNotifyTime = 0;
          vscode.window.showInformationMessage(
            `🔄 已强制重置 ${resetCount} 个项目状态，黑盒已清空，静默期已解除`
          );
        }
        this.sendReport(webviewView);
        break;
      }
      case "killAllAgents": {
        // 物理终止 python.exe 进程
        cp.exec('taskkill /F /IM python.exe', (err, stdout, stderr) => {
          if (err) {
            vscode.window.showErrorMessage(`🔪 终止 Python Agent 失败: ${err.message}`);
          } else {
            vscode.window.showInformationMessage("🔪 已强制终止所有 Python Agent 进程");
          }
        });
        // 同时终止 node.exe 进程
        cp.exec('taskkill /F /IM node.exe', (err) => {
          if (!err) {
            console.log("🔪 Node Agent 进程已终止");
          }
        });
        this.sendReport(webviewView);
        break;
      }
      default:
        break;
    }
  }

  sendReport(webviewView) {
    if (!webviewView) webviewView = this._view;
    if (!webviewView) return;
    const report = computeReport();
    webviewView.webview.postMessage({
      type: "governanceReport",
      report: report,
    });
  }

  getHtmlContent() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🏛️ 治理中心</title>
<style>
  :root {
    --bg: var(--vscode-editor-background, #0f172a);
    --fg: var(--vscode-editor-foreground, #e2e8f0);
    --border: var(--vscode-sideBar-border, #1e293b);
    --accent: var(--vscode-button-background, #6366f1);
    --accent-fg: var(--vscode-button-foreground, #ffffff);
    --green: #22c55e;
    --red: #ef4444;
    --orange: #f97316;
    --yellow: #eab308;
    --blue: #3b82f6;
    --card-bg: var(--vscode-input-background, #1e293b);
    --dim: var(--vscode-descriptionForeground, #64748b);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background-color: var(--vscode-editor-background);
    color: var(--vscode-editor-foreground);
    padding: 10px;
    font-family: var(--vscode-font-family);
    font-size: 14.2px;
    user-select: none;
    overflow-x: hidden;
  }
  /* Header */
  .panel-header {
    padding: 10px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    background: var(--bg);
    z-index: 10;
  }
  .panel-header .title {
    font-weight: 700;
    font-size: 1.05em;
    flex: 1;
  }
  .status-badge {
    font-size: 0.82em;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 10px;
    text-transform: uppercase;
  }
  .status-badge.healthy { background: #1a3a1a; color: var(--green); }
  .status-badge.critical { background: #3a1a1a; color: var(--red); animation: pulse-badge 1.5s infinite; }
  @keyframes pulse-badge { 50% { opacity: 0.6; } }

  /* Sections */
  .section {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }
  .section-title {
    font-size: 0.92em;
    font-weight: 600;
    color: var(--dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  /* KPIs */
  .kpi-row {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  }
  .kpi-card {
    flex: 1;
    background: var(--card-bg);
    border-radius: 6px;
    padding: 8px 10px;
    text-align: center;
    border: 1px solid var(--border);
  }
  .kpi-value {
    font-size: 1.5em;
    font-weight: 700;
  }
  .kpi-label {
    font-size: 0.77em;
    color: var(--dim);
    margin-top: 2px;
  }
  .kpi-value.green { color: var(--green); }
  .kpi-value.red { color: var(--red); }
  .kpi-value.orange { color: var(--orange); }

  /* Controls */
  .control-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
  }
  .control-label {
    font-size: 1.02em;
  }
  .toggle-switch {
    position: relative;
    width: 36px;
    height: 20px;
  }
  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0; left: 0; right: 0; bottom: 0;
    background: #4c4f69;
    border-radius: 20px;
    transition: 0.2s;
  }
  .toggle-slider::before {
    content: "";
    position: absolute;
    height: 14px; width: 14px;
    left: 3px; bottom: 3px;
    background: #fff;
    border-radius: 50%;
    transition: 0.2s;
  }
  input:checked + .toggle-slider { background: var(--accent); }
  input:checked + .toggle-slider::before { transform: translateX(16px); }
  .slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
  }
  .slider-row input[type="range"] {
    flex: 1;
    accent-color: var(--accent);
  }
  .slider-value {
    font-size: 0.92em;
    min-width: 36px;
    text-align: right;
    color: var(--dim);
  }

  /* Project cards */
  .project-card {
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    margin-bottom: 6px;
    transition: border-color 0.3s, background 0.3s;
  }
  .project-card.hang {
    border-color: var(--red);
    background: #2a1015;
  }
  .proj-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }
  .proj-name {
    font-weight: 600;
    font-size: 1.02em;
  }
  .proj-status {
    font-size: 0.82em;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 8px;
  }
  .proj-status.ok { background: #064e3b; color: var(--green); }
  .proj-status.hang { background: #450a0a; color: var(--red); }
  .proj-status.recovering { background: #422006; color: var(--yellow); }
  .proj-status.unknown { background: #1e293b; color: var(--orange); }
  .project-card.recovering {
    border-color: var(--yellow);
    background: #1a1400;
  }
  .proj-meta {
    font-size: 0.84em;
    color: var(--dim);
    display: flex;
    justify-content: space-between;
  }
  .health-bar {
    height: 4px;
    border-radius: 2px;
    background: #313244;
    margin-top: 4px;
    overflow: hidden;
  }
  .health-bar-fill {
    height: 100%;
    border-radius: 2px;
    transition: width 0.5s;
  }
  .health-bar-fill.good { background: var(--green); }
  .health-bar-fill.warn { background: var(--orange); }
  .health-bar-fill.critical { background: var(--red); }

  /* Actions */
  .action-row {
    display: flex;
    gap: 6px;
    padding: 6px 0;
  }
  .btn {
    flex: 1;
    padding: 6px 10px;
    border: none;
    border-radius: 4px;
    background-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    cursor: pointer;
    font-size: 0.92em;
    font-weight: 600;
    text-align: center;
    transition: background 0.15s;
  }
  .btn:hover { background-color: var(--vscode-button-hoverBackground); }
  .btn.danger { background-color: var(--red); color: #fff; }
  .btn.danger:hover { background-color: #dc2626; }
  .btn.warning { background-color: var(--orange); color: #fff; }
  .btn.warning:hover { background-color: #ea580c; }

  /* Footer */
  .panel-footer {
    padding: 8px 12px;
    font-size: 0.82em;
    color: var(--dim);
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>
<div class="panel-header">
  <span style="font-size: 1.2em;">🏛️</span>
  <span class="title">治理中心</span>
  <span class="status-badge healthy" id="global-badge">HEALTHY</span>
</div>

<!-- KPI Section -->
<div class="section">
  <div class="section-title">📊 实时概览</div>
  <div class="kpi-row">
    <div class="kpi-card">
      <div class="kpi-value green" id="kpi-health">--%</div>
      <div class="kpi-label">健康指数</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value" id="kpi-projects">0</div>
      <div class="kpi-label">活跃项目</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value red" id="kpi-hanging">0</div>
      <div class="kpi-label">卡死</div>
    </div>
  </div>
</div>

<!-- Controls Section -->
<div class="section">
  <div class="section-title">⚖️ 全局宪法控制</div>
  <div class="control-row">
    <span class="control-label">🛑 暂停所有生产</span>
    <label class="toggle-switch">
      <input type="checkbox" id="ctrl-pause" onchange="updateControl('pause_all_production', this.checked)">
      <span class="toggle-slider"></span>
    </label>
  </div>
  <div class="control-row">
    <span class="control-label">🔄 自动自愈</span>
    <label class="toggle-switch">
      <input type="checkbox" id="ctrl-autoheal" checked onchange="updateControl('auto_self_heal', this.checked)">
      <span class="toggle-slider"></span>
    </label>
  </div>
  <div class="control-row">
    <span class="control-label">📡 告警广播</span>
    <label class="toggle-switch">
      <input type="checkbox" id="ctrl-broadcast" checked onchange="updateControl('alert_broadcast', this.checked)">
      <span class="toggle-slider"></span>
    </label>
  </div>
  <div class="slider-row">
    <span style="font-size: 0.92em;">🎚️ 容忍阈值</span>
    <input type="range" id="ctrl-threshold" min="0" max="1" step="0.05" value="0.7" oninput="document.getElementById('threshold-val').textContent = this.value">
    <span class="slider-value" id="threshold-val">0.7</span>
  </div>
  <div class="slider-row">
    <span style="font-size: 0.92em;">⏱️ 超时 (s)</span>
    <input type="range" id="ctrl-timeout" min="30" max="600" step="10" value="120" oninput="document.getElementById('timeout-val').textContent = this.value">
    <span class="slider-value" id="timeout-val">120</span>
  </div>
</div>

<!-- Actions -->
<div class="section">
  <div class="section-title">🎬 治理操作</div>
  <div class="action-row">
    <button class="btn" onclick="refresh()">🔄 刷新</button>
    <button class="btn" onclick="clearBlackbox()">🧹 清空黑盒</button>
  </div>
  <div class="action-row">
    <button class="btn warning" onclick="resetAllHeartbeats()">🔄 强制重置所有项目状态</button>
  </div>
  <div class="action-row">
    <button class="btn danger" onclick="killAllAgents()">🔪 强制终止所有 Agent</button>
  </div>
</div>

<!-- Projects List -->
<div class="section">
  <div class="section-title">🏭 工厂监控</div>
  <div id="projects-list">
    <div style="color: var(--dim); text-align: center; padding: 16px;">等待数据...</div>
  </div>
</div>

<div class="panel-footer">
  <span id="poll-time">--</span>
  <span>治理 v2.0</span>
</div>

<script>
  const vscode = acquireVsCodeApi();

  function refresh() {
    vscode.postMessage({ command: "refresh" });
  }

  function updateControl(key, value) {
    vscode.postMessage({ command: "updateControl", key: key, value: value });
  }

  function clearBlackbox() {
    vscode.postMessage({ command: "clearBlackbox" });
  }

  function resetAllHeartbeats() {
    vscode.postMessage({ command: "resetAllHeartbeats" });
  }

  function killAllAgents() {
    vscode.postMessage({ command: "killAllAgents" });
  }

  // Listen for report updates from extension
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "governanceReport") {
      renderReport(msg.report);
    }
  });

  function renderReport(report) {
    if (!report) return;

    // KPI
    const health = report.overall_health_score || 0;
    document.getElementById("kpi-health").textContent = health.toFixed(1) + "%";
    document.getElementById("kpi-health").className =
      "kpi-value " + (health >= 70 ? "green" : health >= 40 ? "orange" : "red");
    document.getElementById("kpi-projects").textContent = report.project_count || 0;
    document.getElementById("kpi-hanging").textContent = report.hanging_count || 0;

    // Global badge
    const badge = document.getElementById("global-badge");
    const status = report.overall_status || "healthy";
    badge.textContent = status === "critical" ? "CRITICAL" : "HEALTHY";
    badge.className = "status-badge " + (status === "critical" ? "critical" : "healthy");

    // Controls
    const ctrl = report.controls || {};
    document.getElementById("ctrl-pause").checked = !!ctrl.pause_all_production;
    document.getElementById("ctrl-autoheal").checked = ctrl.auto_self_heal !== false;
    document.getElementById("ctrl-broadcast").checked = ctrl.alert_broadcast !== false;
    document.getElementById("ctrl-threshold").value = ctrl.risk_threshold || 0.7;
    document.getElementById("threshold-val").textContent = ctrl.risk_threshold || 0.7;
    document.getElementById("ctrl-timeout").value = ctrl.heartbeat_timeout_sec || 120;
    document.getElementById("timeout-val").textContent = ctrl.heartbeat_timeout_sec || 120;

    // Projects
    const projects = report.projects || [];
    const list = document.getElementById("projects-list");
    if (projects.length === 0) {
      list.innerHTML = '<div style="color: var(--dim); text-align: center; padding: 16px;">无已注册项目</div>';
    } else {
      let html = "";
      projects.forEach((proj) => {
        const name = proj.name || "?";
        const pStatus = proj.status || "UNKNOWN";
        const score = (proj.health_score || 0) * 100;
        const ago = proj.last_heartbeat_ago_sec;
        const hangClass = pStatus === "HANG" ? " hang" : pStatus === "RECOVERING" ? " recovering" : "";
        const statusLabel = pStatus === "OK" ? "正常" : pStatus === "HANG" ? "卡死" : pStatus === "RECOVERING" ? "恢复中" : "未知";
        const statusClass = pStatus === "OK" ? "ok" : pStatus === "HANG" ? "hang" : pStatus === "RECOVERING" ? "recovering" : "unknown";
        const barClass = score >= 70 ? "good" : score >= 30 ? "warn" : "critical";
        const emoji = pStatus === "OK" ? "💚" : pStatus === "HANG" ? "💀" : pStatus === "RECOVERING" ? "🔄" : "❓";

        html += \`<div class="project-card\${hangClass}">
          <div class="proj-header">
            <span class="proj-name">\${emoji} \${name}</span>
            <span class="proj-status \${statusClass}">\${statusLabel}</span>
          </div>
          <div class="proj-meta">
            <span>心跳: \${ago != null ? ago + "s" : "N/A"}</span>
            <span>健康: \${score.toFixed(0)}%</span>
          </div>
          <div class="health-bar">
            <div class="health-bar-fill \${barClass}" style="width:\${Math.min(100, score).toFixed(0)}%;"></div>
          </div>
        </div>\`;
      });
      list.innerHTML = html;
    }

    // Timestamp
    document.getElementById("poll-time").textContent =
      new Date().toLocaleTimeString();
  }
</script>
</body>
</html>`;
  }
}

// ============================================================
// Polling Loop
// ============================================================
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!currentView) return;
    try {
      const report = computeReport();
      currentView.webview.postMessage({
        type: "governanceReport",
        report: report,
      });
      await showNativeAlert(report);
    } catch (_) {}
  }, POLL_INTERVAL_MS);
}

// ============================================================
// Extension Activation
// ============================================================
function activate(context) {
  console.log("🏛️ Cline 治理中心已激活");

  const provider = new GovernancePanelProvider();

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("cline-governance.panel", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Start polling after a short delay to ensure workspace is ready
  setTimeout(startPolling, 2000);

  // Register focus command — opens the governance panel view in sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand("cline-governance.panel.focus", () => {
      vscode.commands.executeCommand("workbench.view.extension.cline-governance");
    }),
  );

  // Register openView command — opens governance panel (used by notification callback)
  context.subscriptions.push(
    vscode.commands.registerCommand("cline-governance.openView", () => {
      vscode.commands.executeCommand("workbench.view.extension.cline-governance");
    }),
  );

  // Initial status message
  vscode.window.showInformationMessage("🏛️ Cline 治理中心已就绪");
}

function deactivate() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  currentView = null;
}

module.exports = { activate, deactivate };