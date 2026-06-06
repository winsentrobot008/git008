import os
import json
import uuid
import traceback
import threading
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn
from main import TaskDispatcher, Task
from risk_manager import RiskManager

# ── WebSocket Connection Manager (inspired by CLAWWORK) ─────────────────
class ConnectionManager:
    """Manages WebSocket connections for real-time factory streaming."""
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        """Broadcast message to all connected clients."""
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        for conn in disconnected:
            self.disconnect(conn)

    @property
    def client_count(self) -> int:
        return len(self.active_connections)

# Global connection manager
ws_manager = ConnectionManager()

# ── Factory Status Connection Manager (dedicated for /ws/factory_status) ──
factory_status_manager = ConnectionManager()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动后台 TaskListener 轮询线程
    from core.task_listener import main as start_listener
    listener_thread = threading.Thread(target=start_listener, daemon=True)
    listener_thread.start()
    print("[app] TaskListener thread started")

    # 启动后台 Factory Status 推送任务
    status_task = asyncio.create_task(_factory_status_publisher())
    print("[app] Factory Status publisher started")

    yield
    # 关闭时清理
    status_task.cancel()
    try:
        await status_task
    except asyncio.CancelledError:
        pass
    print("[app] Shutting down")

app = FastAPI(title="Maneki-AI Factory", lifespan=lifespan)

# ── Absolute path resolution ──────────────────────────────────────────────
base_dir = os.path.dirname(os.path.abspath(__file__))
template_dir = os.path.join(base_dir, "templates")
html_path = os.path.join(template_dir, "index.html")
frontend_dir = os.path.join(base_dir, "frontend")

# ── Ensure directories exist ──────────────────────────────────────────────
if not os.path.exists(template_dir):
    os.makedirs(template_dir)

# ── Mount static files (theme.css, etc.) ──────────────────────────────────
if os.path.exists(frontend_dir):
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

# ── Standard Fallback HTML (guarantees the site works even if git sync lapses) ──
FALLBACK_HTML = """<!DOCTYPE html>
<html>
<head><title>🏭 Maneki-AI Control Center</title></head>
<body style="background:#0d1117; color:#c9d1d9; font-family:monospace; padding:40px; text-align:center;">
    <h1>🏭 Maneki-AI Factory</h1>
    <p style="color:#58a6ff">> [SYSTEM] Base engine loaded. Ready to receive commands.</p>
</body>
</html>"""

# ── Lazy-init Jinja2 (only if the template file actually exists) ──────────
templates = None
if os.path.exists(html_path):
    templates = Jinja2Templates(directory=template_dir)

# ── Lazy-init dispatcher & risk manager ───────────────────────────────────
dispatcher = None
risk_manager = None


def _ensure_services():
    """Initialise core services on first API call (avoids import-time crashes)."""
    global dispatcher, risk_manager
    if dispatcher is None:
        dispatcher = TaskDispatcher()
    if risk_manager is None:
        risk_manager = RiskManager()


class TaskRequest(BaseModel):
    task_id: str
    description: str
    tags: list[str]


class RouterRequest(BaseModel):
    """轻量级请求模型 — 工厂首页使用"""
    goal: str


class ThresholdRequest(BaseModel):
    """用于修改 RiskManager BLOCK_THRESHOLD 的请求模型"""
    threshold: int


# ══════════════════════════════════════════════════════════════════════════════
#  Factory Status Publisher — 后台轮询核心指标并通过 WebSocket 推送
# ══════════════════════════════════════════════════════════════════════════════

async def _factory_status_publisher():
    """Background task: polls system state every 2s and pushes to /ws/factory_status clients."""
    import time
    while True:
        try:
            status = _collect_factory_status()
            if factory_status_manager.client_count > 0:
                await factory_status_manager.broadcast(status)
        except Exception as e:
            print(f"[factory_status] Publisher error: {e}")
        await asyncio.sleep(2.0)


def _collect_factory_status() -> dict:
    """
    Collect a comprehensive snapshot of the factory state.
    This function is safe to call from any thread (thread-safe reads).
    """
    now = datetime.now(timezone.utc).isoformat()

    # ── 1. PriorityTaskQueue 堆积深度 ──────────────────────────────────
    queue_depth = 0
    try:
        from workshop.ecc_core import PriorityTaskQueue
        # We can't reference the global engine easily, so we scan task_state.json
        # and count pending queue files as a reliable proxy
        pass
    except ImportError:
        pass

    # Count pending + processing tasks as "queue depth"
    pending_count = 0
    processing_count = 0
    for queue_name in ["pending", "processing"]:
        dir_path = os.path.join(base_dir, "task_queue", queue_name)
        if os.path.exists(dir_path):
            try:
                count = len([f for f in os.listdir(dir_path) if f.endswith(".json")])
                if queue_name == "pending":
                    pending_count = count
                elif queue_name == "processing":
                    processing_count = count
            except OSError:
                pass

    total_queue_depth = pending_count + processing_count

    # ── 2. 重试计数 (from task_state.json) ─────────────────────────────
    retry_tasks = []
    try:
        state = _load_task_state()
        tasks = state.get("tasks", {})
        for tid, tdata in tasks.items():
            retries = tdata.get("retries", 0)
            status = tdata.get("status", "")
            if status.startswith("retrying") or (retries > 0 and status not in ("completed", "success", "failed", "blocked_by_risk")):
                retry_tasks.append({
                    "task_id": tid,
                    "retries": retries,
                    "max_retries": 3,
                    "status": status,
                    "goal": tdata.get("goal", "")[:100],
                    "priority": tdata.get("priority", 3),
                })
    except Exception:
        pass

    # ── 3. 自动修复成功率 ─────────────────────────────────────────────
    total_tasks_tracked = 0
    success_count = 0
    failed_count = 0
    try:
        state = _load_task_state()
        total_tasks_tracked = state.get("total_tasks_tracked", 0)
        tasks = state.get("tasks", {})
        for tid, tdata in tasks.items():
            s = tdata.get("status", "")
            if s in ("success", "completed"):
                success_count += 1
            elif s in ("failed", "blocked_by_risk", "partial_failure"):
                failed_count += 1
    except Exception:
        pass

    auto_fix_rate = 0.0
    total_completed = success_count + failed_count
    if total_completed > 0:
        auto_fix_rate = round((success_count / total_completed) * 100, 1)

    # ── 4. 系统风险等级 (from RiskManager.BLOCK_THRESHOLD & recent alerts) ──
    current_threshold = RiskManager.BLOCK_THRESHOLD
    risk_level = "LOW"
    # Check recent alerts for worst risk level
    recent_alerts = _read_recent_alerts(limit=10)
    max_risk = 1
    interception_count = 0
    for alert in recent_alerts:
        rl = alert.get("risk_level", 1)
        if rl > max_risk:
            max_risk = rl
        interception_count += 1

    if max_risk >= 5:
        risk_level = "CRITICAL"
    elif max_risk >= 4:
        risk_level = "HIGH"
    elif max_risk >= 3:
        risk_level = "ELEVATED"
    elif max_risk >= 2:
        risk_level = "MODERATE"
    else:
        risk_level = "LOW"

    # ── 5. 拦截事件 (from risk_alerts.log) ────────────────────────────
    interception_events = recent_alerts

    # ── 6. 全部重试中的任务 (为 st.progress 准备) ────────────────────
    all_retrying = []
    try:
        state = _load_task_state()
        tasks = state.get("tasks", {})
        for tid, tdata in tasks.items():
            retries = tdata.get("retries", 0)
            status = tdata.get("status", "")
            if retries > 0 or status.startswith("retrying"):
                all_retrying.append({
                    "task_id": tid,
                    "retries": retries,
                    "max_retries": 3,
                    "status": status,
                    "goal": tdata.get("goal", "")[:100],
                    "priority": tdata.get("priority", 3),
                    "updated_at": tdata.get("updated_at", ""),
                })
    except Exception:
        pass

    # ── 7. 自愈重试率 (from error_log.md) ─────────────────────────────
    error_stats = _read_error_log_stats()
    self_healing_retry_rate = error_stats.get("self_healing_retry_rate", 0.0)
    total_retry_attempts = error_stats.get("total_retry_attempts", 0)
    unique_failed_tasks = error_stats.get("unique_failed_tasks", 0)
    latest_errors = error_stats.get("latest_errors", [])

    # ── 8. 系统安全指数 (综合 RiskManager 历史拦截率) ──────────────────
    # 安全指数 = 100 - (interception_rate * 100). 0 拦截 = 100(最安全)
    system_security_index = 100
    if total_tasks_tracked > 0:
        interception_rate = interception_count / total_tasks_tracked
        system_security_index = max(0, 100 - int(interception_rate * 100))
    # Also penalize based on max_risk_level
    if max_risk >= 5:
        system_security_index = max(0, system_security_index - 25)
    elif max_risk >= 4:
        system_security_index = max(0, system_security_index - 15)
    elif max_risk >= 3:
        system_security_index = max(0, system_security_index - 5)

    return {
        "type": "factory_status",
        "timestamp": now,
        "queue_depth": total_queue_depth,
        "pending_count": pending_count,
        "processing_count": processing_count,
        "retry_tasks": retry_tasks,
        "auto_fix_success_rate": auto_fix_rate,
        "total_tasks_tracked": total_tasks_tracked,
        "success_count": success_count,
        "failed_count": failed_count,
        "system_risk_level": risk_level,
        "max_risk_level": max_risk,
        "block_threshold": current_threshold,
        "interception_count": interception_count,
        "interception_events": interception_events,
        "all_retrying": all_retrying,
        "system_security_index": system_security_index,
        "self_healing_retry_rate": self_healing_retry_rate,
        "total_retry_attempts": total_retry_attempts,
        "unique_failed_tasks_log": unique_failed_tasks,
        "latest_errors": latest_errors,
        "ws_clients": ws_manager.client_count,
    }


def _load_task_state() -> dict:
    """Load task_state.json safely."""
    state_path = os.path.join(base_dir, "task_state.json")
    if os.path.isfile(state_path):
        try:
            with open(state_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"tasks": {}, "last_updated": None, "total_tasks_tracked": 0}


def _read_recent_alerts(limit: int = 10) -> list[dict]:
    """Read the most recent alerts from risk_alerts.log."""
    alert_log_path = os.path.join(base_dir, "logs", "risk_alerts.log")
    alerts = []
    if os.path.isfile(alert_log_path):
        try:
            with open(alert_log_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
            # Read last N lines
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


def _read_error_log_stats() -> dict:
    """
    Parse error_log.md to extract retry statistics:
    - total_retry_attempts: total rows in the error log
    - unique_failed_tasks: distinct task_ids that appear
    - latest_errors: last 5 error rows
    Returns aggregated self-healing metrics.
    """
    error_log_path = os.path.join(base_dir, "error_log.md")
    stats = {
        "total_retry_attempts": 0,
        "unique_failed_tasks": 0,
        "latest_errors": [],
        "self_healing_retry_rate": 0.0,
    }
    if not os.path.isfile(error_log_path):
        return stats

    try:
        with open(error_log_path, "r", encoding="utf-8") as f:
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
            # Parse markdown table row
            parts = [p.strip() for p in line.split("|")]
            if len(parts) >= 4:
                # Format: | Timestamp | Task ID | Attempt/Max | Max Retries | Return Code | Stderr | Command |
                task_id = parts[2] if len(parts) > 2 else ""
                attempt_info = parts[3] if len(parts) > 3 else ""
                if task_id:
                    task_ids_seen.add(task_id)
                    error_rows.append({
                        "task_id": task_id,
                        "attempt": attempt_info,
                        "returncode": parts[5] if len(parts) > 5 else "",
                        "stderr": parts[6][:150] if len(parts) > 6 else "",
                    })

    stats["total_retry_attempts"] = len(error_rows)
    stats["unique_failed_tasks"] = len(task_ids_seen)
    stats["latest_errors"] = error_rows[-5:]

    # Calculate self-healing retry rate:
    # Tasks that appear in error_log but eventually succeeded (in task_state.json)
    state = _load_task_state()
    tasks = state.get("tasks", {})
    healed_count = 0
    for tid in task_ids_seen:
        tdata = tasks.get(tid, {})
        if tdata.get("status") in ("success", "completed"):
            healed_count += 1

    total_distinct = len(task_ids_seen)
    if total_distinct > 0:
        stats["self_healing_retry_rate"] = round((healed_count / total_distinct) * 100, 1)

    return stats


# ── Factory Home — 工厂首页 ───────────────────────────────────────────────

FACTORY_HOME_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Maneki-AI Factory Console</title>
    <link rel="stylesheet" href="/static/styles/theme.css">
    <style>
        .factory-home {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: var(--spacing-lg);
        }
        .factory-card {
            background: var(--color-bg-secondary);
            border: 1px solid var(--color-border);
            border-radius: var(--radius-lg);
            padding: var(--spacing-2xl);
            max-width: 640px;
            width: 100%;
            text-align: center;
            box-shadow: var(--shadow-glow-blue);
        }
        .factory-logo { font-size: 64px; line-height: 1; margin-bottom: var(--spacing-md); }
        .factory-title {
            font-size: 28px; font-weight: 700; color: var(--color-accent-blue);
            margin-bottom: var(--spacing-sm); letter-spacing: 1px;
        }
        .factory-subtitle {
            font-size: 14px; color: var(--color-text-secondary);
            margin-bottom: var(--spacing-xl); font-family: var(--font-sans);
        }
        .factory-subtitle span { color: var(--color-accent-green); }
        .factory-input-group { margin-bottom: var(--spacing-lg); text-align: left; }
        .factory-input-group label {
            display: block; font-size: 13px; color: var(--color-text-secondary);
            margin-bottom: var(--spacing-sm); font-family: var(--font-sans);
        }
        .factory-input {
            width: 100%; padding: 16px 20px; font-size: 18px; font-family: var(--font-mono);
            background: var(--color-bg-primary); color: var(--color-text-primary);
            border: 1px solid var(--color-border); border-radius: var(--radius-md);
            outline: none; transition: border-color 0.2s ease, box-shadow 0.2s ease;
            resize: vertical; min-height: 80px; line-height: 1.5;
        }
        .factory-input:focus {
            border-color: var(--color-border-focus);
            box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.15);
        }
        .factory-input::placeholder { color: var(--color-text-muted); font-size: 16px; }
        .factory-btn {
            width: 100%; padding: 18px 24px; font-size: 20px; font-weight: 700;
            font-family: var(--font-sans); color: var(--color-btn-primary-text);
            background: var(--color-btn-primary); border: none; border-radius: var(--radius-md);
            cursor: pointer; transition: background 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
            letter-spacing: 1px;
        }
        .factory-btn:hover { background: var(--color-btn-primary-hover); box-shadow: var(--shadow-glow-green); }
        .factory-btn:active { transform: scale(0.98); }
        .factory-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; box-shadow: none; }
        .factory-status {
            margin-top: var(--spacing-lg); padding: var(--spacing-md);
            border-radius: var(--radius-md); font-size: 14px; font-family: var(--font-mono);
            display: none; text-align: center;
        }
        .factory-status.loading { display: block; color: var(--color-accent-blue); border: 1px solid var(--color-border); background: var(--color-bg-tertiary); }
        .factory-status.success { display: block; color: var(--color-accent-green); border: 1px solid var(--color-accent-green); background: rgba(63, 185, 80, 0.1); }
        .factory-status.error { display: block; color: var(--color-accent-red); border: 1px solid var(--color-accent-red); background: rgba(248, 81, 73, 0.1); }
        .factory-footer { margin-top: var(--spacing-xl); font-size: 12px; color: var(--color-text-muted); font-family: var(--font-sans); }
        .factory-footer a { color: var(--color-text-muted); }
        .factory-footer a:hover { color: var(--color-accent-blue); }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        .cursor-blink::after { content: "\\258C"; color: var(--color-accent-blue); animation: blink 1s step-end infinite; margin-left: 2px; }
        @media (max-width: 480px) {
            .factory-card { padding: var(--spacing-lg); }
            .factory-title { font-size: 22px; }
            .factory-input { font-size: 16px; padding: 14px 16px; }
            .factory-btn { font-size: 18px; padding: 16px 20px; }
        }
    </style>
</head>
<body>
    <div class="factory-home">
        <div class="factory-card">
            <div class="factory-logo">🏭</div>
            <h1 class="factory-title">Maneki-AI Factory Console</h1>
            <p class="factory-subtitle">
                > 输入你的商业目标，AI 工厂将自动拆解、执行并交付成果。
                <br><span>极简交互 · 极限执行</span>
            </p>
            <div class="factory-input-group">
                <label for="goalInput">📋 请输入你的商业目标</label>
                <textarea id="goalInput" class="factory-input" rows="3"
                    placeholder="例如：帮我设计一个 AI 视频出海的推广方案..."></textarea>
            </div>
            <button id="launchBtn" class="factory-btn" onclick="launchFactory()">启动工厂 🚀</button>
            <div id="statusBox" class="factory-status"><span id="statusText"></span></div>
            <div class="factory-footer">
                <a href="/live" style="color:#3fb950;font-weight:600">⚡ 实时工厂 (NEW)</a>
                &nbsp;·&nbsp;
                <a href="/dashboard" style="color:#58a6ff;font-weight:600">📊 仪表盘 (NEW)</a>
                &nbsp;·&nbsp;
                <a href="https://github.com/winsentrobot008/Maneki-AI" target="_blank">Maneki-AI v0.5.0-factory</a>
                &nbsp;·&nbsp; AI Factory OS
            </div>
        </div>
    </div>
    <script>
        async function launchFactory() {
            const goalInput = document.getElementById('goalInput');
            const launchBtn = document.getElementById('launchBtn');
            const statusBox = document.getElementById('statusBox');
            const statusText = document.getElementById('statusText');
            const goal = goalInput.value.trim();
            if (!goal) {
                statusBox.className = 'factory-status error';
                statusText.textContent = '⚠️ 请输入你的商业目标';
                goalInput.focus();
                return;
            }
            launchBtn.disabled = true;
            launchBtn.textContent = '⏳ 工厂启动中...';
            statusBox.className = 'factory-status loading';
            statusText.textContent = '> 正在向 AI 工厂下达生产指令...';
            try {
                const response = await fetch('/api/router', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ goal: goal })
                });
                const result = await response.json();
                if (result.status === 'success') {
                    const taskId = result.task_id;
                    statusBox.className = 'factory-status success';
                    statusText.textContent = '✅ ' + result.message;
                    setTimeout(() => { window.location.href = '/task_detail?task_id=' + taskId; }, 800);
                } else {
                    statusBox.className = 'factory-status error';
                    statusText.textContent = '❌ ' + (result.message || '未知错误');
                    launchBtn.disabled = false;
                    launchBtn.textContent = '启动工厂 🚀';
                }
            } catch (error) {
                statusBox.className = 'factory-status error';
                statusText.textContent = '❌ 网络错误: ' + error.message;
                launchBtn.disabled = false;
                launchBtn.textContent = '启动工厂 🚀';
            }
        }
        document.addEventListener('DOMContentLoaded', function() {
            const goalInput = document.getElementById('goalInput');
            goalInput.addEventListener('keydown', function(e) {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); launchFactory(); }
            });
            goalInput.focus();
        });
    </script>
</body>
</html>"""


# ── Task Detail — 任务详情页 ──────────────────────────────────────────────

TASK_DETAIL_HTML = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Maneki-AI · 任务详情</title>
    <link rel="stylesheet" href="/static/styles/theme.css">
    <style>
        .detail-page { display: flex; flex-direction: column; align-items: center; padding: var(--spacing-2xl) var(--spacing-lg); min-height: 100vh; }
        .detail-card { background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: var(--spacing-2xl); max-width: 720px; width: 100%; }
        .detail-header { display: flex; align-items: center; gap: var(--spacing-md); margin-bottom: var(--spacing-xl); }
        .detail-header h1 { font-size: 22px; color: var(--color-accent-blue); }
        .detail-back { color: var(--color-text-secondary); font-size: 14px; text-decoration: none; }
        .detail-back:hover { color: var(--color-accent-blue); }
        .detail-field { margin-bottom: var(--spacing-md); }
        .detail-field label { display: block; font-size: 12px; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 1px; margin-bottom: var(--spacing-xs); font-family: var(--font-sans); }
        .detail-field .value { font-size: 16px; color: var(--color-text-primary); word-break: break-all; }
        .detail-status { display: inline-block; padding: 4px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; font-family: var(--font-sans); }
        .detail-status.pending { background: rgba(210, 153, 34, 0.15); color: var(--color-accent-orange); border: 1px solid var(--color-accent-orange); }
        .detail-status.processing { background: rgba(88, 166, 255, 0.15); color: var(--color-accent-blue); border: 1px solid var(--color-accent-blue); }
        .detail-status.completed { background: rgba(63, 185, 80, 0.15); color: var(--color-accent-green); border: 1px solid var(--color-accent-green); }
        .detail-status.error { background: rgba(248, 81, 73, 0.15); color: var(--color-accent-red); border: 1px solid var(--color-accent-red); }
        .detail-log { background: var(--color-bg-primary); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--spacing-md); margin-top: var(--spacing-lg); font-size: 13px; white-space: pre-wrap; max-height: 300px; overflow-y: auto; }
        .detail-loading { text-align: center; padding: var(--spacing-2xl); color: var(--color-text-secondary); }
        .detail-error { text-align: center; padding: var(--spacing-xl); color: var(--color-accent-red); }
        .detail-refresh { margin-top: var(--spacing-lg); text-align: center; }
        .detail-refresh button { background: var(--color-bg-tertiary); color: var(--color-text-primary); border: 1px solid var(--color-border); padding: 8px 20px; border-radius: var(--radius-md); cursor: pointer; font-family: var(--font-mono); font-size: 13px; }
        .detail-refresh button:hover { background: var(--color-bg-hover); }
    </style>
</head>
<body>
    <div class="detail-page">
        <div class="detail-card">
            <div class="detail-header">
                <a href="/factory" class="detail-back">← 返回工厂</a>
                <h1>📋 任务详情</h1>
            </div>
            <div id="detailContent">
                <div class="detail-loading">> 正在加载任务信息...</div>
            </div>
        </div>
    </div>
    <script>
        async function loadTaskDetail() {
            const params = new URLSearchParams(window.location.search);
            const taskId = params.get('task_id');
            const container = document.getElementById('detailContent');

            if (!taskId) {
                container.innerHTML = '<div class="detail-error">❌ 缺少 task_id 参数</div>';
                return;
            }

            try {
                const response = await fetch('/api/tasks/' + encodeURIComponent(taskId));
                const result = await response.json();

                if (result.task) {
                    const t = result.task;
                    const statusClass = (t.status || '').toLowerCase();
                    const logContent = t.log || '暂无执行日志';
                    const goal = t.parameters?.goal || t.parameters?.script_name || '—';

                    container.innerHTML = `
                        <div class="detail-field">
                            <label>任务 ID</label>
                            <div class="value">${t.task_id}</div>
                        </div>
                        <div class="detail-field">
                            <label>状态</label>
                            <div class="value"><span class="detail-status ${statusClass}">${t.status || 'UNKNOWN'}</span></div>
                        </div>
                        <div class="detail-field">
                            <label>商业目标</label>
                            <div class="value">${goal}</div>
                        </div>
                        <div class="detail-field">
                            <label>创建时间</label>
                            <div class="value">${t.created_at || '—'}</div>
                        </div>
                        <div class="detail-field">
                            <label>更新时间</label>
                            <div class="value">${t.updated_at || '—'}</div>
                        </div>
                        <div class="detail-field">
                            <label>执行日志</label>
                            <div class="detail-log">${logContent}</div>
                        </div>
                        <div class="detail-refresh">
                            <button onclick="loadTaskDetail()">🔄 刷新状态</button>
                        </div>
                    `;
                } else {
                    container.innerHTML = '<div class="detail-error">❌ 任务未找到: ' + taskId + '</div>';
                }
            } catch (error) {
                container.innerHTML = '<div class="detail-error">❌ 加载失败: ' + error.message + '</div>';
            }
        }
        document.addEventListener('DOMContentLoaded', loadTaskDetail);
    </script>
</body>
</html>"""


# ── Routes ────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    """根路径 — 重定向到工厂首页"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/factory")


@app.get("/factory", response_class=HTMLResponse)
async def factory_home():
    """GET /factory — 工厂首页"""
    return FACTORY_HOME_HTML


@app.get("/task_detail", response_class=HTMLResponse)
async def task_detail():
    """GET /task_detail?task_id=xxx — 任务详情页"""
    return TASK_DETAIL_HTML


@app.get("/health")
async def health():
    """Simple health-check endpoint (no dependencies)."""
    return {"status": "ok", "template_exists": os.path.exists(html_path)}


# ── Factory Router — 工厂首页入口 ─────────────────────────────────────────

@app.post("/api/router")
async def route_goal(request: RouterRequest):
    """
    POST /api/router — 工厂首页入口端点。
    接收商业目标（goal），生成 task_id，返回给前端跳转。
    """
    goal = request.goal.strip()
    if not goal:
        return {"status": "error", "message": "商业目标不能为空"}

    task_id = f"FAC-{uuid.uuid4().hex[:8].upper()}"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # 写入 pending 队列
    pending_dir = os.path.join(base_dir, "task_queue", "pending")
    os.makedirs(pending_dir, exist_ok=True)
    record = {
        "task_id": task_id,
        "status": "PENDING",
        "parameters": {
            "script_name": "factory_goal",
            "goal": goal,
        },
        "result_log": None,
        "created_at": now,
        "updated_at": now,
    }
    filepath = os.path.join(pending_dir, f"task_{task_id}.json")
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2)

    return {
        "status": "success",
        "task_id": task_id,
        "message": f"任务已创建，task_id={task_id}",
    }


# ── Task API — 任务查询 ───────────────────────────────────────────────────

@app.get("/api/tasks/{task_id}")
async def get_task(task_id: str):
    """GET /api/tasks/{task_id} — 获取单个任务详情"""
    # 搜索所有队列
    for queue_dir in ["pending", "processing", "completed"]:
        dir_path = os.path.join(base_dir, "task_queue", queue_dir)
        filepath = os.path.join(dir_path, f"task_{task_id}.json")
        if os.path.exists(filepath):
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    task_data = json.load(f)
                # 附加日志
                log_path = os.path.join(base_dir, "logs", f"task_{task_id}.log")
                if os.path.exists(log_path):
                    with open(log_path, "r", encoding="utf-8") as f:
                        task_data["log"] = f.read()
                return {"task": task_data}
            except (json.JSONDecodeError, IOError):
                pass

    return {"error": "Not Found", "message": f"Task '{task_id}' not found."}


# ── Dispatch — AI 董事会路由 ──────────────────────────────────────────────

@app.post("/api/dispatch")
async def dispatch_task(request: TaskRequest):
    _ensure_services()

    is_safe, message = risk_manager.evaluate_task(request.description)
    if not is_safe:
        return {"status": "blocked", "message": message, "assigned_model": None}

    task = Task(
        task_id=request.task_id,
        description=request.description,
        tags=request.tags,
    )
    selected_model = dispatcher.route_task(task)

    return {
        "status": "success",
        "message": "Task successfully routed.",
        "assigned_model": selected_model.value,
    }


# ── Live Factory Page — 实时工厂页面 (CLAWWORK-inspired) ─────────────────

LIVE_FACTORY_HTML_PATH = os.path.join(base_dir, "maneki_live.html")

@app.get("/live", response_class=HTMLResponse)
async def live_factory():
    """GET /live — 实时工厂页面（WebSocket 实时流 + AI 董事会 + Success-Share）"""
    if os.path.exists(LIVE_FACTORY_HTML_PATH):
        with open(LIVE_FACTORY_HTML_PATH, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    # Fallback inline HTML
    return HTMLResponse(content="""<!DOCTYPE html>
<html><head><title>Maneki-AI Live</title></head>
<body style="background:#0d1117;color:#c9d1d9;font-family:monospace;padding:40px;text-align:center">
<h1>🏭 Maneki-AI Live Factory</h1>
<p style="color:#58a6ff">> [SYSTEM] Live factory page loading... Ensure maneki_live.html is deployed.</p>
</body></html>""")


# ── Dashboard redirect — 仪表盘 (Streamlit) ───────────────────────────────

@app.get("/dashboard")
async def dashboard_redirect():
    """GET /dashboard — 跳转到 Streamlit 仪表盘"""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="http://localhost:8501")


# ── Factory Status REST API — 供 Streamlit 等外部 UI 轮询 ─────────────────

@app.get("/api/factory_status")
async def get_factory_status():
    """GET /api/factory_status — 工厂状态快照（供 Streamlit UI 轮询）"""
    return _collect_factory_status()


# ── Risk Threshold API — 手动控制 RiskManager BLOCK_THRESHOLD ────────────

@app.get("/api/risk_threshold")
async def get_risk_threshold():
    """GET /api/risk_threshold — 获取当前 BLOCK_THRESHOLD"""
    return {
        "block_threshold": RiskManager.BLOCK_THRESHOLD,
        "description": _describe_threshold(RiskManager.BLOCK_THRESHOLD),
    }


@app.post("/api/risk_threshold")
async def set_risk_threshold(req: ThresholdRequest):
    """
    POST /api/risk_threshold — 设置 RiskManager BLOCK_THRESHOLD
    安全范围: 1 (最严格) 到 5 (最宽松)
    """
    threshold = req.threshold
    if threshold < 1 or threshold > 5:
        return {"status": "error", "message": "threshold 必须在 1-5 之间"}

    RiskManager.BLOCK_THRESHOLD = threshold
    print(f"[app] ⚙️ RiskManager BLOCK_THRESHOLD 已更新为: {threshold}")
    return {
        "status": "success",
        "block_threshold": threshold,
        "description": _describe_threshold(threshold),
    }


def _describe_threshold(threshold: int) -> str:
    """Human-readable description of a risk threshold level."""
    descriptions = {
        1: "🔴 極嚴格 — 仅允许最低风险操作（仅分析/扫描类任务）。",
        2: "🟠 严格 — 允许中度风险操作，阻止高风险任务。",
        3: "🟡 标准 (默认) — 允许常规任务，阻止关键金融/删除类操作。",
        4: "🟢 宽松 — 仅阻止最高风险（金融交易）操作。",
        5: "⚪ 最宽松 — 仅在检测到黑名单关键词时阻止。",
    }
    return descriptions.get(threshold, "未知等级")


# ── Enhanced Health Check ─────────────────────────────────────────────────

@app.get("/api/health")
async def health_check():
    """Enhanced health check with version and WebSocket info."""
    return {
        "status": "ok",
        "service": "Maneki-AI Factory",
        "version": "v0.5.0-factory",
        "ws_clients": ws_manager.client_count,
        "factory_status_clients": factory_status_manager.client_count,
        "template_exists": os.path.exists(html_path),
        "live_page_exists": os.path.exists(LIVE_FACTORY_HTML_PATH),
    }


# ── AI Board Status — 董事会状态 ──────────────────────────────────────────

# Board data is stored in-memory and updated by the task listener / ECC
_board_state = {
    "deepseek":  {"name": "DeepSeek",  "icon": "🔧", "role": "深度逻辑与架构 · 代码生成",       "status": "idle", "tasks": 0, "completed": 0, "failed": 0, "revenue": 0.0, "success_rate": 0},
    "gemini":    {"name": "Gemini",    "icon": "🧠", "role": "战略与调度 · 全局统筹",           "status": "idle", "tasks": 0, "completed": 0, "failed": 0, "revenue": 0.0, "success_rate": 0},
    "doubao":    {"name": "Doubao",    "icon": "🎨", "role": "创意与本土化 · 营销策划",         "status": "idle", "tasks": 0, "completed": 0, "failed": 0, "revenue": 0.0, "success_rate": 0},
    "openai":    {"name": "OpenAI",    "icon": "📋", "role": "全球通用标准 · 标准化审计",        "status": "idle", "tasks": 0, "completed": 0, "failed": 0, "revenue": 0.0, "success_rate": 0},
    "yuanbao":   {"name": "Yuanbao",   "icon": "🌐", "role": "生态整合 · 社交数据链路",         "status": "idle", "tasks": 0, "completed": 0, "failed": 0, "revenue": 0.0, "success_rate": 0},
}

def update_board_member(model_key: str, **kwargs):
    """Update a board member's state (called by ECC / task listener)."""
    if model_key in _board_state:
        _board_state[model_key].update(kwargs)

def get_board_summary() -> dict:
    """Get current board state with totals."""
    models = list(_board_state.values())
    return {
        "models": models,
        "total_tasks": sum(m["tasks"] for m in models),
        "total_completed": sum(m["completed"] for m in models),
        "total_revenue": sum(m["revenue"] for m in models),
    }

@app.get("/api/board")
async def get_board():
    """GET /api/board — AI 董事会成员状态与统计数据"""
    return get_board_summary()


# ── Settlement API — Success-Share 收益分成数据 ──────────────────────────

@app.get("/api/settlement")
async def get_settlement():
    """GET /api/settlement — Success-Share 收益分成汇总"""
    # Collect from clearing engine if available
    settlement_data = {
        "total_revenue": sum(m["revenue"] for m in _board_state.values()),
        "total_tasks": sum(m["completed"] for m in _board_state.values()),
        "tiers": {
            "core":       {"rate": 0.10, "tasks": 0, "revenue": 0.0, "fee": 0.0},
            "premium":    {"rate": 0.20, "tasks": 0, "revenue": 0.0, "fee": 0.0},
            "enterprise": {"rate": 0.30, "tasks": 0, "revenue": 0.0, "fee": 0.0},
        },
        "models": [{"name": m["name"], "revenue": m["revenue"], "tasks": m["completed"]} for m in _board_state.values()],
    }
    # Try to get richer data from clearing engine
    try:
        from clearing_engine.core import FinancialClearingEngine
        ce = FinancialClearingEngine()
        metrics = ce.get_metrics_dict()
        if metrics and "error" not in metrics:
            settlement_data["clearing_engine"] = metrics
    except Exception:
        pass
    return settlement_data


# ── Task Statistics API — 任务统计 ────────────────────────────────────────

@app.get("/api/stats")
async def get_stats():
    """GET /api/stats — 工厂总体统计"""
    board = get_board_summary()
    # Count tasks in all queue dirs
    task_count = 0
    for queue_dir in ["pending", "processing", "completed"]:
        dir_path = os.path.join(base_dir, "task_queue", queue_dir)
        if os.path.exists(dir_path):
            task_count += len([f for f in os.listdir(dir_path) if f.endswith(".json")])
    return {
        "board_models": len(_board_state),
        "total_tasks_queued": task_count,
        "total_completed": board["total_completed"],
        "total_revenue": board["total_revenue"],
        "ws_clients": ws_manager.client_count,
    }


# ══════════════════════════════════════════════════════════════════════════════
#  WebSocket /ws — 实时生产流 (CLAWWORK-inspired)
# ══════════════════════════════════════════════════════════════════════════════

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket /ws — 实时工厂生产流。

    前端连接后可以实时接收：
    - board_initialized: AI 董事会初始化
    - task_dispatched: 任务已分发到指定模型
    - model_selected: AI 董事会路由决策
    - task_queued / task_started: 任务生命周期
    - agent_thinking: AI 思考日志
    - ecc_decompose: ECC 任务分解
    - code_generated: 代码生成进度
    - artifact_created: 文件/作品创建
    - work_submitted: 工作已提交
    - settlement: Success-Share 结算
    - task_completed / task_error: 任务结果
    - balance_update: 收益更新
    - board_update: 董事会状态变更
    - risk_assessment: 安全评估结果
    """
    await ws_manager.connect(websocket)
    try:
        # Send welcome + board init
        board = get_board_summary()
        await websocket.send_json({
            "type": "connected",
            "message": "✅ 已连接到 Maneki-AI 工厂实时流",
            "version": "v0.5.0-factory",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        await websocket.send_json({
            "type": "board_initialized",
            "models": board["models"],
            "total_tasks": board["total_tasks"],
            "total_revenue": board["total_revenue"],
        })

        # Keep connection alive, listen for client messages
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)

                # Parse client message
                try:
                    msg = json.loads(data)
                except json.JSONDecodeError:
                    msg = {"type": "text", "data": data}

                msg_type = msg.get("type", "text")

                if msg_type == "ping":
                    await websocket.send_json({
                        "type": "pong",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                elif msg_type == "task_submitted":
                    # Client submitted a task — broadcast to all clients
                    task_id = msg.get("task_id", "")
                    goal = msg.get("goal", "")
                    await ws_manager.broadcast({
                        "type": "task_dispatched",
                        "task_id": task_id,
                        "goal": goal,
                        "assigned_model": msg.get("model", "auto"),
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                    # Simulate task lifecycle for demo
                    import random
                    models_list = list(_board_state.keys())
                    selected = msg.get("model") or (models_list[hash(task_id) % len(models_list)] if task_id else "deepseek")
                    if selected in _board_state:
                        _board_state[selected]["tasks"] += 1
                        _board_state[selected]["status"] = "active"
                    await ws_manager.broadcast({
                        "type": "model_selected",
                        "model": selected,
                        "task_id": task_id,
                        "reason": f"AI 董事会基于任务关键词 '{goal[:30]}...' 自动路由至 {selected}",
                    })
                elif msg_type == "subscribe":
                    agent = msg.get("agent")
                    await websocket.send_json({
                        "type": "subscribed",
                        "agent": agent,
                        "message": f"已订阅 Agent '{agent}' 的事件",
                    })
                else:
                    # Echo unknown message types
                    await websocket.send_json({
                        "type": "echo",
                        "data": msg,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })

            except asyncio.TimeoutError:
                # Send heartbeat to keep connection alive
                try:
                    await websocket.send_json({
                        "type": "heartbeat",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "ws_clients": ws_manager.client_count,
                    })
                except Exception:
                    break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS] WebSocket error: {e}")
    finally:
        ws_manager.disconnect(websocket)


# ══════════════════════════════════════════════════════════════════════════════
#  WebSocket /ws/factory_status — 工厂状态实时推送 (NEW: v0.5.0)
# ══════════════════════════════════════════════════════════════════════════════

@app.websocket("/ws/factory_status")
async def factory_status_websocket(websocket: WebSocket):
    """
    WebSocket /ws/factory_status — 工厂核心指标实时推送。

    每 2 秒自动推送以下数据：
    - queue_depth: PriorityTaskQueue 堆积深度
    - retry_tasks: 正在重试的任务列表及计数
    - system_risk_level: 系统当前风险等级
    - auto_fix_success_rate: 自动修复成功率
    - interception_events: RiskManager 拦截事件列表
    - block_threshold: 当前安全阈值
    """
    await factory_status_manager.connect(websocket)
    try:
        # Send initial snapshot
        status = _collect_factory_status()
        await websocket.send_json(status)

        # Keep connection alive; the background publisher handles push
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                # Client can send control messages
                try:
                    msg = json.loads(data)
                except json.JSONDecodeError:
                    msg = {"type": "text", "data": data}

                msg_type = msg.get("type", "")

                if msg_type == "ping":
                    await websocket.send_json({
                        "type": "pong",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                elif msg_type == "set_threshold":
                    new_threshold = msg.get("threshold", 3)
                    if 1 <= new_threshold <= 5:
                        RiskManager.BLOCK_THRESHOLD = new_threshold
                        await websocket.send_json({
                            "type": "threshold_updated",
                            "block_threshold": new_threshold,
                            "description": _describe_threshold(new_threshold),
                        })
                else:
                    await websocket.send_json({
                        "type": "echo",
                        "data": msg,
                    })

            except asyncio.TimeoutError:
                # Background publisher handles data push; just keep alive
                try:
                    await websocket.send_json({
                        "type": "heartbeat",
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    })
                except Exception:
                    break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[WS-factory_status] WebSocket error: {e}")
    finally:
        factory_status_manager.disconnect(websocket)


# ── Broadcast API — 供 ECC/OpenClaw 内部调用 ─────────────────────────────

@app.post("/api/broadcast")
async def broadcast_message(message: dict):
    """
    POST /api/broadcast — 广播消息到所有 WebSocket 客户端。
    供 ECC / OpenClaw / TaskListener 在执行过程中调用。
    """
    await ws_manager.broadcast(message)
    return {"status": "broadcast sent", "clients": ws_manager.client_count}


# ── Fault Status API — 跨域联动墙数据源 ───────────────────────────────────

@app.get("/api/fault_status")
async def get_fault_status():
    """
    GET /api/fault_status — 读取 fault_blackbox.json 并返回所有子项目的实时状态。
    供 Streamlit 仪表盘渲染跨域联动墙使用。
    """
    # Try to load from heartbeat_monitor output
    fault_blackbox_path = os.path.join(
        os.path.dirname(base_dir), "Cline-anti-freeze", "fault_blackbox.json"
    )
    if os.path.isfile(fault_blackbox_path):
        try:
            with open(fault_blackbox_path, "r", encoding="utf-8") as f:
                blackbox = json.load(f)
            return blackbox
        except (json.JSONDecodeError, IOError):
            pass

    # Fallback: scan subprojects for heartbeat files directly
    projects = _scan_subproject_heartbeats()
    return {
        "version": "1.0",
        "last_updated": datetime.now(timezone.utc).isoformat(),
        "projects": projects,
    }


def _scan_subproject_heartbeats() -> dict:
    """Fallback: scan all sibling directories with .governance_entry.py for heartbeat status."""
    import time as time_mod
    root = os.path.dirname(base_dir)
    projects = {}
    if not os.path.isdir(root):
        return projects

    for entry in sorted(os.listdir(root)):
        proj_path = os.path.join(root, entry)
        if not os.path.isdir(proj_path) or entry.startswith("."):
            continue
        gov_entry = os.path.join(proj_path, ".governance_entry.py")
        if not os.path.isfile(gov_entry):
            continue

        hb_file = os.path.join(proj_path, ".heartbeat")
        status = "UNKNOWN"
        ago_sec = None
        hb_ts = None

        if os.path.isfile(hb_file):
            ago_sec = time_mod.time() - os.path.getmtime(hb_file)
            hb_ts = datetime.fromtimestamp(
                os.path.getmtime(hb_file), tz=timezone.utc
            ).isoformat()
            status = "HANG" if ago_sec > 120 else "OK"
        else:
            gov_link = os.path.join(proj_path, ".governance_link")
            if os.path.isfile(gov_link):
                ago_sec = time_mod.time() - os.path.getmtime(gov_link)
                hb_ts = datetime.fromtimestamp(
                    os.path.getmtime(gov_link), tz=timezone.utc
                ).isoformat()
                status = "HANG" if ago_sec > 120 else "OK"

        projects[entry] = {
            "status": status,
            "last_heartbeat_ago_sec": round(ago_sec, 1) if ago_sec else None,
            "last_heartbeat_ts": hb_ts,
            "last_checked": datetime.now(timezone.utc).isoformat(),
        }

    return projects


# ── Entrypoint ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("app:app", host="0.0.0.0", port=port)
