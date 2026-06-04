# Maneki-AI Web Frontend Architecture

## Overview

The Maneki-AI web frontend is a **single-file Streamlit application** (`app.py`) deployed on **Render** at `https://maneki-ai.onrender.com/`. It provides a task management console that interfaces with the internal Maneki-AI Smart Factory pipeline via the API Gateway.

---

## Files Modified

| File | Change |
|------|--------|
| `app.py` | **Rewritten** — Single-file Streamlit app with 3 pages (Submit Task, Dashboard, Report Viewer) + embedded lightweight data store |
| `core/api_gateway.py` | **Enhanced** — Added `POST /api/submit-task`, `GET /api/tasks`, `GET /api/tasks/{id}` endpoints |
| `core/task_listener.py` | **Patched** — `write_status_report()` now outputs full Task Schema (parameters, result_log, created_at, updated_at) |
| `render.yaml` | **Updated** — Added `API_GATEWAY_URL` env var |
| `docs/WEB_ARCHITECTURE.md` | **Rewritten** — This document |

---

## Data Schema: Task

Lightweight file-based store. Each task is a JSON file in `task_queue/`.

```json
{
  "task_id":     "TASK_20260602_001",
  "status":      "PENDING",
  "parameters":  { "script_name": "scripts/example_worker.py", ... },
  "result_log":  "logs/task_TASK_20260602_001_report.json",
  "created_at":  "2026-06-02T14:00:00Z",
  "updated_at":  "2026-06-02T14:05:00Z"
}
```

Tasks flow through directories: `pending/ → processing/ → completed/`

---

## API Endpoints (`core/api_gateway.py`)

| Method | Endpoint | Source | Description |
|--------|----------|--------|-------------|
| POST | `/api/task` | n8n/Agent-S | Inject task (strict validation) |
| POST | `/api/submit-task` | Web UI | Submit task → status PENDING |
| GET | `/api/tasks` | Web UI | List all tasks with status |
| GET | `/api/tasks/{id}` | Web UI | Get task details + report + log |
| GET | `/api/health` | Any | Health check |

---

## Web Control Loop (`app.py`)

```
User opens https://maneki-ai.onrender.com/
        │
        ▼
    Sidebar Navigation
        │
        ├── 📋 Submit Task
        │       │
        │       ├── Form: task_id, script_name, extra_params (JSON)
        │       │
        │       └── "Submit Task" clicked
        │               │
        │               ├──► submit_task() writes to task_queue/pending/  (status: PENDING)
        │               │
        │               └──► POST /api/submit-task to API Gateway (best-effort)
        │
        ├── 📊 Task Dashboard
        │       │
        │       ├── Summary metrics (total / pending / processing / completed)
        │       ├── Filter by status
        │       └── Expandable task list → "View Report" button
        │
        └── 📄 Execution Report
                │
                ├── Dropdown: select completed task
                ├── Structured report (status, task_id, timestamp, full JSON)
                ├── Full execution log viewer (read-only text area)
                └── Download log file button
```

### Background Processing (separate process)

```
core/task_listener.py (runs independently)
        │
        ├── Polls task_queue/pending/ every 5s
        ├── Moves file → processing/
        ├── Executes script via subprocess
        ├── Writes logs/task_[id].log
        ├── Writes logs/task_[id]_report.json  (status: SUCCESS/FAILED)
        └── Moves file → completed/
```

---

## Render Deployment

- **Service**: `maneki-ai` (Python web service)
- **Entry Point**: `streamlit run app.py --server.port $PORT --server.address 0.0.0.0`
- **Build**: `pip install -r requirements.txt`
- **Runtime**: Python 3.12.0 (via `runtime.txt`)
- **Config**: `render.yaml`

---

## Cross-Platform Compatibility

- All file paths use `os.path.join()` for Windows/Linux/macOS
- No platform-specific dependencies
- Streamlit runs identically on all platforms
- File-based task queue avoids external database dependency
