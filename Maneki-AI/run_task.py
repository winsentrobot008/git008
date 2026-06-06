#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
run_task.py — Standalone task runner for Maneki-AI.

Reads commands.json and executes the corresponding CLI command via subprocess.
This is NOT a VS Code plugin. It is a standalone Python script.
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone


def load_registry(registry_path: str = "commands.json") -> dict:
    """Load the task registry from commands.json."""
    if not os.path.exists(registry_path):
        print(f"[ERROR] Registry file not found: {registry_path}", file=sys.stderr)
        sys.exit(1)
    with open(registry_path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_task_command(registry: dict, task_name: str) -> dict | None:
    """Look up a task by name in the registry."""
    tasks = registry.get("tasks", {})
    return tasks.get(task_name)


def execute_command(command: str, timeout: int = 300, cwd: str | None = None) -> dict:
    """Execute a CLI command using subprocess and return the result."""
    cwd = cwd or os.getcwd()
    start_time = datetime.now(timezone.utc)

    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=cwd,
            timeout=timeout,
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )
        return {
            "command": command,
            "returncode": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "success": result.returncode == 0,
            "started_at": start_time.isoformat(),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }
    except subprocess.TimeoutExpired:
        return {
            "command": command,
            "returncode": -1,
            "stdout": "",
            "stderr": f"Command timed out after {timeout} seconds",
            "success": False,
            "started_at": start_time.isoformat(),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        return {
            "command": command,
            "returncode": -1,
            "stdout": "",
            "stderr": str(e),
            "success": False,
            "started_at": start_time.isoformat(),
            "finished_at": datetime.now(timezone.utc).isoformat(),
        }


def write_log(result: dict, task_name: str, log_dir: str = "logs") -> None:
    """Write execution log to the logs directory."""
    os.makedirs(log_dir, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    log_file = os.path.join(log_dir, f"run_task_{task_name}_{timestamp}.json")
    with open(log_file, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"[LOG] Execution log written to: {log_file}")


def print_result(result: dict) -> None:
    """Print execution result to stdout."""
    status = "SUCCESS" if result["success"] else "FAILED"
    print(f"\n{'='*60}")
    print(f"  Task Status: {status}")
    print(f"  Command:     {result['command']}")
    print(f"  Return Code: {result['returncode']}")
    print(f"{'='*60}")
    if result["stdout"]:
        print("\n[STDOUT]")
        print(result["stdout"])
    if result["stderr"]:
        print("\n[STDERR]")
        print(result["stderr"])
    print(f"{'='*60}\n")


def main():
    if len(sys.argv) < 2:
        print("Usage: python run_task.py <task_name> [--log]", file=sys.stderr)
        print("")
        print("Available tasks:")
        registry = load_registry()
        for task_name, task_info in registry.get("tasks", {}).items():
            desc = task_info.get("description", "No description")
            print(f"  {task_name:15s}  {desc}")
        sys.exit(1)

    task_name = sys.argv[1]
    write_log_flag = "--log" in sys.argv

    registry = load_registry()
    task = get_task_command(registry, task_name)

    if task is None:
        print(f"[ERROR] Unknown task: '{task_name}'", file=sys.stderr)
        print("Available tasks:", ", ".join(registry.get("tasks", {}).keys()))
        sys.exit(1)

    command = task["command"]
    timeout = task.get("timeout", 300)
    engine = task.get("engine", "unknown")

    print(f"[INFO] Running task: {task_name}")
    print(f"[INFO] Engine:       {engine}")
    print(f"[INFO] Command:      {command}")
    print(f"[INFO] Timeout:      {timeout}s")

    result = execute_command(command, timeout=timeout)

    print_result(result)

    if write_log_flag:
        write_log(result, task_name)

    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
