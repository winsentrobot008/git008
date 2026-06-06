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
import uuid
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, BackgroundTasks
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import glob
import httpx


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
    """Load task_completions.jsonl indexed by task_id 鈫?entry dict."""
    completions_file = agent_dir / "economic" / "task_completions.jsonl"
    by_task_id = {}
    if not completions_file.exists():
        return by_task_id
    with open(completions_file, 'r') as f:
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
    with open(completions_file, 'r') as f:
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


# ============================================================
# 甯搁┗鐢熶骇 Agent 娉ㄥ唽琛?# ============================================================
# 鍦ㄥ唴瀛樹腑娉ㄥ唽甯搁┗ Agent锛屼笉渚濊禆鏂囦欢绯荤粺
REGISTERED_AGENTS = [
    {
        "signature": "ClawCoder_001",
        "role": "鍏ㄦ爤鑷姩鍖栬蒋浠跺伐绋嬪笀",
        "description": "涓撹亴鏍规嵁鐢ㄦ埛鍒涙剰锛屽叏鑷姩鏋勭瓚銆佺紪鍐欏苟鎵撳寘鐙珛鍏ㄦ爤搴旂敤鎴栧崟椤甸潰 APP銆?,
        "status": "online",
        "balance": 10000.0,
        "net_worth": 10000.0,
        "survival_status": "thriving",
        "current_activity": "idle",
        "current_date": datetime.now().strftime("%Y-%m-%d"),
        "total_token_cost": 0,
        "is_registered": True,
    }
]

# 灏嗚緭鍑虹洰褰曟寚鍚戝鍣ㄥ唴缁濆鍙鍐欑殑 /tmp/output 鐩綍
OUTPUT_DIR = Path("/tmp/output")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# ===== 鍋ュ悍妫€鏌ョ鐐?=====
@app.get("/api/health")
async def health_check():
    """Health check endpoint returning JSON (not HTML) for frontend connectivity checks"""
    return {"status": "ok", "service": "LiveBench API", "version": "1.0.0"}


@app.get("/api/agents")
async def get_agents():
    """Get list of all agents with their current status"""
    agents = []

    # 1. 鍏堟坊鍔犲父椹绘敞鍐?Agent
    for reg_agent in REGISTERED_AGENTS:
        agents.append({
            "signature": reg_agent["signature"],
            "balance": reg_agent["balance"],
            "net_worth": reg_agent["net_worth"],
            "survival_status": reg_agent["survival_status"],
            "current_activity": reg_agent["current_activity"],
            "current_date": reg_agent["current_date"],
            "total_token_cost": reg_agent["total_token_cost"],
        })

    # 2. 鍐嶄粠鏂囦欢绯荤粺璇诲彇鍘嗗彶 Agent
    if DATA_PATH.exists():
        for agent_dir in DATA_PATH.iterdir():
            if agent_dir.is_dir():
                signature = agent_dir.name

                # 璺宠繃宸插湪娉ㄥ唽琛ㄤ腑鐨?Agent
                if any(a["signature"] == signature for a in REGISTERED_AGENTS):
                    continue

                # Get latest balance
                balance_file = agent_dir / "economic" / "balance.jsonl"
                balance_data = None
                if balance_file.exists():
                    with open(balance_file, 'r') as f:
                        lines = f.readlines()
                        if lines:
                            balance_data = json.loads(lines[-1])

                # Get latest decision
                decision_file = agent_dir / "decisions" / "decisions.jsonl"
                current_activity = None
                current_date = None
                if decision_file.exists():
                    with open(decision_file, 'r') as f:
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
    # 妫€鏌ユ槸鍚︽槸娉ㄥ唽 Agent
    for reg_agent in REGISTERED_AGENTS:
        if reg_agent["signature"] == signature:
            return {
                "signature": signature,
                "current_status": {
                    "balance": reg_agent["balance"],
                    "net_worth": reg_agent["net_worth"],
                    "survival_status": reg_agent["survival_status"],
                    "total_token_cost": reg_agent["total_token_cost"],
                    "total_work_income": 0,
                    "current_activity": reg_agent["current_activity"],
                    "current_date": reg_agent["current_date"],
                    "avg_evaluation_score": None,
                    "num_evaluations": 0,
                    "role": reg_agent["role"],
                    "description": reg_agent["description"],
                    "status": reg_agent["status"],
                },
                "balance_history": [],
                "decisions": [],
                "evaluation_scores": [],
            }

    agent_dir = DATA_PATH / signature

    if not agent_dir.exists():
        raise HTTPException(status_code=404, detail="Agent not found")

    # Get balance history
    balance_file = agent_dir / "economic" / "balance.jsonl"
    balance_history = []
    if balance_file.exists():
        with open(balance_file, 'r') as f:
            for line in f:
                balance_history.append(json.loads(line))

    # Get decisions
    decision_file = agent_dir / "decisions" / "decisions.jsonl"
    decisions = []
    if decision_file.exists():
        with open(decision_file, 'r') as f:
            for line in f:
                decisions.append(json.loads(line))

    # Get evaluation statistics 鈥?use task_completions.jsonl for authoritative task count
    evaluations_file = agent_dir / "work" / "evaluations.jsonl"
    avg_evaluation_score = None
    evaluation_scores = []

    if evaluations_file.exists():
        with open(evaluations_file, 'r') as f:
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
        with open(tasks_file, 'r') as f:
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
        with open(evaluations_file, 'r') as f:
            for line in f:
                if not line.strip():
                    continue
                eval_data = json.loads(line)
                tid = eval_data.get("task_id")
                if tid:
                    evaluations[tid] = eval_data

    # Build task list from task_completions.jsonl (authoritative 鈥?one entry per task, no duplicates)
    tasks = []
    if completions_file.exists():
        with open(completions_file, 'r') as f:
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

    with open(balance_file, 'r') as f:
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
            with open(balance_file, 'r') as f:
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
            with open(evaluations_file, 'r') as f:
                for line in f:
                    if line.strip():
                        eval_data = json.loads(line)
                        score = eval_data.get("evaluation_score")
                        if score is not None:
                            evaluation_scores.append(score)

        avg_eval_score = (sum(evaluation_scores) / len(evaluation_scores)) if evaluation_scores else None

        # Load task completions (authoritative source) 鈥?used for wall-clock and task count
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
    """Get a random sample of agent-produced artifact files (including output/ production files)"""
    artifacts = []

    # 1. 鎵弿 Agent 娌欑涓殑浼犵粺浜х墿锛圥DF/DOCX/XLSX/PPTX锛?    if DATA_PATH.exists():
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
                        "source": "agent_sandbox",
                    })

    # 2. 鎵弿 output/ 鐩綍涓殑鐢熶骇浜х墿锛圚TML 搴旂敤锛?    if OUTPUT_DIR.exists():
        for file_path in OUTPUT_DIR.iterdir():
            if not file_path.is_file():
                continue
            ext = file_path.suffix.lower()
            if ext not in ('.html',):
                continue
            artifacts.append({
                "agent": "ClawCoder_001",
                "date": datetime.now().strftime("%Y-%m-%d"),
                "filename": file_path.name,
                "extension": ext,
                "size_bytes": file_path.stat().st_size,
                "path": f"output/{file_path.name}",
                "source": "production",
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
        with open(HIDDEN_AGENTS_PATH, 'r') as f:
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
# 浠诲姟璋冨害鍣ㄩ泦鎴?# =====================================================================
# 寤惰繜瀵煎叆浠ラ伩鍏嶅惊鐜緷璧?_scheduler_instance = None


def _get_scheduler():
    global _scheduler_instance
    if _scheduler_instance is None:
        from livebench.scheduler.task_scheduler import get_scheduler
        _scheduler_instance = get_scheduler(broadcast_callback=manager.broadcast)
    return _scheduler_instance


# 鈹€鈹€ Pydantic 璇锋眰/鍝嶅簲妯″瀷 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
class TaskSubmitRequest(BaseModel):
    """浠诲姟鎻愪氦璇锋眰"""
    prompt: str = Field(..., description="浠诲姟鎻忚堪锛屼緥濡傦細鎼炰釜3D鎶曟幏娓告垙")
    agent: Optional[str] = Field(None, description="鎸囧畾 Agent 绛惧悕锛堝彲閫夛級")
    occupation: Optional[str] = Field("Software Engineer", description="鑱屼笟鍒嗙被")
    sector: Optional[str] = Field("Technology", description="琛屼笟鍒嗙被")
    max_payment: Optional[float] = Field(50.0, description="鏈€澶ф敮浠橀噾棰濓紙缇庡厓锛?)


class TaskSubmitResponse(BaseModel):
    """浠诲姟鎻愪氦鍝嶅簲"""
    task_id: str
    agent: str
    status: str
    message: str


class TaskStatusResponse(BaseModel):
    """浠诲姟鐘舵€佸搷搴?""
    task_id: str
    status: str
    agent: Optional[str] = None
    prompt: Optional[str] = None
    occupation: Optional[str] = None
    sector: Optional[str] = None
    created_at: Optional[str] = None
    result: Optional[dict] = None
    error: Optional[str] = None


# 鈹€鈹€ DeepSeek API 璋冪敤鍑芥暟 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", os.getenv("OPENAI_API_KEY", ""))
DEEPSEEK_API_BASE = os.getenv("DEEPSEEK_API_BASE", "https://api.deepseek.com/v1")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_API_MODEL", "deepseek-chat")


async def call_deepseek(system_prompt: str, user_prompt: str, timeout: float = 120.0) -> str:
    """璋冪敤 DeepSeek API 骞惰繑鍥炵敓鎴愮殑鏂囨湰鍐呭"""
    if not DEEPSEEK_API_KEY:
        raise HTTPException(status_code=500, detail="鏈厤缃?DeepSeek API Key锛岃鍦?.env 涓缃?DEEPSEEK_API_KEY")

    headers = {
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": 0.7,
        "max_tokens": 8192,
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{DEEPSEEK_API_BASE}/chat/completions",
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


# 鍐呭瓨涓殑浠诲姟瀛樺偍锛堢敤浜庣敓浜т换鍔★級
_production_tasks: Dict[str, dict] = {}


# 鈹€鈹€ POST /api/tasks 鈥?鎻愪氦鐢熶骇浠诲姟 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
@app.post("/api/tasks", response_model=TaskSubmitResponse)
async def submit_task(request: TaskSubmitRequest, background_tasks: BackgroundTasks):
    """
    鎻愪氦涓€涓敓浜т换鍔°€?
    鏀跺埌璇锋眰鍚庣珛鍗宠繑鍥?{"status": "queued", "task_id": "..."}锛?    灏嗙湡姝ｇ殑 DeepSeek 璋冪敤鍜屾枃浠跺啓鍏ラ€氳繃 BackgroundTasks 鍦ㄥ悗鍙伴潤榛樻墽琛岋紝
    閬垮厤 HTTP 杩炴帴鍥犲ぇ妯″瀷鐢熸垚鏃堕棿杩囬暱鑰岃秴鏃舵柇寮€銆?
    鍓嶇鍙€氳繃 GET /api/tasks/{task_id} 姣?2 绉掕疆璇换鍔＄姸鎬併€?    """
    task_id = f"prod_{uuid.uuid4().hex[:12]}"
    agent_sig = request.agent or "ClawCoder_001"

    # 鏇存柊 Agent 鐘舵€佷负 working
    for reg_agent in REGISTERED_AGENTS:
        if reg_agent["signature"] == agent_sig:
            reg_agent["current_activity"] = "working"
            reg_agent["current_date"] = datetime.now().strftime("%Y-%m-%d")

    # 瀛樺偍浠诲姟锛堝垵濮嬬姸鎬?queued锛?    _production_tasks[task_id] = {
        "task_id": task_id,
        "prompt": request.prompt,
        "agent": agent_sig,
        "occupation": request.occupation or "Software Engineer",
        "sector": request.sector or "Technology",
        "status": "queued",
        "created_at": datetime.now().isoformat(),
    }

    # 骞挎挱浠诲姟宸叉帓闃?    await manager.broadcast({
        "type": "task_queued",
        "task_id": task_id,
        "agent": agent_sig,
        "prompt": request.prompt[:100],
    })

    # 鈹€鈹€ 灏嗘牳蹇冪敓浜т换鍔″交搴曟敼涓哄悗鍙板紓姝ヤ换鍔?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
    # 浣跨敤 FastAPI 鐨?BackgroundTasks 鏇夸唬 asyncio.create_task锛?    # 纭繚璇锋眰澶勭悊瀹屾瘯鍚庡悗鍙颁换鍔′笉浼氳鍙栨秷銆?    if "姣忔棩閿﹀泭" in request.prompt:
        background_tasks.add_task(_execute_daily_wisdom_task, task_id, agent_sig)
        return TaskSubmitResponse(
            task_id=task_id,
            agent=agent_sig,
            status="queued",
            message="鉁?姣忔棩閿﹀泭浠诲姟宸叉彁浜わ紒ClawCoder_001 姝ｅ湪璋冪敤 DeepSeek 鐢熸垚鍖呭惈銆愭悶閽便€戙€愭妧鏈€戙€愮敓娲汇€戠淮搴︾殑 HTML 搴旂敤...",
        )

    background_tasks.add_task(_execute_production_task, task_id, agent_sig, request.prompt)
    return TaskSubmitResponse(
        task_id=task_id,
        agent=agent_sig,
        status="queued",
        message=f"鉁?浠诲姟宸叉彁浜わ紒Agent '{agent_sig}' 姝ｅ湪璋冪敤 DeepSeek 鐢熸垚浠ｇ爜...",
    )


# 鈹€鈹€ POST /api/tasks/demo 鈥?涓€閿紨绀猴細鐢熸垚姣忔棩閿﹀泭 APP 鈹€鈹€鈹€鈹€鈹€鈹€
@app.post("/api/tasks/demo", response_model=TaskSubmitResponse)
async def submit_demo_task(background_tasks: BackgroundTasks):
    """
    涓€閿紨绀虹鐐广€?
    鐢?DeepSeek 鐢熸垚涓€涓?姣忔棩閿﹀泭"鐙珛 HTML APP锛?    鍐欏叆 output/daily_wisdom_app.html锛屽苟杩斿洖涓嬭浇閾炬帴銆?
    閫氳繃 BackgroundTasks 鍚庡彴鎵ц锛岄伩鍏?HTTP 杩炴帴瓒呮椂銆?    """
    task_id = f"demo_{uuid.uuid4().hex[:8]}"
    agent_sig = "ClawCoder_001"
    prompt = "甯垜鍐欎釜姣忔棩閿﹀泭APP"

    # 鏇存柊 Agent 鐘舵€?    for reg_agent in REGISTERED_AGENTS:
        if reg_agent["signature"] == agent_sig:
            reg_agent["current_activity"] = "working"
            reg_agent["current_date"] = datetime.now().strftime("%Y-%m-%d")

    # 瀛樺偍浠诲姟
    _production_tasks[task_id] = {
        "task_id": task_id,
        "prompt": prompt,
        "agent": agent_sig,
        "occupation": "Software Engineer",
        "sector": "Technology",
        "status": "queued",
        "created_at": datetime.now().isoformat(),
    }

    # 骞挎挱
    await manager.broadcast({
        "type": "task_queued",
        "task_id": task_id,
        "agent": agent_sig,
        "prompt": prompt,
    })

    # 閫氳繃 BackgroundTasks 鍚庡彴鎵ц锛屾浛浠?asyncio.create_task
    background_tasks.add_task(_execute_demo_task, task_id, agent_sig)

    return TaskSubmitResponse(
        task_id=task_id,
        agent=agent_sig,
        status="queued",
        message="鉁?姣忔棩閿﹀泭 APP 鐢熸垚浠诲姟宸叉彁浜わ紒ClawCoder_001 姝ｅ湪璋冪敤 DeepSeek 鍒涗綔涓?..",
    )


async def _execute_demo_task(task_id: str, agent_sig: str):
    """鍚庡彴鎵ц婕旂ず浠诲姟锛氱敓鎴愭瘡鏃ラ敠鍥?APP 骞跺啓鍏?output/daily_wisdom_app.html"""
    try:
        _production_tasks[task_id]["status"] = "running"

        await manager.broadcast({
            "type": "task_started",
            "task_id": task_id,
            "agent": agent_sig,
            "message": "馃 ClawCoder_001 寮€濮嬫瀯鎬濇瘡鏃ラ敠鍥?APP...",
        })

        # 鈹€鈹€ 1. 鍥哄畾绯荤粺鎻愮ず璇嶏紙姣忔棩閿﹀泭涓撶敤锛?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        system_prompt = (
            "浣犳槸涓€浣嶉《绾у叏鏍堝伐绋嬪笀銆備綘鐨勪换鍔℃槸鐢熸垚涓€涓畬鏁淬€佺嫭绔嬨€佸彲浠ョ洿鎺ヨ繍琛岀殑 HTML 搴旂敤銆俓n\n"
            "銆愰」鐩悕绉般€戞瘡鏃ラ敠鍥奬n"
            "銆愯璁￠鏍笺€戞瀬绠€鑻规灉椋庯紙iOS 椋庢牸锛夛紝寰笎鍙樿儗鏅紝姣涚幓鐠冨崱鐗囷紝SF 椋庢牸瀛椾綋\n"
            "銆愭牳蹇冨姛鑳姐€慭n"
            "1. 椤甸潰灞曠ず涓€鍙ラ殢鏈洪噾鍙ワ紙鎼為挶/鐮村眬/蹇冩€佷笁绫伙級\n"
            "2. 鐢ㄦ埛鐐瑰嚮銆屾憞涓€鎽囥€嶆寜閽垨鎽囨檭鎵嬫満鏃讹紝闅忔満鍒囨崲閲戝彞\n"
            "3. 閲戝彞鍒嗙被鏍囩锛堭煉版悶閽?/ 馃殌鐮村眬 / 馃蹇冩€侊級\n"
            "4. 搴曢儴鏄剧ず銆屼粖鏃ュ凡鎽?X 娆°€嶈鏁板櫒\n"
            "5. 鐐瑰嚮閲戝彞鍙鍒跺埌鍓创鏉縗n\n"
            "銆愭妧鏈姹傘€慭n"
            "1. 鎵€鏈?HTML銆丆SS 鍜?JavaScript 铻嶅悎鍦ㄤ竴涓枃浠朵腑\n"
            "2. 浣跨敤寰笎鍙樻殫榛戣嫻鏋滈 UI 璁捐\n"
            "3. 鍖呭惈瀹屾暣鐨勪氦浜掗€昏緫\n"
            "4. 浠ｇ爜蹇呴』瀹屾暣銆佸彲鐩存帴鍦ㄦ祻瑙堝櫒涓墦寮€杩愯\n"
            "5. 涓嶈浣跨敤澶栭儴 CDN 渚濊禆\n"
            "6. 杈撳嚭绾?HTML 浠ｇ爜锛屼笉瑕佺敤 markdown 浠ｇ爜鍧楀寘瑁筡n"
            "7. 鍐呯疆鑷冲皯 30 鏉￠噾鍙ワ紙姣忕被 10 鏉★級\n\n"
            "鐢ㄦ埛闇€姹傦細甯垜鍐欎釜姣忔棩閿﹀泭APP锛氱紪鍐欎竴涓畬鏁淬€佺嫭绔嬨€佹瀬绠€鑻规灉椋庛€佹敮鎸佷竴閿憞鍙栨悶閽?鐮村眬/蹇冩€侀噾鍙ョ殑姣忔棩閿﹀泭 APP HTML 鏂囦欢"
        )

        await manager.broadcast({
            "type": "agent_thinking",
            "task_id": task_id,
            "agent": agent_sig,
            "message": "馃 Agent 姝ｅ湪璋冪敤 DeepSeek API 鐢熸垚姣忔棩閿﹀泭 APP...",
        })

        # 鈹€鈹€ 2. 璋冪敤 DeepSeek API 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        generated_code = await call_deepseek(system_prompt, "鐢熸垚姣忔棩閿﹀泭 APP")

        # 娓呯悊浠ｇ爜锛堝幓闄ゅ彲鑳界殑 markdown 浠ｇ爜鍧楀寘瑁癸級
        generated_code = generated_code.strip()
        if generated_code.startswith("```html"):
            generated_code = generated_code[7:]
        elif generated_code.startswith("```"):
            first_backtick = generated_code.find("```")
            if first_backtick != -1:
                end_first_line = generated_code.find("\n", first_backtick)
                if end_first_line != -1:
                    generated_code = generated_code[end_first_line + 1:]
        if generated_code.endswith("```"):
            generated_code = generated_code[:-3]

        generated_code = generated_code.strip()

        await manager.broadcast({
            "type": "code_generated",
            "task_id": task_id,
            "agent": agent_sig,
            "message": "鉁?DeepSeek 浠ｇ爜鐢熸垚瀹屾垚锛屾鍦ㄥ啓鍏?output/daily_wisdom_app.html...",
            "code_length": len(generated_code),
        })

        # 鈹€鈹€ 3. 鍥哄畾鍐欏叆 output/daily_wisdom_app.html 鈹€鈹€鈹€鈹€鈹€鈹€
        output_filename = "daily_wisdom_app.html"
        output_path = OUTPUT_DIR / output_filename

        output_path.write_text(generated_code, encoding="utf-8")

        await manager.broadcast({
            "type": "artifact_created",
            "task_id": task_id,
            "agent": agent_sig,
            "file_path": str(output_path),
            "filename": output_filename,
            "message": f"馃搫 姣忔棩閿﹀泭 APP 宸茬敓鎴? {output_filename}",
        })

        # 鈹€鈹€ 4. 鏇存柊浠诲姟鐘舵€?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        _production_tasks[task_id]["status"] = "completed"
        _production_tasks[task_id]["result"] = {
            "file_path": str(output_path),
            "filename": output_filename,
            "code_length": len(generated_code),
            "download_url": f"/artifacts/{output_filename}",
        }

        # 鏇存柊 Agent 鐘舵€佸洖 idle
        for reg_agent in REGISTERED_AGENTS:
            if reg_agent["signature"] == agent_sig:
                reg_agent["current_activity"] = "idle"

        await manager.broadcast({
            "type": "task_completed",
            "task_id": task_id,
            "agent": agent_sig,
            "status": "completed",
            "filename": output_filename,
            "download_url": f"/artifacts/{output_filename}",
            "message": f"馃帀 姣忔棩閿﹀泭 APP 宸插氨缁紒璁块棶 /artifacts/{output_filename} 鏌ョ湅",
        })

    except Exception as e:
        _production_tasks[task_id]["status"] = "error"
        _production_tasks[task_id]["error"] = str(e)

        for reg_agent in REGISTERED_AGENTS:
            if reg_agent["signature"] == agent_sig:
                reg_agent["current_activity"] = "idle"

        await manager.broadcast({
            "type": "task_error",
            "task_id": task_id,
            "agent": agent_sig,
            "error": str(e)[:500],
            "message": f"鉂?姣忔棩閿﹀泭 APP 鐢熸垚澶辫触: {str(e)[:200]}",
        })
        import traceback
        traceback.print_exc()


async def _execute_daily_wisdom_task(task_id: str, agent_sig: str):
    """鍚庡彴鎵ц姣忔棩閿﹀泭浠诲姟锛氳皟鐢?DeepSeek API 鐢熸垚鍖呭惈銆愭悶閽便€戙€愭妧鏈€戙€愮敓娲汇€戠淮搴︾殑 HTML 搴旂敤"""
    try:
        _production_tasks[task_id]["status"] = "running"

        await manager.broadcast({
            "type": "task_started",
            "task_id": task_id,
            "agent": agent_sig,
            "message": "馃 ClawCoder_001 寮€濮嬫瀯鎬濇瘡鏃ラ敠鍥婏紙鎼為挶/鎶€鏈?鐢熸椿锛?..",
        })

        # 鈹€鈹€ 1. 绯荤粺鎻愮ず璇嶏紙姣忔棩閿﹀泭涓撶敤锛屼笁缁村害锛?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        system_prompt = (
            "浣犳槸涓€浣嶉《绾у叏鏍堝伐绋嬪笀銆備綘鐨勪换鍔℃槸鐢熸垚涓€涓畬鏁淬€佺嫭绔嬨€佸彲浠ョ洿鎺ヨ繍琛岀殑 HTML 搴旂敤銆俓n\n"
            "銆愰」鐩悕绉般€戞瘡鏃ラ敠鍥奬n"
            "銆愯璁￠鏍笺€戞瀬绠€鑻规灉椋庯紙iOS 椋庢牸锛夛紝寰笎鍙樿儗鏅紝姣涚幓鐠冨崱鐗囷紝SF 椋庢牸瀛椾綋\n"
            "銆愭牳蹇冨姛鑳姐€慭n"
            "1. 椤甸潰灞曠ず涓€鍙ラ殢鏈洪敠鍥婏紝娑电洊涓変釜缁村害锛氿煉般€愭悶閽便€戙€侌煉汇€愭妧鏈€戙€侌煂裤€愮敓娲汇€慭n"
            "2. 鐢ㄦ埛鐐瑰嚮銆屾憞涓€鎽囥€嶆寜閽垨鎽囨檭鎵嬫満鏃讹紝闅忔満鍒囨崲閿﹀泭\n"
            "3. 閿﹀泭鍒嗙被鏍囩锛堭煉版悶閽?/ 馃捇鎶€鏈?/ 馃尶鐢熸椿锛夛紝鐐瑰嚮鏍囩鍙瓫閫夊彧鐪嬭绫诲埆\n"
            "4. 搴曢儴鏄剧ず銆屼粖鏃ュ凡鎽?X 娆°€嶈鏁板櫒\n"
            "5. 鐐瑰嚮閿﹀泭鍐呭鍙鍒跺埌鍓创鏉縗n"
            "6. 椤甸潰椤堕儴鏄剧ず褰撳墠鏃ユ湡\n\n"
            "銆愰敠鍥婂唴瀹硅姹傘€慭n"
            "- 馃挵銆愭悶閽便€戯細鍓笟鎬濊矾銆佺悊璐㈡妧宸с€佺渷閽卞鎷涖€佽禋閽辫鐭ワ紙鑷冲皯 15 鏉★級\n"
            "- 馃捇銆愭妧鏈€戯細缂栫▼鎶€宸с€佹晥鐜囧伐鍏枫€佹妧鏈秼鍔裤€佸涔犺矾绾匡紙鑷冲皯 15 鏉★級\n"
            "- 馃尶銆愮敓娲汇€戯細鍋ュ悍涔犳儻銆佷汉闄呭叧绯汇€佹儏缁鐞嗐€佺敓娲荤編瀛︼紙鑷冲皯 15 鏉★級\n"
            "- 姣忔潯閿﹀泭蹇呴』绠€鐭湁鍔涳紙10-30 瀛楋級锛屾湁瀹為檯浠峰€硷紝璇诲悗鏈夊惎鍙慭n\n"
            "銆愭妧鏈姹傘€慭n"
            "1. 鎵€鏈?HTML銆丆SS 鍜?JavaScript 铻嶅悎鍦ㄤ竴涓枃浠朵腑\n"
            "2. 浣跨敤寰笎鍙樻殫榛戣嫻鏋滈 UI 璁捐\n"
            "3. 鍖呭惈瀹屾暣鐨勪氦浜掗€昏緫\n"
            "4. 浠ｇ爜蹇呴』瀹屾暣銆佸彲鐩存帴鍦ㄦ祻瑙堝櫒涓墦寮€杩愯\n"
            "5. 涓嶈浣跨敤澶栭儴 CDN 渚濊禆\n"
            "6. 杈撳嚭绾?HTML 浠ｇ爜锛屼笉瑕佺敤 markdown 浠ｇ爜鍧楀寘瑁筡n"
            "7. 鍐呯疆鑷冲皯 45 鏉￠敠鍥婏紙姣忕被 15 鏉★級\n\n"
            "鐢ㄦ埛闇€姹傦細鐢熸垚涓€涓寘鍚€愭悶閽便€戙€愭妧鏈€戙€愮敓娲汇€戜笁涓淮搴︾殑姣忔棩閿﹀泭 HTML 搴旂敤"
        )

        await manager.broadcast({
            "type": "agent_thinking",
            "task_id": task_id,
            "agent": agent_sig,
            "message": "馃 Agent 姝ｅ湪璋冪敤 DeepSeek API 鐢熸垚姣忔棩閿﹀泭锛堟悶閽?鎶€鏈?鐢熸椿锛?..",
        })

        # 鈹€鈹€ 2. 璋冪敤 DeepSeek API 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        generated_code = await call_deepseek(system_prompt, "鐢熸垚鍖呭惈銆愭悶閽便€戙€愭妧鏈€戙€愮敓娲汇€戜笁涓淮搴︾殑姣忔棩閿﹀泭 APP")

        # 娓呯悊浠ｇ爜锛堝幓闄ゅ彲鑳界殑 markdown 浠ｇ爜鍧楀寘瑁癸級
        generated_code = generated_code.strip()
        if generated_code.startswith("```html"):
            generated_code = generated_code[7:]
        elif generated_code.startswith("```"):
            first_backtick = generated_code.find("```")
            if first_backtick != -1:
                end_first_line = generated_code.find("\n", first_backtick)
                if end_first_line != -1:
                    generated_code = generated_code[end_first_line + 1:]
        if generated_code.endswith("```"):
            generated_code = generated_code[:-3]

        generated_code = generated_code.strip()

        await manager.broadcast({
            "type": "code_generated",
            "task_id": task_id,
            "agent": agent_sig,
            "message": "鉁?DeepSeek 浠ｇ爜鐢熸垚瀹屾垚锛屾鍦ㄥ啓鍏?output/daily_wisdom_app.html...",
            "code_length": len(generated_code),
        })

        # 鈹€鈹€ 3. 鍥哄畾鍐欏叆 output/daily_wisdom_app.html 鈹€鈹€鈹€鈹€鈹€鈹€
        output_filename = "daily_wisdom_app.html"
        output_path = OUTPUT_DIR / output_filename

        output_path.write_text(generated_code, encoding="utf-8")

        await manager.broadcast({
            "type": "artifact_created",
            "task_id": task_id,
            "agent": agent_sig,
            "file_path": str(output_path),
            "filename": output_filename,
            "message": f"馃搫 姣忔棩閿﹀泭 APP 宸茬敓鎴? {output_filename}",
        })

        # 鈹€鈹€ 4. 鏇存柊浠诲姟鐘舵€?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        _production_tasks[task_id]["status"] = "completed"
        _production_tasks[task_id]["result"] = {
            "file_path": str(output_path),
            "filename": output_filename,
            "code_length": len(generated_code),
            "download_url": f"/artifacts/{output_filename}",
        }

        # 鏇存柊 Agent 鐘舵€佸洖 idle
        for reg_agent in REGISTERED_AGENTS:
            if reg_agent["signature"] == agent_sig:
                reg_agent["current_activity"] = "idle"

        await manager.broadcast({
            "type": "task_completed",
            "task_id": task_id,
            "agent": agent_sig,
            "status": "completed",
            "filename": output_filename,
            "download_url": f"/artifacts/{output_filename}",
            "message": f"馃帀 姣忔棩閿﹀泭 APP锛堟悶閽?鎶€鏈?鐢熸椿锛夊凡灏辩华锛佽闂?/artifacts/{output_filename} 鏌ョ湅",
        })

    except Exception as e:
        _production_tasks[task_id]["status"] = "error"
        _production_tasks[task_id]["error"] = str(e)

        for reg_agent in REGISTERED_AGENTS:
            if reg_agent["signature"] == agent_sig:
                reg_agent["current_activity"] = "idle"

        await manager.broadcast({
            "type": "task_error",
            "task_id": task_id,
            "agent": agent_sig,
            "error": str(e)[:500],
            "message": f"鉂?姣忔棩閿﹀泭 APP 鐢熸垚澶辫触: {str(e)[:200]}",
        })
        import traceback
        traceback.print_exc()


async def _execute_production_task(task_id: str, agent_sig: str, prompt: str):
    """鍚庡彴鎵ц鐢熶骇浠诲姟锛氳皟鐢?DeepSeek 鐢熸垚浠ｇ爜骞跺啓鍏ユ枃浠?""
    try:
        _production_tasks[task_id]["status"] = "running"

        await manager.broadcast({
            "type": "task_started",
            "task_id": task_id,
            "agent": agent_sig,
            "message": f"馃 {agent_sig} 寮€濮嬪垎鏋愪换鍔?..",
        })

        # 鈹€鈹€ 1. 鏋勫缓绯荤粺鎻愮ず璇?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        system_prompt = (
            "浣犳槸涓€浣嶉《绾у叏鏍堝伐绋嬪笀銆備綘鐨勪换鍔℃槸鐢熸垚涓€涓畬鏁淬€佺嫭绔嬨€佸彲浠ョ洿鎺ヨ繍琛岀殑 HTML 搴旂敤銆俓n\n"
            "瑕佹眰锛歕n"
            "1. 灏嗘墍鏈?HTML銆丆SS 鍜?JavaScript 铻嶅悎鍦ㄤ竴涓枃浠朵腑\n"
            "2. 浣跨敤寰笎鍙樻殫榛戣嫻鏋滈 UI 璁捐\n"
            "3. 鍖呭惈瀹屾暣鐨勪氦浜掗€昏緫\n"
            "4. 浠ｇ爜蹇呴』瀹屾暣銆佸彲鐩存帴鍦ㄦ祻瑙堝櫒涓墦寮€杩愯\n"
            "5. 涓嶈浣跨敤澶栭儴 CDN 渚濊禆锛堥櫎闈炵粷瀵瑰繀瑕侊級\n"
            "6. 杈撳嚭绾?HTML 浠ｇ爜锛屼笉瑕佺敤 markdown 浠ｇ爜鍧楀寘瑁筡n\n"
            f"鐢ㄦ埛闇€姹傦細{prompt}"
        )

        await manager.broadcast({
            "type": "agent_thinking",
            "task_id": task_id,
            "agent": agent_sig,
            "message": "馃 Agent 姝ｅ湪璋冪敤 DeepSeek API 鐢熸垚浠ｇ爜...",
        })

        # 鈹€鈹€ 2. 璋冪敤 DeepSeek API 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        generated_code = await call_deepseek(system_prompt, prompt)

        # 娓呯悊浠ｇ爜锛堝幓闄ゅ彲鑳界殑 markdown 浠ｇ爜鍧楀寘瑁癸級
        generated_code = generated_code.strip()
        if generated_code.startswith("```html"):
            generated_code = generated_code[7:]
        elif generated_code.startswith("```"):
            # 鎵惧埌绗竴涓?``` 骞跺幓鎺?            first_backtick = generated_code.find("```")
            if first_backtick != -1:
                end_first_line = generated_code.find("\n", first_backtick)
                if end_first_line != -1:
                    generated_code = generated_code[end_first_line + 1:]
        if generated_code.endswith("```"):
            generated_code = generated_code[:-3]

        generated_code = generated_code.strip()

        await manager.broadcast({
            "type": "code_generated",
            "task_id": task_id,
            "agent": agent_sig,
            "message": "鉁?DeepSeek 浠ｇ爜鐢熸垚瀹屾垚锛屾鍦ㄥ啓鍏ユ枃浠?..",
            "code_length": len(generated_code),
        })

        # 鈹€鈹€ 3. 鍐欏叆 output 鐩綍 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        # 鏍规嵁浠诲姟鎻忚堪鐢熸垚鏂囦欢鍚?        safe_name = "".join(c if c.isalnum() or c in (' ', '_', '-') else '_' for c in prompt[:30])
        safe_name = safe_name.strip().replace(' ', '_').lower()
        if not safe_name:
            safe_name = "generated_app"
        output_filename = f"{safe_name}.html"
        output_path = OUTPUT_DIR / output_filename

        output_path.write_text(generated_code, encoding="utf-8")

        await manager.broadcast({
            "type": "artifact_created",
            "task_id": task_id,
            "agent": agent_sig,
            "file_path": str(output_path),
            "filename": output_filename,
            "message": f"馃搫 鏂囦欢宸茬敓鎴? {output_filename}",
        })

        # 鈹€鈹€ 4. 鏇存柊浠诲姟鐘舵€?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        _production_tasks[task_id]["status"] = "completed"
        _production_tasks[task_id]["result"] = {
            "file_path": str(output_path),
            "filename": output_filename,
            "code_length": len(generated_code),
            "download_url": f"/artifacts/{output_filename}",
        }

        # 鏇存柊 Agent 鐘舵€佸洖 idle
        for reg_agent in REGISTERED_AGENTS:
            if reg_agent["signature"] == agent_sig:
                reg_agent["current_activity"] = "idle"

        await manager.broadcast({
            "type": "task_completed",
            "task_id": task_id,
            "agent": agent_sig,
            "status": "completed",
            "filename": output_filename,
            "download_url": f"/artifacts/{output_filename}",
            "message": f"馃帀 浠诲姟瀹屾垚锛亄output_filename} 宸茬敓鎴愬湪 output 鐩綍",
        })

    except Exception as e:
        _production_tasks[task_id]["status"] = "error"
        _production_tasks[task_id]["error"] = str(e)

        # 鎭㈠ Agent 鐘舵€?        for reg_agent in REGISTERED_AGENTS:
            if reg_agent["signature"] == agent_sig:
                reg_agent["current_activity"] = "idle"

        await manager.broadcast({
            "type": "task_error",
            "task_id": task_id,
            "agent": agent_sig,
            "error": str(e)[:500],
            "message": f"鉂?浠诲姟澶辫触: {str(e)[:200]}",
        })
        import traceback
        traceback.print_exc()



# 鈹€鈹€ GET /api/tasks/{task_id} 鈥?鏌ヨ浠诲姟鐘舵€?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
@app.get("/api/tasks/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(task_id: str):
    """鏌ヨ鎸囧畾浠诲姟鐨勭姸鎬佸拰缁撴灉锛堝悓鏃舵敮鎸佺敓浜т换鍔″拰璋冨害鍣ㄤ换鍔★級"""
    # 鍏堟煡鐢熶骇浠诲姟
    if task_id in _production_tasks:
        pt = _production_tasks[task_id]
        return TaskStatusResponse(
            task_id=task_id,
            status=pt.get("status", "unknown"),
            agent=pt.get("agent"),
            prompt=pt.get("prompt"),
            occupation=pt.get("occupation"),
            sector=pt.get("sector"),
            created_at=pt.get("created_at"),
            result=pt.get("result"),
            error=pt.get("error"),
        )

    # 鍐嶆煡璋冨害鍣ㄤ换鍔?    scheduler = _get_scheduler()
    task = scheduler.get_task_status(task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    return TaskStatusResponse(**task)


# 鈹€鈹€ GET /api/tasks 鈥?鑾峰彇鎵€鏈変换鍔″垪琛?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
@app.get("/api/tasks")
async def get_all_tasks():
    """鑾峰彇鎵€鏈夊凡鎻愪氦鐨勪换鍔″垪琛紙鍚屾椂鍖呭惈鐢熶骇浠诲姟鍜岃皟搴﹀櫒浠诲姟锛?""
    # 鐢熶骇浠诲姟
    prod_tasks = []
    for tid, pt in _production_tasks.items():
        prod_tasks.append({
            "task_id": tid,
            "prompt": pt.get("prompt"),
            "agent": pt.get("agent"),
            "occupation": pt.get("occupation"),
            "sector": pt.get("sector"),
            "status": pt.get("status"),
            "created_at": pt.get("created_at"),
            "result": pt.get("result"),
            "error": pt.get("error"),
        })

    # 璋冨害鍣ㄤ换鍔?    scheduler = _get_scheduler()
    sched_tasks = scheduler.get_all_tasks()

    all_tasks = prod_tasks + sched_tasks
    return {"tasks": all_tasks, "total": len(all_tasks)}



# 鈹€鈹€ GET /api/scheduler/agents 鈥?璋冨害鍣?Agent 鐘舵€?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
@app.get("/api/scheduler/agents")
async def get_scheduler_agents():
    """鑾峰彇璋冨害鍣ㄤ腑鎵€鏈?Agent 鐨勮繍琛岀姸鎬?""
    scheduler = _get_scheduler()
    agents = scheduler.get_all_agents()
    return {"agents": agents}


# =====================================================================
# WebSocket 瀹炴椂娴侊紙澧炲己鐗堬級
# =====================================================================
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket 绔偣 鈥?瀹炴椂娴併€?
    鍓嶇杩炴帴鍚庡彲浠ュ疄鏃舵帴鏀讹細
    - agent_thinking: Agent 鎬濊€冩棩蹇?    - code_generated: 浠ｇ爜鐢熸垚杩涘害
    - artifact_created: 鏂囦欢/浣滃搧鍒涘缓
    - work_submitted: 宸ヤ綔鎻愪氦
    - task_completed: 浠诲姟瀹屾垚
    - task_error: 浠诲姟閿欒
    - balance_update: 浣欓鏇存柊
    - activity_update: 娲诲姩鏇存柊
    """
    await manager.connect(websocket)
    try:
        # 鍙戦€佽繛鎺ユ垚鍔熸秷鎭?        await websocket.send_json({
            "type": "connected",
            "message": "鉁?宸茶繛鎺ュ埌 LiveBench 瀹炴椂娴?,
            "timestamp": datetime.now().isoformat(),
        })

        # 鎸佺画鐩戝惉瀹㈡埛绔秷鎭紙蹇冭烦淇濇寔锛?        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)

                # 瑙ｆ瀽瀹㈡埛绔秷鎭?                try:
                    msg = json.loads(data)
                except json.JSONDecodeError:
                    msg = {"type": "text", "data": data}

                msg_type = msg.get("type", "text")

                if msg_type == "ping":
                    # 蹇冭烦鍝嶅簲
                    await websocket.send_json({
                        "type": "pong",
                        "timestamp": datetime.now().isoformat(),
                    })
                elif msg_type == "subscribe":
                    # 璁㈤槄鐗瑰畾 Agent 鐨勪簨浠?                    agent = msg.get("agent")
                    await websocket.send_json({
                        "type": "subscribed",
                        "agent": agent,
                        "message": f"宸茶闃?Agent '{agent}' 鐨勪簨浠?,
                    })
                else:
                    # 鍥炴樉
                    await websocket.send_json({
                        "type": "echo",
                        "data": data,
                        "timestamp": datetime.now().isoformat(),
                    })

            except asyncio.TimeoutError:
                # 鍙戦€佸績璺充繚娲?                try:
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
    骞挎挱娑堟伅鍒版墍鏈?WebSocket 瀹㈡埛绔€?    渚涜皟搴﹀櫒 / Agent 鍦ㄦ墽琛岃繃绋嬩腑璋冪敤銆?    """
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
                                with open(balance_file, 'r') as f:
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
                                with open(decision_file, 'r') as f:
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


# ===== 浜у搧浜や粯绔偣锛氭寕杞?output 鐩綍涓?/artifacts =====
# 璁╁墠绔彲浠ョ洿鎺ラ€氳繃 /artifacts/filename.html 璁块棶鐢熸垚鐨?APP
if OUTPUT_DIR.exists():
    app.mount("/artifacts", StaticFiles(directory=str(OUTPUT_DIR)), name="artifacts")
    print(f"鉁?浜у搧浜や粯绔偣宸叉寕杞? /artifacts -> {OUTPUT_DIR}")
else:
    print(f"鈿狅笍 output 鐩綍涓嶅瓨鍦紝璺宠繃鎸傝浇: {OUTPUT_DIR}")


# ===== Static Files (Hugging Face Spaces 鍚屾簮閮ㄧ讲) =====
# 鎸傝浇 static 鐩綍锛屼娇璁块棶鏍圭洰褰曟椂鐩存帴鏄剧ず index.html
# 娉ㄦ剰锛氭寕杞藉繀椤诲湪鎵€鏈?API 璺敱涔嬪悗锛岄伩鍏嶈鐩?API 绔偣
STATIC_DIR = Path(__file__).parent.parent.parent / "static"
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
    print(f"鉁?闈欐€佹枃浠跺凡鎸傝浇: {STATIC_DIR}")
else:
    print(f"鈿狅笍 闈欐€佺洰褰曚笉瀛樺湪锛岃烦杩囨寕杞? {STATIC_DIR}")



# =====================================================================
# 涓€閿儴缃茬鐐?# =====================================================================

class DeployResponse(BaseModel):
    """閮ㄧ讲鍝嶅簲妯″瀷"""
    success: bool
    message: str
    steps: Optional[List[dict]] = None
    error: Optional[str] = None
    timestamp: Optional[str] = None


@app.post("/api/deploy", response_model=DeployResponse)
async def trigger_deploy():
    """
    涓€閿儴缃插埌 Hugging Face Spaces銆?
    鎵ц娴佺▼锛?    1. git add .
    2. git commit -m "auto-deploy: <timestamp>"
    3. git push -f hf main
    """
    import subprocess
    import sys
    from datetime import datetime

    deploy_timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    steps = []
    project_root = Path(__file__).parent.parent.parent

    try:
        # 鈹€鈹€ Step 1: git add . 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        await manager.broadcast({
            "type": "deploy_progress",
            "step": 1,
            "message": "馃摝 鎵ц git add . ...",
        })

        add_result = subprocess.run(
            ["git", "add", "."],
            cwd=str(project_root),
            capture_output=True,
            text=True,
            timeout=30,
        )
        if add_result.returncode != 0:
            raise RuntimeError(f"git add 澶辫触: {add_result.stderr}")
        steps.append({"step": 1, "name": "git add .", "success": True})

        # 鈹€鈹€ Step 2: git commit 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        commit_msg = f"auto-deploy: {deploy_timestamp}"
        await manager.broadcast({
            "type": "deploy_progress",
            "step": 2,
            "message": f"馃捑 鎵ц git commit: {commit_msg}",
        })

        commit_result = subprocess.run(
            ["git", "commit", "-m", commit_msg],
            cwd=str(project_root),
            capture_output=True,
            text=True,
            timeout=30,
        )
        if commit_result.returncode != 0:
            # "nothing to commit" 涓嶇畻閿欒
            if "nothing to commit" not in commit_result.stdout and "nothing to commit" not in commit_result.stderr:
                raise RuntimeError(f"git commit 澶辫触: {commit_result.stderr}")
            else:
                steps.append({"step": 2, "name": "git commit", "success": True, "note": "鏃犲彉鏇达紝璺宠繃"})
        else:
            steps.append({"step": 2, "name": "git commit", "success": True})

        # 鈹€鈹€ Step 3: git push -f hf main 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        await manager.broadcast({
            "type": "deploy_progress",
            "step": 3,
            "message": "鈽侊笍 姝ｅ湪鎺ㄩ€佸埌 Hugging Face Spaces...",
        })

        push_result = subprocess.run(
            ["git", "push", "-f", "hf", "main"],
            cwd=str(project_root),
            capture_output=True,
            text=True,
            timeout=120,
        )
        if push_result.returncode != 0:
            raise RuntimeError(f"git push 澶辫触: {push_result.stderr}")
        steps.append({"step": 3, "name": "git push -f hf main", "success": True})

        # 鈹€鈹€ 瀹屾垚 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
        await manager.broadcast({
            "type": "deploy_completed",
            "success": True,
            "message": "鉁?閮ㄧ讲鎴愬姛锛丠ugging Face Space 宸叉洿鏂?,
            "timestamp": deploy_timestamp,
        })

        return DeployResponse(
            success=True,
            message="鉁?閮ㄧ讲鎴愬姛锛丠ugging Face Space 宸叉洿鏂?,
            steps=steps,
            timestamp=deploy_timestamp,
        )

    except Exception as e:
        error_msg = str(e)
        await manager.broadcast({
            "type": "deploy_error",
            "success": False,
            "message": f"鉂?閮ㄧ讲澶辫触: {error_msg[:200]}",
        })
        return DeployResponse(
            success=False,
            message=f"鉂?閮ㄧ讲澶辫触: {error_msg[:200]}",
            steps=steps,
            error=error_msg,
            timestamp=deploy_timestamp,
        )


@app.on_event("startup")
async def startup_event():
    """Start background tasks on startup"""
    asyncio.create_task(watch_agent_files())


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
