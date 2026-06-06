"""
Maneki-AI Factory Dashboard — Streamlit UI (v0.6.0-factory)

仪表盘组件：
  1. 顶部三盏状态指示灯 — 系统安全指数 / 任务堆积深度 / 自愈重试率
  2. 告警弹窗流 — WebSocket risk_alert 红色边框告警日志
  3. 任务链动态进度条 — retrying 时黄色闪烁进度条
  4. 操作干预面板 — 管理中心：手动控制 RiskManager BLOCK_THRESHOLD

数据源：
  - REST API: GET /api/factory_status (由 app.py 提供)
  - REST API: GET /api/risk_threshold, POST /api/risk_threshold
  - 本地文件: task_state.json, logs/risk_alerts.log, error_log.md (fallback)
"""

import os
import sys
import json
import time
import threading
from datetime import datetime, timezone

import streamlit as st
import requests
import pandas as pd

# ── Page Configuration ────────────────────────────────────────────────────
st.set_page_config(
    page_title="Maneki-AI 工厂仪表盘",
    page_icon="🏭",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Constants ─────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
API_BASE_URL = os.environ.get("MANEKI_API_URL", "http://localhost:8000")
TASK_STATE_PATH = os.path.join(BASE_DIR, "task_state.json")
RISK_ALERTS_PATH = os.path.join(BASE_DIR, "logs", "risk_alerts.log")
ERROR_LOG_PATH = os.path.join(BASE_DIR, "error_log.md")
REFRESH_INTERVAL_SEC = 3  # Auto-refresh interval

# ── Risk Level Color Mapping ──────────────────────────────────────────────
RISK_COLORS = {
    "CRITICAL":  {"bg": "#ff4444", "text": "#ffffff", "border": "#cc0000"},
    "HIGH":      {"bg": "#ff8800", "text": "#ffffff", "border": "#cc6600"},
    "ELEVATED":  {"bg": "#ffcc00", "text": "#333333", "border": "#cc9900"},
    "MODERATE":  {"bg": "#44aaff", "text": "#ffffff", "border": "#2288cc"},
    "LOW":       {"bg": "#44cc44", "text": "#ffffff", "border": "#229922"},
}

RISK_EMOJI = {
    "CRITICAL": "🔴",
    "HIGH": "🟠",
    "ELEVATED": "🟡",
    "MODERATE": "🔵",
    "LOW": "🟢",
}

# ── Track latest WebSocket risk alerts (in-memory across reruns) ────────
if "risk_alert_stream" not in st.session_state:
    st.session_state.risk_alert_stream = []


# ── CSS Injection ─────────────────────────────────────────────────────────
def inject_css():
    st.markdown("""
    <style>
    .stApp { background-color: #0d1117; }

    /* ── 三盏状态指示灯卡片 ── */
    .status-light-card {
        background: #161b22;
        border: 1px solid #30363d;
        border-radius: 16px;
        padding: 24px 20px;
        text-align: center;
        position: relative;
        overflow: hidden;
        transition: box-shadow 0.3s ease, border-color 0.3s ease;
    }
    .status-light-card:hover { box-shadow: 0 6px 20px rgba(88,166,255,0.12); }
    .status-light-icon {
        font-size: 48px;
        line-height: 1;
        margin-bottom: 12px;
        display: block;
    }
    .status-light-label {
        font-size: 13px;
        color: #8b949e;
        text-transform: uppercase;
        letter-spacing: 1.5px;
        margin-bottom: 6px;
    }
    .status-light-value {
        font-size: 42px;
        font-weight: 900;
        line-height: 1;
        margin-bottom: 4px;
    }
    .status-light-sub {
        font-size: 13px;
        color: #6e7681;
    }
    /* 安全指数配色 */
    .safety-high { color: #3fb950; border-top: 3px solid #3fb950; }
    .safety-mid  { color: #d29922; border-top: 3px solid #d29922; }
    .safety-low  { color: #f85149; border-top: 3px solid #f85149; }
    /* 堆积深度配色 */
    .queue-low   { color: #58a6ff; border-top: 3px solid #58a6ff; }
    .queue-mid   { color: #d29922; border-top: 3px solid #d29922; }
    .queue-high  { color: #f85149; border-top: 3px solid #f85149; }
    /* 自愈率配色 */
    .heal-high   { color: #3fb950; border-top: 3px solid #3fb950; }
    .heal-mid    { color: #d29922; border-top: 3px solid #d29922; }
    .heal-low    { color: #f85149; border-top: 3px solid #f85149; }

    /* ── 告警弹窗流 ── */
    .risk-alert-popup {
        border: 2px solid #f85149;
        background: rgba(248, 81, 73, 0.08);
        border-radius: 10px;
        padding: 14px 18px;
        margin-bottom: 8px;
        animation: alertSlideIn 0.4s ease;
    }
    .risk-alert-popup .alert-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 6px;
    }
    .risk-alert-popup .alert-badge {
        background: #f85149;
        color: #fff;
        font-weight: 700;
        font-size: 11px;
        padding: 2px 10px;
        border-radius: 12px;
        text-transform: uppercase;
    }
    .risk-alert-popup .alert-ts {
        font-size: 11px;
        color: #6e7681;
        margin-left: auto;
    }
    @keyframes alertSlideIn {
        from { opacity: 0; transform: translateX(-20px); }
        to   { opacity: 1; transform: translateX(0); }
    }

    /* ── 黄色闪烁重试进度条 ── */
    @keyframes retryPulse {
        0%, 100% { opacity: 0.6; }
        50%      { opacity: 1.0; }
    }
    .retry-bar-wrapper {
        border: 2px solid #d29922;
        border-radius: 6px;
        padding: 2px;
        animation: retryPulse 1.2s ease-in-out infinite;
        background: rgba(210, 153, 34, 0.08);
    }
    .retrying-dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background-color: #d29922;
        animation: retryPulse 0.8s ease-in-out infinite;
        margin-right: 8px;
    }

    /* ── 通用告警条目 ── */
    .alert-item {
        padding: 12px 16px;
        border-radius: 8px;
        margin-bottom: 8px;
        border-left: 4px solid;
        font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
        font-size: 13px;
        animation: fadeIn 0.3s ease;
    }
    .alert-critical { background: rgba(255,68,68,0.12); border-color: #ff4444; color: #ff6b6b; }
    .alert-high     { background: rgba(255,136,0,0.12); border-color: #ff8800; color: #ffa94d; }
    .alert-elevated { background: rgba(255,204,0,0.10); border-color: #ffcc00; color: #ffd43b; }
    .alert-moderate { background: rgba(68,170,255,0.10); border-color: #44aaff; color: #74c0fc; }
    .alert-low      { background: rgba(68,204,68,0.10); border-color: #44cc44; color: #69db7c; }

    .retry-task-id { font-family: 'SF Mono', monospace; font-size: 12px; color: #58a6ff; }

    .admin-panel {
        background: #161b22; border: 1px solid #30363d;
        border-radius: 12px; padding: 24px; margin-top: 16px;
    }
    .admin-panel h3 { color: #58a6ff; margin-bottom: 12px; }
    .threshold-badge {
        display: inline-block; padding: 4px 14px;
        border-radius: 20px; font-weight: 700; font-size: 18px;
    }
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
    }

    /* ── 跨域联动墙 ── */
    .cross-domain-wall {
        margin-top: 8px;
    }
    .domain-row {
        display: flex;
        align-items: center;
        padding: 10px 16px;
        border-bottom: 1px solid #21262d;
        font-family: 'SF Mono', 'Cascadia Code', monospace;
        font-size: 13px;
    }
    .domain-name {
        flex: 0 0 160px;
        font-weight: 700;
        color: #c9d1d9;
    }
    .domain-status {
        flex: 0 0 100px;
        font-weight: 700;
        text-align: center;
    }
    .status-ok {
        color: #3fb950;
        background: rgba(63,185,80,0.1);
        padding: 2px 12px;
        border-radius: 12px;
    }
    .status-hang {
        color: #f85149;
        background: rgba(248,81,73,0.12);
        padding: 2px 12px;
        border-radius: 12px;
        animation: retryPulse 1s ease-in-out infinite;
    }
    .status-unknown {
        color: #8b949e;
        background: rgba(139,148,158,0.1);
        padding: 2px 12px;
        border-radius: 12px;
    }
    .domain-latency {
        flex: 0 0 120px;
        color: #6e7681;
        font-size: 12px;
    }
    .domain-event {
        flex: 1;
        color: #f85149;
        font-size: 12px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    </style>
    """, unsafe_allow_html=True)


# ══════════════════════════════════════════════════════════════════════════════
#  Data Fetching Helpers
# ══════════════════════════════════════════════════════════════════════════════

@st.cache_data(ttl=2)
def fetch_factory_status() -> dict | None:
    try:
        resp = requests.get(f"{API_BASE_URL}/api/factory_status", timeout=5)
        if resp.status_code == 200:
            return resp.json()
    except requests.RequestException:
        pass
    return None


@st.cache_data(ttl=3)
def fetch_fault_status() -> dict | None:
    """Fetch cross-domain project heartbeat status from /api/fault_status."""
    try:
        resp = requests.get(f"{API_BASE_URL}/api/fault_status", timeout=5)
        if resp.status_code == 200:
            return resp.json()
    except requests.RequestException:
        pass
    return None


def fetch_fault_status_local() -> dict:
    """Fallback: scan sibling directories directly for .heartbeat files."""
    import time as time_mod
    root = os.path.dirname(BASE_DIR)
    projects = {}
    if not os.path.isdir(root):
        return {"projects": projects}
    for entry in sorted(os.listdir(root)):
        proj_path = os.path.join(root, entry)
        if not os.path.isdir(proj_path) or entry.startswith("."):
            continue
        gov_entry = os.path.join(proj_path, ".governance_entry.py")
        if not os.path.isfile(gov_entry):
            continue
        hb_file = os.path.join(proj_path, ".heartbeat")
        ago_sec = None
        status = "UNKNOWN"
        hb_ts = None
        if os.path.isfile(hb_file):
            ago_sec = time_mod.time() - os.path.getmtime(hb_file)
            hb_ts = datetime.fromtimestamp(os.path.getmtime(hb_file), tz=timezone).isoformat()
            status = "HANG" if ago_sec > 120 else "OK"
        else:
            gov_link = os.path.join(proj_path, ".governance_link")
            if os.path.isfile(gov_link):
                ago_sec = time_mod.time() - os.path.getmtime(gov_link)
                hb_ts = datetime.fromtimestamp(os.path.getmtime(gov_link), tz=timezone).isoformat()
                status = "HANG" if ago_sec > 120 else "OK"
        projects[entry] = {
            "status": status,
            "last_heartbeat_ago_sec": round(ago_sec, 1) if ago_sec else None,
            "last_heartbeat_ts": hb_ts,
            "last_checked": datetime.now(timezone.utc).isoformat(),
        }
    return {"projects": projects}


@st.cache_data(ttl=2)
def fetch_risk_threshold() -> dict | None:
    try:
        resp = requests.get(f"{API_BASE_URL}/api/risk_threshold", timeout=3)
        if resp.status_code == 200:
            return resp.json()
    except requests.RequestException:
        pass
    return None


def set_risk_threshold_api(threshold: int) -> dict:
    try:
        resp = requests.post(
            f"{API_BASE_URL}/api/risk_threshold",
            json={"threshold": threshold},
            timeout=5,
        )
        return resp.json()
    except requests.RequestException as e:
        return {"status": "error", "message": str(e)}


def load_task_state_local() -> dict:
    if os.path.isfile(TASK_STATE_PATH):
        try:
            with open(TASK_STATE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"tasks": {}, "last_updated": None, "total_tasks_tracked": 0}


def load_risk_alerts_local(limit: int = 20) -> list[dict]:
    alerts = []
    if os.path.isfile(RISK_ALERTS_PATH):
        try:
            with open(RISK_ALERTS_PATH, "r", encoding="utf-8") as f:
                lines = f.readlines()
            for line in lines[-limit:]:
                line = line.strip()
                if line:
                    try:
                        alerts.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
        except (IOError, OSError):
            pass
    return alerts


def parse_error_log_stats() -> dict:
    """Parse error_log.md for self-healing retry rate (offline fallback)."""
    stats = {
        "total_retry_attempts": 0,
        "unique_failed_tasks": 0,
        "self_healing_retry_rate": 0.0,
        "latest_errors": [],
    }
    if not os.path.isfile(ERROR_LOG_PATH):
        return stats
    try:
        with open(ERROR_LOG_PATH, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except (IOError, OSError):
        return stats

    task_ids_seen = set()
    error_rows = []
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("| Timestamp"):
            continue
        if line.startswith("|") and "|" in line[1:]:
            parts = [p.strip() for p in line.split("|")]
            if len(parts) >= 4:
                tid = parts[2] if len(parts) > 2 else ""
                if tid:
                    task_ids_seen.add(tid)
                    error_rows.append({
                        "task_id": tid,
                        "attempt": parts[3] if len(parts) > 3 else "",
                        "returncode": parts[5] if len(parts) > 5 else "",
                        "stderr": parts[6][:150] if len(parts) > 6 else "",
                    })
    stats["total_retry_attempts"] = len(error_rows)
    stats["unique_failed_tasks"] = len(task_ids_seen)
    stats["latest_errors"] = error_rows[-5:]

    state = load_task_state_local()
    tasks_dict = state.get("tasks", {})
    healed = sum(1 for tid in task_ids_seen if tasks_dict.get(tid, {}).get("status") in ("success", "completed"))
    total = len(task_ids_seen)
    if total > 0:
        stats["self_healing_retry_rate"] = round((healed / total) * 100, 1)
    return stats


# ══════════════════════════════════════════════════════════════════════════════
#  UI Section ── 三盏状态指示灯 (TOP)
# ══════════════════════════════════════════════════════════════════════════════

def render_status_lights(status: dict):
    """
    顶部三张卡片：
      1. 系统安全指数 (RiskManager 历史拦截率)
      2. 任务堆积深度 (PriorityTaskQueue 长度)
      3. 自愈重试率   (error_log.md 统计)
    """
    st.markdown("## 🚦 生产状态指示灯")

    security_index = status.get("system_security_index", 100)
    queue_depth = status.get("queue_depth", 0)
    self_heal_rate = status.get("self_healing_retry_rate", 0.0)

    # Determine classes for each card
    if security_index >= 80:
        sec_class = "status-light-card safety-high"
        sec_icon = "🛡️"
        sec_label = "高度安全"
    elif security_index >= 50:
        sec_class = "status-light-card safety-mid"
        sec_icon = "⚠️"
        sec_label = "中等风险"
    else:
        sec_class = "status-light-card safety-low"
        sec_icon = "🚨"
        sec_label = "危险"

    if queue_depth == 0:
        q_class = "status-light-card queue-low"
        q_icon = "✅"
        q_label = "队列空闲"
    elif queue_depth <= 5:
        q_class = "status-light-card queue-mid"
        q_icon = "📥"
        q_label = "轻微堆积"
    else:
        q_class = "status-light-card queue-high"
        q_icon = "🔥"
        q_label = "严重堆积"

    if self_heal_rate >= 80:
        h_class = "status-light-card heal-high"
        h_icon = "💚"
        h_label = "优秀自愈"
    elif self_heal_rate >= 40:
        h_class = "status-light-card heal-mid"
        h_icon = "💛"
        h_label = "部分自愈"
    else:
        h_class = "status-light-card heal-low"
        h_icon = "❤️‍🩹"
        h_label = "需人工介入"

    col1, col2, col3 = st.columns(3)

    with col1:
        st.markdown(f"""
        <div class="{sec_class}">
            <span class="status-light-icon">{sec_icon}</span>
            <div class="status-light-label">系统安全指数</div>
            <div class="status-light-value">{security_index}</div>
            <div class="status-light-sub">{sec_label} · 阈值 {status.get('block_threshold', 3)}</div>
        </div>
        """, unsafe_allow_html=True)

    with col2:
        pending = status.get("pending_count", 0)
        processing = status.get("processing_count", 0)
        st.markdown(f"""
        <div class="{q_class}">
            <span class="status-light-icon">{q_icon}</span>
            <div class="status-light-label">任务堆积深度</div>
            <div class="status-light-value">{queue_depth}</div>
            <div class="status-light-sub">{q_label} · 待处理 {pending} / 处理中 {processing}</div>
        </div>
        """, unsafe_allow_html=True)

    with col3:
        retry_attempts = status.get("total_retry_attempts", 0)
        st.markdown(f"""
        <div class="{h_class}">
            <span class="status-light-icon">{h_icon}</span>
            <div class="status-light-label">自愈重试率</div>
            <div class="status-light-value">{self_heal_rate}%</div>
            <div class="status-light-sub">{h_label} · {retry_attempts} 次重试记录</div>
        </div>
        """, unsafe_allow_html=True)

    st.markdown("---")


# ══════════════════════════════════════════════════════════════════════════════
#  UI Section ── 告警弹窗流
# ══════════════════════════════════════════════════════════════════════════════

def render_alert_popup_stream(status: dict):
    """
    当 RiskManager 触发拦截时，以红色边框弹窗渲染。
    支持 WebSocket 推送的 risk_alert 消息和本地日志回退。
    """
    st.markdown("## 🚨 告警弹窗流")

    interception_events = status.get("interception_events", [])
    if not interception_events:
        interception_events = load_risk_alerts_local(limit=20)

    if not interception_events:
        st.success("✅ 当前无拦截事件 — 系统运行正常")
        return

    # Sort by timestamp descending
    interception_events.sort(key=lambda x: x.get("timestamp", ""), reverse=True)

    # Show the 5 most recent as red-border popups
    popup_container = st.container(border=True)

    with popup_container:
        for alert in interception_events[:5]:
            risk_level = alert.get("risk_level", 1)
            task_id = alert.get("task_id", "N/A")
            message = alert.get("message", "No message")
            ts = alert.get("timestamp", "")

            try:
                dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                ts_fmt = dt.strftime("%m-%d %H:%M:%S")
            except Exception:
                ts_fmt = ts[:19] if ts else "N/A"

            level_label = {5: "CRITICAL", 4: "HIGH", 3: "ELEVATED", 2: "MODERATE"}.get(risk_level, "LOW")

            st.markdown(f"""
            <div class="risk-alert-popup">
                <div class="alert-header">
                    <span class="alert-badge">⚠ {level_label} Lv.{risk_level}</span>
                    <code style="color:#58a6ff;">{task_id}</code>
                    <span class="alert-ts">{ts_fmt}</span>
                </div>
                <div style="color:#c9d1d9; font-size:14px;">{message[:250]}</div>
            </div>
            """, unsafe_allow_html=True)

    # Older alerts in standard alert-items
    if len(interception_events) > 5:
        with st.expander(f"📋 历史告警记录 (+{len(interception_events) - 5} 条)", expanded=False):
            for alert in interception_events[5:15]:
                rl = alert.get("risk_level", 1)
                tid = alert.get("task_id", "N/A")
                msg = alert.get("message", "")[:180]
                ts = alert.get("timestamp", "")[:19]

                if rl >= 5:
                    css = "alert-critical"
                elif rl >= 4:
                    css = "alert-high"
                elif rl >= 3:
                    css = "alert-elevated"
                else:
                    css = "alert-moderate"

                st.markdown(f"""
                <div class="alert-item {css}">
                    <strong>[Lv.{rl}]</strong> <code>{tid}</code> · {ts}<br>
                    <span style="font-size:12px;">{msg}</span>
                </div>
                """, unsafe_allow_html=True)


# ══════════════════════════════════════════════════════════════════════════════
#  UI Section ── 任务链动态进度条
# ══════════════════════════════════════════════════════════════════════════════

def render_task_chain_progress(status: dict):
    """
    从 task_state.json 渲染任务状态。
    当 status=retrying 时，进度条变为黄色并且动态闪烁。
    """
    st.markdown("---")
    st.markdown("## 🔗 任务链动态进度条")

    all_retrying = status.get("all_retrying", [])

    if not all_retrying:
        state = load_task_state_local()
        tasks_dict = state.get("tasks", {})
        all_retrying = []
        for tid, tdata in tasks_dict.items():
            retries = tdata.get("retries", 0)
            s = tdata.get("status", "")
            if retries > 0 or s.startswith("retrying"):
                all_retrying.append({
                    "task_id": tid,
                    "retries": retries,
                    "max_retries": tdata.get("max_retries", 3),
                    "status": s,
                    "goal": tdata.get("goal", "")[:100],
                    "priority": tdata.get("priority", 3),
                    "updated_at": tdata.get("updated_at", ""),
                })

    if not all_retrying:
        # Also show non-retrying tasks for full picture
        state = load_task_state_local()
        tasks_dict = state.get("tasks", {})
        active_tasks = [
            {"task_id": tid, "status": tdata.get("status", "unknown"),
             "retries": tdata.get("retries", 0),
             "max_retries": tdata.get("max_retries", 3),
             "goal": tdata.get("goal", "")[:100],
             "priority": tdata.get("priority", 3)}
            for tid, tdata in tasks_dict.items()
            if tdata.get("status") not in ("completed", "success", "failed", "blocked_by_risk")
        ]
        if not active_tasks:
            st.info("✅ 当前无活跃任务 — 所有任务已完成或空闲")
            return
        all_retrying = active_tasks  # show active tasks too

    st.markdown(f"**{len(all_retrying)} 个活跃任务**")

    for task in all_retrying:
        task_id = task.get("task_id", "N/A")
        retries = task.get("retries", 0)
        max_retries = task.get("max_retries", 3)
        goal = task.get("goal", "—")
        t_status = task.get("status", "unknown")
        priority = task.get("priority", 3)

        progress = min(retries / max_retries, 1.0) if max_retries > 0 else 0.0
        is_retrying = t_status.startswith("retrying")

        col_id, col_bar, col_meta = st.columns([0.22, 0.55, 0.23])

        with col_id:
            dot_html = '<span class="retrying-dot"></span>' if is_retrying else ""
            st.markdown(f"""
            <div style="padding-top:4px;">
                {dot_html}<code class="retry-task-id">{task_id}</code>
                <div style="font-size:11px;color:#8b949e;">{goal[:55]}</div>
            </div>
            """, unsafe_allow_html=True)

        with col_bar:
            if is_retrying:
                # Yellow blinking retry wrapper
                bar_text = f"🔄 重试中 {retries}/{max_retries}"
                st.markdown(f"""
                <div class="retry-bar-wrapper">
                    <div style="padding:6px 12px;color:#d29922;font-weight:700;font-size:13px;">
                        {bar_text}
                    </div>
                </div>
                """, unsafe_allow_html=True)
                st.progress(progress, text="")
            else:
                bar_text = f"进度 {int(progress * 100)}%"
                st.progress(progress, text=bar_text)

        with col_meta:
            p_emoji = {1: "🔴P1", 2: "🟠P2", 3: "🟡P3", 4: "🔵P4", 5: "⚪P5"}.get(priority, f"P{priority}")
            status_color = "#d29922" if is_retrying else "#8b949e"
            st.markdown(
                f"<span style='font-size:12px;color:{status_color};'>{p_emoji} | {t_status}</span>",
                unsafe_allow_html=True,
            )


# ══════════════════════════════════════════════════════════════════════════════
#  UI Section ── 操作干预面板
# ══════════════════════════════════════════════════════════════════════════════

def render_admin_panel():
    st.markdown("---")
    st.markdown("## ⚙️ 管理中心 · 操作干预面板")

    threshold_data = fetch_risk_threshold()
    current_threshold = _fallback_threshold()

    if threshold_data and "block_threshold" in threshold_data:
        current_threshold = threshold_data["block_threshold"]

    level_descriptions = {
        1: "🔴 極嚴格 — 仅允许最低风险操作",
        2: "🟠 严格 — 允许中度风险操作",
        3: "🟡 标准 (默认) — 阻止金融/删除类操作",
        4: "🟢 宽松 — 仅阻止最高风险操作",
        5: "⚪ 最宽松 — 仅阻止黑名单关键词",
    }

    col_info, col_controls = st.columns([1, 1])

    with col_info:
        st.markdown(f"""
        <div class="admin-panel">
            <h3>🔐 当前安全阈值</h3>
            <div style="font-size:48px;font-weight:900;color:#58a6ff;text-align:center;margin:16px 0;">
                BLOCK = <span class="threshold-badge" style="background:rgba(88,166,255,0.15);">{current_threshold}</span>
            </div>
            <p style="color:#8b949e;text-align:center;margin-top:8px;">
                {level_descriptions.get(current_threshold, "未知等级")}
            </p>
            <p style="color:#6e7681;font-size:12px;text-align:center;">
                风险等级 > BLOCK_THRESHOLD 的任务将被拦截
            </p>
        </div>
        """, unsafe_allow_html=True)

    with col_controls:
        st.markdown("""<div class="admin-panel"><h3>🎚️ 调整安全等级</h3></div>""", unsafe_allow_html=True)
        new_threshold = st.slider(
            "BLOCK_THRESHOLD", min_value=1, max_value=5, value=current_threshold, step=1,
            help="1=最严格, 5=最宽松。风险等级 > 阈值时任务被拦截。",
            key="threshold_slider",
        )
        st.markdown(f"**预览**: {level_descriptions.get(new_threshold, '')}")

        if st.button("✅ 应用新阈值", type="primary", use_container_width=True, key="apply_threshold"):
            if new_threshold != current_threshold:
                result = set_risk_threshold_api(new_threshold)
                if result.get("status") == "success":
                    st.success(f"✅ 阈值已更新: BLOCK_THRESHOLD = {new_threshold}")
                    st.cache_data.clear()
                    time.sleep(0.5)
                    st.rerun()
                else:
                    st.error(f"❌ 更新失败: {result.get('message', '未知错误')}")
            else:
                st.info("阈值未变更")

        st.markdown("**快速预设:**")
        qcols = st.columns(5)
        for i, (label, key, help_text) in enumerate([
            ("🔴 1", "preset1", "極嚴格"), ("🟠 2", "preset2", "严格"),
            ("🟡 3", "preset3", "标准(默认)"), ("🟢 4", "preset4", "宽松"),
            ("⚪ 5", "preset5", "最宽松"),
        ]):
            with qcols[i]:
                if st.button(label, key=key, use_container_width=True, help=help_text):
                    if (i + 1) != current_threshold:
                        result = set_risk_threshold_api(i + 1)
                        if result.get("status") == "success":
                            st.cache_data.clear()
                            st.rerun()


def _fallback_threshold() -> int:
    try:
        from risk_manager import RiskManager
        return RiskManager.BLOCK_THRESHOLD
    except ImportError:
        return 3


# ══════════════════════════════════════════════════════════════════════════════
#  UI Section ── 跨域联动墙
# ══════════════════════════════════════════════════════════════════════════════

def render_cross_domain_wall():
    """
    跨域联动墙：从 /api/fault_status 读取所有子项目的实时心跳状态，
    以列表形式显示：OK (绿) / HANG (红闪烁) / UNKNOWN (灰)。
    若检测到 HANG 状态，显示告警提示。
    """
    st.markdown("---")
    st.markdown("## 🌐 跨域联动墙 — 子项目实时状态")
    st.caption("监控所有子项目的哨兵心跳 (120s 超时阈值)")

    fault_data = fetch_fault_status()
    if fault_data is None:
        fault_data = fetch_fault_status_local()

    projects = fault_data.get("projects", {})
    if not projects:
        st.info("暂无跨域项目数据。请确保各子项目已部署 .governance_entry.py 哨兵入口。")
        return

    has_hang = any(p.get("status") == "HANG" for p in projects.values())
    if has_hang:
        st.error("🚨 检测到死锁项目！请检查下方红色标记的项目。")

    wall_container = st.container(border=True)

    with wall_container:
        # Header row
        st.markdown("""
        <div class="domain-row" style="color:#6e7681;font-weight:600;border-bottom:1px solid #30363d;">
            <span class="domain-name">项目名称</span>
            <span class="domain-status">状态</span>
            <span class="domain-latency">最后心跳</span>
            <span class="domain-event">事件</span>
        </div>
        """, unsafe_allow_html=True)

        for proj_name, proj_data in sorted(projects.items()):
            status = proj_data.get("status", "UNKNOWN")
            ago_sec = proj_data.get("last_heartbeat_ago_sec")
            error_snap = proj_data.get("error_snapshot", [])

            # Status styling
            if status == "OK":
                status_css = "status-ok"
                status_icon = "✅"
            elif status == "HANG":
                status_css = "status-hang"
                status_icon = "💀"
            else:
                status_css = "status-unknown"
                status_icon = "❓"

            # Latency display
            if ago_sec is not None:
                if ago_sec < 30:
                    latency = f"{ago_sec:.0f}s 前"
                elif ago_sec < 120:
                    latency = f"{ago_sec:.0f}s 前"
                else:
                    latency = f"⚠️ {ago_sec:.0f}s 前"
            else:
                latency = "无记录"

            # Event message
            if status == "HANG" and error_snap:
                last_err = error_snap[-1] if error_snap else {}
                event_msg = f"死锁: {last_err.get('module', '?')}"
            elif status == "HANG":
                event_msg = "检测到死锁，已进入隔离保护，请相关任务暂停。"
            else:
                event_msg = "—"

            st.markdown(f"""
            <div class="domain-row">
                <span class="domain-name">{proj_name}</span>
                <span class="domain-status"><span class="{status_css}">{status_icon} {status}</span></span>
                <span class="domain-latency">{latency}</span>
                <span class="domain-event" title="{event_msg}">{event_msg}</span>
            </div>
            """, unsafe_allow_html=True)


# ══════════════════════════════════════════════════════════════════════════════
#  Sidebar
# ══════════════════════════════════════════════════════════════════════════════

def render_system_info(status: dict):
    with st.sidebar:
        st.markdown("## 🖥️ 系统信息")
        st.markdown(f"**API 端点**: `{API_BASE_URL}`")
        st.markdown(f"**WebSocket 客户端**: {status.get('ws_clients', 0)}")
        st.markdown(f"**任务追踪总数**: {status.get('total_tasks_tracked', 0)}")
        st.markdown(f"**拦截事件数**: {status.get('interception_count', 0)}")

        st.markdown("---")
        st.markdown("### ⏱️ 刷新设置")
        auto_refresh = st.checkbox("自动刷新 (3s)", value=True, key="auto_refresh")
        if auto_refresh:
            time.sleep(REFRESH_INTERVAL_SEC)
            st.rerun()

        st.markdown("---")
        st.markdown("### 📖 图例")
        st.markdown("🔴 CRITICAL — 金融/黑名单操作")
        st.markdown("🟠 HIGH — 安全敏感操作")
        st.markdown("🟡 ELEVATED — 破坏性写入")
        st.markdown("🔵 MODERATE — 非破坏性操作")
        st.markdown("🟢 LOW — 只读/分析")


# ══════════════════════════════════════════════════════════════════════════════
#  Main
# ══════════════════════════════════════════════════════════════════════════════

def main():
    inject_css()

    status = fetch_factory_status()
    if status is None:
        status = _build_local_status()

    render_system_info(status)

    # ── Header ──
    st.markdown("# 🏭 Maneki-AI 工厂仪表盘")
    st.markdown("*实时监控 · 风险感知 · 智能干预*")

    # ── 1. 顶部三盏状态指示灯 ──
    render_status_lights(status)

    # ── 2. 告警弹窗流 (red-border risk_alert) ──
    render_alert_popup_stream(status)

    # ── 3. 任务链动态进度条 (yellow blinking retries) ──
    render_task_chain_progress(status)

    # ── 3.5. 跨域联动墙 (all subproject heartbeat status) ──
    render_cross_domain_wall()

    # ── 4. 管理中心 ──
    render_admin_panel()

    # ── Footer ──
    st.markdown("---")
    st.markdown(
        "<p style='text-align:center;color:#484f58;font-size:12px;'>"
        "Maneki-AI Factory Dashboard v0.6.0-factory · Powered by Streamlit · "
        f"Last update: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}"
        "</p>",
        unsafe_allow_html=True,
    )


def _build_local_status() -> dict:
    """Fallback status from local files when API is unavailable."""
    now = datetime.now(timezone.utc).isoformat()

    pending_count = 0
    processing_count = 0
    for q in ["pending", "processing"]:
        dp = os.path.join(BASE_DIR, "task_queue", q)
        if os.path.exists(dp):
            try:
                c = len([f for f in os.listdir(dp) if f.endswith(".json")])
                if q == "pending":
                    pending_count = c
                else:
                    processing_count = c
            except OSError:
                pass

    state = load_task_state_local()
    tasks_dict = state.get("tasks", {})
    total_tracked = state.get("total_tasks_tracked", len(tasks_dict))
    sc = sum(1 for t in tasks_dict.values() if t.get("status") in ("success", "completed"))
    fc = sum(1 for t in tasks_dict.values() if t.get("status") in ("failed", "blocked_by_risk", "partial_failure"))
    auto_fix = round((sc / max(sc + fc, 1)) * 100, 1)

    all_retrying = []
    retry_tasks_list = []
    for tid, td in tasks_dict.items():
        r = td.get("retries", 0)
        s = td.get("status", "")
        if s.startswith("retrying") or (r > 0 and s not in ("completed", "success", "failed", "blocked_by_risk")):
            retry_tasks_list.append({"task_id": tid, "retries": r, "max_retries": 3, "status": s,
                                     "goal": td.get("goal", "")[:100], "priority": td.get("priority", 3)})
        if r > 0 or s.startswith("retrying"):
            all_retrying.append({"task_id": tid, "retries": r, "max_retries": td.get("max_retries", 3),
                                 "status": s, "goal": td.get("goal", "")[:100],
                                 "priority": td.get("priority", 3), "updated_at": td.get("updated_at", "")})

    alerts = load_risk_alerts_local(limit=20)
    max_r = 1
    for a in alerts:
        rl = a.get("risk_level", 1)
        if rl > max_r:
            max_r = rl

    if max_r >= 5:
        risk_level = "CRITICAL"
    elif max_r >= 4:
        risk_level = "HIGH"
    elif max_r >= 3:
        risk_level = "ELEVATED"
    elif max_r >= 2:
        risk_level = "MODERATE"
    else:
        risk_level = "LOW"

    err_stats = parse_error_log_stats()

    sec_idx = 100
    if total_tracked > 0:
        sec_idx = max(0, 100 - int((len(alerts) / total_tracked) * 100))
    if max_r >= 5:
        sec_idx = max(0, sec_idx - 25)
    elif max_r >= 4:
        sec_idx = max(0, sec_idx - 15)
    elif max_r >= 3:
        sec_idx = max(0, sec_idx - 5)

    return {
        "type": "factory_status",
        "timestamp": now,
        "queue_depth": pending_count + processing_count,
        "pending_count": pending_count,
        "processing_count": processing_count,
        "retry_tasks": retry_tasks_list,
        "auto_fix_success_rate": auto_fix,
        "total_tasks_tracked": total_tracked,
        "success_count": sc,
        "failed_count": fc,
        "system_risk_level": risk_level,
        "max_risk_level": max_r,
        "block_threshold": _fallback_threshold(),
        "interception_count": len(alerts),
        "interception_events": alerts,
        "all_retrying": all_retrying,
        "system_security_index": sec_idx,
        "self_healing_retry_rate": err_stats.get("self_healing_retry_rate", 0.0),
        "total_retry_attempts": err_stats.get("total_retry_attempts", 0),
        "unique_failed_tasks_log": err_stats.get("unique_failed_tasks", 0),
        "latest_errors": err_stats.get("latest_errors", []),
        "ws_clients": 0,
    }


if __name__ == "__main__":
    main()