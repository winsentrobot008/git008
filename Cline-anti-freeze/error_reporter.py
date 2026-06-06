#!/usr/bin/env python3
"""
error_reporter.py — Error Reporting & Governance Protocol (Rule 1)
==================================================================
Implements the Zero-Silence Policy:
  Any try/except block must log the traceback to
  governance_logs/error_report.json and notify the main dashboard.

Usage:
    from error_reporter import report_error
    try:
        ...
    except Exception as e:
        report_error("module_name", e, context={"task_id": "..."})
"""

import os
import sys
import json
import traceback
import threading
from pathlib import Path
from datetime import datetime, timezone

# ── Paths ──────────────────────────────────────────────────────
THIS_DIR = Path(__file__).resolve().parent
GOVERNANCE_LOGS_DIR = THIS_DIR / "governance_logs"
ERROR_REPORT_PATH = GOVERNANCE_LOGS_DIR / "error_report.json"
ERROR_LOG_MD_PATH = THIS_DIR / "error_log.md"

# Ensure governance_logs/ exists
GOVERNANCE_LOGS_DIR.mkdir(parents=True, exist_ok=True)

# ── Thread lock for concurrent writes ──────────────────────────
_write_lock = threading.Lock()


def _ensure_file(path: Path):
    """Ensure the JSON file exists with a valid root structure."""
    if not path.exists():
        path.write_text(
            json.dumps({"version": "2.0", "errors": [], "last_updated": None}, indent=2),
            encoding="utf-8",
        )


def report_error(
    module: str,
    exception: BaseException,
    context: dict = None,
    severity: str = "ERROR",
    task_id: str = None,
    project: str = None,
    agent_signature: str = None,
):
    """
    Log an error to governance_logs/error_report.json and error_log.md.
    
    Args:
        module:      Source module name (e.g. 'task_scheduler', 'live_agent')
        exception:   The exception object (sys.exc_info() is used if not provided)
        context:     Additional context dict (task_id, prompt, etc.)
        severity:    One of "INFO", "WARNING", "ERROR", "CRITICAL"
        task_id:     Optional task identifier
        project:     Optional project name
        agent_signature: Optional agent identifier
    """
    tb_str = "".join(traceback.format_exception(type(exception), exception, exception.__traceback__))
    now_iso = datetime.now(timezone.utc).isoformat()

    entry = {
        "timestamp": now_iso,
        "module": module,
        "error_type": type(exception).__name__,
        "error_message": str(exception)[:500],
        "traceback": tb_str,
        "severity": severity.upper(),
        "task_id": task_id or context.get("task_id") if context else None,
        "project": project,
        "agent_signature": agent_signature,
        "context": context or {},
    }

    with _write_lock:
        _ensure_file(ERROR_REPORT_PATH)
        try:
            data = json.loads(ERROR_REPORT_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            data = {"version": "2.0", "errors": [], "last_updated": None}

        data["errors"].append(entry)
        data["last_updated"] = now_iso
        # Keep only last 1000 errors to prevent bloat
        if len(data["errors"]) > 1000:
            data["errors"] = data["errors"][-1000:]

        ERROR_REPORT_PATH.write_text(
            json.dumps(data, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    # Also append to error_log.md for streamlit dashboard
    _append_to_error_log_md(entry, now_iso)

    print(f"[error_reporter] [{severity}] {module}: {str(exception)[:120]}")


def _append_to_error_log_md(entry: dict, timestamp: str):
    """Append a structured entry to error_log.md."""
    try:
        ts_short = timestamp[:19]
        module = entry.get("module", "?")
        err_type = entry.get("error_type", "?")
        msg = entry.get("error_message", "?")
        task_id = entry.get("task_id", "?")
        severity = entry.get("severity", "ERROR")

        line = (
            f"## [{ts_short} | {task_id} | {module}]\n"
            f"- **严重度**: {severity}\n"
            f"- **异常类型**: {err_type}\n"
            f"- **错误**: {msg}\n"
            f"- **Traceback**: `{entry.get('traceback', '')[:200]}`\n\n"
        )

        with _write_lock:
            with open(str(ERROR_LOG_MD_PATH), "a", encoding="utf-8") as f:
                f.write(line)
    except OSError:
        pass  # Silently fail — we already wrote to JSON


def get_recent_errors(limit: int = 50, min_severity: str = "ERROR") -> list:
    """Retrieve recent errors from the JSON report file."""
    _ensure_file(ERROR_REPORT_PATH)
    try:
        data = json.loads(ERROR_REPORT_PATH.read_text(encoding="utf-8"))
        errors = data.get("errors", [])
        # Filter by severity
        severity_order = {"INFO": 0, "WARNING": 1, "ERROR": 2, "CRITICAL": 3}
        min_level = severity_order.get(min_severity.upper(), 2)
        filtered = [
            e for e in errors
            if severity_order.get(e.get("severity", "ERROR"), 2) >= min_level
        ]
        return filtered[-limit:]
    except (json.JSONDecodeError, OSError):
        return []


def get_error_summary() -> dict:
    """Return a summary of error counts by module and severity."""
    _ensure_file(ERROR_REPORT_PATH)
    try:
        data = json.loads(ERROR_REPORT_PATH.read_text(encoding="utf-8"))
        errors = data.get("errors", [])
    except (json.JSONDecodeError, OSError):
        errors = []

    summary = {
        "total_errors": len(errors),
        "by_module": {},
        "by_severity": {"INFO": 0, "WARNING": 0, "ERROR": 0, "CRITICAL": 0},
        "last_updated": data.get("last_updated") if errors else None,
    }

    for e in errors:
        mod = e.get("module", "unknown")
        sev = e.get("severity", "ERROR")
        summary["by_module"][mod] = summary["by_module"].get(mod, 0) + 1
        if sev in summary["by_severity"]:
            summary["by_severity"][sev] += 1

    return summary