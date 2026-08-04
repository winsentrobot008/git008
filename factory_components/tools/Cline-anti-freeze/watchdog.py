#!/usr/bin/env python3
"""
watchdog.py — Anti-Hang Watchdog & Context-Preserving Crash Recovery
====================================================================
Implements:
  Rule 2 (Article 1.2): Anti-Hang Watchdog — any task execution or loop exceeding 30 seconds
          of inactivity is flagged as "Stuck". Self-diagnostic + clean restart.
  Rule 3 (Article 1.2): Context-Preserving Crash Recovery — before a process is forcefully
          killed, dump current memory state/context to a file to prevent total data loss.
  Rule 4 (Article 1.5 §2): The Guillotine Rule — on fuse trip or abnormal exit, force-kill
          all session PIDs with taskkill /F /T (Win32) / SIGKILL (Unix). No zombie terminals.

Usage:
    watchdog = Watchdog(task_id="task_xxx", timeout=30.0)
    watchdog.start()
    try:
        # ... do work ...
        watchdog.ping()  # call periodically to reset inactivity timer
    except Exception:
        watchdog.dump_state("error", {"exception": str(e)})
        raise
    finally:
        watchdog.stop()
"""

import os
import sys
import json
import time
import signal
import threading
import traceback
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Optional, Any, Callable

# ── Paths ──────────────────────────────────────────────────────
THIS_DIR = Path(__file__).resolve().parent
GOVERNANCE_LOGS_DIR = THIS_DIR / "governance_logs"
STATE_DUMP_DIR = GOVERNANCE_LOGS_DIR / "crash_dumps"
DIAGNOSTIC_LOG = GOVERNANCE_LOGS_DIR / "watchdog_diagnostics.json"

GOVERNANCE_LOGS_DIR.mkdir(parents=True, exist_ok=True)
STATE_DUMP_DIR.mkdir(parents=True, exist_ok=True)

# ── Default timeout ────────────────────────────────────────────
DEFAULT_INACTIVITY_TIMEOUT = 30.0  # seconds


class Watchdog:
    """
    Anti-Hang Watchdog for agent task execution.
    
    Monitors task progress and flags inactivity exceeding the timeout.
    On hang detection: runs self-diagnostic, dumps state, then triggers
    the hang_callback for recovery.
    """

    def __init__(
        self,
        task_id: str,
        timeout: float = DEFAULT_INACTIVITY_TIMEOUT,
        hang_callback: Optional[Callable] = None,
        agent_signature: Optional[str] = None,
        module: str = "unknown",
        context: Optional[dict] = None,
    ):
        self.task_id = task_id
        self.timeout = timeout
        self.hang_callback = hang_callback
        self.agent_signature = agent_signature
        self.module = module
        self.context = context or {}

        self._last_activity = time.time()
        self._start_time = time.time()
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._hang_detected = False
        self._lock = threading.Lock()

    # ── Public API ────────────────────────────────────────────

    def start(self):
        """Start the watchdog monitor thread."""
        if self._thread is not None:
            return
        self._stop_event.clear()
        self._last_activity = time.time()
        self._start_time = time.time()
        self._thread = threading.Thread(
            target=self._monitor_loop,
            daemon=True,
            name=f"watchdog-{self.task_id[:12]}",
        )
        self._thread.start()

    def stop(self):
        """Stop the watchdog monitor thread."""
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=3.0)
            self._thread = None

    def ping(self):
        """Reset the inactivity timer. Call this after any meaningful progress."""
        with self._lock:
            self._last_activity = time.time()

    def dump_state(self, status: str, extra: Optional[dict] = None):
        """
        Dump current execution context to a crash dump file (Rule 3).
        
        Args:
            status: One of "error", "hang", "crash", "recovery"
            extra: Additional context to include in the dump
        """
        state = {
            "task_id": self.task_id,
            "agent_signature": self.agent_signature,
            "module": self.module,
            "status": status,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "uptime_seconds": round(time.time() - self._start_time, 2),
            "last_activity_ago_sec": round(time.time() - self._last_activity, 2),
            "timeout_sec": self.timeout,
            "context": self.context,
            "extra": extra or {},
            "threads": self._capture_threads_info(),
        }

        # Write to crash dump file
        dump_filename = f"crash_{self.task_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        dump_path = STATE_DUMP_DIR / dump_filename
        try:
            dump_path.write_text(
                json.dumps(state, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError as e:
            print(f"[watchdog] Failed to write crash dump: {e}")

        # Append to diagnostic log
        self._append_diagnostic(state)

        return dump_path

    def is_hung(self) -> bool:
        """Check if the watchdog has detected a hang."""
        return self._hang_detected

    def get_elapsed(self) -> float:
        """Seconds since watchdog start."""
        return time.time() - self._start_time

    def get_idle_seconds(self) -> float:
        """Seconds since last ping."""
        with self._lock:
            return time.time() - self._last_activity

    # ── Internal ──────────────────────────────────────────────

    def _monitor_loop(self):
        """Background loop that checks inactivity periodically."""
        check_interval = min(self.timeout / 3, 10.0)  # Check ~3x per timeout period

        while not self._stop_event.is_set():
            time.sleep(check_interval)

            if self._stop_event.is_set():
                break

            idle = self.get_idle_seconds()
            if idle > self.timeout and not self._hang_detected:
                self._hang_detected = True
                self._on_hang_detected(idle)

    def _on_hang_detected(self, idle_seconds: float):
        """Called when a hang is detected. Runs self-diagnostic and triggers callback."""
        hang_time = datetime.now(timezone.utc).isoformat()
        print(f"[watchdog] 🚨 HANG DETECTED | Task: {self.task_id} | Idle: {idle_seconds:.1f}s | Timeout: {self.timeout}s")

        # 1. Run self-diagnostic
        diagnostic = self._run_self_diagnostic(idle_seconds)

        # 2. Dump state (Rule 3 — context-preserving crash recovery)
        dump_path = self.dump_state("hang", {
            "idle_seconds": idle_seconds,
            "diagnostic": diagnostic,
        })

        # 3. Log to error_reporter
        try:
            sys.path.insert(0, str(THIS_DIR))
            from error_reporter import report_error
            report_error(
                module=self.module,
                exception=TimeoutError(
                    f"Task {self.task_id} hung: no activity for {idle_seconds:.1f}s "
                    f"(timeout={self.timeout}s). State dumped to {dump_path}"
                ),
                context={
                    "task_id": self.task_id,
                    "idle_seconds": idle_seconds,
                    "agent_signature": self.agent_signature,
                    "dump_path": str(dump_path),
                    "diagnostic": diagnostic,
                },
                severity="CRITICAL",
                task_id=self.task_id,
                agent_signature=self.agent_signature,
            )
        except ImportError:
            pass  # error_reporter not available

        # 4. Invoke hang callback for recovery
        if self.hang_callback:
            try:
                self.hang_callback({
                    "task_id": self.task_id,
                    "idle_seconds": idle_seconds,
                    "diagnostic": diagnostic,
                    "dump_path": str(dump_path),
                })
            except Exception as cb_err:
                print(f"[watchdog] Hang callback failed: {cb_err}")

    def _run_self_diagnostic(self, idle_seconds: float) -> Dict:
        """
        Run a self-diagnostic: captures thread stack traces, system state,
        and environment variables.
        """
        threads_info = self._capture_threads_info()

        diagnostic = {
            "detected_at": datetime.now(timezone.utc).isoformat(),
            "idle_seconds": idle_seconds,
            "timeout_sec": self.timeout,
            "task_id": self.task_id,
            "agent_signature": self.agent_signature,
            "threads": threads_info,
            "system": {
                "python_version": sys.version,
                "platform": sys.platform,
                "cwd": os.getcwd(),
            },
        }

        # Append to the diagnostic log
        self._append_diagnostic(diagnostic)

        return diagnostic

    def _capture_threads_info(self) -> list:
        """Capture stack traces for all active threads."""
        threads_info = []
        for thread_id, frame in sys._current_frames().items():
            stack = traceback.format_stack(frame)
            threads_info.append({
                "thread_id": thread_id,
                "thread_name": threading._active.get(thread_id, threading.Thread()).name
                if thread_id in threading._active else str(thread_id),
                "stack": "".join(stack[-15:]) if stack else "No stack",
            })
        return threads_info

    def _append_diagnostic(self, data: dict):
        """Append a diagnostic entry to the JSON log file."""
        try:
            if DIAGNOSTIC_LOG.exists():
                diag_data = json.loads(DIAGNOSTIC_LOG.read_text(encoding="utf-8"))
            else:
                diag_data = {"version": "1.0", "entries": []}

            diag_data["entries"].append({
                "timestamp": datetime.now(timezone.utc).isoformat(),
                **data,
            })
            # Keep only last 500 entries
            if len(diag_data["entries"]) > 500:
                diag_data["entries"] = diag_data["entries"][-500:]

            DIAGNOSTIC_LOG.write_text(
                json.dumps(diag_data, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError:
            pass


def create_clean_restart_plan(dump_path: Path) -> dict:
    """
    Generate a clean restart plan from a crash dump (Rule 3 recovery).
    
    Reads the dumped state and produces a recovery plan including
    what needs to be re-initialized and what context to restore.
    """
    if not dump_path.exists():
        return {"error": f"Dump file not found: {dump_path}"}

    try:
        state = json.loads(dump_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        return {"error": f"Failed to read dump: {e}"}

    plan = {
        "task_id": state.get("task_id"),
        "agent_signature": state.get("agent_signature"),
        "module": state.get("module"),
        "failure_status": state.get("status"),
        "failure_timestamp": state.get("timestamp"),
        "uptime_at_failure_sec": state.get("uptime_seconds"),
        "restart_action": "reinitialize",
        "context_to_restore": state.get("context", {}),
        "extra_state": state.get("extra", {}),
    }

    # If the failed module was a LiveAgent, the plan includes re-init
    if state.get("module") in ("task_scheduler", "live_agent"):
        plan["restart_action"] = "kill_and_reinitialize_agent"
        plan["steps"] = [
            "1. Kill zombie agent process",
            "2. Clear stale agent_data/ locks",
            "3. Re-initialize LiveAgent with saved context",
            "4. Retry task from last known state",
        ]
    else:
        plan["steps"] = [
            "1. Kill stalled sub-process",
            "2. Reset watchdog timer",
            "3. Retry operation",
        ]

    return plan


def kill_zombie_process(pid: int) -> bool:
    """Force-kill a zombie/stuck process (cross-platform)."""
    try:
        if sys.platform == "win32":
            import subprocess as sp
            result = sp.run(
                ["taskkill", "/F", "/PID", str(pid)],
                capture_output=True, text=True, timeout=10,
            )
            return result.returncode == 0
        else:
            os.kill(pid, signal.SIGKILL)
            return True
    except (OSError, subprocess.TimeoutExpired) as e:
        print(f"[watchdog] Failed to kill PID {pid}: {e}")
        return False


# ============================================================
# Article 1.5 §2 — The Guillotine Rule (熔断挥刀机制)
# ============================================================

def guillotine_kill_all(
    task_id: str,
    session_id: Optional[str] = None,
    context: Optional[dict] = None,
    agent_signature: Optional[str] = None,
    module: str = "unknown",
) -> Dict:
    """
    熔断挥刀机制 — Article 1.5 §2 The Guillotine Rule。

    当触发反卡死熔断或异常退出时，强制向该会话占用的所有底层 PID
    发送 SIGKILL / taskkill 信号，不留任何 Warning 标记的挂起僵尸终端。

    Steps:
    1. 读取 .instance_registry.json 获取当前 Instance 关联的所有 PID
    2. dump_state() 保留上下文崩溃恢复快照
    3. 使用 taskkill /F /T (Win32) 或 SIGKILL (Unix) 强制终止进程树
    4. 从注册表中移除已终止的条目
    5. 返回完整绞杀报告

    Args:
        task_id: 触发熔断的任务 ID
        session_id: 可选的会话 ID，用于进一步限定进程范围
        context: 可选的上下文信息，用于崩溃快照
        agent_signature: 代理签名
        module: 触发熔断的模块名

    Returns:
        绞杀报告字典
    """
    import subprocess as sp

    report = {
        "action": "guillotine_kill_all",
        "task_id": task_id,
        "session_id": session_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "killed_pids": [],
        "failed_pids": [],
        "dump_path": None,
        "status": "completed",
    }

    # ── Step 1: Dump crash recovery snapshot (context-preserving) ──
    try:
        # Create a minimal Watchdog instance just for state dumping
        dump_wd = Watchdog(
            task_id=task_id,
            agent_signature=agent_signature,
            module=module,
            context={
                "guillotine_triggered": True,
                "session_id": session_id,
                **(context or {}),
            },
        )
        dump_path = dump_wd.dump_state("guillotine", {
            "kill_action": "force_terminate_all",
            "reason": "Article 1.5 §2 — The Guillotine Rule triggered",
        })
        report["dump_path"] = str(dump_path) if dump_path else None
    except Exception as e:
        report["dump_error"] = str(e)

    # ── Step 2: Gather all PIDs to kill ──
    pids_to_kill = set()

    # 2a. Load instance registry
    registry_path = THIS_DIR / ".instance_registry.json"
    try:
        if registry_path.exists():
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            for inst_id, info in registry.items():
                pid = info.get("pid")
                if pid is not None:
                    pids_to_kill.add(pid)
    except Exception as e:
        report["registry_error"] = str(e)

    # 2b. Add current process PID
    pids_to_kill.add(os.getpid())

    # 2c. Add any session-specific PIDs from instance_registry matching session_id
    if session_id:
        try:
            if registry_path.exists():
                registry = json.loads(registry_path.read_text(encoding="utf-8"))
                for inst_id, info in registry.items():
                    if session_id in inst_id or session_id == info.get("hostname", ""):
                        pid = info.get("pid")
                        if pid is not None:
                            pids_to_kill.add(pid)
        except Exception:
            pass

    # ── Step 3: Force-kill each PID with tree termination ──
    for pid in sorted(pids_to_kill):
        try:
            if pid == os.getpid():
                # Skip self — we'll kill self last
                continue

            if sys.platform == "win32":
                # /F = force, /T = terminate process tree
                result = sp.run(
                    ["taskkill", "/F", "/T", "/PID", str(pid)],
                    capture_output=True, text=True, timeout=10,
                )
                if result.returncode == 0:
                    report["killed_pids"].append({
                        "pid": pid,
                        "method": "taskkill /F /T",
                        "output": result.stdout.strip(),
                    })
                else:
                    report["failed_pids"].append({
                        "pid": pid,
                        "method": "taskkill /F /T",
                        "error": result.stderr.strip(),
                    })
            else:
                # Unix: kill the process group with SIGKILL
                try:
                    os.killpg(os.getpgid(pid), signal.SIGKILL)
                except (ProcessLookupError, OSError):
                    os.kill(pid, signal.SIGKILL)
                report["killed_pids"].append({
                    "pid": pid,
                    "method": "SIGKILL",
                })
        except Exception as e:
            report["failed_pids"].append({
                "pid": pid,
                "method": "taskkill/SIGKILL",
                "error": str(e),
            })

    # ── Step 4: Clean registry entries ──
    try:
        if registry_path.exists():
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            killed_ids = []
            for inst_id, info in list(registry.items()):
                pid = info.get("pid")
                if pid in pids_to_kill:
                    killed_ids.append(inst_id)
                    registry[inst_id]["status"] = "guillotine_terminated"
                    registry[inst_id]["terminated_at"] = datetime.now(timezone.utc).isoformat()
            registry_path.write_text(
                json.dumps(registry, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            report["registry_cleaned"] = killed_ids
    except Exception as e:
        report["registry_clean_error"] = str(e)

    # ── Step 5: Kill self last ──
    # (Note: the calling code should handle self-termination)
    report["self_pid"] = os.getpid()
    report["self_kill_pending"] = True

    print(
        f"[watchdog] 🗡️ GUILLOTINE EXECUTED | Task: {task_id} | "
        f"Killed: {len(report['killed_pids'])} PIDs | "
        f"Failed: {len(report['failed_pids'])}"
    )

    return report