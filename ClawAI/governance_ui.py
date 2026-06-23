#!/usr/bin/env python3
"""
governance_ui.py — Cline-anti-freeze 治理控制台 (v2.0)
========================================================
基于 Streamlit 的轻量级治理控制台，提供：
  1. 状态实时监控 — 所有子项目治理健康值（基于心跳）
  2. 全域联动墙 — 集成 fault_blackbox.json，卡死/报错时变红并展示故障溯源日志
  3. 全局宪法控制 — 一键暂停所有生产任务、风险阈值调控
  4. WebSocket 服务器 — 实现子项目哨兵实时报告状态
  5. VS Code WebView 嵌入式面板 — 自动在 VSC 中弹出治理面板
  6. 实时工厂监控栏 — 轮询 fault_blackbox.json，异常时侧边栏变红告警

启动方式：
  streamlit run Cline-anti-freeze/governance_ui.py --server.port 8501
  或通过 auto_enforce.py 自动拉起
  --webview-mode  以 VS Code WebView 嵌入式面板模式启动

  VS Code 环境下（检测 VSCODE_CWD 环境变量）自动通过 VSC Simple Browser 打开面板
"""

import os
import sys
import json
import time
import asyncio
import threading
import queue
import signal
import subprocess as sp
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, List, Optional

# ═══════════════════════════════════════════════════════════════
# 治理协议集成 (Chapter 8: Error Reporting & Anti-Hang Protocol)
# ═══════════════════════════════════════════════════════════════
# Import error_reporter for reading error reports
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from error_reporter import get_recent_errors, get_error_summary
    _HAS_ERROR_REPORTER = True
except ImportError:
    _HAS_ERROR_REPORTER = False

# Import watchdog for crash dump reading and recovery planning
try:
    from watchdog import create_clean_restart_plan, kill_zombie_process
    _HAS_WATCHDOG = True
except ImportError:
    _HAS_WATCHDOG = False
# ═══════════════════════════════════════════════════════════════

# ============================================================
# Paths
# ============================================================
THIS_DIR = Path(__file__).resolve().parent
ROOT_DIR = THIS_DIR.parent
ANTI_FREEZE_DIR = THIS_DIR
FAULT_BLACKBOX_PATH = ANTI_FREEZE_DIR / "fault_blackbox.json"
INSTANCE_REGISTRY_PATH = ANTI_FREEZE_DIR / ".instance_registry.json"
ERROR_LOG_PATH = ANTI_FREEZE_DIR / "error_log.md"
CLINERULES_PATH = ANTI_FREEZE_DIR / "clinerules.yaml"
GLOBAL_CONTROLS_PATH = ANTI_FREEZE_DIR / "global_controls.json"
WEBVIEW_TEMPLATE_PATH = ANTI_FREEZE_DIR / "governance_webview.html"

# ============================================================
# Global State (shared between WS server & UI thread)
# ============================================================
class GovernanceState:
    """Thread-safe shared state between WebSocket server and Streamlit UI."""

    def __init__(self):
        self.lock = threading.Lock()
        self.latest_ws_messages: List[Dict] = []  # recent WS messages from sentinels
        self.max_ws_messages = 200
        self.heartbeat_cache: Dict[str, Dict] = {}  # project_name -> status
        self.last_refresh = 0.0

    def add_ws_message(self, msg: Dict):
        with self.lock:
            msg["_received_at"] = datetime.now(timezone.utc).isoformat()
            self.latest_ws_messages.append(msg)
            if len(self.latest_ws_messages) > self.max_ws_messages:
                self.latest_ws_messages = self.latest_ws_messages[-self.max_ws_messages:]

    def get_ws_messages(self) -> List[Dict]:
        with self.lock:
            return list(self.latest_ws_messages)

    def update_heartbeat(self, project_name: str, data: Dict):
        with self.lock:
            self.heartbeat_cache[project_name] = data

    def get_heartbeats(self) -> Dict[str, Dict]:
        with self.lock:
            return dict(self.heartbeat_cache)


state = GovernanceState()

# ============================================================
# Global Controls Persistence
# ============================================================
def load_global_controls() -> Dict:
    """Load global control switches from disk."""
    defaults = {
        "pause_all_production": False,
        "decomposition_depth": 5,  # 多智能体任务拆解层级：5 层深度
        "risk_threshold": 0.7,
        "heartbeat_timeout_sec": 120,
        "auto_self_heal": True,
        "alert_broadcast": True,
    }
    if GLOBAL_CONTROLS_PATH.exists():
        try:
            stored = json.loads(GLOBAL_CONTROLS_PATH.read_text(encoding="utf-8"))
            for k, v in defaults.items():
                if k not in stored:
                    stored[k] = v
            return stored
        except (json.JSONDecodeError, OSError):
            pass
    return dict(defaults)


def save_global_controls(controls: Dict):
    """Persist global control switches to disk."""
    GLOBAL_CONTROLS_PATH.write_text(
        json.dumps(controls, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


# ============================================================
# Data Loaders
# ============================================================
def load_fault_blackbox() -> Dict:
    """Load fault_blackbox.json."""
    if FAULT_BLACKBOX_PATH.exists():
        try:
            return json.loads(FAULT_BLACKBOX_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"version": "1.0", "last_updated": None, "projects": {}}


def load_instance_registry() -> Dict:
    """Load instance registry."""
    if INSTANCE_REGISTRY_PATH.exists():
        try:
            return json.loads(INSTANCE_REGISTRY_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def discover_subprojects() -> List[Dict]:
    """Discover all subprojects with .governance_entry.py."""
    discovered = []
    if not ROOT_DIR.exists():
        return discovered
    try:
        for entry in sorted(ROOT_DIR.iterdir()):
            if entry.is_dir() and not entry.name.startswith("."):
                gov_entry = entry / ".governance_entry.py"
                if gov_entry.exists():
                    hb_file = entry / ".heartbeat"
                    discovered.append({
                        "name": entry.name,
                        "path": str(entry),
                        "heartbeat_file": str(hb_file),
                        "heartbeat_exists": hb_file.exists(),
                    })
    except OSError:
        pass
    return discovered


HEARTBEAT_RECOVERING_THRESHOLD_SEC = 60  # 心跳 TTL：超过60秒标记为 recovering
HEARTBEAT_CORRUPT_THRESHOLD_SEC = 3600  # 心跳数据损坏阈值：超过1小时视为脏数据


def check_project_heartbeat(project: Dict) -> Dict:
    """Check a single project's heartbeat."""
    hb_path = Path(project["heartbeat_file"])
    result = {
        "name": project["name"],
        "status": "UNKNOWN",
        "last_heartbeat_ago_sec": None,
        "last_heartbeat_ts": None,
        "health_score": 0.0,
    }
    if hb_path.exists():
        ago = time.time() - hb_path.stat().st_mtime

        # 异常数据过滤：心跳时间超过1小时视为数据损坏，强制重置为0
        if ago > HEARTBEAT_CORRUPT_THRESHOLD_SEC:
            ago = 0
            try:
                now = time.time()
                os.utime(str(hb_path), (now, now))
            except OSError:
                pass

        result["last_heartbeat_ago_sec"] = round(ago, 1)
        result["last_heartbeat_ts"] = datetime.fromtimestamp(
            hb_path.stat().st_mtime, tz=timezone.utc
        ).isoformat()
        timeout = load_global_controls().get("heartbeat_timeout_sec", 120)

        if ago > HEARTBEAT_RECOVERING_THRESHOLD_SEC and ago <= timeout:
            result["status"] = "RECOVERING"
            result["health_score"] = max(0.0, 1.0 - (ago / timeout))
        elif ago > timeout:
            result["status"] = "HANG"
            result["health_score"] = max(0.0, 1.0 - (ago / timeout))
        else:
            result["status"] = "OK"
            result["health_score"] = max(0.0, 1.0 - (ago / timeout))
    return result


def extract_error_snapshot(project_name: str, limit: int = 10) -> List[Dict]:
    """Extract recent error entries from error_log.md for a given project."""
    import re
    errors = []
    if not ERROR_LOG_PATH.exists():
        return errors
    try:
        content = ERROR_LOG_PATH.read_text(encoding="utf-8")
    except (OSError, IOError):
        return errors

    pattern = r"## \[([^\]]+)\s*\|\s*([^\]]+)\s*\|\s*([^\]]+)\]\n- \*\*错误\*\*: (.+?)\n"
    matches = re.findall(pattern, content)

    proj_lower = project_name.lower().replace(" ", "").replace("-", "").replace("_", "")
    for ts_str, inst_id, module, err_msg in matches:
        inst_lower = inst_id.lower()
        module_lower = module.lower()
        if proj_lower in inst_lower or proj_lower in module_lower:
            errors.append({
                "timestamp": ts_str.strip(),
                "instance_id": inst_id.strip(),
                "module": module.strip(),
                "error": err_msg.strip(),
            })

    return errors[-limit:]


def compute_governance_report() -> Dict:
    """Compute a full governance report for the UI."""
    projects = discover_subprojects()
    blackbox = load_fault_blackbox()
    registry = load_instance_registry()
    controls = load_global_controls()

    project_statuses = []
    hanging_count = 0
    total_health = 0.0

    for proj in projects:
        status = check_project_heartbeat(proj)
        proj_name = proj["name"]

        # Check blackbox for this project
        bb_entry = blackbox.get("projects", {}).get(proj_name, {})
        if bb_entry.get("status") == "HANG":
            status["status"] = "HANG"
            status["blackbox_confirmed"] = True
            status["error_snapshot"] = bb_entry.get("error_snapshot", [])
            status["detected_hang_at"] = bb_entry.get("detected_hang_at")

        # Also extract from error_log directly
        if status["status"] == "HANG" and not status.get("error_snapshot"):
            status["error_snapshot"] = extract_error_snapshot(proj_name)

        if status["status"] == "HANG":
            hanging_count += 1

        total_health += status["health_score"]
        project_statuses.append(status)

    overall_health = (total_health / len(project_statuses) * 100) if project_statuses else 100.0

    # Check stale instances from registry
    stale_instances = []
    now = datetime.now()
    for inst_id, info in registry.items():
        last_hb = info.get("last_heartbeat") or info.get("registered_at")
        if last_hb:
            try:
                last_hb_dt = datetime.fromisoformat(last_hb)
                stale_sec = (now - last_hb_dt).total_seconds()
                if stale_sec > 90:
                    stale_instances.append({
                        "instance_id": inst_id,
                        "role": info.get("role", "unknown"),
                        "stale_seconds": int(stale_sec),
                    })
            except (ValueError, TypeError):
                pass

    # Overall status
    if hanging_count == 0 and len(stale_instances) == 0:
        overall_status = "healthy"
    elif hanging_count > 0:
        overall_status = "critical"
    else:
        overall_status = "degraded"

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "overall_status": overall_status,
        "overall_health_score": round(overall_health, 1),
        "project_count": len(project_statuses),
        "hanging_count": hanging_count,
        "projects": project_statuses,
        "stale_instances": stale_instances,
        "active_instances": len(registry),
        "controls": controls,
        "blackbox_last_updated": blackbox.get("last_updated"),
    }


# ============================================================
# WebSocket Server (for sentinel status reporting)
# ============================================================
WS_HOST = "0.0.0.0"
WS_PORT = 8769

_try_ws = False
try:
    import websockets
    _try_ws = True
except ImportError:
    _try_ws = False


async def ws_handler(websocket):
    """Handle incoming WebSocket connections from sentinels."""
    remote = websocket.remote_address
    print(f"[WS] 哨兵连接: {remote}")
    try:
        async for message in websocket:
            try:
                data = json.loads(message)
                msg_type = data.get("type", "unknown")

                if msg_type == "heartbeat":
                    project = data.get("project", "unknown")
                    state.update_heartbeat(project, {
                        "status": data.get("status", "OK"),
                        "last_heartbeat_ts": data.get("timestamp", ""),
                        "health_score": data.get("health_score", 1.0),
                    })
                    await websocket.send(json.dumps({"ack": True, "type": "heartbeat_ack"}))

                elif msg_type == "alert":
                    state.add_ws_message(data)
                    await websocket.send(json.dumps({"ack": True, "type": "alert_ack"}))

                elif msg_type == "status_report":
                    state.add_ws_message(data)
                    await websocket.send(json.dumps({"ack": True, "type": "report_ack"}))

                elif msg_type == "ping":
                    await websocket.send(json.dumps({"type": "pong", "timestamp": datetime.now(timezone.utc).isoformat()}))

                else:
                    state.add_ws_message(data)
                    await websocket.send(json.dumps({"ack": True}))

            except json.JSONDecodeError:
                pass
    except websockets.exceptions.ConnectionClosed:
        print(f"[WS] 哨兵断开: {remote}")


async def ws_main():
    """Start the WebSocket server."""
    print(f"[WS] WebSocket 服务器启动 ws://{WS_HOST}:{WS_PORT}")
    async with websockets.serve(ws_handler, WS_HOST, WS_PORT):
        await asyncio.Future()  # run forever


def start_ws_server():
    """Start WebSocket server in a background daemon thread."""
    if not _try_ws:
        print("[WS] ⚠️ websockets 未安装，跳过 WebSocket 服务器")
        return None

    loop = asyncio.new_event_loop()

    def _run():
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(ws_main())
        except Exception as e:
            print(f"[WS] 服务器异常: {e}")

    t = threading.Thread(target=_run, daemon=True, name="gov-ws-server")
    t.start()
    return t


# ============================================================
# VSCode WebView Integration
# ============================================================
def generate_webview_html(streamlit_url: str, ws_url: str) -> str:
    """Generate a self-contained HTML page for VSCode Simple Browser WebView."""
    bb_path_abs = FAULT_BLACKBOX_PATH.as_posix()
    return f'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🏛️ Cline 治理指挥中心</title>
<style>
  :root {{
    --bg: #0d1117;
    --card-bg: #161b22;
    --border: #30363d;
    --text: #c9d1d9;
    --text-dim: #8b949e;
    --green: #00c853;
    --red: #ff1744;
    --orange: #ff9100;
    --blue: #58a6ff;
  }}
  * {{ margin:0; padding:0; box-sizing:border-box; }}
  body {{
    font-family: 'Segoe UI', -apple-system, sans-serif;
    background: var(--bg);
    color: var(--text);
    display: flex;
    height: 100vh;
    overflow: hidden;
  }}
  /* ---- 主内容区 (Streamlit iframe) ---- */
  #main-content {{
    flex: 1;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--border);
  }}
  #streamlit-frame {{
    flex: 1;
    border: none;
    width: 100%;
  }}
  /* ---- 工厂监控侧边栏 ---- */
  #factory-sidebar {{
    width: 340px;
    min-width: 340px;
    display: flex;
    flex-direction: column;
    background: var(--card-bg);
    transition: background 0.5s, border-color 0.5s;
    border-left: 4px solid var(--green);
  }}
  #factory-sidebar.critical {{
    background: #1a0000;
    border-left-color: var(--red);
    animation: alert-pulse 1.5s infinite;
  }}
  #factory-sidebar.critical .sidebar-header {{
    background: #2a0000;
    border-bottom-color: var(--red);
  }}
  @keyframes alert-pulse {{
    0%, 100% {{ border-left-color: var(--red); }}
    50% {{ border-left-color: #ff5252; box-shadow: inset 0 0 24px rgba(255,23,68,0.3); }}
  }}
  .sidebar-header {{
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: bold;
    font-size: 1.05em;
    background: var(--card-bg);
    transition: background 0.5s;
  }}
  .sidebar-header .status-dot {{
    width: 10px; height: 10px;
    border-radius: 50%;
    background: var(--green);
    display: inline-block;
    transition: background 0.3s;
  }}
  .sidebar-header .status-dot.warn {{ background: var(--orange); }}
  .sidebar-header .status-dot.critical {{ background: var(--red); animation: blink-dot 0.8s infinite; }}
  @keyframes blink-dot {{ 50% {{ opacity: 0.3; }} }}
  .alert-tag {{
    display: none;
    background: var(--red);
    color: #fff;
    font-size: 0.7em;
    font-weight: bold;
    padding: 2px 8px;
    border-radius: 10px;
    margin-left: auto;
    animation: blink-tag 1s infinite;
  }}
  .alert-tag.active {{ display: inline-block; }}
  @keyframes blink-tag {{ 50% {{ opacity: 0.6; }} }}
  #projects-list {{
    flex: 1;
    overflow-y: auto;
    padding: 10px;
  }}
  .project-card {{
    background: #0d1117;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 12px;
    margin-bottom: 8px;
    transition: border-color 0.3s, background 0.3s;
  }}
  .project-card.hang {{
    border-color: var(--red);
    background: #1a0000;
  }}
  .project-card .proj-header {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }}
  .project-card .proj-name {{
    font-weight: 600;
    font-size: 0.95em;
  }}
  .project-card .proj-status {{
    font-size: 0.8em;
    font-weight: bold;
    padding: 1px 8px;
    border-radius: 10px;
  }}
  .project-card .proj-status.ok {{ background: #002a10; color: var(--green); }}
  .project-card .proj-status.hang {{ background: #2a0000; color: var(--red); }}
  .project-card .proj-status.unknown {{ background: #2a1a00; color: var(--orange); }}
  .project-card .proj-meta {{
    font-size: 0.78em;
    color: var(--text-dim);
    display: flex;
    justify-content: space-between;
  }}
  .health-mini-bar {{
    height: 4px;
    border-radius: 2px;
    background: #30363d;
    margin-top: 4px;
    overflow: hidden;
  }}
  .health-mini-bar-fill {{
    height: 100%;
    border-radius: 2px;
    transition: width 0.5s;
  }}
  .health-mini-bar-fill.good {{ background: var(--green); }}
  .health-mini-bar-fill.warn {{ background: var(--orange); }}
  .health-mini-bar-fill.critical {{ background: var(--red); }}
  .fault-mini {{
    font-size: 0.72em;
    color: #ff5252;
    margin-top: 4px;
    padding: 4px 6px;
    background: #1a0000;
    border-radius: 3px;
    border-left: 2px solid var(--red);
  }}
  #footer-bar {{
    padding: 10px 16px;
    border-top: 1px solid var(--border);
    font-size: 0.75em;
    color: var(--text-dim);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }}
  #footer-bar .poll-dot {{
    width: 6px; height: 6px;
    border-radius: 50%;
    background: var(--green);
    display: inline-block;
  }}
  #top-alert-bar {{
    display: none;
    background: var(--red);
    color: #fff;
    text-align: center;
    padding: 8px;
    font-weight: bold;
    font-size: 0.9em;
    animation: alert-bar-pulse 1s infinite;
  }}
  #top-alert-bar.active {{ display: block; }}
  @keyframes alert-bar-pulse {{
    0%, 100% {{ background: var(--red); }}
    50% {{ background: #d50000; }}
  }}
</style>
</head>
<body>

<div id="main-content">
  <div id="top-alert-bar">
    ⚠️ 异常告警 — 检测到项目故障，请立即处理！
  </div>
  <iframe id="streamlit-frame" src="{streamlit_url}" allow="clipboard-read; clipboard-write"></iframe>
</div>

<div id="factory-sidebar">
  <div class="sidebar-header">
    <span class="status-dot" id="global-dot"></span>
    工厂监控栏
    <span class="alert-tag" id="alert-tag">告警</span>
  </div>
  <div id="projects-list">
    <div style="color: var(--text-dim); text-align: center; padding: 20px;">
      等待数据加载...
    </div>
  </div>
  <div id="footer-bar">
    <span>轮询: <span class="poll-dot"></span> 正常</span>
    <span id="poll-time">--</span>
  </div>
</div>

<script>
// ============================================================
// 实时工厂监控栏 — 轮询 fault_blackbox.json
// ============================================================
const BLACKBOX_URL = '/api/blackbox';  // Endpoint served by the Streamlit backend
const POLL_INTERVAL_MS = 3000;         // 每 3 秒拉一次

let lastReport = null;

function getBlackboxData() {{
  // Use fetch to get the blackbox data from the Streamlit API
  // We'll use the Streamlit internal state endpoint or a dedicated proxy
  return fetch(BLACKBOX_URL + '?_=' + Date.now(), {{ cache: 'no-store' }})
    .then(r => r.json())
    .catch(() => null);
}}

function updateSidebar(report) {{
  if (!report || report.error) {{
    // Fallback: use stored report if available
    report = lastReport;
    if (!report) return;
  }}
  lastReport = report;

  const sidebar = document.getElementById('factory-sidebar');
  const globalDot = document.getElementById('global-dot');
  const alertTag = document.getElementById('alert-tag');
  const alertBar = document.getElementById('top-alert-bar');
  const projectsList = document.getElementById('projects-list');
  const pollTime = document.getElementById('poll-time');

  // Update timestamp
  const now = new Date();
  pollTime.textContent = now.toLocaleTimeString();

  // Determine global status
  const status = report.overall_status || 'healthy';
  const hasErrors = status === 'critical' || (report.hanging_count || 0) > 0;

  // Toggle classes
  sidebar.classList.toggle('critical', hasErrors);
  globalDot.className = 'status-dot ' + (status === 'critical' ? 'critical' : (status === 'degraded' ? 'warn' : ''));
  alertTag.classList.toggle('active', hasErrors);
  alertBar.classList.toggle('active', hasErrors);

  if (hasErrors) {{
    alertBar.textContent = `⚠️ 异常告警 — ${{report.hanging_count || 0}} 个项目卡死，请立即处理！`;
  }}

  // Render project cards
  const projects = report.projects || [];
  if (projects.length === 0) {{
    projectsList.innerHTML = '<div style="color: var(--text-dim); text-align: center; padding: 20px;">无已注册项目</div>';
    return;
  }}

  let html = '';
  projects.forEach(proj => {{
    const name = proj.name || '?';
    const status = proj.status || 'UNKNOWN';
    const score = (proj.health_score || 0) * 100;
    const ago = proj.last_heartbeat_ago_sec;
    const hangClass = status === 'HANG' ? ' hang' : '';
    const statusLabel = status === 'OK' ? '正常' : (status === 'HANG' ? '卡死' : '未知');
    const statusClass = status === 'OK' ? 'ok' : (status === 'HANG' ? 'hang' : 'unknown');
    const barClass = score > 70 ? 'good' : (score > 30 ? 'warn' : 'critical');
    const emoji = status === 'OK' ? '💚' : (status === 'HANG' ? '💀' : '❓');

    html += `<div class="project-card${{hangClass}}">
      <div class="proj-header">
        <span class="proj-name">${{emoji}} ${{name}}</span>
        <span class="proj-status ${{statusClass}}">${{statusLabel}}</span>
      </div>
      <div class="proj-meta">
        <span>心跳: ${{ago != null ? ago + '秒前' : 'N/A'}}</span>
        <span>健康: ${{score.toFixed(0)}}%</span>
      </div>
      <div class="health-mini-bar">
        <div class="health-mini-bar-fill ${{barClass}}" style="width: ${{score.toFixed(0)}}%;"></div>
      </div>`;

    // Fault trace for hanging projects
    const errors = proj.error_snapshot || [];
    if (status === 'HANG' && errors.length > 0) {{
      errors.slice(0, 3).forEach(err => {{
        html += `<div class="fault-mini">🕐 ${{(err.timestamp || err.ts || 'N/A').substring(0, 19)}} — ${{(err.error || err.message || '未知错误').substring(0, 80)}}</div>`;
      }});
    }}
    html += '</div>';
  }});

  projectsList.innerHTML = html;
}}

// Polling loop
async function startPolling() {{
  while (true) {{
    try {{
      const data = await getBlackboxData();
      updateSidebar(data);
    }} catch (e) {{
      console.error('[工厂监控栏] 轮询异常:', e);
    }}
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }}
}}

// Start immediately
updateSidebar({{
  overall_status: 'healthy',
  projects: [],
  hanging_count: 0,
}});
startPolling();
</script>
</body>
</html>'''


def serve_webview_api(port: int):
    """Start a lightweight HTTP server that serves the webview HTML and a /api/blackbox endpoint."""
    try:
        from http.server import HTTPServer, BaseHTTPRequestHandler
    except ImportError:
        print("[webview] HTTP server not available")
        return

    webview_url = f"http://localhost:{port}"

    class WebviewHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path.startswith("/api/blackbox"):
                # Return the current governance report as JSON
                try:
                    report = compute_governance_report()
                    body = json.dumps(report, ensure_ascii=False, default=str).encode("utf-8")
                except Exception as e:
                    body = json.dumps({"error": str(e)}).encode("utf-8")

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-store, must-revalidate")
                self.end_headers()
                self.wfile.write(body)
                return

            # Default: serve the webview HTML
            html = generate_webview_html(
                streamlit_url=webview_url,
                ws_url=f"ws://localhost:{WS_PORT}",
            )
            body = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            # Suppress default logging
            pass

    server = HTTPServer(("127.0.0.1", port), WebviewHandler)
    print(f"[webview] WebView 面板 HTTP 服务: http://127.0.0.1:{port}")

    def _serve():
        try:
            server.serve_forever()
        except Exception as e:
            print(f"[webview] HTTP 服务异常: {e}")

    t = threading.Thread(target=_serve, daemon=True, name="webview-http")
    t.start()
    return server, t


def open_vscode_webview_panel(webview_port: int):
    """Use VSCode command to open the WebView panel in a Simple Browser tab."""
    vscode_cwd = os.environ.get("VSCODE_CWD", "")
    if not vscode_cwd:
        print("[webview] 未检测到 VS Code 环境，跳过面板打开")
        # Fallback to external browser
        import webbrowser
        url = f"http://localhost:{webview_port}"
        print(f"[webview] 回退到外部浏览器: {url}")
        webbrowser.open(url)
        return

    url = f"http://localhost:{webview_port}"
    print(f"[webview] 检测到 VS Code 环境 (VSCODE_CWD={vscode_cwd})")
    print(f"[webview] 尝试通过 VS Code Simple Browser 打开面板")

    # Method 1: code --open-url (VSCode Simple Browser)
    try:
        code_path = os.environ.get("VSCODE_IPC_HOOK_CLI", "")
        if not code_path:
            code_cmd = "code"
        else:
            code_cmd = "code"

        result = sp.run(
            [code_cmd, "--open-url", url],
            capture_output=True, text=True, timeout=10,
            cwd=vscode_cwd,
        )
        if result.returncode == 0:
            print(f"[webview] VS Code Simple Browser 已打开: {url}")
            return
        else:
            print(f"[webview] code --open-url 返回 {result.returncode}: {result.stderr.strip()}")
    except Exception as e:
        print(f"[webview] code --open-url 失败: {e}")

    # Method 2: Fallback to external browser
    print(f"[webview] 回退到外部浏览器: {url}")
    import webbrowser
    webbrowser.open(url)


# ============================================================
# Streamlit UI
# ============================================================
def run_streamlit_ui():
    """Main Streamlit UI rendering function."""
    import streamlit as st

    # --- Resolve project name for title display ---
    _project_name = os.environ.get("GOVERNANCE_PROJECT_NAME", "")
    _page_title = f"🏛️ [工厂中控台] 当前监控流水线：{_project_name}" if _project_name else "🏛️ 治理控制台 — Cline-anti-freeze"

    st.set_page_config(
        page_title=_page_title,
        page_icon="🏛️",
        layout="wide",
        initial_sidebar_state="expanded",
    )

    # --- Custom CSS ---
    st.markdown("""
    <style>
    .status-ok { color: #22c55e; font-weight: bold; }
    .status-hang { color: #ef4444; font-weight: bold; animation: blink 1s infinite; }
    .status-recovering { color: #eab308; font-weight: bold; }
    .status-unknown { color: #f97316; font-weight: bold; }
    @keyframes blink { 50% { opacity: 0.5; } }
    .metric-card { background: #1e293b; border-radius: 8px; padding: 16px; margin: 4px 0; border-left: 4px solid #22c55e; }
    .metric-card.hang { border-left-color: #ef4444; background: #2a1015; }
    .metric-card.recovering { border-left-color: #eab308; background: #1a1400; }
    .metric-card.degraded { border-left-color: #f97316; }
    .health-bar { height: 8px; border-radius: 4px; background: #333; margin-top: 4px; }
    .health-bar-fill { height: 100%; border-radius: 4px; transition: width 0.5s; }
    .health-bar-fill.good { background: linear-gradient(90deg, #22c55e, #4ade80); }
    .health-bar-fill.warn { background: linear-gradient(90deg, #f97316, #eab308); }
    .health-bar-fill.critical { background: linear-gradient(90deg, #dc2626, #ef4444); }
    .ws-log { font-family: 'Courier New', monospace; font-size: 0.85em; max-height: 400px; overflow-y: auto; background: #0d1117; padding: 12px; border-radius: 6px; }
    .big-number { font-size: 3em; font-weight: bold; }
    .fault-trace { background: #1a0000; border: 1px solid #ef4444; border-radius: 6px; padding: 12px; margin: 8px 0; font-size: 0.9em; }
    /* 工厂监控栏兼容样式 — 当在 iframe 内时隐藏部分侧边栏 */
    </style>
    """, unsafe_allow_html=True)

    # --- Sidebar: Global Constitution Controls ---
    st.sidebar.markdown("## ⚖️ 全局宪法控制")

    controls = load_global_controls()

    with st.sidebar.expander("🔧 全局开关", expanded=True):
        new_pause = st.toggle(
            "🛑 一键暂停所有生产任务",
            value=controls.get("pause_all_production", False),
            help="启用后将暂停所有子项目的生产级任务执行"
        )
        if new_pause != controls.get("pause_all_production"):
            controls["pause_all_production"] = new_pause
            save_global_controls(controls)
            if new_pause:
                st.sidebar.error("⚠️ 已暂停所有生产任务！")

        new_auto_heal = st.toggle(
            "🔄 自动自愈",
            value=controls.get("auto_self_heal", True),
            help="当检测到卡死时自动触发 kill_all_agents"
        )
        if new_auto_heal != controls.get("auto_self_heal"):
            controls["auto_self_heal"] = new_auto_heal
            save_global_controls(controls)

        new_broadcast = st.toggle(
            "📡 告警广播",
            value=controls.get("alert_broadcast", True),
            help="向所有连接哨兵广播死锁告警"
        )
        if new_broadcast != controls.get("alert_broadcast"):
            controls["alert_broadcast"] = new_broadcast
            save_global_controls(controls)

    with st.sidebar.expander("🎚️ 风险阈值调控", expanded=True):
        new_threshold = st.slider(
            "风险容忍阈值",
            min_value=0.0, max_value=1.0,
            value=controls.get("risk_threshold", 0.7),
            step=0.05,
            help="越低越敏感，越早触发告警。建议范围: 0.5 - 0.8"
        )
        if new_threshold != controls.get("risk_threshold"):
            controls["risk_threshold"] = new_threshold
            save_global_controls(controls)

        new_timeout = st.number_input(
            "心跳超时 (秒)",
            min_value=30, max_value=600,
            value=controls.get("heartbeat_timeout_sec", 120),
            step=10,
            help="子项目无心跳超过此秒数即判定为 HANG"
        )
        if new_timeout != controls.get("heartbeat_timeout_sec"):
            controls["heartbeat_timeout_sec"] = new_timeout
            save_global_controls(controls)

    # --- Sidebar: Multi-Agent Decomposition Depth Control ---
    st.sidebar.markdown("---")
    st.sidebar.markdown("## 🧩 多智能体任务拆解层级")

    depth_options = {
        "2层（快速）": 2,
        "5层（深度）": 5,
    }
    current_depth = controls.get("decomposition_depth", 5)
    # Map current_depth to the closest option label
    depth_label = "5层（深度）" if current_depth >= 5 else "2层（快速）"

    selected_depth_label = st.sidebar.radio(
        "智能体拆解层级",
        options=list(depth_options.keys()),
        index=list(depth_options.keys()).index(depth_label),
        help="2层：快速响应，适合简单任务；5层：深度拆解，适合复杂多步骤任务",
        key="depth_radio",
    )
    new_depth = depth_options[selected_depth_label]
    if new_depth != controls.get("decomposition_depth"):
        controls["decomposition_depth"] = new_depth
        save_global_controls(controls)
        st.sidebar.success(f"✅ 拆解层级已切换为 {new_depth} 层")

    # Show current depth badge
    depth_badge_color = "#00c853" if new_depth == 5 else "#ff9100"
    st.sidebar.markdown(
        f"<div style='text-align:center;padding:8px;background:#161b22;border-radius:6px;"
        f"border:1px solid {depth_badge_color};margin-top:4px;'>"
        f"<span style='font-size:1.5em;font-weight:bold;color:{depth_badge_color};'>{new_depth}</span>"
        f"<span style='color:#aaa;margin-left:6px;'>层拆解激活</span></div>",
        unsafe_allow_html=True,
    )

    # --- Sidebar: Actions ---
    st.sidebar.markdown("---")
    st.sidebar.markdown("## 🎬 治理操作")
    col_a, col_b = st.sidebar.columns(2)
    with col_a:
        if st.button("🔄 刷新数据", use_container_width=True):
            st.rerun()
    with col_b:
        if st.button("🧹 清空黑盒", use_container_width=True):
            if FAULT_BLACKBOX_PATH.exists():
                FAULT_BLACKBOX_PATH.write_text(
                    json.dumps({"version": "1.0", "last_updated": None, "projects": {}}, indent=2),
                    encoding="utf-8",
                )
            st.sidebar.success("黑盒已清空")
            st.rerun()

    if st.sidebar.button("🔄 强制重置所有项目状态", type="secondary", use_container_width=True):
        # 遍历所有项目，重置其 .heartbeat 文件内容为 healthy
        projects = discover_subprojects()
        now = time.time()
        reset_count = 0
        for proj in projects:
            hb_file = Path(proj["heartbeat_file"])
            try:
                hb_file.write_text(
                    json.dumps({"status": "healthy", "last_update": 0}),
                    encoding="utf-8",
                )
                os.utime(str(hb_file), (now, now))
                reset_count += 1
            except OSError:
                pass
        # 清空黑盒
        if FAULT_BLACKBOX_PATH.exists():
            FAULT_BLACKBOX_PATH.write_text(
                json.dumps({"version": "1.0", "last_updated": None, "projects": {}}, indent=2),
                encoding="utf-8",
            )
        st.sidebar.success(f"🔄 已强制重置 {reset_count} 个项目状态，黑盒已清空")
        time.sleep(0.5)
        st.rerun()

    if st.sidebar.button("🔪 强制终止所有 Agent (Self-Heal)", type="primary", use_container_width=True):
        monitor_path = ANTI_FREEZE_DIR / "monitor.py"
        if monitor_path.exists():
            result = sp.run(
                [sys.executable, str(monitor_path), "--kill-all"],
                capture_output=True, text=True, timeout=30,
                cwd=str(ANTI_FREEZE_DIR),
            )
            st.sidebar.text(result.stdout[-500:] if result.stdout else "无输出")
            if result.returncode == 0:
                st.sidebar.success("✅ 已执行 kill_all_agents")
            else:
                st.sidebar.error(f"执行失败: {result.stderr[:200]}")

    st.sidebar.markdown("---")
    st.sidebar.caption(f"治理控制台 v2.0 | WebSocket: ws://localhost:{WS_PORT}")

    # --- Main Content ---
    if _project_name:
        st.title(f"🏛️ [工厂中控台] 当前监控流水线：{_project_name}")
    else:
        st.title("🏛️ 治理控制台 — Cline-anti-freeze")

    # ══════════════════════════════════════════════════════════
    # 第八章：错误报告与防卡死仪表盘
    # ══════════════════════════════════════════════════════════
    with st.expander("🛡️ 第八章：错误报告与防卡死协议 (Chapter 8 Dashboard)", expanded=False):
        err_col1, err_col2, err_col3 = st.columns(3)

        if _HAS_ERROR_REPORTER:
            error_summary = get_error_summary()
            recent_errors = get_recent_errors(limit=20)

            with err_col1:
                st.metric("总错误数", error_summary.get("total_errors", 0))
            with err_col2:
                st.metric("CRITICAL 级错误", error_summary.get("by_severity", {}).get("CRITICAL", 0))
            with err_col3:
                st.metric("涉及模块数", len(error_summary.get("by_module", {})))

            if recent_errors:
                st.subheader("最近错误记录")
                for err in reversed(recent_errors[-10:]):
                    sev = err.get("severity", "ERROR")
                    sev_color = {"CRITICAL": "#ff1744", "ERROR": "#ff9100", "WARNING": "#eab308", "INFO": "#22c55e"}
                    st.markdown(f"""
                    <div style="border-left: 4px solid {sev_color.get(sev, '#888')}; background: #161b22; padding: 8px 12px; margin: 4px 0; border-radius: 4px;">
                        <span style="color: #555; font-size: 0.85em;">{err.get('timestamp', '')[:19]}</span>
                        <span style="color: {sev_color.get(sev, '#888')}; font-weight: bold;"> [{sev}]</span>
                        <span style="color: #58a6ff;"> {err.get('module', '?')}</span>
                        <span style="color: #888;"> — {err.get('error_message', '')[:120]}</span>
                    </div>
                    """, unsafe_allow_html=True)
            else:
                st.info("✅ 无错误记录 — 系统运行正常")
        else:
            st.warning("error_reporter.py 未加载，无法显示错误报告")

        # watchdog crash dump section
        st.divider()
        st.subheader("💥 看门狗崩溃快照 (Crash Dumps)")
        crash_dumps_dir = THIS_DIR / "governance_logs" / "crash_dumps"
        if crash_dumps_dir.exists():
            dumps = sorted(crash_dumps_dir.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
            if dumps:
                for dump in dumps[:5]:
                    try:
                        state_data = json.loads(dump.read_text(encoding="utf-8"))
                        status = state_data.get("status", "?")
                        task_id = state_data.get("task_id", "?")
                        ts = state_data.get("timestamp", "?")[:19]
                        st.markdown(f"""
                        <div style="border-left: 4px solid #ef4444; background: #1a0000; padding: 8px 12px; margin: 4px 0; border-radius: 4px;">
                            <span style="color: #ff5252;">💥 {status.upper()}</span>
                            <span style="color: #888;"> | {ts}</span>
                            <span style="color: #58a6ff;"> | {task_id}</span>
                            <span style="color: #555; font-size: 0.85em;"> | {dump.name}</span>
                        </div>
                        """, unsafe_allow_html=True)
                    except (json.JSONDecodeError, OSError):
                        pass
                if len(dumps) > 5:
                    st.caption(f"... 还有 {len(dumps) - 5} 个历史快照")
            else:
                st.info("无崩溃快照记录")
        else:
            st.info("governance_logs/crash_dumps/ 目录不存在 — 尚未有崩溃记录")

    # Auto-refresh
    if "auto_refresh" not in st.session_state:
        st.session_state.auto_refresh = True
    auto_refresh = st.sidebar.checkbox("⏱️ 自动刷新 (5s)", value=st.session_state.auto_refresh)
    st.session_state.auto_refresh = auto_refresh

    report = compute_governance_report()

    # --- Top Row: KPI Cards ---
    col1, col2, col3, col4, col5 = st.columns(5)

    status_color = {
        "healthy": "#00c853",
        "degraded": "#ff9100",
        "critical": "#ff1744",
    }.get(report["overall_status"], "#999")

    with col1:
        st.markdown(f"""
        <div class="metric-card">
            <div style="font-size: 0.85em; color: #888;">整体状态</div>
            <div class="big-number" style="color: {status_color};">{report['overall_status'].upper()}</div>
        </div>
        """, unsafe_allow_html=True)

    with col2:
        st.markdown(f"""
        <div class="metric-card">
            <div style="font-size: 0.85em; color: #888;">健康指数</div>
            <div class="big-number" style="color: {'#ff1744' if report['overall_health_score'] < 50 else '#00c853'};">{report['overall_health_score']}%</div>
        </div>
        """, unsafe_allow_html=True)

    with col3:
        st.metric("活跃项目", report["project_count"], delta=None)

    with col4:
        hanging = report["hanging_count"]
        st.metric("卡死项目", hanging, delta=f"⚠️ {hanging}" if hanging > 0 else "✅ 0")

    with col5:
        st.metric("活跃实例", report["active_instances"])

    st.divider()

    # --- Main Layout: Two Columns ---
    left_col, right_col = st.columns([3, 2])

    with left_col:
        st.subheader("📊 子项目治理健康值")

        if not report["projects"]:
            st.info("未发现已注册子项目。运行 onboard_scanner.py 以自动发现项目。")
        else:
            for proj in report["projects"]:
                name = proj["name"]
                status = proj["status"]
                score = proj["health_score"] * 100
                ago = proj.get("last_heartbeat_ago_sec")

                # Card styling
                card_class = ""
                if status == "HANG":
                    card_class = "hang"
                elif status == "RECOVERING":
                    card_class = "recovering"
                elif status == "UNKNOWN":
                    card_class = "degraded"

                bar_class = "good" if score > 70 else ("warn" if score > 30 else "critical")
                status_cn = "正常" if status == "OK" else ("卡死" if status == "HANG" else ("恢复中" if status == "RECOVERING" else "未知"))
                status_emoji = "💚" if status == "OK" else ("💀" if status == "HANG" else ("🔄" if status == "RECOVERING" else "❓"))

                st.markdown(f"""
                <div class="metric-card {card_class}">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <strong style="font-size: 1.2em;">{status_emoji} {name}</strong>
                        <span class="status-{'hang' if status == 'HANG' else 'recovering' if status == 'RECOVERING' else 'ok' if status == 'OK' else 'unknown'}">{status_cn}</span>
                    </div>
                    <div style="margin-top: 4px; color: #aaa; font-size: 0.85em;">
                        最后心跳: {ago if ago is not None else 'N/A'} 秒前 | 健康值: {score:.0f}%
                    </div>
                    <div class="health-bar">
                        <div class="health-bar-fill {bar_class}" style="width: {score:.0f}%;"></div>
                    </div>
                </div>
                """, unsafe_allow_html=True)

                # Fault trace for hanging projects
                if status == "HANG" and proj.get("error_snapshot"):
                    with st.expander(f"🔍 故障溯源: {name}", expanded=True):
                        for err in proj["error_snapshot"]:
                            st.markdown(f"""
                            <div class="fault-trace">
                                <div style="color: #ff5252; font-weight: bold;">🕐 {err.get('timestamp', 'N/A')}</div>
                                <div>实例: {err.get('instance_id', 'N/A')} | 模块: {err.get('module', 'N/A')}</div>
                                <div style="color: #ff8a80; margin-top: 4px;">{err.get('error', 'N/A')}</div>
                            </div>
                            """, unsafe_allow_html=True)
                        if proj.get("detected_hang_at"):
                            st.caption(f"首次检测到卡死: {proj['detected_hang_at']}")

        # Stale instances
        if report.get("stale_instances"):
            st.subheader("⏱️ 心跳超时实例")
            for si in report["stale_instances"]:
                st.warning(f"实例 {si['instance_id']} ({si['role']}) 已 {si['stale_seconds']}秒 无心跳")

    with right_col:
        st.subheader("📡 全域联动墙 — 实时哨兵消息")

        ws_msgs = state.get_ws_messages()
        if ws_msgs:
            st.markdown(f'<div class="ws-log">', unsafe_allow_html=True)
            for msg in reversed(ws_msgs[-50:]):
                msg_type = msg.get("type", "unknown")
                project = msg.get("project", msg.get("name", "-"))
                ts = msg.get("timestamp", msg.get("_received_at", ""))[:19]
                severity = msg.get("severity", "INFO")
                sev_color = "#ff1744" if severity == "CRITICAL" else ("#ff9100" if severity == "WARNING" else "#00c853")

                st.markdown(f"""
                <div style="margin: 4px 0; padding: 6px; border-left: 3px solid {sev_color}; background: #161b22; border-radius: 3px;">
                    <span style="color: #555;">{ts}</span>
                    <span style="color: {sev_color}; font-weight: bold;"> [{severity}]</span>
                    <span style="color: #58a6ff;"> {project}</span>
                    <span style="color: #888;"> — {msg.get('message', msg_type)}</span>
                </div>
                """, unsafe_allow_html=True)
            st.markdown('</div>', unsafe_allow_html=True)
        else:
            st.info("等待哨兵连接... (ws://localhost:{})".format(WS_PORT))

        st.divider()
        st.subheader("📋 全局控制状态")
        st.json(report["controls"])

        st.divider()
        st.subheader("💾 黑盒最后更新")
        st.text(report.get("blackbox_last_updated") or "从未更新")

    # Auto-refresh logic
    if auto_refresh:
        time.sleep(5)
        st.rerun()


# ============================================================
# Entry Point
# ============================================================
def main():
    """Main entry: start WebSocket server then run Streamlit."""
    global WS_PORT
    import argparse

    parser = argparse.ArgumentParser(description="Cline-anti-freeze 治理控制台 v2.0")
    parser.add_argument("--port", type=int, default=8501, help="Streamlit 端口 (默认 8501)")
    parser.add_argument("--ws-port", type=int, default=WS_PORT, help="WebSocket 端口 (默认 8769)")
    parser.add_argument("--no-browser", action="store_true", help="不自动打开浏览器/WebView面板")
    parser.add_argument("--headless", action="store_true", help="无头模式（仅启动 WS 服务器）")
    parser.add_argument("--webview-mode", action="store_true", help="VS Code WebView 嵌入式面板模式")
    parser.add_argument("--webview-port", type=int, default=8599, help="WebView HTTP 服务端口 (默认 8599)")
    parser.add_argument("--project-name", type=str, default=None, help="当前监控流水线项目名称 (用于标题栏展示)")
    args = parser.parse_args()

    WS_PORT = args.ws_port

    # Store project name for UI title
    project_name = args.project_name or os.environ.get("GOVERNANCE_PROJECT_NAME", "")
    if project_name:
        os.environ["GOVERNANCE_PROJECT_NAME"] = project_name

    # Start WebSocket server in background
    ws_thread = start_ws_server()
    if ws_thread:
        print(f"[governance_ui] WebSocket 服务器已启动 ws://localhost:{WS_PORT}")

    if args.headless:
        print("[governance_ui] 无头模式运行中，WebSocket 服务器就绪，按 Ctrl+C 退出")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("[governance_ui] 已退出")
        return

    # Run Streamlit UI
    print(f"[governance_ui] Streamlit UI 启动: http://localhost:{args.port}")
    print(f"[governance_ui] WebSocket 端点: ws://localhost:{WS_PORT}")

    # ---- First-startup force browser open (ensure UI panel pops in editor) ----
    FIRST_RUN_FLAG = ANTI_FREEZE_DIR / ".governance_first_run"
    is_first_run = not FIRST_RUN_FLAG.exists()

    if is_first_run and not args.no_browser:
        print("[governance_ui] 首次启动检测 -> 强制弹出 UI 面板")
        # Mark first run complete immediately to avoid race with re-launches
        try:
            FIRST_RUN_FLAG.write_text("initialized", encoding="utf-8")
        except OSError:
            pass
        # Force webbrowser.open as primary popup mechanism
        dashboard_url = f"http://localhost:{args.port}"
        try:
            import webbrowser
            webbrowser.open(dashboard_url)
            print(f"[governance_ui] webbrowser.open({dashboard_url}) 已触发")
        except Exception as e:
            print(f"[governance_ui] webbrowser.open 失败: {e}")

    # ---- WebView Mode: Start dedicated HTTP server + VSCode Simple Browser ----
    if args.webview_mode:
        try:
            # Wait a moment for Streamlit to boot
            print("[webview] 等待 Streamlit 就绪...")
            time.sleep(2)

            webview_port = args.webview_port
            server, _ = serve_webview_api(webview_port)
            time.sleep(0.5)

            if not args.no_browser:
                open_vscode_webview_panel(webview_port)

        except Exception as e:
            print(f"[webview] WebView 启动异常: {e}")

    # ---- VS Code 环境自动打开面板 (非 webview-mode 时的回退) ----
    if not args.webview_mode:
        _vscode_cwd = os.environ.get("VSCODE_CWD", "")
        if _vscode_cwd and not args.no_browser:
            dashboard_url = f"http://localhost:{args.port}"
            print(f"[governance_ui] 检测到 VS Code 环境 (VSCODE_CWD={_vscode_cwd})")
            print(f"[governance_ui] 尝试通过 VS Code Simple Browser 打开面板 -> {dashboard_url}")

            try:
                code_cmd = "code"
                result = sp.run(
                    [code_cmd, "--open-url", dashboard_url],
                    capture_output=True, text=True, timeout=10,
                    cwd=_vscode_cwd,
                )
                if result.returncode == 0:
                    print(f"[governance_ui] VS Code Simple Browser 已打开")
                else:
                    print(f"[governance_ui] code --open-url 返回 {result.returncode}, 回退外部浏览器")
                    import webbrowser
                    webbrowser.open(dashboard_url)
            except Exception as e:
                print(f"[governance_ui] code --open-url 失败: {e}, 回退外部浏览器")
                import webbrowser
                webbrowser.open(dashboard_url)

    import subprocess as subproc_mod
    cmd = [
        sys.executable, "-m", "streamlit", "run", __file__,
        "--server.port", str(args.port),
        "--server.headless", "true",
    ]
    if args.no_browser:
        cmd.append("--server.headless")
        cmd.append("true")

    # Use environment to signal we're being invoked by ourselves
    os.environ["GOVERNANCE_UI_PORT"] = str(args.port)
    os.environ["GOVERNANCE_WS_PORT"] = str(args.ws_port)

    subproc_mod.run(cmd, cwd=str(ROOT_DIR))


# When invoked by streamlit directly, run the UI
if __name__ == "__main__":
    # Check if we're being run by streamlit or directly
    if "STREAMLIT" in os.environ.get("_", "").upper() or os.environ.get("STREAMLIT_RUNTIME"):
        run_streamlit_ui()
    else:
        main()