"""
LiveBench API Server - Real-time updates and data access for frontend

This FastAPI server provides:
- WebSocket endpoint for live agent activity streaming
- REST endpoints for agent data, tasks, and economic metrics
- POST /api/tasks endpoint for submitting tasks to the scheduler
- Real-time updates as agents work and learn
"""

import os
import json
import asyncio
import random
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, BackgroundTasks, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import glob

app = FastAPI(title="LiveBench API", version="1.0.0")

# Enable CORS for frontend (allow all origins for Render deployment)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for demo/frontend access
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Data path
DATA_PATH = Path(__file__).parent.parent / "data" / "agent_data"
HIDDEN_AGENTS_PATH = Path(__file__).parent.parent / "data" / "hidden_agents.json"

# Task value lookup (task_id -> task_value_usd)
_TASK_VALUES_PATH = Path(__file__).parent.parent.parent / "scripts" / "task_value_estimates" / "task_values.jsonl"


def _load_task_values() -> tuple:
    values = {}
    pool = {}
    if not _TASK_VALUES_PATH.exists():
        return values, pool
    with open(_TASK_VALUES_PATH, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                tid = entry.get("task_id")
                val = entry.get("task_value_usd")
                if tid and val is not None:
                    values[tid] = val
                    pool[tid] = {
                        "task_value_usd": val,
                        "occupation": entry.get("occupation", "Unknown"),
                        "sector": entry.get("sector", "Unknown"),
                    }
            except json.JSONDecodeError:
                pass
    return values, pool


TASK_VALUES, TASK_POOL = _load_task_values()


def _load_task_completions_by_task_id(agent_dir: Path) -> dict:
    """Load task_completions.jsonl indexed by task_id → entry dict."""
    completions_file = agent_dir / "economic" / "task_completions.jsonl"
    by_task_id = {}
    if not completions_file.exists():
        return by_task_id
    with open(completions_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                tid = entry.get("task_id")
                if tid:
                    by_task_id[tid] = entry
            except json.JSONDecodeError:
                pass
    return by_task_id


def _load_task_completions_by_date(agent_dir: Path) -> dict:
    """Load task_completions.jsonl, summing wall_clock_seconds per date."""
    completions_file = agent_dir / "economic" / "task_completions.jsonl"
    by_date: dict = {}
    if not completions_file.exists():
        return by_date
    with open(completions_file, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                date = entry.get("date")
                secs = entry.get("wall_clock_seconds")
                if date and secs is not None:
                    by_date[date] = by_date.get(date, 0.0) + float(secs)
            except json.JSONDecodeError:
                pass
    return by_date


# Active WebSocket connections
active_connections: List[WebSocket] = []


class AgentStatus(BaseModel):
    """Agent status model"""
    signature: str
    balance: float
    net_worth: float
    survival_status: str
    current_activity: Optional[str] = None
    current_date: Optional[str] = None


class WorkTask(BaseModel):
    """Work task model"""
    task_id: str
    sector: str
    occupation: str
    prompt: str
    date: str
    status: str = "assigned"


class LearningEntry(BaseModel):
    """Learning memory entry"""
    topic: str
    content: str
    timestamp: str


class EconomicMetrics(BaseModel):
    """Economic metrics model"""
    balance: float
    total_token_cost: float
    total_work_income: float
    net_worth: float
    dates: List[str]
    balance_history: List[float]


# WebSocket Connection Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        """Broadcast message to all connected clients"""
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except:
                pass


manager = ConnectionManager()


# ===== 健康检查端点 =====
@app.get("/api/health")
async def health_check():
    """Health check endpoint returning JSON (not HTML) for frontend connectivity checks"""
    return {"status": "ok", "service": "LiveBench API", "version": "1.0.0"}


@app.get("/api/agents")
async def get_agents():
    """Get list of all agents with their current status"""
    agents = []

    if not DATA_PATH.exists():
        return {"agents": []}

    for agent_dir in DATA_PATH.iterdir():
        if agent_dir.is_dir():
            signature = agent_dir.name

            # Get latest balance
            balance_file = agent_dir / "economic" / "balance.jsonl"
            balance_data = None
            if balance_file.exists():
                with open(balance_file, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
                    if lines:
                        balance_data = json.loads(lines[-1])

            # Get latest decision
            decision_file = agent_dir / "decisions" / "decisions.jsonl"
            current_activity = None
            current_date = None
            if decision_file.exists():
                with open(decision_file, 'r', encoding='utf-8') as f:
                    lines = f.readlines()
                    if lines:
                        decision = json.loads(lines[-1])
                        current_activity = decision.get("activity")
                        current_date = decision.get("date")

            if balance_data:
                agents.append({
                    "signature": signature,
                    "balance": balance_data.get("balance", 0),
                    "net_worth": balance_data.get("net_worth", 0),
                    "survival_status": balance_data.get("survival_status", "unknown"),
                    "current_activity": current_activity,
                    "current_date": current_date,
                    "total_token_cost": balance_data.get("total_token_cost", 0)
                })

    return {"agents": agents}


@app.get("/api/agents/{signature}")
async def get_agent_details(signature: str):
    """Get detailed information about a specific agent"""
    agent_dir = DATA_PATH / signature

    if not agent_dir.exists():
        raise HTTPException(status_code=404, detail="Agent not found")

    # Get balance history
    balance_file = agent_dir / "economic" / "balance.jsonl"
    balance_history = []
    if balance_file.exists():
        with open(balance_file, 'r', encoding='utf-8') as f:
            for line in f:
                balance_history.append(json.loads(line))

    # Get decisions
    decision_file = agent_dir / "decisions" / "decisions.jsonl"
    decisions = []
    if decision_file.exists():
        with open(decision_file, 'r', encoding='utf-8') as f:
            for line in f:
                decisions.append(json.loads(line))

    # Get evaluation statistics — use task_completions.jsonl for authoritative task count
    evaluations_file = agent_dir / "work" / "evaluations.jsonl"
    avg_evaluation_score = None
    evaluation_scores = []

    if evaluations_file.exists():
        with open(evaluations_file, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                eval_data = json.loads(line)
                score = eval_data.get("evaluation_score")
                if score is not None:
                    evaluation_scores.append(score)

        if evaluation_scores:
            avg_evaluation_score = sum(evaluation_scores) / len(evaluation_scores)

    # Authoritative task count from task_completions.jsonl
    num_tasks = len(_load_task_completions_by_task_id(agent_dir))

    # Get latest status
    latest_balance = balance_history[-1] if balance_history else {}
    latest_decision = decisions[-1] if decisions else {}

    return {
        "signature": signature,
        "current_status": {
            "balance": latest_balance.get("balance", 0),
            "net_worth": latest_balance.get("net_worth", 0),
            "survival_status": latest_balance.get("survival_status", "unknown"),
            "total_token_cost": latest_balance.get("total_token_cost", 0),
            "total_work_income": latest_balance.get("total_work_income", 0),
            "current_activity": latest_decision.get("activity"),
            "current_date": latest_decision.get("date"),
            "avg_evaluation_score": avg_evaluation_score,
            "num_evaluations": num_tasks  # authoritative count from task_completions.jsonl
        },
        "balance_history": balance_history,
        "decisions": decisions,
        "evaluation_scores": evaluation_scores
    }


@app.get("/api/agents/{signature}/tasks")
async def get_agent_tasks(signature: str):
    """Get all tasks assigned to an agent.

    Uses task_completions.jsonl as the authoritative list of tasks (no duplicates).
    task_details are looked up from tasks.jsonl (first occurrence per task_id).
    """
    agent_dir = DATA_PATH / signature

    if not agent_dir.exists():
        raise HTTPException(status_code=404, detail="Agent not found")

    tasks_file = agent_dir / "work" / "tasks.jsonl"
    evaluations_file = agent_dir / "work" / "evaluations.jsonl"
    completions_file = agent_dir / "economic" / "task_completions.jsonl"

    # Build task metadata lookup from tasks.jsonl (first occurrence per task_id)
    task_metadata: dict = {}
    if tasks_file.exists():
        with open(tasks_file, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                entry = json.loads(line)
                tid = entry.get("task_id")
                if tid and tid not in task_metadata:
                    task_metadata[tid] = entry

    # Build evaluations lookup (by task_id)
    evaluations: dict = {}
    if evaluations_file.exists():
        with open(evaluations_file, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                eval_data = json.loads(line)
                tid = eval_data.get("task_id")
                if tid:
                    evaluations[tid] = eval_data

    # Build task list from task_completions.jsonl (authoritative — one entry per task, no duplicates)
    tasks = []
    if completions_file.exists():
        with open(completions_file, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                completion = json.loads(line)
                tid = completion.get("task_id")
                if not tid:
                    continue

                # Merge task metadata from tasks.jsonl
                task = dict(task_metadata.get(tid, {}))
                task["task_id"] = tid
                # Use date from task_completions (reflects actual execution date)
                task["date"] = completion.get("date", task.get("date", ""))

                # Wall-clock time (authoritative source)
                task["wall_clock_seconds"] = completion.get("wall_clock_seconds")

                # Task market value
                if tid in TASK_VALUES:
                    task["task_value_usd"] = TASK_VALUES[tid]

                # Merge evaluation data
                if tid in evaluations:
                    task["evaluation"] = evaluations[tid]
                    task["completed"] = True
                    task["payment"] = evaluations[tid].get("payment", 0)
                    task["feedback"] = evaluations[tid].get("feedback", "")
                    task["evaluation_score"] = evaluations[tid].get("evaluation_score", None)
                    task["evaluation_method"] = evaluations[tid].get("evaluation_method", "heuristic")
                else:
                    task["completed"] = bool(completion.get("work_submitted", False))
                    task["payment"] = completion.get("money_earned", 0)
                    task["evaluation_score"] = completion.get("evaluation_score")
                    task["evaluation_method"] = "heuristic"

                tasks.append(task)

    # Pool size = total tasks available in GDPVal (all 220), sourced from TASK_VALUES
    pool_size = len(TASK_VALUES) if TASK_VALUES else None

    # Add unassigned tasks from the full GDPVal pool so the dashboard can show
    # untapped potential from tasks the agent never attempted.
    assigned_ids = {t["task_id"] for t in tasks}
    for tid, meta in TASK_POOL.items():
        if tid not in assigned_ids:
            tasks.append({
                "task_id": tid,
                "occupation": meta["occupation"],
                "sector": meta["sector"],
                "task_value_usd": meta["task_value_usd"],
                "completed": False,
                "payment": 0,
                "evaluation_score": None,
            })

    return {"tasks": tasks, "pool_size": pool_size}


@app.get("/api/agents/{signature}/terminal-log/{date}")
async def get_terminal_log(signature: str, date: str):
    """Get terminal log for an agent on a specific date"""
    agent_dir = DATA_PATH / signature
    if not agent_dir.exists():
        raise HTTPException(status_code=404, detail="Agent not found")
    log_file = agent_dir / "terminal_logs" / f"{date}.log"
    if not log_file.exists():
        raise HTTPException(status_code=404, detail="Log not found")
    content = log_file.read_text(encoding="utf-8", errors="replace")
    return {"date": date, "content": content}


@app.get("/api/agents/{signature}/learning")
async def get_agent_learning(signature: str):
    """Get agent's learning memory"""
    agent_dir = DATA_PATH / signature

    if not agent_dir.exists():
        raise HTTPException(status_code=404, detail="Agent not found")

    memory_file = agent_dir / "memory" / "memory.jsonl"

    if not memory_file.exists():
        return {"memory": "", "entries": []}

    # Parse JSONL format
    entries = []
    with open(memory_file, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                entry = json.loads(line)
                entries.append({
                    "topic": entry.get("topic", "Unknown"),
                    "timestamp": entry.get("timestamp", ""),
                    "date": entry.get("date", ""),
                    "content": entry.get("knowledge", "")
                })

    # Create a summary memory content
    memory_content = "\n\n".join([
        f"## {entry['topic']} ({entry['date']})\n{entry['content']}"
        for entry in entries
    ])

    return {
        "memory": memory_content,
        "entries": entries
    }


@app.get("/api/agents/{signature}/economic")
async def get_agent_economic(signature: str):
    """Get economic metrics for an agent"""
    agent_dir = DATA_PATH / signature

    if not agent_dir.exists():
        raise HTTPException(status_code=404, detail="Agent not found")

    balance_file = agent_dir / "economic" / "balance.jsonl"

    if not balance_file.exists():
        raise HTTPException(status_code=404, detail="No economic data found")

    dates = []
    balance_history = []
    token_costs = []
    work_income = []

    with open(balance_file, 'r', encoding='utf-8') as f:
        for line in f:
            data = json.loads(line)
            dates.append(data.get("date", ""))
            balance_history.append(data.get("balance", 0))
            token_costs.append(data.get("daily_token_cost", 0))
            work_income.append(data.get("work_income_delta", 0))

    latest = json.loads(line) if line else {}

    return {
        "balance": latest.get("balance", 0),
        "total_token_cost": latest.get("total_token_cost", 0),
        "total_work_income": latest.get("total_work_income", 0),
        "net_worth": latest.get("net_worth", 0),
        "survival_status": latest.get("survival_status", "unknown"),
        "dates": dates,
        "balance_history": balance_history,
        "token_costs": token_costs,
        "work_income": work_income
    }


@app.get("/api/leaderboard")
async def get_leaderboard():
    """Get leaderboard data for all agents with summary metrics and balance histories"""
    if not DATA_PATH.exists():
        return {"agents": []}

    agents = []

    for agent_dir in DATA_PATH.iterdir():
        if not agent_dir.is_dir():
            continue

        signature = agent_dir.name

        # Load balance history
        balance_file = agent_dir / "economic" / "balance.jsonl"
        balance_history = []
        if balance_file.exists():
            with open(balance_file, 'r', encoding='utf-8') as f:
                for line in f:
                    if line.strip():
                        balance_history.append(json.loads(line))

        if not balance_history:
            continue

        latest = balance_history[-1]
        initial_balance = balance_history[0].get("balance", 0)
        current_balance = latest.get("balance", 0)
        pct_change = ((current_balance - initial_balance) / initial_balance * 100) if initial_balance else 0

        # Load evaluation scores
        evaluations_file = agent_dir / "work" / "evaluations.jsonl"
        evaluation_scores = []
        if evaluations_file.exists():
            with open(evaluations_file, 'r', encoding='utf-8') as f:
                for line in f:
                    if line.strip():
                        eval_data = json.loads(line)
                        score = eval_data.get("evaluation_score")
                        if score is not None:
                            evaluation_scores.append(score)

        avg_eval_score = (sum(evaluation_scores) / len(evaluation_scores)) if evaluation_scores else None

        # Load task completions (authoritative source) — used for wall-clock and task count
        task_completions_by_task_id = _load_task_completions_by_task_id(agent_dir)
        task_completions_by_date = _load_task_completions_by_date(agent_dir)

        # Strip balance history to essential fields, exclude initialization
        stripped_history = []
        for entry in balance_history:
            if entry.get("date") == "initialization":
                continue
            stripped_history.append({
                "date": entry.get("date"),
                "balance": entry.get("balance", 0),
            })

        # Build wall-clock series from task_completions (every entry has wall_clock_seconds).
        # We pair each completion with the balance recorded in balance.jsonl for that task_id.
        balance_by_task_id = {}
        for entry in balance_history:
            tid = entry.get("task_id")
            if tid:
                balance_by_task_id[tid] = entry.get("balance", 0)

        # Sort completions by timestamp so cumulative hours are in execution order
        sorted_completions = sorted(
            task_completions_by_task_id.values(),
            key=lambda e: e.get("timestamp") or "",
        )
        wc_series = []
        for tc in sorted_completions:
            tid = tc.get("task_id")
            wcs = tc.get("wall_clock_seconds")
            if wcs is None:
                continue
            wc_series.append({
                "wall_clock_seconds": wcs,
                "balance": balance_by_task_id.get(tid, current_balance),
                "date": tc.get("date"),
                "timestamp": tc.get("timestamp"),
            })

        agents.append({
            "signature": signature,
            "initial_balance": initial_balance,
            "current_balance": current_balance,
            "pct_change": round(pct_change, 1),
            "total_token_cost": latest.get("total_token_cost", 0),
            "total_work_income": latest.get("total_work_income", 0),
            "net_worth": latest.get("net_worth", 0),
            "survival_status": latest.get("survival_status", "unknown"),
            "num_tasks": len(task_completions_by_task_id),  # authoritative count from task_completions.jsonl
            "avg_eval_score": avg_eval_score,
            "balance_history": stripped_history,
            "wc_series": wc_series,
        })

    # Sort by current_balance descending
    agents.sort(key=lambda a: a["current_balance"], reverse=True)

    return {"agents": agents}


ARTIFACT_EXTENSIONS = {'.pdf', '.docx', '.xlsx', '.pptx'}
ARTIFACT_MIME_TYPES = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}


@app.get("/api/artifacts/random")
async def get_random_artifacts(count: int = Query(default=30, ge=1, le=100)):
    """Get a random sample of agent-produced artifact files"""
    if not DATA_PATH.exists():
        return {"artifacts": []}

    artifacts = []
    for agent_dir in DATA_PATH.iterdir():
        if not agent_dir.is_dir():
            continue
        sandbox_dir = agent_dir / "sandbox"
        if not sandbox_dir.exists():
            continue
        signature = agent_dir.name
        for date_dir in sandbox_dir.iterdir():
            if not date_dir.is_dir():
                continue
            for file_path in date_dir.rglob("*"):
                if not file_path.is_file():
                    continue
                # Skip code_exec, videos, and reference_files directories
                rel_parts = file_path.relative_to(date_dir).parts
                if any(p in ('code_exec', 'videos', 'reference_files') for p in rel_parts):
                    continue
                ext = file_path.suffix.lower()
                if ext not in ARTIFACT_EXTENSIONS:
                    continue
                rel_path = str(file_path.relative_to(DATA_PATH))
                artifacts.append({
                    "agent": signature,
                    "date": date_dir.name,
                    "filename": file_path.name,
                    "extension": ext,
                    "size_bytes": file_path.stat().st_size,
                    "path": rel_path,
                })

    if len(artifacts) > count:
        artifacts = random.sample(artifacts, count)

    return {"artifacts": artifacts}


@app.get("/api/artifacts/file")
async def get_artifact_file(path: str = Query(...)):
    """Serve an artifact file for preview/download"""
    if ".." in path:
        raise HTTPException(status_code=400, detail="Invalid path")

    file_path = (DATA_PATH / path).resolve()
    # Ensure resolved path is within DATA_PATH
    if not str(file_path).startswith(str(DATA_PATH.resolve())):
        raise HTTPException(status_code=403, detail="Access denied")

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    ext = file_path.suffix.lower()
    media_type = ARTIFACT_MIME_TYPES.get(ext, 'application/octet-stream')
    return FileResponse(file_path, media_type=media_type)


@app.get("/api/settings/hidden-agents")
async def get_hidden_agents():
    """Get list of hidden agent signatures"""
    if HIDDEN_AGENTS_PATH.exists():
        with open(HIDDEN_AGENTS_PATH, 'r', encoding='utf-8') as f:
            hidden = json.load(f)
        return {"hidden": hidden}
    return {"hidden": []}


@app.put("/api/settings/hidden-agents")
async def set_hidden_agents(body: dict):
    """Set list of hidden agent signatures"""
    hidden = body.get("hidden", [])
    HIDDEN_AGENTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(HIDDEN_AGENTS_PATH, 'w') as f:
        json.dump(hidden, f)
    return {"status": "ok"}


DISPLAYING_NAMES_PATH = Path(__file__).parent.parent / "data" / "displaying_names.json"

@app.get("/api/settings/displaying-names")
async def get_displaying_names():
    """Get display name mapping {signature: display_name}"""
    if DISPLAYING_NAMES_PATH.exists():
        with open(DISPLAYING_NAMES_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}


# =====================================================================
# 任务调度器集成
# =====================================================================
# 延迟导入以避免循环依赖
_scheduler_instance = None


def _get_scheduler():
    global _scheduler_instance
    if _scheduler_instance is None:
        import sys
        # 确保项目根目录在 sys.path 中，使 'livebench' 包可导入
        _project_root = Path(__file__).parent.parent.parent
        if str(_project_root) not in sys.path:
            sys.path.insert(0, str(_project_root))
        from livebench.scheduler.task_scheduler import get_scheduler

        # ── 创建"双通道"广播回调：WebSocket + SSE 队列 ──
        async def _combined_broadcast(event: dict):
            """同时广播到 WebSocket 和 SSE 队列"""
            # 1. WebSocket 广播（保持向后兼容）
            await manager.broadcast(event)
            # 2. SSE 队列推送（供前端 EventSource 使用）
            task_id = event.get("task_id")
            if task_id and task_id in _sse_queues:
                try:
                    await _sse_queues[task_id].put(event)
                except Exception:
                    pass

        _scheduler_instance = get_scheduler(broadcast_callback=_combined_broadcast)
    return _scheduler_instance


# ── Pydantic 请求/响应模型 ──────────────────────────────────
class TaskSubmitRequest(BaseModel):
    """任务提交请求"""
    prompt: str = Field(..., description="任务描述，例如：搞个3D投掷游戏")
    agent: Optional[str] = Field(None, description="指定 Agent 签名（可选）")
    occupation: Optional[str] = Field("Software Engineer", description="职业分类")
    sector: Optional[str] = Field("Technology", description="行业分类")
    max_payment: Optional[float] = Field(50.0, description="最大支付金额（美元）")
    fast_mode: Optional[bool] = Field(False, description="（已弃用）使用 fast_mode 布尔值")
    mode: Optional[str] = Field("deep", description="引擎模式: 'fast' (2层直通) 或 'deep' (5层自主Agent)")
    parent_task_id: Optional[str] = Field(None, description="父任务ID（从Fast Mode升级到Deep Mode时使用）")


class TaskSubmitResponse(BaseModel):
    """任务提交响应"""
    task_id: str
    agent: str
    status: str
    message: str


class TaskStatusResponse(BaseModel):
    """任务状态响应"""
    task_id: str
    status: str
    agent: Optional[str] = None
    prompt: Optional[str] = None
    occupation: Optional[str] = None
    sector: Optional[str] = None
    created_at: Optional[str] = None
    result: Optional[dict] = None
    error: Optional[str] = None


# ── SSE 事件队列（用于 /api/stream 端点） ──────────────────
_sse_queues: Dict[str, asyncio.Queue] = {}


def _get_sse_queue(task_id: str) -> asyncio.Queue:
    """获取或创建 SSE 事件队列"""
    if task_id not in _sse_queues:
        _sse_queues[task_id] = asyncio.Queue()
    return _sse_queues[task_id]


def _sse_progress_callback(task_id: str):
    """
    创建一个进度回调，将事件推送到 SSE 队列
    同时也广播到 WebSocket（保持向后兼容）
    """
    queue = _get_sse_queue(task_id)

    def _cb(event: dict):
        event["task_id"] = task_id
        # 推送到 SSE 队列
        asyncio.ensure_future(queue.put(event))
        # 同时广播到 WebSocket
        asyncio.ensure_future(manager.broadcast(event))

    return _cb


# ── SSE 流端点（Server-Sent Events） ────────────────────────
@app.get("/api/stream/task/{task_id}")
async def stream_task_events(request: Request, task_id: str):
    """
    SSE (Server-Sent Events) 流端点。

    前端通过 EventSource 连接到此端点即可接收实时事件：
    - agent_thinking: Agent 思考日志
    - code_generated: 代码生成进度
    - artifact_created: 文件/作品创建
    - work_submitted: 工作提交
    - task_completed: 任务完成
    - task_error: 任务错误

    与 Hugging Face 在线版行为一致（使用 SSEUtils.js）。
    """
    queue = _get_sse_queue(task_id)

    async def event_generator():
        try:
            # 发送初始连接事件
            yield {
                "event": "connected",
                "data": json.dumps({
                    "type": "connected",
                    "message": "✅ SSE 流已连接",
                    "task_id": task_id,
                    "timestamp": datetime.now().isoformat(),
                }),
            }

            while True:
                # 检查客户端是否断开
                if await request.is_disconnected():
                    break

                try:
                    # 从队列获取下一个事件，超时 30 秒
                    event = await asyncio.wait_for(queue.get(), timeout=30.0)
                    event_type = event.get("type", "message")
                    yield {
                        "event": event_type,
                        "data": json.dumps(event),
                    }

                    # 如果是完成或错误事件，结束流
                    if event_type in ("task_completed", "task_error"):
                        yield {
                            "event": "done",
                            "data": json.dumps({"type": "done", "task_id": task_id}),
                        }
                        break

                except asyncio.TimeoutError:
                    # 发送心跳保持连接
                    yield {
                        "event": "heartbeat",
                        "data": json.dumps({
                            "type": "heartbeat",
                            "timestamp": datetime.now().isoformat(),
                        }),
                    }

        finally:
            # 已断开连接的客户端不能再 yield — 否则 Python 3.12 会抛出
            # RuntimeError("async generator ignored GeneratorExit") 并崩溃。
            # 仅在客户端仍连接时发射 complete / close 事件。
            try:
                if not await request.is_disconnected():
                    yield {
                        "event": "complete",
                        "data": json.dumps({
                            "type": "complete",
                            "event": "complete",
                            "message": "Task finished",
                            "task_id": task_id,
                        }),
                    }
                    yield {
                        "event": "close",
                        "data": json.dumps({
                            "type": "close",
                            "message": "[DONE]",
                            "task_id": task_id,
                        }),
                    }
            except (GeneratorExit, RuntimeError, Exception):
                # 安全兜底：如果客户端已断开或 generator 正在关闭，静默忽略
                pass
            # 清理队列
            if task_id in _sse_queues:
                del _sse_queues[task_id]

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── POST /api/tasks — 双引擎动态路由 ──
@app.post("/api/tasks", response_model=TaskSubmitResponse)
async def submit_task(request: TaskSubmitRequest, background_tasks: BackgroundTasks):
    """
    提交一个任务到调度器。

    Dual-Engine 动态路由：
    - mode="fast"（2层直通）: 跳过 LiveAgent 5 层循环，直接调用 DeepSeek API 单轮生成，约 45 秒
    - mode="deep"（5层自主）: 使用 LiveAgent 完整 5 层执行管道（规划→执行→工具调用→提交→评估）

    Agent 会调用 DeepSeek API 执行任务，并通过 SSE + WebSocket 实时回传进度。
    使用 FastAPI BackgroundTasks 确保后台任务不会被 Python GC 静默回收。
    """
    import uuid as _uuid
    task_id = f"task_{_uuid.uuid4().hex[:12]}"

    # ── 引擎选择：优先 mode 字段，回退 fast_mode（向后兼容） ──
    is_fast = (request.mode and request.mode.lower() == "fast") or request.fast_mode
    engine_label = "FAST" if is_fast else "DEEP"

    # ── 交通控制日志 ──
    print(f"\n{'='*60}")
    print(f"[TRAFFIC CONTROL] ⚡ Inbound task routed to [{engine_label}] engine")
    print(f"   task_id:     {task_id}")
    print(f"   mode:        {engine_label}")
    print(f"   prompt:      {request.prompt[:200]}")
    print(f"   occupation:  {request.occupation or 'Software Engineer'}")
    print(f"   sector:      {request.sector or 'Technology'}")
    print(f"{'='*60}\n")

    if is_fast:
        # ── 快速通道（2层直通）：直接使用 FastTaskRunner ──
        from livebench.scheduler.fast_task_runner import FastTaskRunner
        runner = FastTaskRunner(
            progress_callback=_sse_progress_callback(task_id),
        )

        # 注册到调度器（用于状态查询）
        scheduler = _get_scheduler()
        scheduler._tasks[task_id] = {
            "task_id": task_id,
            "prompt": request.prompt,
            "agent": "FastAgent-001",
            "occupation": request.occupation or "Software Engineer",
            "sector": request.sector or "Technology",
            "status": "queued",
            "created_at": datetime.now().isoformat(),
            "mode": "fast",
        }

        # 使用 BackgroundTasks 执行快速通道任务
        background_tasks.add_task(
            _execute_fast_task,
            runner, task_id, request.prompt,
            request.occupation or "Software Engineer",
            request.sector or "Technology",
            request.max_payment or 50.0,
        )

        return TaskSubmitResponse(
            task_id=task_id,
            agent="FastAgent-001",
            status="queued",
            message=f"🚀 [2层直通] 任务已提交（Fast Mode），预计 ~45 秒完成",
        )

    # ── 深度通道（5层自主Agent）：使用调度器 + LiveAgent ──
    scheduler = _get_scheduler()

    result = await scheduler.submit_task(
        task_prompt=request.prompt,
        agent_signature=request.agent,
        occupation=request.occupation or "Software Engineer",
        sector=request.sector or "Technology",
        max_payment=request.max_payment or 50.0,
    )

    # ── [EVOLUTION FORK] parent_task_id 处理 → 完全委托到后台线程 ──
    # 注意：所有文件 I/O（扫描目录、复制文件）都在 BackgroundTasks 中异步执行，
    # 不会阻塞当前请求线程。POST 立即返回 200，释放 FastAPI 事件循环
    # 以便前端 WebSocket/SSE 握手可以立即完成。
    if request.parent_task_id:
        print(f"\n{'='*60}")
        print(f"[EVOLUTION FORK] 🔄 parent_task_id={request.parent_task_id} detected. Deferring workspace seeding to BackgroundTasks.")
        print(f"[EVOLUTION FORK] ✅ Deep task_id={result.get('task_id')} registered. Returning 200 immediately to unblock event loop.")
        print(f"{'='*60}\n")

        background_tasks.add_task(
            _seed_and_execute_deep_task,
            scheduler,
            result["task_id"],
            result["agent"],
            request.prompt,
            request.parent_task_id,
            request.occupation or "Software Engineer",
            request.sector or "Technology",
            request.max_payment or 50.0,
        )
    else:
        # 普通 Deep Mode — 无 workspace seeding
        background_tasks.add_task(
            scheduler._execute_task_background,
            result["task_id"],
            result["agent"],
            request.prompt,
            request.occupation or "Software Engineer",
            request.sector or "Technology",
            request.max_payment or 50.0,
        )

    return TaskSubmitResponse(**result)


async def _execute_fast_task(
    runner,
    task_id: str,
    task_prompt: str,
    occupation: str,
    sector: str,
    max_payment: float,
):
    """
    后台执行快速通道任务。
    由 BackgroundTasks 框架管理生命周期。
    """
    scheduler = _get_scheduler()
    try:
        scheduler._tasks[task_id]["status"] = "running"
        result = await runner.run_task(
            task_id=task_id,
            task_prompt=task_prompt,
            occupation=occupation,
            sector=sector,
            max_payment=max_payment,
        )
        scheduler._tasks[task_id]["status"] = result.get("status", "completed")
        scheduler._tasks[task_id]["result"] = result

        # ── Persist fast task completion to agent data disk ──
        try:
            _persist_fast_task_completion(
                task_id=task_id,
                prompt=task_prompt,
                occupation=occupation,
                sector=sector,
                result=result,
                agent_signature="FastAgent-001",
            )
        except Exception as persist_err:
            print(f"[PERSIST] ⚠️ Failed to persist fast task {task_id}: {persist_err}")

    except Exception as e:
        scheduler._tasks[task_id]["status"] = "error"
        scheduler._tasks[task_id]["error"] = str(e)
        import traceback
        traceback.print_exc()


async def _seed_and_execute_deep_task(
    scheduler,
    task_id: str,
    agent_signature: str,
    task_prompt: str,
    parent_task_id: str,
    occupation: str,
    sector: str,
    max_payment: float,
):
    """
    BackgroundTask: 执行 "Fast→Deep" Evolution Fork 工作流。

    分两步（均在后台线程中运行，不阻塞事件循环）：
    1. 查找父任务 (parent_task_id) 生成的工件文件，复制到新 Agent 的 sandbox
    2. 委托给 scheduler._execute_task_background 启动 5 层 LiveAgent 循环
    """
    print(f"\n{'='*60}")
    print(f"[PIPELINE EVOLUTION] 🔄 Cloning fast track sample {parent_task_id} into deep autonomous processing track.")
    print(f"[PIPELINE EVOLUTION] 📁 Deep task: {task_id}, Agent: {agent_signature}")
    print(f"{'='*60}\n")

    # ── 步骤 1: 查找父任务工件文件 ──
    parent_artifact_dir = Path(__file__).parent.parent.parent / "产出"
    fast_output_files = []

    if parent_artifact_dir.exists():
        parent_short_id = parent_task_id
        if parent_short_id.startswith("task_"):
            parent_short_id = parent_short_id[len("task_"):]
        parent_short_id = parent_short_id[:8]

        for f in parent_artifact_dir.iterdir():
            if f.is_file() and parent_short_id in f.name:
                fast_output_files.append(f)
            elif f.is_dir() and parent_short_id in f.name:
                for sub in f.rglob("*"):
                    if sub.is_file():
                        fast_output_files.append(sub)

        # 也从 scheduler 内存中查找父任务的 artifacts
        parent_task_data = scheduler.get_task_status(parent_task_id)
        if parent_task_data:
            parent_result = parent_task_data.get("result") or {}
            parent_artifacts = parent_result.get("artifacts", [])
            for artifact_path in parent_artifacts:
                if isinstance(artifact_path, str):
                    ap = Path(artifact_path)
                    if ap.exists() and ap.is_file():
                        fast_output_files.append(ap)

    # ── 步骤 2: 复制到新 Agent 的 sandbox ──
    if fast_output_files:
        # 去重
        seen = set()
        unique_files = []
        for f in fast_output_files:
            fp = str(f.resolve())
            if fp not in seen:
                seen.add(fp)
                unique_files.append(f)

        # 创建 seed 目录
        new_agent_workspace = Path(__file__).parent.parent / "data" / "agent_data" / agent_signature / "sandbox"
        new_agent_workspace.mkdir(parents=True, exist_ok=True)
        seed_dir = new_agent_workspace / f"seeded_from_{parent_task_id[:12]}"
        seed_dir.mkdir(parents=True, exist_ok=True)

        copied_count = 0
        for src_path in unique_files:
            if src_path.exists():
                dest = seed_dir / src_path.name
                try:
                    dest.write_bytes(src_path.read_bytes())
                    copied_count += 1
                    print(f"[PIPELINE EVOLUTION] ✅ Seeded: {src_path.name} -> {dest}")
                except Exception as e:
                    print(f"[PIPELINE EVOLUTION] ⚠️ Failed to seed {src_path.name}: {e}")

        if task_id in scheduler._tasks:
            scheduler._tasks[task_id]["seeded_from"] = parent_task_id
            scheduler._tasks[task_id]["seeded_files_count"] = copied_count

        print(f"[PIPELINE EVOLUTION] 📊 Total {copied_count}/{len(unique_files)} files seeded.\n")
    else:
        print(f"[PIPELINE EVOLUTION] ⚠️ parent_task_id={parent_task_id} specified but no artifacts found.\n")

    # ── 步骤 3: 委托执行到 scheduler ──
    await scheduler._execute_task_background(
        task_id,
        agent_signature,
        task_prompt,
        occupation,
        sector,
        max_payment,
    )


# ── 辅助函数：持久化 Fast Mode 任务完成记录到磁盘 ──────────
def _persist_fast_task_completion(
    task_id: str,
    prompt: str,
    occupation: str,
    sector: str,
    result: dict,
    agent_signature: str = "FastAgent-001",
):
    """
    将 Fast Mode 任务的完成记录写入 agent_data/{agent}/economic/task_completions.jsonl，
    使得 GET /api/tasks 可以扫描到该任务并正确显示为 completed 状态。
    同时也写入 work/tasks.jsonl 用于元数据查询。
    """
    now = datetime.now()
    today_str = now.strftime("%Y-%m-%d")
    timestamp = now.isoformat()

    # ── 写入 task_completions.jsonl ──
    agent_dir = DATA_PATH / agent_signature
    economic_dir = agent_dir / "economic"
    economic_dir.mkdir(parents=True, exist_ok=True)

    completion_entry = {
        "task_id": task_id,
        "prompt": prompt,
        "occupation": occupation,
        "sector": sector,
        "agent": agent_signature,
        "date": today_str,
        "timestamp": timestamp,
        "status": "completed",
        "mode": "fast",
        "wall_clock_seconds": result.get("elapsed_seconds", 0),
        "money_earned": result.get("payment", 0),
        "evaluation_score": result.get("evaluation_score", 0),
        "work_submitted": True,
    }

    completions_file = economic_dir / "task_completions.jsonl"
    with open(completions_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(completion_entry, ensure_ascii=False) + "\n")
    print(f"[PERSIST] ✅ Written task_completions.jsonl for {task_id}")

    # ── 写入 work/tasks.jsonl（元数据） ──
    work_dir = agent_dir / "work"
    work_dir.mkdir(parents=True, exist_ok=True)

    task_meta = {
        "task_id": task_id,
        "prompt": prompt,
        "occupation": occupation,
        "sector": sector,
        "agent": agent_signature,
        "date": today_str,
        "timestamp": timestamp,
        "status": "completed",
        "mode": "fast",
    }

    tasks_file = work_dir / "tasks.jsonl"
    with open(tasks_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(task_meta, ensure_ascii=False) + "\n")
    print(f"[PERSIST] ✅ Written tasks.jsonl for {task_id}")


# ── 辅助函数：从 Agent 数据文件中查找任务 ──────────────────
def _lookup_task_from_agent_data(task_id: str) -> dict:
    """遍历所有 Agent 的数据文件，返回任务状态字典或 None"""
    if not DATA_PATH.exists():
        return None
    for agent_dir in DATA_PATH.iterdir():
        if not agent_dir.is_dir():
            continue
        agent_sig = agent_dir.name
        completions = _load_task_completions_by_task_id(agent_dir)
        if task_id not in completions:
            continue
        completion = completions[task_id]
    # 从 tasks.jsonl 读取元数据
    tasks_file = agent_dir / "work" / "tasks.jsonl"
    meta = {}
    if tasks_file.exists():
        with open(tasks_file, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                entry = json.loads(line)
                if entry.get("task_id") == task_id:
                    meta = entry
                    break
    # 从 evaluations.jsonl 读取评分
    evaluations_file = agent_dir / "work" / "evaluations.jsonl"
    eval_data = {}
    if evaluations_file.exists():
        with open(evaluations_file, 'r', encoding='utf-8') as f:
            for line in f:
                if not line.strip():
                    continue
                ev = json.loads(line)
                if ev.get("task_id") == task_id:
                    eval_data = ev
                    break
        return {
            "task_id": task_id,
            "status": "completed",
            "agent": agent_sig,
            "prompt": meta.get("prompt") or completion.get("prompt") or "",
            "occupation": meta.get("occupation") or completion.get("occupation") or "Unknown",
            "sector": meta.get("sector") or completion.get("sector") or "Unknown",
            "created_at": completion.get("timestamp") or meta.get("timestamp") or "",
            "result": {
                "thinking_log": [],
                "code_generated": [],
                "artifacts": [],
                "payment": eval_data.get("payment") or completion.get("money_earned", 0),
                "evaluation_score": eval_data.get("evaluation_score") or completion.get("evaluation_score"),
            },
            "error": None,
        }
    return None


# ── GET /api/tasks/{task_id} — 查询任务状态 ────────────────
@app.get("/api/tasks/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str):
    """查询指定任务的状态和结果
    
    优先从调度器内存中查找，回退到 Agent 数据文件 (task_completions.jsonl)。
    """
    scheduler = _get_scheduler()
    task = scheduler.get_task_status(task_id)
    if not task:
        task = _lookup_task_from_agent_data(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found in scheduler or agent data files")
    return TaskStatusResponse(**task)


# ── GET /api/tasks/{task_id}/detail — 查询任务完整详情 ─────
@app.get("/api/tasks/{task_id}/detail")
async def get_task_detail(task_id: str):
    """查询任务的完整详情，包含 thinking_log、code_generated、artifacts 等。
    
    优先从调度器内存中查找，如果未找到则回退到从 Agent 数据文件 (task_completions.jsonl)
    中读取，确保前端能查看到历史任务详情。
    """
    scheduler = _get_scheduler()
    task = scheduler.get_task_status(task_id)
    if not task:
        # ── 回退：从 Agent 数据文件中查找 ──
        if DATA_PATH.exists():
            for agent_dir in DATA_PATH.iterdir():
                if not agent_dir.is_dir():
                    continue
                agent_sig = agent_dir.name
                completions = _load_task_completions_by_task_id(agent_dir)
                if task_id in completions:
                    completion = completions[task_id]
                    # 从 tasks.jsonl 读取元数据
                    tasks_file = agent_dir / "work" / "tasks.jsonl"
                    meta = {}
                    if tasks_file.exists():
                        with open(tasks_file, 'r', encoding='utf-8') as f:
                            for line in f:
                                if not line.strip():
                                    continue
                                entry = json.loads(line)
                                if entry.get("task_id") == task_id:
                                    meta = entry
                                    break
                    # 从 evaluations.jsonl 读取评分
                    evaluations_file = agent_dir / "work" / "evaluations.jsonl"
                    eval_data = {}
                    if evaluations_file.exists():
                        with open(evaluations_file, 'r', encoding='utf-8') as f:
                            for line in f:
                                if not line.strip():
                                    continue
                                ev = json.loads(line)
                                if ev.get("task_id") == task_id:
                                    eval_data = ev
                                    break
                    return {
                        "task_id": task_id,
                        "status": "completed",
                        "agent": agent_sig,
                        "prompt": meta.get("prompt") or completion.get("prompt") or "",
                        "occupation": meta.get("occupation") or completion.get("occupation") or "Unknown",
                        "sector": meta.get("sector") or completion.get("sector") or "Unknown",
                        "created_at": completion.get("timestamp") or meta.get("timestamp") or "",
                        "error": None,
                        "thinking_log": [],
                        "code_generated": [],
                        "artifacts": [],
                        "payment": eval_data.get("payment") or completion.get("money_earned", 0),
                        "evaluation_score": eval_data.get("evaluation_score") or completion.get("evaluation_score"),
                    }
        # 在所有数据源中都未找到
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found in scheduler or agent data files")
    # 从调度器返回
    result = task.get("result") or {}
    return {
        "task_id": task["task_id"],
        "status": task["status"],
        "agent": task.get("agent"),
        "prompt": task.get("prompt"),
        "occupation": task.get("occupation"),
        "sector": task.get("sector"),
        "created_at": task.get("created_at"),
        "error": task.get("error"),
        "thinking_log": result.get("thinking_log", []),
        "code_generated": result.get("code_generated", []),
        "artifacts": result.get("artifacts", []),
        "payment": result.get("payment"),
        "evaluation_score": result.get("evaluation_score"),
    }


# ── DELETE /api/tasks/{task_id} — 删除/清除任务 ───────────
@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: str):
    """删除指定任务。
    
    宽容模式：即使 task_id 不存在于调度器内存中，也返回成功响应。
    前端在提交新任务前使用 DELETE 清除/重置状态，如果收到 404
    会导致 Promise 悬挂，UI 卡在"提交中..."（Submitting...）状态。
    """
    scheduler = _get_scheduler()
    found = scheduler.delete_task(task_id)
    # 无论是否找到，都返回成功（宽容模式）
    # 目的是确保该 task_id 被清除，而不是报错
    return {
        "status": "success",
        "message": "Task cleared/deleted" if not found else "Task deleted",
        "task_id": task_id,
    }


# ── POST /api/tasks/{task_id}/resubmit — 重新提交任务 ─────
class TaskResubmitRequest(BaseModel):
    prompt: Optional[str] = Field(None, description="修改后的提示词")

@app.post("/api/tasks/{task_id}/resubmit")
async def resubmit_task(task_id: str, request: TaskResubmitRequest):
    """重新提交任务（可修改提示词）"""
    scheduler = _get_scheduler()
    original = scheduler.get_task_status(task_id)
    if not original:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    prompt = request.prompt or original.get("prompt", "")
    result = await scheduler.submit_task(
        task_prompt=prompt,
        agent_signature=original.get("agent"),
        occupation=original.get("occupation") or "Software Engineer",
        sector=original.get("sector") or "Technology",
        max_payment=50.0,
    )
    return TaskSubmitResponse(**result)


# ── GET /api/tasks — 获取所有任务列表 ───────────────────────
@app.get("/api/tasks")
async def get_all_tasks():
    """获取所有已提交的任务列表
    
    从调度器内存 + Agent 数据文件 (task_completions.jsonl) 合并返回。
    """
    scheduler = _get_scheduler()
    tasks = scheduler.get_all_tasks()
    # 收集调度器中已有的 task_id
    seen_ids = {t["task_id"] for t in tasks if "task_id" in t}
    # 从 Agent 数据文件中补充历史任务
    if DATA_PATH.exists():
        for agent_dir in DATA_PATH.iterdir():
            if not agent_dir.is_dir():
                continue
            completions = _load_task_completions_by_task_id(agent_dir)
            for tid, completion in completions.items():
                if tid in seen_ids:
                    continue
                seen_ids.add(tid)
                # 从 tasks.jsonl 读取元数据
                tasks_file = agent_dir / "work" / "tasks.jsonl"
                meta = {}
                if tasks_file.exists():
                    with open(tasks_file, 'r', encoding='utf-8') as f:
                        for line in f:
                            if not line.strip():
                                continue
                            entry = json.loads(line)
                            if entry.get("task_id") == tid:
                                meta = entry
                                break
                tasks.append({
                    "task_id": tid,
                    "status": "completed",
                    "agent": agent_dir.name,
                    "prompt": meta.get("prompt") or completion.get("prompt") or "",
                    "occupation": meta.get("occupation") or completion.get("occupation") or "Unknown",
                    "sector": meta.get("sector") or completion.get("sector") or "Unknown",
                    "created_at": completion.get("timestamp") or meta.get("timestamp") or "",
                    "mode": meta.get("mode") or completion.get("mode") or "deep",
                    "error": None,
                    "result": None,
                })
    return {"tasks": tasks, "total": len(tasks)}


# ── GET /api/scheduler/agents — 调度器 Agent 状态 ──────────
@app.get("/api/scheduler/agents")
async def get_scheduler_agents():
    """获取调度器中所有 Agent 的运行状态"""
    scheduler = _get_scheduler()
    agents = scheduler.get_all_agents()
    return {"agents": agents}


# =====================================================================
# WebSocket 实时流（增强版）
# =====================================================================
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket 端点 — 实时流。

    前端连接后可以实时接收：
    - agent_thinking: Agent 思考日志
    - code_generated: 代码生成进度
    - artifact_created: 文件/作品创建
    - work_submitted: 工作提交
    - task_completed: 任务完成
    - task_error: 任务错误
    - balance_update: 余额更新
    - activity_update: 活动更新
    """
    await manager.connect(websocket)
    try:
        # 发送连接成功消息
        await websocket.send_json({
            "type": "connected",
            "message": "✅ 已连接到 LiveBench 实时流",
            "timestamp": datetime.now().isoformat(),
        })

        # 持续监听客户端消息（心跳保持）
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)

                # 解析客户端消息
                try:
                    msg = json.loads(data)
                except json.JSONDecodeError:
                    msg = {"type": "text", "data": data}

                msg_type = msg.get("type", "text")

                if msg_type == "ping":
                    # 心跳响应
                    await websocket.send_json({
                        "type": "pong",
                        "timestamp": datetime.now().isoformat(),
                    })
                elif msg_type == "subscribe":
                    # 订阅特定 Agent 的事件
                    agent = msg.get("agent")
                    await websocket.send_json({
                        "type": "subscribed",
                        "agent": agent,
                        "message": f"已订阅 Agent '{agent}' 的事件",
                    })
                else:
                    # 回显
                    await websocket.send_json({
                        "type": "echo",
                        "data": data,
                        "timestamp": datetime.now().isoformat(),
                    })

            except asyncio.TimeoutError:
                # 发送心跳保活
                try:
                    await websocket.send_json({
                        "type": "heartbeat",
                        "timestamp": datetime.now().isoformat(),
                    })
                except Exception:
                    break

    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as e:
        print(f"WebSocket error: {e}")
        try:
            manager.disconnect(websocket)
        except Exception:
            pass


@app.post("/api/broadcast")
async def broadcast_message(message: dict):
    """
    广播消息到所有 WebSocket 客户端。
    供调度器 / Agent 在执行过程中调用。
    """
    await manager.broadcast(message)
    return {"status": "broadcast sent", "clients": len(manager.active_connections)}


# File watcher for live updates (optional, for when agents are running)
async def watch_agent_files():
    """
    Watch agent data files for changes and broadcast updates
    This runs as a background task
    """
    import time
    last_modified = {}

    while True:
        try:
            if DATA_PATH.exists():
                for agent_dir in DATA_PATH.iterdir():
                    if agent_dir.is_dir():
                        signature = agent_dir.name

                        # Check balance file
                        balance_file = agent_dir / "economic" / "balance.jsonl"
                        if balance_file.exists():
                            mtime = balance_file.stat().st_mtime
                            key = f"{signature}_balance"

                            if key not in last_modified or mtime > last_modified[key]:
                                last_modified[key] = mtime

                                # Read latest balance
                                with open(balance_file, 'r', encoding='utf-8') as f:
                                    lines = f.readlines()
                                    if lines:
                                        data = json.loads(lines[-1])
                                        await manager.broadcast({
                                            "type": "balance_update",
                                            "signature": signature,
                                            "data": data
                                        })

                        # Check decisions file
                        decision_file = agent_dir / "decisions" / "decisions.jsonl"
                        if decision_file.exists():
                            mtime = decision_file.stat().st_mtime
                            key = f"{signature}_decision"

                            if key not in last_modified or mtime > last_modified[key]:
                                last_modified[key] = mtime

                                # Read latest decision
                                with open(decision_file, 'r', encoding='utf-8') as f:
                                    lines = f.readlines()
                                    if lines:
                                        data = json.loads(lines[-1])
                                        await manager.broadcast({
                                            "type": "activity_update",
                                            "signature": signature,
                                            "data": data
                                        })
        except Exception as e:
            print(f"Error watching files: {e}")

        await asyncio.sleep(1)  # Check every second


# ===== Static Files (Hugging Face Spaces 同源部署) =====
# 挂载 static 目录，使访问根目录时直接显示 index.html
# 注意：挂载必须在所有 API 路由之后，避免覆盖 API 端点
STATIC_DIR = Path(__file__).parent.parent.parent / "static"
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
    print(f"✅ 静态文件已挂载: {STATIC_DIR}")
else:
    print(f"⚠️ 静态目录不存在，跳过挂载: {STATIC_DIR}")


@app.on_event("startup")
async def startup_event():
    """Start background tasks on startup"""
    asyncio.create_task(watch_agent_files())
    # ── 双引擎路由器状态横幅 ──
    print("\n" + "=" * 60)
    print("[ROUTER STATUS] ⚡ Dual-Engine Router Active. Listening on port 8010.")
    print("[ROUTER STATUS]    🚀 Fast Mode (2-Layer) — 单轮直通 DeepSeek API, ~45 秒")
    print("[ROUTER STATUS]    🧠  Deep Mode (5-Layer) — 完整 LiveAgent 自主执行管道")
    print("=" * 60)
    # ── 路由诊断：在启动时打印所有已注册端点 ──
    print("\n" + "=" * 70)
    print("🔍 [ROUTE DIAGNOSTIC] 已注册的所有 API 端点:")
    print("=" * 70)
    for route in app.routes:
        if hasattr(route, "methods") and route.methods:
            for method in sorted(route.methods):
                if method in ("GET", "POST", "PUT", "DELETE", "PATCH"):
                    print(f"  {method:6s} {route.path}")
        elif hasattr(route, "path"):
            print(f"  WS      {route.path}")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    import uvicorn
    # 硬编码端口 8010，忽略环境变量中的其他值
    port = 8010
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
