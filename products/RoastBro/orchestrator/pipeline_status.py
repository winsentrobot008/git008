"""
Pipeline Status Tracker
=======================
Thread-safe file-based status tracking for video pipeline execution.

Decouples background pipeline threads from Streamlit's frontend by writing
status to JSON files on disk. The dashboard polls these files to display
real-time progress without ever touching st.session_state from a thread.

Status file location: data/metadata/{video_id}.status.json
"""

import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List

# ── Constants ────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
STATUS_DIR = ROOT / "data" / "metadata"

# ── Status Keys ──────────────────────────────────────────────
STATUS_PENDING = "pending"
STATUS_RUNNING = "running"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"


def _ensure_dir():
    STATUS_DIR.mkdir(parents=True, exist_ok=True)


def _status_path(video_id: str) -> Path:
    return STATUS_DIR / f"{video_id}.status.json"


# ── Public API ───────────────────────────────────────────────

def init_status(video_id: str, label: str = "") -> Dict[str, Any]:
    """
    Initialize a status file for a video pipeline run.
    Safe to call from any thread.
    """
    _ensure_dir()
    status: Dict[str, Any] = {
        "video_id": video_id,
        "label": label or video_id,
        "status": STATUS_RUNNING,
        "current_step": 0,
        "total_steps": 9,
        "step_name": "",
        "progress": 0.0,
        "cn_progress": 0.0,
        "en_progress": 0.0,
        "error": "",
        "started_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        "completed_at": "",
        "pid": os.getpid(),
    }
    path = _status_path(video_id)
    path.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")
    return status


def update_status(
    video_id: str,
    *,
    status: Optional[str] = None,
    current_step: Optional[int] = None,
    step_name: str = "",
    progress: Optional[float] = None,
    cn_progress: Optional[float] = None,
    en_progress: Optional[float] = None,
    error: str = "",
) -> Optional[Dict[str, Any]]:
    """
    Update fields in a video's status file.
    Only writes non-None fields. Safe to call from any thread.
    Returns the full status dict, or None if file doesn't exist.
    """
    path = _status_path(video_id)
    if not path.exists():
        return None

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None

    if status is not None:
        data["status"] = status
    if current_step is not None:
        data["current_step"] = current_step
    if step_name:
        data["step_name"] = step_name
    if progress is not None:
        data["progress"] = round(progress, 4)
    if cn_progress is not None:
        data["cn_progress"] = round(cn_progress, 4)
    if en_progress is not None:
        data["en_progress"] = round(en_progress, 4)
    if error:
        data["error"] = error

    data["updated_at"] = datetime.now().isoformat()

    if status == STATUS_COMPLETED:
        data["completed_at"] = datetime.now().isoformat()
        data["progress"] = 1.0
        data["cn_progress"] = 1.0
        data["en_progress"] = 1.0

    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def mark_completed(video_id: str) -> Optional[Dict[str, Any]]:
    """Mark a pipeline run as completed."""
    return update_status(video_id, status=STATUS_COMPLETED)


def mark_failed(video_id: str, error_msg: str) -> Optional[Dict[str, Any]]:
    """Mark a pipeline run as failed with error message."""
    return update_status(video_id, status=STATUS_FAILED, error=error_msg)


def get_status(video_id: str) -> Optional[Dict[str, Any]]:
    """
    Read a video's current status from disk.
    Returns None if no status file exists.
    Safe to call from any thread (including Streamlit main thread).
    """
    path = _status_path(video_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def get_all_statuses() -> Dict[str, Dict[str, Any]]:
    """
    Read ALL pipeline status files from disk.
    Returns dict of {video_id: status_dict}.
    Safe to call from Streamlit main thread.
    """
    _ensure_dir()
    result: Dict[str, Dict[str, Any]] = {}
    for f in sorted(STATUS_DIR.glob("*.status.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            vid = data.get("video_id", f.stem.replace(".status", ""))
            result[vid] = data
        except (json.JSONDecodeError, OSError):
            pass
    return result


def get_running_count() -> int:
    """Count how many pipelines are currently running."""
    count = 0
    for f in STATUS_DIR.glob("*.status.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            if data.get("status") == STATUS_RUNNING:
                count += 1
        except (json.JSONDecodeError, OSError):
            pass
    return count


def clean_old_statuses(max_age_hours: int = 48):
    """Remove status files older than max_age_hours."""
    _ensure_dir()
    now = time.time()
    for f in STATUS_DIR.glob("*.status.json"):
        try:
            mtime = f.stat().st_mtime
            if (now - mtime) > max_age_hours * 3600:
                f.unlink(missing_ok=True)
        except OSError:
            pass


def delete_status(video_id: str):
    """Remove a single status file."""
    path = _status_path(video_id)
    path.unlink(missing_ok=True)
