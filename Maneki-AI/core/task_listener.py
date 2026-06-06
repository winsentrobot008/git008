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

Anti-Freeze 改造 (Phase 5.1):
  - Worker 通过 subprocess.Popen 异步启动，不再阻塞主循环
  - threading.Thread 异步读取 stdout/stderr，防止管道死锁
  - 10 秒心跳看门狗: 无输出即杀进程重启
  - 显式传递 env=os.environ.copy() 确保 API Key 可达
  - 添加 [DEBUG] Worker PID 输出
"""

import os
import sys
import time
import json
import glob
import shutil
import signal
import subprocess
import threading
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

# ── Watchdog Configuration ──────────────────────────────────────────────
WORKER_WATCHDOG_TIMEOUT = 10        # 10 秒无 stdout 输出即杀进程
WORKER_HARD_TIMEOUT = 300           # 硬超时 5 分钟（防止无限挂起）
WORKER_EXECUTOR_MODULE = "worker.executor"

N8N_CALLBACK_URL = os.environ.get("N8N_CALLBACK_URL", "")

# OS-native kill signal / command
IS_WINDOWS = sys.platform == "win32"


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
    """跨平台安全的文件移动：先复制再删除，避免 Windows 文件锁冲突。"""
    dst = os.path.join(dst_dir, os.path.basename(src))
    # 复制内容
    with open(src, "r", encoding="utf-8") as fsrc:
        content = fsrc.read()
    os.makedirs(dst_dir, exist_ok=True)
    with open(dst, "w", encoding="utf-8") as fdst:
        fdst.write(content)
    # 删除源文件（带重试）
    for attempt in range(5):
        try:
            os.remove(src)
            break
        except PermissionError:
            time.sleep(0.2 * (attempt + 1))
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


# ══════════════════════════════════════════════════════════════════════════════
#  Worker Subprocess Manager — Popen + 异步读取 + 10s 看门狗
# ══════════════════════════════════════════════════════════════════════════════

def _force_kill_worker(proc: subprocess.Popen, label: str = ""):
    """
    Forcefully kill a Worker subprocess and its entire process tree.
    平台安全: 永远通过 PID 杀死，绝不使用镜像名 (如 taskkill /F /IM python.exe)
    """
    if proc is None or proc.poll() is not None:
        return

    pid = proc.pid
    print(f"[task_listener] Watchdog: killing {label} Worker PID {pid}")

    try:
        if IS_WINDOWS:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=10,
            )
        else:
            os.kill(pid, signal.SIGKILL)
    except Exception as e:
        print(f"[task_listener] ⚠️ Kill PID {pid} failed, trying proc.kill(): {e}")
        try:
            proc.kill()
        except Exception:
            pass

    # Wait for reaping
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        print(f"[task_listener] ⚠️ Worker PID {pid} did not exit after kill")


def _launch_worker_subprocess(plan: dict, circuit_breaker_enabled: bool = False) -> dict | None:
    """
    Launch the Worker executor as a standalone subprocess with:
      - Popen + PIPE for stdin/stdout/stderr
      - threading.Thread to read stdout/stderr asynchronously (prevents pipe deadlock)
      - 10s watchdog that kills the process if no stdout line arrives
      - 300s hard timeout
      - Explicit env=os.environ.copy() for API keys

    Returns:
        Parsed result dict on success, None on failure/timeout.
    """
    worker_cmd = [
        sys.executable, "-m", WORKER_EXECUTOR_MODULE,
    ]

    # Build the input payload
    input_payload = json.dumps({
        "plan": plan,
        "circuit_breaker_enabled": circuit_breaker_enabled,
    }, ensure_ascii=False)

    # ── 显式传递环境变量 ──────────────────────────────────────────────
    worker_env = os.environ.copy()

    # Launch
    try:
        proc = subprocess.Popen(
            worker_cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=PROJECT_ROOT,
            env=worker_env,
            text=True,
            bufsize=1,  # line-buffered
        )
    except Exception as e:
        print(f"[task_listener] ❌ Failed to spawn Worker process: {e}")
        return None

    # ── 关键调试输出 ──────────────────────────────────────────────────
    print(f"[DEBUG] Worker PID: {proc.pid} started  (module={WORKER_EXECUTOR_MODULE})")
    sys.stdout.flush()

    # ── 异步读取 stdout / stderr ─────────────────────────────────────
    stdout_lines: list[str] = []
    stderr_lines: list[str] = []
    last_stdout_time = time.time()
    result_data: dict | None = None
    read_lock = threading.Lock()
    stop_reading = threading.Event()

    def _read_stdout():
        nonlocal last_stdout_time, result_data
        try:
            for line in proc.stdout:
                if stop_reading.is_set():
                    break
                line = line.rstrip()
                with read_lock:
                    stdout_lines.append(line)
                    last_stdout_time = time.time()
                # Try to parse the result line early
                if not result_data:
                    try:
                        candidate = json.loads(line)
                        if candidate.get("status") in ("ok", "error"):
                            result_data = candidate
                    except json.JSONDecodeError:
                        pass
        except Exception:
            pass

    def _read_stderr():
        try:
            for line in proc.stderr:
                if stop_reading.is_set():
                    break
                line = line.rstrip()
                with read_lock:
                    stderr_lines.append(line)
                # Print stderr as debug output
                print(f"[Worker-stderr] {line}")
                sys.stdout.flush()
        except Exception:
            pass

    stdout_thread = threading.Thread(target=_read_stdout, daemon=True)
    stderr_thread = threading.Thread(target=_read_stderr, daemon=True)
    stdout_thread.start()
    stderr_thread.start()

    # ── 通过 stdin 注入 Plan ──────────────────────────────────────────
    try:
        proc.stdin.write(input_payload)
        proc.stdin.close()
    except Exception as e:
        print(f"[task_listener] ❌ Failed to write plan to Worker stdin: {e}")
        _force_kill_worker(proc, "stdin-error")
        stop_reading.set()
        return None

    # ── 看门狗轮询: 10s 无 stdout 则杀进程 ───────────────────────────
    start_time = time.time()
    last_kill_restart = False
    killed_once = False

    while proc.poll() is None:
        elapsed = time.time() - start_time

        # 硬超时
        if elapsed > WORKER_HARD_TIMEOUT:
            print(f"[task_listener] ⚠️ Worker PID {proc.pid} hard timeout ({WORKER_HARD_TIMEOUT}s), killing")
            _force_kill_worker(proc, "hard-timeout")
            stop_reading.set()
            return None

        # 软看门狗: 10 秒无 stdout → 杀
        with read_lock:
            idle = time.time() - last_stdout_time

        if idle > WORKER_WATCHDOG_TIMEOUT and not killed_once:
            print(f"[task_listener] ⚠️ Worker PID {proc.pid} silent for {idle:.0f}s (> {WORKER_WATCHDOG_TIMEOUT}s), restarting!")
            _force_kill_worker(proc, "watchdog-silent")
            killed_once = True

            # Drain reader threads
            stop_reading.set()
            stdout_thread.join(timeout=2)
            stderr_thread.join(timeout=2)

            # Retry: spawn a fresh worker
            print(f"[task_listener] 🔄 Re-launching Worker (retry 1/1)...")
            return _launch_worker_subprocess(plan, circuit_breaker_enabled)

        # If we already got a result, we can stop early
        if result_data:
            break

        time.sleep(0.1)

    # After loop — either process exited or result_data is set
    stop_reading.set()
    stdout_thread.join(timeout=3)
    stderr_thread.join(timeout=3)

    # If process exited without result, check exit code
    if result_data is None:
        exit_code = proc.returncode
        with read_lock:
            all_stdout = "\n".join(stdout_lines[-20:])
            all_stderr = "\n".join(stderr_lines[-20:])

        if exit_code != 0:
            print(f"[task_listener] ❌ Worker PID {proc.pid} exited with code {exit_code}")
            print(f"[task_listener] Last stdout (20 lines):\n{all_stdout}")
            print(f"[task_listener] Last stderr (20 lines):\n{all_stderr}")
            return None

        # Try to parse the last stdout line as JSON
        for line in reversed(stdout_lines):
            try:
                candidate = json.loads(line)
                if candidate.get("status") in ("ok", "error"):
                    result_data = candidate
                    break
            except json.JSONDecodeError:
                continue

    # ── 处理结果 ──────────────────────────────────────────────────────
    if result_data is None:
        print(f"[task_listener] ❌ Worker PID {proc.pid} produced no valid result JSON")
        return None

    if result_data.get("status") == "ok":
        return result_data.get("result")
    else:
        error_msg = result_data.get("error", "Unknown worker error")
        print(f"[task_listener] ❌ Worker PID {proc.pid} error: {error_msg}")
        return None


# ══════════════════════════════════════════════════════════════════════════════
#  Task Processing — GitHub Issues & Local Files
# ══════════════════════════════════════════════════════════════════════════════

def process_github_issue(issue: dict) -> bool:
    """
    Process a GitHub Issue through the HQ → Worker → Safety pipeline.

    This is the Phase 5+ cross-plane integration: GitHub Issues (Cloud Plane)
    are ingested by the local factory (Local Plane) and executed via the
    full three-stage pipeline.

    Args:
        issue: GitHub Issue dict (from github_issue.list_open_issues())

    Returns:
        True if the issue was successfully processed and closed, False otherwise.
    """
    issue_number = issue.get("number", 0)
    issue_title = issue.get("title", "Untitled Issue")
    issue_body = issue.get("body", "")

    # Extract goal from Issue body
    goal = issue_body_to_goal(issue_body)
    if not goal or len(goal) < 3:
        print(f"[task_listener] ⚠️  GitHub Issue #{issue_number}: body is empty or too short, skipping")
        return False

    # Assign Issue URL as external reference
    issue_url = issue.get("html_url", "")

    print(f"\n{'='*60}")
    print(f"[task_listener] 🌐 GitHub Issue #{issue_number}: {issue_title[:80]}")
    print(f"[task_listener]    Goal: {goal[:120]}")
    print(f"[task_listener]    URL:  {issue_url}")
    print(f"{'='*60}")

    # ── Phase 1: Risk Check ─────────────────────────────────────────
    try:
        from risk_manager import RiskManager
        rm = RiskManager()
        is_safe, message = rm.evaluate_task(goal)
        if not is_safe:
            log_content = f"RISK BLOCKED: {message}\nSource: GitHub Issue #{issue_number}\n{issue_url}"
            write_task_log(f"ISSUE-{issue_number}", log_content)
            write_status_report(f"ISSUE-{issue_number}", "BLOCKED", {"error": message, "issue_url": issue_url})
            try:
                from github_issue import add_issue_comment
                add_issue_comment(issue_number,
                    f"⚠️ **RiskManager 已拦截此任务**\n\n"
                    f"原因: {message}\n\n"
                    f"此任务需要人工审核后才能执行。请修正 Issue Body 中的高风险操作后重新 Open。")
            except Exception:
                pass
            return False
    except ImportError:
        print("[task_listener] RiskManager not available, skipping risk check")
    except Exception as e:
        print(f"[task_listener] Risk check error: {e}")

    # ── Phase 2: HQ → Generate Plan (Claude API) ────────────────────
    log_lines = []
    log_lines.append(f"Source: GitHub Issue #{issue_number}")
    log_lines.append(f"URL: {issue_url}")
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
        write_task_log(f"ISSUE-{issue_number}", "\n".join(log_lines))
        write_status_report(f"ISSUE-{issue_number}", "FAILED", {"error": "HQ module not found"})
        return False
    except Exception as e:
        log_lines.append(f"[HQ] Error: {e}")
        write_task_log(f"ISSUE-{issue_number}", "\n".join(log_lines))
        write_status_report(f"ISSUE-{issue_number}", "FAILED", {"error": str(e)})
        return False

    if plan.get("status") == "error":
        log_lines.append(f"[HQ] Plan error: {plan.get('error')}")
        write_task_log(f"ISSUE-{issue_number}", "\n".join(log_lines))
        write_status_report(f"ISSUE-{issue_number}", "FAILED", {"error": plan.get("error")})
        return False

    task_id = plan.get("task_id", f"ISSUE-{issue_number}")

    # ── Phase 3: Worker → Execute Plan via Subprocess (DeepSeek API) ─
    execution_status = "FAILED"
    aggregate_output = {}

    try:
        log_lines.append("[Worker] Starting execution via subprocess (Popen)...")

        result = _launch_worker_subprocess(plan, circuit_breaker_enabled=True)

        if result:
            log_lines.append(f"[Worker] Status: {result.get('status')}")
            log_lines.append(f"[Worker] Steps: {result.get('steps_completed')}/{result.get('steps_total')}")
            log_lines.append(f"[Worker] Aggregate: {json.dumps(result.get('aggregate_output', {}), indent=2, default=str)}")

            execution_status = "SUCCESS" if result.get("status") == "success" else "PARTIAL"
            aggregate_output = result.get("aggregate_output", {})
        else:
            log_lines.append("[Worker] Execution failed (subprocess returned no result)")
            execution_status = "FAILED"
            aggregate_output = {}

        write_status_report(task_id, execution_status, detail=aggregate_output)

    except Exception as e:
        log_lines.append(f"[Worker] Execution error: {e}")
        write_status_report(task_id, "FAILED", {"error": str(e)})

    # ── Write log ────────────────────────────────────────────────────
    log_path = write_task_log(task_id, "\n".join(log_lines))
    send_callback(task_id)

    # ── Phase 4: Close GitHub Issue & Post Delivery Comment ──────────
    try:
        from github_issue import close_issue_with_comment

        delivery_dir = os.path.join(PROJECT_ROOT, "deliveries")
        delivery_file = os.path.join(delivery_dir, f"delivery_{task_id}.json")

        comment_parts = [
            f"## 🏭 Maneki-AI 工厂执行报告",
            f"",
            f"**任务状态**: {execution_status}",
            f"**任务 ID**: {task_id}",
            f"**HQ 计划步骤数**: {len(plan.get('steps', []))}",
            f"",
        ]

        for s in plan.get("steps", []):
            comment_parts.append(f"- **Step {s.get('step')}**: {s.get('action')} — {s.get('description', '')}")

        comment_parts.append("")

        if aggregate_output:
            comment_parts.append("### 📦 聚合输出")
            comment_parts.append(f"```json")
            comment_parts.append(json.dumps(aggregate_output, indent=2, ensure_ascii=False, default=str)[:2000])
            comment_parts.append(f"```")

        comment_parts.append("")
        comment_parts.append(f"### 📋 交付物")
        if os.path.exists(delivery_file):
            comment_parts.append(f"✅ 交付物已生成: `{delivery_file}`")
        else:
            comment_parts.append(f"⚠️ 交付物文件未找到: `{delivery_file}`")

        comment_parts.append(f"")
        comment_parts.append(f"### 📝 执行日志")
        comment_parts.append(f"日志路径: `{log_path}`")
        comment_parts.append(f"")
        comment_parts.append(f"---")
        comment_parts.append(f"*由 Maneki-AI Factory OS v0.5.0-crossplane 自动执行*")

        comment = "\n".join(comment_parts)

        close_result = close_issue_with_comment(issue_number, comment)
        print(f"[task_listener] ✅ GitHub Issue #{issue_number} closed: {close_result.get('status')}")

    except ImportError:
        print(f"[task_listener] ⚠️  github_issue module not available; Issue #{issue_number} remains open")
        return False
    except Exception as e:
        print(f"[task_listener] ⚠️  Failed to close Issue #{issue_number}: {e}")
        return True

    print(f"[task_listener] Task {task_id} (GitHub Issue #{issue_number}) completed.")
    return True


def issue_body_to_goal(issue_body: str) -> str:
    """
    Extract the business goal from a GitHub Issue body.

    Supports markdown format: extracts first heading or first meaningful line.
    """
    if not issue_body or not issue_body.strip():
        return ""

    lines = issue_body.strip().split("\n")
    goal = lines[0].strip()

    # Strip markdown heading markers
    if goal.startswith("#"):
        goal = goal.lstrip("#").strip()

    # If first line is too short, take the entire body (up to 500 chars)
    if len(goal) < 5 and len(lines) > 1:
        goal = issue_body.strip()[:500]

    return goal


def fetch_and_process_github_issues(processed_issues: set) -> int:
    """
    Poll GitHub for open Issues and process any new ones.

    This is the highest-priority task source — remote cloud Issues are processed
    BEFORE local file-system pending tasks.

    Args:
        processed_issues: Set of already-processed issue numbers (prevents re-processing)

    Returns:
        Number of issues successfully processed in this cycle.
    """
    try:
        from github_issue import list_open_issues, get_rate_limit_status
    except ImportError:
        if not hasattr(fetch_and_process_github_issues, "_warned"):
            print("[task_listener] ⚠️  github_issue module not available; GitHub polling disabled")
            fetch_and_process_github_issues._warned = True
        return 0

    rl = get_rate_limit_status()
    if rl.get("is_exhausted", False):
        reset_in = rl.get("reset_in_seconds", 60)
        print(f"[task_listener] ⏱️  GitHub API rate limit exhausted (resets in {reset_in}s); skipping Issue poll")
        return 0

    try:
        issues = list_open_issues()
    except Exception as e:
        print(f"[task_listener] ⚠️  GitHub Issue poll failed: {e}")
        return 0

    if not issues:
        return 0

    processed_count = 0
    for issue in issues:
        issue_number = issue.get("number", 0)

        if "pull_request" in issue:
            continue

        if issue_number in processed_issues:
            continue

        processed_issues.add(issue_number)

        success = process_github_issue(issue)
        if success:
            processed_count += 1

    return processed_count


def process_task(task_path):
    """Process a single task through HQ → Worker → Safety pipeline via subprocess."""
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

    # ── Phase 1: Risk Check ──────────────────────────────────────────
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

    # ── Phase 3: Worker → Execute Plan via Subprocess (DeepSeek API) ─
    try:
        log_lines.append("[Worker] Starting execution via subprocess (Popen)...")

        result = _launch_worker_subprocess(plan, circuit_breaker_enabled=True)

        if result:
            log_lines.append(f"[Worker] Status: {result.get('status')}")
            log_lines.append(f"[Worker] Steps: {result.get('steps_completed')}/{result.get('steps_total')}")
            log_lines.append(f"[Worker] Aggregate: {json.dumps(result.get('aggregate_output', {}), indent=2, default=str)}")

            status = "SUCCESS" if result.get("status") == "success" else "PARTIAL"
            write_status_report(task_id, status, detail=result.get("aggregate_output"))

            # ── Step 5 构建成功 → WebSocket 广播通知 ─────────────────
            for sr in result.get("steps_results", []):
                if sr.get("action") == "build_artifact":
                    build_out = sr.get("result", {}).get("output", {})
                    if build_out.get("success_status"):
                        artifact_path = build_out.get("output_path", "unknown")
                        msg = {
                            "type": "app_build_success",
                            "task_id": task_id,
                            "artifact_path": artifact_path,
                            "build_command": build_out.get("build_command", ""),
                            "message": f"🏭 [APP 生成成功] 构建产物: {artifact_path}",
                            "timestamp": timestamp(),
                        }
                        log_lines.append(f"[WebSocket] APP 生成成功 → {artifact_path}")
                        try:
                            from urllib.request import Request, urlopen
                            data = json.dumps(msg).encode("utf-8")
                            req = Request(
                                "http://localhost:8000/api/broadcast",
                                data=data,
                                headers={"Content-Type": "application/json"},
                                method="POST",
                            )
                            urlopen(req, timeout=5)
                        except Exception:
                            pass
                        break
        else:
            log_lines.append("[Worker] Execution failed (subprocess returned no result)")
            write_status_report(task_id, "FAILED", {"error": "Worker subprocess returned no result"})

    except Exception as e:
        log_lines.append(f"[Worker] Execution error: {e}")
        write_status_report(task_id, "FAILED", {"error": str(e)})

    # ── Write log and complete ───────────────────────────────────────
    write_task_log(task_id, "\n".join(log_lines))
    send_callback(task_id)
    move_file(processing_path, COMPLETED_DIR)
    print(f"[task_listener] Task {task_id} completed.")


def main():
    print("[task_listener] Maneki-AI Task Listener (Phase 5.1+ Anti-Freeze Subprocess)")
    print(f"[task_listener] Watching Local: {PENDING_DIR}")
    print(f"[task_listener] Watching Remote: github.com/winsentrobot008/DevDirector-Tasks (Open Issues)")
    print(f"[task_listener] Poll interval: {POLL_INTERVAL}s")
    print(f"[task_listener] Watchdog: {WORKER_WATCHDOG_TIMEOUT}s silence → kill & restart")
    print(f"[task_listener] Hard timeout: {WORKER_HARD_TIMEOUT}s")
    if N8N_CALLBACK_URL:
        print(f"[task_listener] Callback: {N8N_CALLBACK_URL}")
    else:
        print("[task_listener] Callback: DISABLED")

    ensure_directories()
    known_tasks = set()
    processed_github_issues = set()

    try:
        while True:
            # ── PRIORITY 1: GitHub Issues (Cross-Plane Cloud Tasks) ──
            gh_processed = fetch_and_process_github_issues(processed_github_issues)
            if gh_processed > 0:
                print(f"[task_listener] 🌐 Processed {gh_processed} GitHub Issue(s) this cycle")

            # ── PRIORITY 2: Local File-System pending/ Tasks ──────────
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