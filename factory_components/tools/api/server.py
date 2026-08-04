"""
MediaIndexerPro — Unified Backend Service
==========================================
Single FastAPI instance consolidating all micro‑services:

  ├── /api/health          — Health check
  ├── /api/index           — Media index (media_index.json)
  ├── /api/stats           — Media index stats summary
  ├── /api/dashboard       — Factory status dashboard
  ├── /api/events          — Orchestrator event receiver
  ├── /api/generate_video  — Video generation pipeline (v3)
  ├── /api/timeline/…      — Timeline CRUD + render (v3)
  ├── /generate.html       — Legacy generate page
  ├── /timeline.html       — Legacy timeline page
  └── /                    — Unified single‑page frontend

Usage:
    cd <git008>
    python api/server.py          # runs on 0.0.0.0:8000
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from pathlib import Path

# ── Path setup ──────────────────────────────────────────────────────────────
# Project root is git008/
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# MediaIndexerPro project paths
MIP_ROOT = PROJECT_ROOT / "projects" / "MediaIndexerPro"
MIP_DATA = MIP_ROOT / "data"
MIP_INDEX = MIP_ROOT / "media_index.json"
MIP_REPORTS = MIP_ROOT / "reports"
MIP_SCREENSHOTS = MIP_DATA / "screenshots"

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

# ── Logging ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)-28s | %(levelname)-5s | %(message)s",
)
logger = logging.getLogger("ZOO.Server")

# ═══════════════════════════════════════════════════════════════════════════════
# FastAPI Application
# ═══════════════════════════════════════════════════════════════════════════════

APP = FastAPI(
    title="MediaIndexerPro Unified API",
    version="3.0.0",
    description="Single backend for video generation, timeline editing, media browsing & factory dashboard",
)

# ── Static directory (api/static/) ──────────────────────────────────────────
STATIC_DIR = Path(__file__).parent / "static"
STATIC_DIR.mkdir(parents=True, exist_ok=True)

# ═══════════════════════════════════════════════════════════════════════════════
# API Endpoints
# ═══════════════════════════════════════════════════════════════════════════════

# ── 1. Health ───────────────────────────────────────────────────────────────


@APP.get("/api/health")
async def health():
    """Unified health check — returns service status + uptime."""
    return JSONResponse({
        "status": "ok",
        "service": "MediaIndexerPro Unified API",
        "version": "3.0.0",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })


# ── 2. Media Index (ported from src/server.py) ─────────────────────────────


def _load_index() -> dict:
    """Load media_index.json; return empty structure on failure."""
    if MIP_INDEX.exists():
        with open(MIP_INDEX, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source_directory": str(MIP_DATA),
        "total_files": 0,
        "total_size_bytes": 0,
        "total_size_human": "0 B",
        "type_counts": {},
        "files": [],
    }


@APP.get("/api/index")
async def get_index():
    """Return the full media index JSON."""
    return JSONResponse(_load_index())


@APP.get("/api/stats")
async def get_stats():
    """Return media index summary statistics."""
    idx = _load_index()
    return JSONResponse({
        "total_files": idx["total_files"],
        "total_size_human": idx["total_size_human"],
        "type_counts": idx["type_counts"],
        "generated": idx["generated"],
        "source_directory": idx["source_directory"],
    })


# ── 3. Factory Dashboard (ported from executor/dashboard/app.py) ────────────


def _load_dashboard_summary(project: str = "MediaIndexerPro") -> dict | None:
    """Load status_summary.json for a given project."""
    path = MIP_REPORTS / "status_summary.json"
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


@APP.get("/api/dashboard")
async def get_dashboard(project: str = "MediaIndexerPro"):
    """Return factory status summary JSON."""
    summary = _load_dashboard_summary(project)
    if summary is None:
        return JSONResponse({
            "project": project,
            "agents": {},
            "updated_at": None,
            "note": "No status_summary.json yet — run orchestrator to generate",
        })
    return JSONResponse(summary)


# ── 4. Orchestrator Events (ported from executor/orchestrator.py) ───────────


@APP.post("/api/events")
async def receive_event(req: Request):
    """Receive an agent event and append to events_received.log."""
    body = await req.json()
    project = body.get("project", "MediaIndexerPro")
    agent = body.get("agent", "unknown")
    payload = body.get("payload", {})

    proj_dir = PROJECT_ROOT / "projects" / project
    reports_dir = proj_dir / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)

    with open(reports_dir / "events_received.log", "a", encoding="utf-8") as f:
        f.write(json.dumps({
            "ts": time.time(),
            "agent": agent,
            "payload": payload,
        }, ensure_ascii=False) + "\n")

    return JSONResponse({"ok": True})


# ── 5. Log endpoints ──────────────────────────────────────────────────────


def _tail_file(path: Path, n: int = 100) -> str:
    """Return last *n* lines of a text file."""
    if not path.exists():
        return ""
    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except UnicodeDecodeError:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    return "".join(lines[-n:])


@APP.get("/api/logs/events")
async def get_events_log(n: int = 100):
    """Return last *n* lines of events_received.log."""
    path = MIP_REPORTS / "events_received.log"
    return JSONResponse({"log": _tail_file(path, n), "path": str(path)})


@APP.get("/api/logs/timeline")
async def get_timeline_log(n: int = 100):
    """List timeline JSON files in data/timelines/ with metadata."""
    tl_dir = MIP_DATA / "timelines"
    files = []
    if tl_dir.exists():
        for f in sorted(tl_dir.iterdir(), key=os.path.getmtime, reverse=True)[:20]:
            files.append({
                "name": f.name,
                "size": f.stat().st_size,
                "modified": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(f.stat().st_mtime)),
            })
    return JSONResponse({"files": files, "dir": str(tl_dir)})


@APP.get("/api/logs/render")
async def get_render_log(n: int = 100):
    """List generated video files in data/generated/."""
    gen_dir = MIP_DATA / "generated"
    files = []
    if gen_dir.exists():
        for f in sorted(gen_dir.iterdir(), key=os.path.getmtime, reverse=True)[:20]:
            files.append({
                "name": f.name,
                "size": f.stat().st_size,
                "size_human": _human_size(f.stat().st_size),
                "modified": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(f.stat().st_mtime)),
            })
    return JSONResponse({"files": files, "dir": str(gen_dir)})


def _human_size(b: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} TB"


# ── 6. Settings endpoints ─────────────────────────────────────────────────

SETTINGS_FILE = Path(__file__).parent / "settings.json"


def _load_settings() -> dict:
    if SETTINGS_FILE.exists():
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "render_mode": "placeholder",
        "voice_engine": "default",
        "maintenance_mode": False,
    }


def _save_settings(s: dict) -> None:
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=2, ensure_ascii=False)


@APP.get("/api/settings")
async def get_settings():
    """Return current system settings."""
    s = _load_settings()
    import psutil
    try:
        mem = psutil.virtual_memory()
        s["system_memory"] = {
            "total": _human_size(mem.total),
            "available": _human_size(mem.available),
            "percent": mem.percent,
        }
    except Exception:
        s["system_memory"] = {"total": "unknown", "available": "unknown", "percent": 0}
    return JSONResponse(s)


@APP.post("/api/settings")
async def update_settings(req: Request):
    """Update system settings."""
    body = await req.json()
    current = _load_settings()
    current.update(body)
    _save_settings(current)
    return JSONResponse({"ok": True, "settings": current})


# ── 7. Legacy static page routes ───────────────────────────────────────────


@APP.get("/generate.html")
async def serve_generate():
    path = STATIC_DIR / "generate.html"
    if path.exists():
        return FileResponse(str(path))
    return HTMLResponse("<h1>generate.html not found</h1>", status_code=404)


@APP.get("/timeline.html")
async def serve_timeline():
    path = STATIC_DIR / "timeline.html"
    if path.exists():
        return FileResponse(str(path))
    return HTMLResponse("<h1>timeline.html not found</h1>", status_code=404)


# ── 6. Include v3 routers from MediaIndexerPro project ─────────────────────

try:
    sys.path.insert(0, str(MIP_ROOT))
    from api.routes.generate_video import router as generate_router
    from api.routes.edit_timeline import router as timeline_router
    APP.include_router(generate_router)
    APP.include_router(timeline_router)
    logger.info("✓ v3 routers loaded (generate_video + edit_timeline)")
except ImportError as e:
    logger.warning("⚠ v3 routers not loaded: %s", e)


# ═══════════════════════════════════════════════════════════════════════════════
# Static File Mounting
# ═══════════════════════════════════════════════════════════════════════════════

# Mount data directory for screenshots, generated videos, etc.
MIP_DATA.mkdir(parents=True, exist_ok=True)
MIP_SCREENSHOTS.mkdir(parents=True, exist_ok=True)
APP.mount("/data", StaticFiles(directory=str(MIP_DATA)), name="data")

# Serve api/static/ — index.html, generate.html, timeline.html
APP.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")

# ═══════════════════════════════════════════════════════════════════════════════
# Entrypoint
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")

    print(f"╔══════════════════════════════════════════════════════════╗")
    print(f"║   MediaIndexerPro Unified API                          ║")
    print(f"║   Listening on http://{host}:{port}                     ║")
    print(f"║   Static dir : {STATIC_DIR}                             ║")
    print(f"║   Data dir   : {MIP_DATA}                               ║")
    print(f"╚══════════════════════════════════════════════════════════╝")

    uvicorn.run(APP, host=host, port=port, log_level="info")
