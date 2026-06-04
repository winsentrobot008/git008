#!/usr/bin/env python3
"""
task_listener.py — Maneki-AI Task Listener (Phase 5)
升级为 HQ + Worker + Safety 三部门协同执行流程。

流程：
  发现任务 → RiskManager 安全检查
           → HQCommander 生成 Plan (Claude API)
           → CircuitBreaker 保护 → WorkerExecutor 执行 (DeepSeek API)
           → 写日志 → N8N 回调

路径规范：所有路径通过 os.path 处理相对路径。
"""

import os
import sys
import time
import json
import glob
import shutil
import subprocess
from datetime import datetime, timezone
from urllib.request import Request, urlopen
from urllib.error import URLError

# Project root resolved relative to this file
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, PROJECT_ROOT)

PENDING_DIR = os.path.join(PROJECT_ROOT, "task_queue", "pending")
PROCESSING_DIR = os.path.join(PROJECT_ROOT, "task_queue", "processing")
COMPLETED_DIR = os.path.join(PROJECT_ROOT, "task_queue", "completed")
LOGS_DIR = os.path.join(PROJECT_ROOT, "logs")
POLL_INTERVAL = 5

N8N_CALLBACK_URL = os.environ.get("N8N_CALLBACK_URL", "")


def timestamp():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ensure_directories():
    for d in [PENDING_DIR, PROCESSING_DIR, COMPLETED_DIR, LOGS_DIR]:
        os.makedirs(d, exist_ok=True)


def discover_tasks():
    if not os.path.isdir(PENDING_DIR):
        return []
    return glob.glob(os.path.join(PENDING_DIR, "*.json"))


def move_file(src, dst_dir):
    dst = os.path.join(dst_dir, os.path.basename(src))
    shutil.move(src, dst)
    return dst


def parse_task(task_path):
    try:
        with open(task_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError) as e:
        print(f"[task_listener] Parse error: {e}")
        return None


def write_task_log(task_id, content):
    log_path = os.path.join(LOGS_DIR, f"task_{task_id}.log")
    with open(log_path, "w", encoding="utf-8") as f:
        f.write(f"Task ID: {task_id}\n")
        f.write(f"Timestamp: {timestamp()}\n")
        f.write(f"{'='*60}\n")
        f.write(content)
    return log_path


def write_status_report(task_id, status, detail=None):
    now = timestamp()
    report = {
        "task_id": task_id,
        "status": status,
        "detail": detail or {},
        "created_at": now,
        "updated_at": now,
    }
    path = os.path.join(LOGS_DIR, f"task_{task_id}_report.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    return path


def send_callback(task_id):
    if not N8N_CALLBACK_URL:
        return
    report_path = os.path.join(LOGS_DIR, f"task_{task_id}_report.json")
    if not os.path.isfile(report_path):
        return
    try:
        with open(report_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        data = json.dumps(payload).encode("utf-8")
        req = Request(
            N8N_CALLBACK_URL, data=data,
            headers={"Content-Type": "application/json"}, method="POST"
        )
        resp = urlopen(req, timeout=10)
        print(f"[task_listener] Callback sent: HTTP {resp.status}")
        resp.close()
    except URLError as e:
        print(f"[task_listener] Callback failed: {e.reason}")
    except Exception as e:
        print(f"[task_listener] Callback error: {e}")


def process_task(task_path):
    """Process a single task through HQ → Worker → Safety pipeline."""
    task_name = os.path.basename(task_path)
    print(f"\n[task_listener] New task: {task_name}")

    # Step a: Move pending → processing
    processing_path = move_file(task_path, PROCESSING_DIR)

    # Step b: Parse JSON
    task_data = parse_task(processing_path)
    if task_data is None:
        tid = task_name.replace(".json", "")
        write_task_log(tid, "Failed to parse task file")
        write_status_report(tid, "FAILED", {"error": "Parse error"})
        send_callback(tid)
        move_file(processing_path, COMPLETED_DIR)
        return

    task_id = task_data.get("task_id", task_name.replace(".json", ""))
    goal = task_data.get("parameters", {}).get("goal", task_data.get("description", ""))

    print(f"[task_listener] task_id: {task_id}")
    print(f"[task_listener] goal: {goal}")

    # ── Phase 1: Risk Check (keep existing) ──────────────────────────
    try:
        from risk_manager import RiskManager
        rm = RiskManager()
        is_safe, message = rm.evaluate_task(goal)
        if not is_safe:
            log_content = f"RISK BLOCKED: {message}\n"
            write_task_log(task_id, log_content)
            write_status_report(task_id, "BLOCKED", {"error": message})
            send_callback(task_id)
            move_file(processing_path, COMPLETED_DIR)
            return
    except ImportError:
        print("[task_listener] RiskManager not available, skipping")
    except Exception as e:
        print(f"[task_listener] Risk check error: {e}")

    # ── Phase 2: HQ → Generate Plan (Claude API) ─────────────────────
    log_lines = []
    log_lines.append(f"Goal: {goal}\n")
    try:
        from hq.commander import HQCommander
        hq = HQCommander()
        plan = hq.generate_plan(goal)
        log_lines.append(f"[HQ] Plan generated: {plan.get('task_id')}")
        log_lines.append(f"[HQ] Steps: {len(plan.get('steps', []))}")
        for s in plan.get("steps", []):
            log_lines.append(f"  Step {s.get('step')}: {s.get('action')}")
        log_lines.append("")
    except ImportError:
        log_lines.append("[HQ] HQCommander not available")
        write_task_log(task_id, "\n".join(log_lines))
        write_status_report(task_id, "FAILED", {"error": "HQ module not found"})
        send_callback(task_id)
        move_file(processing_path, COMPLETED_DIR)
        return
    except Exception as e:
        log_lines.append(f"[HQ] Error: {e}")
        write_task_log(task_id, "\n".join(log_lines))
        write_status_report(task_id, "FAILED", {"error": str(e)})
        send_callback(task_id)
        move_file(processing_path, COMPLETED_DIR)
        return

    if plan.get("status") == "error":
        log_lines.append(f"[HQ] Plan error: {plan.get('error')}")
        write_task_log(task_id, "\n".join(log_lines))
        write_status_report(task_id, "FAILED", {"error": plan.get("error")})
        send_callback(task_id)
        move_file(processing_path, COMPLETED_DIR)
        return

    # ── Phase 3: Worker + Safety → Execute Plan (DeepSeek API) ──────
    try:
        from safety.circuit_breaker import CircuitBreaker
        from worker.executor import WorkerExecutor

        breaker = CircuitBreaker()
        executor = WorkerExecutor(circuit_breaker=breaker)

        log_lines.append("[Worker] Starting execution with CircuitBreaker...")
        result = executor.execute_plan(plan)

        log_lines.append(f"[Worker] Status: {result.get('status')}")
        log_lines.append(f"[Worker] Steps: {result.get('steps_completed')}/{result.get('steps_total')}")
        log_lines.append(f"[Worker] Aggregate: {json.dumps(result.get('aggregate_output', {}), indent=2, default=str)}")

        status = "SUCCESS" if result.get("status") == "success" else "PARTIAL"
        write_status_report(task_id, status, detail=result.get("aggregate_output"))

    except ImportError as e:
        log_lines.append(f"[Worker] Module import failed: {e}")
        write_status_report(task_id, "FAILED", {"error": str(e)})
    except Exception as e:
        log_lines.append(f"[Worker] Execution error: {e}")
        write_status_report(task_id, "FAILED", {"error": str(e)})

    # ── Write log and complete ───────────────────────────────────────
    write_task_log(task_id, "\n".join(log_lines))
    send_callback(task_id)
    move_file(processing_path, COMPLETED_DIR)
    print(f"[task_listener] Task {task_id} completed.")


def main():
    print("[task_listener] Maneki-AI Task Listener (Phase 5 - HQ+Worker+Safety)")
    print(f"[task_listener] Watching: {PENDING_DIR}")
    print(f"[task_listener] Poll interval: {POLL_INTERVAL}s")
    if N8N_CALLBACK_URL:
        print(f"[task_listener] Callback: {N8N_CALLBACK_URL}")
    else:
        print("[task_listener] Callback: DISABLED")

    ensure_directories()
    known_tasks = set()

    try:
        while True:
            tasks = discover_tasks()
            for task_path in tasks:
                tn = os.path.basename(task_path)
                if tn not in known_tasks:
                    known_tasks.add(tn)
                    process_task(task_path)
            time.sleep(POLL_INTERVAL)
    except KeyboardInterrupt:
        print("\n[task_listener] Shutting down.")


if __name__ == "__main__":
    main()