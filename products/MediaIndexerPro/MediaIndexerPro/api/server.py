"""
MediaIndexerPro — Unified Backend Service
==========================================
Single FastAPI instance at projects/MediaIndexerPro/api/server.py
Emotion-driven video generation pipeline + nightly auto-generation.

Endpoints:
  GET  /api/health               — Health check
  GET  /api/index                — Media index (media_index.json)
  GET  /api/stats                — Media index stats summary + memory/CPU
  GET  /api/dashboard            — Factory agent status
  POST /api/events               — Agent event receiver
  POST /api/generate_video       — Create video generation job (async)
  GET  /api/job/{job_id}         — Get job status
  GET  /api/jobs                 — List recent jobs
  GET  /api/nightly              — List nightly output files
  GET  /api/nightly/report       — Get latest morning report
  GET  /api/timeline/{id}        — Get timeline
  POST /api/timeline/new         — Create timeline
  POST /api/timeline/{id}/update — Update timeline tracks
  POST /api/timeline/{id}/render — Render timeline to video
  GET  /api/logs/events          — Event log tail
  GET  /api/logs/timeline        — Timeline file list
  GET  /api/logs/render          — Generated video file list
  GET  /api/settings             — Get settings + system info
  POST /api/settings             — Update settings
  GET  /                         — Unified SPA frontend

Usage:
    cd projects/MediaIndexerPro
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
# Server lives at: projects/MediaIndexerPro/api/server.py
BASE = Path(__file__).resolve().parent               # .../MediaIndexerPro/api/
MIP_ROOT = BASE.parent                                # .../MediaIndexerPro/
sys.path.insert(0, str(MIP_ROOT))                     # for v3 route imports

STATIC_DIR = BASE / "static"
DATA_DIR = BASE / "data"
TIMELINES_DIR = DATA_DIR / "timelines"
GENERATED_DIR = DATA_DIR / "generated"
LOGS_DIR = DATA_DIR / "logs"
ASSETS_DIR = MIP_ROOT / "assets"
INDEX_PATH = MIP_ROOT / "media_index.json"
REPORTS_DIR = MIP_ROOT / "reports"
SCREENSHOTS_DIR = MIP_ROOT / "data" / "screenshots"

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

# ── Ensure directories exist ────────────────────────────────────────────────
for d in (STATIC_DIR, DATA_DIR, TIMELINES_DIR, GENERATED_DIR, LOGS_DIR,
          ASSETS_DIR, REPORTS_DIR, SCREENSHOTS_DIR):
    d.mkdir(parents=True, exist_ok=True)

# ═══════════════════════════════════════════════════════════════════════════════
# API Endpoints
# ═══════════════════════════════════════════════════════════════════════════════


# ── 1. Health ───────────────────────────────────────────────────────────────


@APP.get("/api/health")
async def health():
    """Unified health check."""
    return JSONResponse({
        "status": "ok",
        "service": "MediaIndexerPro Unified API",
        "version": "3.0.0",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })


# ── 2. Media Index ─────────────────────────────────────────────────────────


def _load_index() -> dict:
    """Load media_index.json from MIP_ROOT."""
    if INDEX_PATH.exists():
        with open(INDEX_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source_directory": str(DATA_DIR),
        "total_files": 0,
        "total_size_bytes": 0,
        "total_size_human": "0 B",
        "type_counts": {},
        "files": [],
    }


@APP.get("/api/index")
async def get_index():
    """Return full media index JSON."""
    return JSONResponse(_load_index())


@APP.get("/api/stats")
async def get_stats():
    """Return media index summary statistics + process memory/CPU."""
    idx = _load_index()
    mem_mb = 0
    cpu_pct = 0.0
    try:
        import psutil
        proc = psutil.Process(os.getpid())
        mem_mb = proc.memory_info().rss // (1024 * 1024)
        cpu_pct = proc.cpu_percent(interval=0.1)
    except Exception:
        pass
    return JSONResponse({
        "total_files": idx["total_files"],
        "total_size_human": idx["total_size_human"],
        "type_counts": idx["type_counts"],
        "generated": idx["generated"],
        "source_directory": idx["source_directory"],
        "memory_mb": mem_mb,
        "cpu_percent": cpu_pct,
    })


# ── 2b. Media Library (aggregated from media_index.json + local_assets) ────


@APP.get("/api/media/list")
async def get_media_list():
    """Return aggregated media library with tags, emotions, stats.
    
    Combines media_index.json files with local_assets/ scan results
    and emotion tagging from the emotion engine.
    """
    import mimetypes

    items = []

    # 1. Load from media_index.json
    idx = _load_index()
    for f in idx.get("files", []):
        ext = os.path.splitext(f.get("name", ""))[1].lower()
        ftype = f.get("type", "other")
        size_mb = round(f.get("size_bytes", 0) / (1024 * 1024), 2)
        items.append({
            "id": f"idx-{len(items)}",
            "filename": f.get("name", ""),
            "path": f.get("absolute_path", f.get("path", "")),
            "type": ftype,
            "size_mb": size_mb,
            "modified": f.get("modified", ""),
            "tags": [ftype, ext.lstrip(".")] if ext else [ftype],
            "emotion": "",  # Will be tagged by emotion engine
        })

    # 2. Scan local_assets/
    local_dirs = [
        ("motivation", MIP_ROOT / "local_assets" / "motivation"),
        ("voice", MIP_ROOT / "local_assets" / "voice"),
        ("emotion", MIP_ROOT / "local_assets" / "emotion"),
        ("psychology", MIP_ROOT / "local_assets" / "psychology"),
        ("relationship", MIP_ROOT / "local_assets" / "relationship"),
    ]

    for tag_name, directory in local_dirs:
        if not directory.exists():
            continue
        for f in directory.iterdir():
            if f.is_file() and f.suffix.lower() in (".mp4", ".mov", ".avi", ".jpg", ".png", ".wav", ".mp3", ".flac"):
                size_mb = round(f.stat().st_size / (1024 * 1024), 2)
                ftype = "video" if f.suffix.lower() in (".mp4", ".mov", ".avi") else \
                        "audio" if f.suffix.lower() in (".wav", ".mp3", ".flac") else "image"

                # Try to infer emotion from filename keywords
                from workflow.emotion_engine import analyze_script
                emotion_label = ""
                try:
                    analysis = analyze_script(f.stem.replace("_", " ").replace("-", " "))
                    if analysis.curve:
                        emotion_label = analysis.curve[0].label
                except Exception:
                    pass

                items.append({
                    "id": f"local-{len(items)}",
                    "filename": f.name,
                    "path": str(f),
                    "type": ftype,
                    "size_mb": size_mb,
                    "modified": time.strftime("%Y-%m-%d %H:%M:%S",
                                              time.localtime(f.stat().st_mtime)),
                    "tags": [tag_name, ftype, f.suffix.lstrip(".")],
                    "emotion": emotion_label,
                })

    # 3. Scan assets/index/ for emotion-tagged index files
    assets_index_dir = MIP_ROOT / "assets" / "index"
    if assets_index_dir.exists():
        for sub_dir in assets_index_dir.iterdir():
            if sub_dir.is_dir():
                idx_file = sub_dir / "index.json"
                if idx_file.exists():
                    try:
                        with open(idx_file, "r", encoding="utf-8") as f:
                            data = json.load(f)
                        files = data if isinstance(data, list) else data.get("files", [data])
                        for media in files:
                            items.append({
                                "id": f"asset-{len(items)}",
                                "filename": media.get("name", media.get("title", sub_dir.name)),
                                "path": media.get("path", media.get("url", "")),
                                "type": media.get("type", "image"),
                                "size_mb": media.get("size_mb", 0),
                                "modified": "",
                                "tags": [sub_dir.name],
                                "emotion": sub_dir.name.split("_")[0] if "_" in sub_dir.name else "",
                            })
                    except Exception:
                        pass

    # 4. Compute stats
    by_emotion: dict[str, int] = {}
    by_tag: dict[str, int] = {}
    for item in items:
        em = item.get("emotion", "")
        if em:
            by_emotion[em] = by_emotion.get(em, 0) + 1
        for tag in item.get("tags", []):
            by_tag[tag] = by_tag.get(tag, 0) + 1

    return JSONResponse({
        "items": items,
        "stats": {
            "total": len(items),
            "by_emotion": by_emotion,
            "by_tag": by_tag,
        },
    })


@APP.post("/api/media/annotate")
async def annotate_media(req: Request):
    """AI auto-annotation: analyze a filename/path for emotion tags.
    
    Request: {"filename": "sunset_beach.mp4", "text": "optional description"}
    Response: {"emotion": "希望", "tags": ["sunset","beach","warm"], "style": {...}}
    """
    body = await req.json()
    filename = body.get("filename", "")
    text = body.get("text", "")

    # Use filename + text for emotion analysis
    analysis_text = text or filename.replace("_", " ").replace("-", " ").replace(".", " ")
    
    from workflow.emotion_engine import analyze_script, get_style_for_emotion
    analysis = analyze_script(analysis_text)
    
    emotion_label = analysis.dominant_emotion if analysis.curve else "平静"
    style = get_style_for_emotion(emotion_label)
    
    # Extract tags from filename
    name = Path(filename).stem
    words = [w for w in name.replace("_", " ").replace("-", " ").split() if len(w) > 2]
    tags = words[:5]
    if emotion_label not in tags:
        tags.insert(0, emotion_label)

    return JSONResponse({
        "emotion": emotion_label,
        "tags": tags,
        "style": style,
        "confidence": analysis.curve[0].intensity if analysis.curve else 0.5,
    })


# ── 3. Factory Dashboard ───────────────────────────────────────────────────


def _load_dashboard_summary(project: str = "MediaIndexerPro") -> dict | None:
    """Load status_summary.json from reports/."""
    path = REPORTS_DIR / "status_summary.json"
    if path.exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


@APP.get("/api/dashboard")
async def get_dashboard(project: str = "MediaIndexerPro"):
    """Return factory agent status summary."""
    summary = _load_dashboard_summary(project)
    if summary is None:
        return JSONResponse({
            "project": project,
            "agents": {},
            "updated_at": None,
            "note": "No status_summary.json yet",
        })
    return JSONResponse(summary)


# ── 4. Events ──────────────────────────────────────────────────────────────


@APP.post("/api/events")
async def receive_event(req: Request):
    """Receive agent event and append to events log."""
    body = await req.json()
    agent = body.get("agent", "unknown")
    payload = body.get("payload", {})

    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    with open(LOGS_DIR / "events_received.log", "a", encoding="utf-8") as f:
        f.write(json.dumps({
            "ts": time.time(),
            "agent": agent,
            "payload": payload,
        }, ensure_ascii=False) + "\n")

    return JSONResponse({"ok": True})


# ── 5. Log endpoints ───────────────────────────────────────────────────────


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
    """Return last *n* lines of events log."""
    path = LOGS_DIR / "events_received.log"
    return JSONResponse({"log": _tail_file(path, n), "path": str(path)})


@APP.get("/api/logs/timeline")
async def get_timeline_log():
    """List timeline JSON files in data/timelines/."""
    files = []
    if TIMELINES_DIR.exists():
        for f in sorted(TIMELINES_DIR.iterdir(), key=os.path.getmtime, reverse=True)[:20]:
            files.append({
                "name": f.name,
                "size": f.stat().st_size,
                "modified": time.strftime("%Y-%m-%d %H:%M:%S",
                                          time.localtime(f.stat().st_mtime)),
            })
    return JSONResponse({"files": files, "dir": str(TIMELINES_DIR)})


@APP.get("/api/logs/render")
async def get_render_log():
    """List generated video files in data/generated/."""
    files = []
    if GENERATED_DIR.exists():
        for f in sorted(GENERATED_DIR.iterdir(), key=os.path.getmtime, reverse=True)[:20]:
            files.append({
                "name": f.name,
                "size_human": _human_size(f.stat().st_size),
                "modified": time.strftime("%Y-%m-%d %H:%M:%S",
                                          time.localtime(f.stat().st_mtime)),
            })
    return JSONResponse({"files": files, "dir": str(GENERATED_DIR)})


def _human_size(b: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} TB"


# ── 6. Settings ────────────────────────────────────────────────────────────

SETTINGS_FILE = BASE / "settings.json"


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
    """Return current settings + system memory info."""
    s = _load_settings()
    try:
        import psutil
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
    """Update settings."""
    body = await req.json()
    current = _load_settings()
    current.update(body)
    _save_settings(current)
    return JSONResponse({"ok": True, "settings": current})


# ── 7. Job endpoints (async pipeline) ──────────────────────────────────────


@APP.post("/api/generate_video")
async def generate_video_async(req: Request):
    """Create a video generation job (returns job_id immediately).
    
    The job is queued for async processing by worker.py.
    Previous sync behavior is preserved via job polling.
    """
    from workflow.pipeline_orchestrator import create_job
    body = await req.json()
    script = body.get("script", "")
    ratio = body.get("ratio", "1:1")
    voice = body.get("voice", "default")
    speed = body.get("speed", 1.0)

    job_id = create_job(script, ratio, voice, float(speed))

    # Queue in worker via subprocess (Python -m path for proper module resolution)
    try:
        import subprocess
        log_path = str(LOGS_DIR / "worker.log")
        log_file = open(log_path, "a", encoding="utf-8")
        subprocess.Popen(
            [sys.executable, "-m", "workflow.worker", "--once"],
            stdout=log_file,
            stderr=subprocess.STDOUT,
            cwd=str(MIP_ROOT),
            close_fds=True,
        )
    except Exception as exc:
        logger.warning(f"Worker spawn failed: {exc}")

    return JSONResponse({
        "status": "queued",
        "job_id": job_id,
        "message": "Job created. Poll /api/job/{job_id} for status.",
    })


@APP.get("/api/job/{job_id}")
async def get_job_status(job_id: str):
    """Return the current status of a generation job."""
    from workflow.pipeline_orchestrator import get_job
    job = get_job(job_id)
    if job is None:
        return JSONResponse({"error": "job not found", "job_id": job_id}, status_code=404)
    return JSONResponse(job)


@APP.get("/api/jobs")
async def list_jobs(n: int = 20):
    """List recent generation jobs."""
    from workflow.pipeline_orchestrator import list_recent_jobs
    jobs = list_recent_jobs(n)
    return JSONResponse({"jobs": jobs, "total": len(jobs)})


# ── 8. Nightly output endpoints ────────────────────────────────────────────


@APP.get("/api/nightly")
async def list_nightly_outputs():
    """List nightly generated videos."""
    nightly_dir = MIP_ROOT / "data" / "nightly_output"
    files = []
    if nightly_dir.exists():
        for f in sorted(nightly_dir.iterdir(), key=os.path.getmtime, reverse=True)[:50]:
            if f.suffix == ".mp4":
                files.append({
                    "name": f.name,
                    "size_human": _human_size(f.stat().st_size),
                    "modified": time.strftime("%Y-%m-%d %H:%M:%S",
                                              time.localtime(f.stat().st_mtime)),
                })
    return JSONResponse({"files": files, "dir": str(nightly_dir)})


@APP.get("/api/nightly/report")
async def get_latest_report():
    """Return the latest morning report content."""
    nightly_dir = MIP_ROOT / "data" / "nightly_output"
    if not nightly_dir.exists():
        return JSONResponse({"report": "", "note": "No reports yet"})
    reports = sorted(nightly_dir.glob("REPORT_*.txt"), key=os.path.getmtime, reverse=True)
    if not reports:
        return JSONResponse({"report": "", "note": "No reports yet"})
    with open(reports[0], "r", encoding="utf-8") as f:
        content = f.read()
    return JSONResponse({"report": content, "file": reports[0].name})


# ── 9. Legacy page routes ──────────────────────────────────────────────────


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


# ── 10. Include v3 routers ─────────────────────────────────────────────────

try:
    from api.routes.generate_video import router as generate_router
    from api.routes.edit_timeline import router as timeline_router
    APP.include_router(generate_router)
    APP.include_router(timeline_router)
    logger.info("✓ v3 routers loaded (generate_video + edit_timeline)")
except ImportError as e:
    logger.warning("⚠ v3 routers not loaded: %s", e)

# ── 11. Media Library Pro router ──────────────────────────────────────────

try:
    from api.media_library import router as media_router
    APP.include_router(media_router)
    logger.info("✓ Media Library Pro router loaded")
except ImportError as e:
    logger.warning("⚠ Media Library Pro router not loaded: %s", e)


# ═══════════════════════════════════════════════════════════════════════════════
# Static File Mounting
# ═══════════════════════════════════════════════════════════════════════════════

# Mount data directory (screenshots, etc.)
APP.mount("/data", StaticFiles(directory=str(MIP_ROOT / "data")), name="data")

# ── Shadow Index endpoint ────────────────────────────────────────────────
@APP.get("/api/shadow_index")
async def get_shadow_index():
    """Return the humor shadow index."""
    shadow_path = MIP_ROOT / "storage" / "humor_shadow_index.json"
    if shadow_path.exists():
        with open(shadow_path, "r", encoding="utf-8") as f:
            return JSONResponse(json.load(f))
    return JSONResponse({"generated_at": "", "total_videos": 0, "videos": []})


# ── Batch-produced videos listing ────────────────────────────────────────
@APP.get("/api/batch_videos")
async def get_batch_videos():
    """List batch-produced videos from the scheduler."""
    videos = []
    for fpath in sorted(GENERATED_DIR.glob("scheduled_*.mp4")):
        videos.append({
            "filename": fpath.name,
            "path": f"/api/data/generated/{fpath.name}",
            "size_bytes": fpath.stat().st_size,
            "size_mb": round(fpath.stat().st_size / (1024 * 1024), 1),
            "modified": time.strftime("%Y-%m-%d %H:%M:%S",
                                      time.localtime(fpath.stat().st_mtime)),
        })
    return JSONResponse({"total": len(videos), "videos": videos})


# Mount api/data (generated videos, timelines)
APP.mount("/api/data", StaticFiles(directory=str(DATA_DIR)), name="api_data")

# Mount assets directory
APP.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")

# Serve api/static/ as root (index.html SPA)
APP.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")

# ═══════════════════════════════════════════════════════════════════════════════
# Auto-start worker daemon on server startup
# ═══════════════════════════════════════════════════════════════════════════════

def _start_worker_daemon():
    """Spawn the worker daemon in background to auto-consume jobs."""
    try:
        import subprocess
        daemon_log = open(str(LOGS_DIR / "worker_daemon.log"), "a", encoding="utf-8")
        proc = subprocess.Popen(
            [sys.executable, "-m", "workflow.worker_daemon"],
            stdout=daemon_log,
            stderr=subprocess.STDOUT,
            cwd=str(MIP_ROOT),
            close_fds=True,
        )
        logger.info(f"Worker daemon started (PID {proc.pid})")
    except Exception as e:
        logger.warning(f"Worker daemon not started: {e}")


# ═══════════════════════════════════════════════════════════════════════════════
# Entrypoint
# ═══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")

    # Auto-start worker daemon in background
    _start_worker_daemon()

    print(f"╔══════════════════════════════════════════════════════════╗")
    print(f"║   MediaIndexerPro Unified API                          ║")
    print(f"║   PID   : {os.getpid()}                                 ║")
    print(f"║   Root  : {MIP_ROOT}                                   ║")
    print(f"║   Data  : {DATA_DIR}                                    ║")
    print(f"║   Static: {STATIC_DIR}                                  ║")
    print(f"║   Port  : {port}                                        ║")
    print(f"╚══════════════════════════════════════════════════════════╝")

    uvicorn.run(APP, host=host, port=port, log_level="info")
