import os
import json
import uuid
import traceback
from datetime import datetime, timezone
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn
from main import TaskDispatcher, Task
from risk_manager import RiskManager

app = FastAPI(title="Maneki-AI Factory")

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
                <a href="https://github.com/winsentrobot008/Maneki-AI" target="_blank">Maneki-AI v0.3.0</a>
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


# ── Entrypoint ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("app:app", host="0.0.0.0", port=port)
