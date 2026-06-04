#!/usr/bin/env python3
"""
api_gateway.py — Maneki-AI HTTP API Gateway (Phase 3 + Web Integration)

A lightweight HTTP server using Python's built-in libraries.
Provides endpoints for n8n, Agent-S, and the Web Frontend to
interact with the task factory.

Endpoints:
  POST /api/task         — Inject a new task into the pending queue (n8n/Agent-S)
  POST /api/submit-task  — Submit a task from the web frontend (status → PENDING)
  GET  /api/tasks        — List all tasks with their current status
  GET  /api/tasks/{id}   — Get a single task's status and report
  GET  /api/health       — Health check endpoint

Default port: 8000
"""

import os
import sys
import json
import glob
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
from datetime import datetime, timezone

# Paths relative to the project root
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PENDING_DIR = os.path.join(PROJECT_ROOT, "task_queue", "pending")
PROCESSING_DIR = os.path.join(PROJECT_ROOT, "task_queue", "processing")
COMPLETED_DIR = os.path.join(PROJECT_ROOT, "task_queue", "completed")
LOGS_DIR = os.path.join(PROJECT_ROOT, "logs")

DEFAULT_PORT = 8000


# ── Helpers ────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ensure_dirs():
    for d in [PENDING_DIR, PROCESSING_DIR, COMPLETED_DIR, LOGS_DIR]:
        os.makedirs(d, exist_ok=True)


def _collect_all_tasks() -> list[dict]:
    """Aggregate all tasks from all queues and logs into a unified list."""
    _ensure_dirs()
    tasks: dict[str, dict] = {}

    def _ingest(filepath: str, inferred_status: str):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, IOError):
            return
        tid = data.get("task_id", os.path.basename(filepath).replace(".json", ""))
        tasks[tid] = {
            "task_id": tid,
            "status": data.get("status", inferred_status),
            "parameters": data.get("parameters", {}),
            "result_log": data.get("result_log", None),
            "created_at": data.get("created_at", data.get("timestamp", "")),
            "updated_at": data.get("updated_at", data.get("timestamp", "")),
        }

    for fp in glob.glob(os.path.join(PENDING_DIR, "*.json")):
        _ingest(fp, "PENDING")
    for fp in glob.glob(os.path.join(PROCESSING_DIR, "*.json")):
        _ingest(fp, "PROCESSING")
    for fp in glob.glob(os.path.join(COMPLETED_DIR, "*.json")):
        _ingest(fp, "COMPLETED")
    for fp in glob.glob(os.path.join(LOGS_DIR, "*_report.json")):
        _ingest(fp, "UNKNOWN")

    return list(tasks.values())


# ── Validation ─────────────────────────────────────────────────────────────

def validate_task_payload(payload):
    """
    Validate that the incoming JSON payload contains the required fields.
    Returns (is_valid, error_message).
    """
    if not isinstance(payload, dict):
        return False, "Payload must be a JSON object."

    task_id = payload.get("task_id")
    if not task_id or not isinstance(task_id, str) or not task_id.strip():
        return False, "Missing or invalid 'task_id'. Must be a non-empty string."

    parameters = payload.get("parameters")
    if not isinstance(parameters, dict):
        return False, "Missing or invalid 'parameters'. Must be a JSON object."

    script_name = parameters.get("script_name")
    if not script_name or not isinstance(script_name, str) or not script_name.strip():
        return False, "Missing or invalid 'parameters -> script_name'. Must be a non-empty string."

    return True, ""


# ── Task Persistence ───────────────────────────────────────────────────────

def save_task_to_pending(payload):
    """
    Save the validated payload as a JSON file in the pending queue.
    Augments the payload with status, timestamps, and result_log.
    Returns the filename that was created.
    """
    task_id = payload["task_id"]
    now = _now_iso()
    record = {
        "task_id": task_id,
        "status": "PENDING",
        "parameters": payload.get("parameters", {}),
        "result_log": None,
        "created_at": payload.get("created_at", now),
        "updated_at": now,
    }
    filename = f"task_{task_id}.json"
    filepath = os.path.join(PENDING_DIR, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(record, f, indent=2)
    return filename


# ── HTTP Handler ───────────────────────────────────────────────────────────

class ManekiAPIHandler(BaseHTTPRequestHandler):
    """HTTP request handler for the Maneki-AI API Gateway."""

    def _send_json_response(self, status_code, data):
        body = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            return None
        raw = self.rfile.read(content_length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None

    def _parse_path(self):
        """Parse the URL path into segments for routing."""
        parsed = urlparse(self.path)
        segments = [s for s in parsed.path.split("/") if s]
        return parsed.path, segments

    # ── POST ───────────────────────────────────────────────────────────────

    def do_POST(self):
        path, segs = self._parse_path()

        if path == "/api/task":
            self._handle_post_task()
        elif path == "/api/submit-task":
            self._handle_submit_task()
        else:
            self._send_json_response(404, {
                "error": "Not Found",
                "message": f"Endpoint POST {path} not found."
            })

    def _handle_post_task(self):
        """POST /api/task — n8n/Agent-S style: strict validation."""
        payload = self._read_json_body()
        if payload is None:
            self._send_json_response(400, {
                "error": "Bad Request",
                "message": "Invalid or empty JSON body."
            })
            return

        is_valid, error_msg = validate_task_payload(payload)
        if not is_valid:
            self._send_json_response(400, {
                "error": "Bad Request",
                "message": error_msg
            })
            return

        _ensure_dirs()
        try:
            filename = save_task_to_pending(payload)
        except IOError as e:
            self._send_json_response(500, {
                "error": "Internal Server Error",
                "message": f"Failed to save task file: {str(e)}"
            })
            return

        task_id = payload["task_id"]
        self._send_json_response(201, {
            "status": "QUEUED",
            "task_id": task_id,
            "message": "Task injected into pending queue successfully."
        })
        print(f"[api_gateway] Task {task_id} queued -> {filename}")

    def _handle_submit_task(self):
        """
        POST /api/submit-task — Web frontend submission.
        Accepts a simpler payload: { task_id, script_name, ... }
        Sets status to PENDING and readies for the automation pipeline.
        """
        payload = self._read_json_body()
        if payload is None:
            self._send_json_response(400, {
                "error": "Bad Request",
                "message": "Invalid or empty JSON body."
            })
            return

        task_id = payload.get("task_id", "")
        script_name = payload.get("script_name", "")
        extra_params = payload.get("parameters", {})

        if not task_id or not task_id.strip():
            self._send_json_response(400, {
                "error": "Bad Request",
                "message": "Missing or empty 'task_id'."
            })
            return
        if not script_name or not script_name.strip():
            self._send_json_response(400, {
                "error": "Bad Request",
                "message": "Missing or empty 'script_name'."
            })
            return

        _ensure_dirs()
        now = _now_iso()
        record = {
            "task_id": task_id,
            "status": "PENDING",
            "parameters": {
                "script_name": script_name,
                **(extra_params if isinstance(extra_params, dict) else {}),
            },
            "result_log": None,
            "created_at": now,
            "updated_at": now,
        }

        filepath = os.path.join(PENDING_DIR, f"task_{task_id}.json")
        try:
            with open(filepath, "w", encoding="utf-8") as f:
                json.dump(record, f, indent=2)
        except IOError as e:
            self._send_json_response(500, {
                "error": "Internal Server Error",
                "message": f"Failed to save task: {str(e)}"
            })
            return

        self._send_json_response(201, {
            "status": "PENDING",
            "task_id": task_id,
            "message": f"Task {task_id} submitted. Status set to PENDING.",
            "task": record,
        })
        print(f"[api_gateway] Web task submitted: {task_id} -> PENDING")

    # ── GET ────────────────────────────────────────────────────────────────

    def do_GET(self):
        path, segs = self._parse_path()

        if path == "/api/health":
            self._handle_get_health()
        elif path == "/api/tasks":
            self._handle_list_tasks()
        elif len(segs) == 3 and segs[0] == "api" and segs[1] == "tasks":
            # GET /api/tasks/{task_id}
            self._handle_get_task(segs[2])
        else:
            self._send_json_response(404, {
                "error": "Not Found",
                "message": f"Endpoint GET {path} not found."
            })

    def _handle_get_health(self):
        self._send_json_response(200, {
            "status": "HEALTHY",
            "engine": "Maneki-AI"
        })

    def _handle_list_tasks(self):
        """GET /api/tasks — Return all tasks with current status."""
        tasks = _collect_all_tasks()
        self._send_json_response(200, {
            "count": len(tasks),
            "tasks": tasks,
        })

    def _handle_get_task(self, task_id):
        """GET /api/tasks/{task_id} — Return a single task with report."""
        tasks = _collect_all_tasks()
        for t in tasks:
            if t["task_id"] == task_id:
                # Attach report and log content if available
                report_path = os.path.join(LOGS_DIR, f"task_{task_id}_report.json")
                log_path = os.path.join(LOGS_DIR, f"task_{task_id}.log")
                t["report"] = None
                t["log"] = None
                if os.path.isfile(report_path):
                    try:
                        with open(report_path, "r", encoding="utf-8") as f:
                            t["report"] = json.load(f)
                    except (json.JSONDecodeError, IOError):
                        pass
                if os.path.isfile(log_path):
                    try:
                        with open(log_path, "r", encoding="utf-8") as f:
                            t["log"] = f.read()
                    except IOError:
                        pass
                self._send_json_response(200, {"task": t})
                return

        self._send_json_response(404, {
            "error": "Not Found",
            "message": f"Task '{task_id}' not found."
        })

    def log_message(self, format, *args):
        sys.stderr.write(f"[api_gateway] {args[0]} {args[1]} {args[2]}\n")


# ── Server Runner ──────────────────────────────────────────────────────────

def run_server(host="0.0.0.0", port=DEFAULT_PORT):
    server = HTTPServer((host, port), ManekiAPIHandler)
    print(f"[api_gateway] Maneki-AI API Gateway starting...")
    print(f"[api_gateway] Listening on http://{host}:{port}")
    print(f"[api_gateway] Endpoints:")
    print(f"[api_gateway]   POST /api/task         — Inject task (n8n/Agent-S)")
    print(f"[api_gateway]   POST /api/submit-task  — Submit task (Web UI)")
    print(f"[api_gateway]   GET  /api/tasks        — List all tasks")
    print(f"[api_gateway]   GET  /api/tasks/{id}   — Get task details")
    print(f"[api_gateway]   GET  /api/health       — Health check")
    print(f"[api_gateway] Pending queue: {PENDING_DIR}")
    print(f"[api_gateway] Press Ctrl+C to stop.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[api_gateway] Shutting down gracefully.")
        server.server_close()


if __name__ == "__main__":
    port = DEFAULT_PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f"[api_gateway] Invalid port '{sys.argv[1]}'. Using default port {DEFAULT_PORT}.")
    run_server(port=port)
