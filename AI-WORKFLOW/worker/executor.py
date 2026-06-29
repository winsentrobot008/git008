"""
WorkerExecutor — 工兵部门执行器
读取 HQ 生成的 Plan → 逐步执行 Actions → 调用 DeepSeek API
集成 CircuitBreaker 实现防卡死保护。

路径规范：所有路径通过 pathlib 处理相对路径。

支持两种运行模式:
  1. 库模式: 直接 import WorkerExecutor，调用 execute_plan()
  2. 子进程模式: python -m worker.executor，通过 stdin 读取 Plan JSON，stdout 输出结果 JSON
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from datetime import datetime, timezone
from typing import Any

from .actions import ACTIONS_REGISTRY
from .grip import GripVerifier

logger = logging.getLogger(__name__)

# Project root via relative resolution
PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOGS_DIR = PROJECT_ROOT / "logs"
OUTPUTS_DIR = PROJECT_ROOT / "deliveries"


class WorkerExecutor:
    """Worker Executor — reads Plan, executes Actions, produces outputs.

    Usage:
        executor = WorkerExecutor(circuit_breaker=my_breaker)
        result = executor.execute_plan(plan)
    """

    def __init__(self, circuit_breaker: Any = None):
        self._breaker = circuit_breaker
        self._verifier = GripVerifier(max_auto_correct_retries=3)

    def execute_plan(self, plan: dict[str, Any]) -> dict[str, Any]:
        """Execute all steps in the Plan sequentially.

        Args:
            plan: Plan dict from HQCommander.generate_plan()

        Returns:
            Result dict with task_id, status, steps_results, aggregate_output
        """
        task_id = plan.get("task_id", "unknown")
        goal = plan.get("goal", "")
        steps = plan.get("steps", [])

        if not steps:
            return {
                "task_id": task_id,
                "status": "error",
                "error": "Plan contains no steps",
            }

        logger.info(f"[Worker] Executing plan: {task_id} ({len(steps)} steps)")

        steps_results: list[dict[str, Any]] = []
        overall_status = "success"

        for step in steps:
            step_num = step.get("step", 0)
            action_name = step.get("action", "")
            action_input = step.get("input", {})

            # ── Resolve {{GENERATED_FILE}} / {{GENERATED_LANGUAGE}} from prior steps ─
            resolved_input = dict(action_input)
            for key, val in list(resolved_input.items()):
                if val == "{{GENERATED_FILE}}" or val == "{{GENERATED_LANGUAGE}}":
                    for sr in steps_results:
                        out = sr.get("result", {}).get("output", {})
                        if key == "source_file" and out.get("filename"):
                            gen_dir = PROJECT_ROOT / "generated_outputs" / task_id
                            resolved_input[key] = str(gen_dir / out["filename"])
                            logger.info(f"[Worker] Resolved source_file → {resolved_input[key]}")
                        elif key == "language" and out.get("language"):
                            resolved_input[key] = out["language"]
                            logger.info(f"[Worker] Resolved language → {resolved_input[key]}")
            action_input = resolved_input

            logger.info(
                f"[Worker] Step {step_num}/{len(steps)}: {action_name}"
            )

            # Heartbeat from Cline-anti-freeze rules
            if step_num % 5 == 0:
                logger.info("[Worker] [治理心跳] 运行中")

            # ── Broadcast step start to WebSocket ──────────────────────
            try:
                from urllib.request import Request, urlopen
                import json as _json
                _broadcast_payload = _json.dumps({
                    "type": "agent_thinking",
                    "task_id": task_id,
                    "step": step_num,
                    "total": len(steps),
                    "action": action_name,
                    "agent": "Maneki-Worker",
                    "message": f"正在执行 Step {step_num}/{len(steps)}: {action_name}",
                    "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                }).encode("utf-8")
                _req = Request(
                    "http://localhost:8000/api/broadcast",
                    data=_broadcast_payload,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                urlopen(_req, timeout=2)
            except Exception:
                pass

            # ── Phase 1: Action (执行) ─────────────────────────────────
            try:
                if self._breaker:
                    step_result = self._breaker.run_with_protection(
                        self._execute_action, action_name, action_input
                    )
                else:
                    step_result = self._execute_action(action_name, action_input)

                # ── Phase 2: Grip (验证) ───────────────────────────────
                grip_confidence = 1.0
                grip_issues: list[str] = []

                if step_result.get("status") == "success":
                    is_valid, grip_confidence, grip_issues = self._verifier.verify_action_result(
                        action_name, action_input, step_result, step
                    )

                    if not is_valid:
                        if grip_confidence < 0.3:
                            # 置信度太低 → 回滚
                            logger.error(
                                f"[Executor] Step {step_num} ROLLBACK: "
                                f"confidence={grip_confidence:.2f}"
                            )
                            self._verifier.rollback(task_id, step_num)
                            step_result = {
                                "status": "ROLLED_BACK",
                                "error": grip_issues,
                            }
                        else:
                            # 中等置信度 → 自动修正
                            logger.warning(
                                f"[Executor] Step {step_num} AUTO-CORRECT: "
                                f"confidence={grip_confidence:.2f}"
                            )
                            retry_count = (
                                self._breaker.get_retry_count("_execute_action")
                                if self._breaker else 0
                            )
                            step_result = self._verifier.auto_correct(
                                action_name, step_result, action_input, retry_count
                            )

                # ── Phase 3: Commit (提交) ──────────────────────────────
                if step_result.get("status") == "success":
                    logger.info(f"[Executor] Step {step_num} COMMIT")

                    # ── Broadcast step_complete to WebSocket ─────────
                    try:
                        from urllib.request import Request, urlopen
                        import json as _json2
                        _done_payload = _json2.dumps({
                            "type": "step_complete",
                            "task_id": task_id,
                            "step": step_num,
                            "total": len(steps),
                            "action": action_name,
                            "message": f"Step {step_num}/{len(steps)} 完成: {action_name}",
                            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                        }).encode("utf-8")
                        _req2 = Request(
                            "http://localhost:8000/api/broadcast",
                            data=_done_payload,
                            headers={"Content-Type": "application/json"},
                            method="POST",
                        )
                        urlopen(_req2, timeout=2)
                    except Exception:
                        pass

                    # ── Eager-write code files for subsequent build steps ─
                    if action_name == "write_code":
                        code = step_result.get("output", {}).get("code", "")
                        filename = step_result.get("output", {}).get("filename", "")
                        if code and filename:
                            gen_dir = PROJECT_ROOT / "generated_outputs" / task_id
                            gen_dir.mkdir(parents=True, exist_ok=True)
                            filepath = gen_dir / filename
                            with open(filepath, "w", encoding="utf-8") as cf:
                                cf.write(code)
                            logger.info(f"[Executor] Eager-wrote code: {filepath}")

                            # ── Broadcast code_generated to WebSocket ─
                            try:
                                _code_payload = _json2.dumps({
                                    "type": "code_generated",
                                    "task_id": task_id,
                                    "step": step_num,
                                    "filename": filename,
                                    "message": f"代码已生成: {filename}",
                                    "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                }).encode("utf-8")
                                _req3 = Request(
                                    "http://localhost:8000/api/broadcast",
                                    data=_code_payload,
                                    headers={"Content-Type": "application/json"},
                                    method="POST",
                                )
                                urlopen(_req3, timeout=2)
                            except Exception:
                                pass

                steps_results.append({
                    "step": step_num,
                    "action": action_name,
                    "result": step_result,
                    "grip_confidence": round(grip_confidence, 3),
                    "grip_issues": grip_issues,
                })

                if step_result.get("status") not in ("success",):
                    overall_status = "partial_failure"
                    logger.warning(
                        f"[Worker] Step {step_num} failed: {step_result.get('error')}"
                    )

            except Exception as e:
                logger.exception(f"[Worker] Step {step_num} exception: {e}")
                steps_results.append({
                    "step": step_num,
                    "action": action_name,
                    "result": {"status": "error", "error": str(e)},
                    "grip_confidence": 0.0,
                    "grip_issues": [str(e)],
                })
                overall_status = "partial_failure"

        # Aggregate all outputs
        aggregate_output = self._aggregate(steps_results)

        # Save execution log and outputs
        self._save_results(task_id, goal, steps_results, aggregate_output, overall_status)

        return {
            "task_id": task_id,
            "status": overall_status,
            "steps_completed": len(steps_results),
            "steps_total": len(steps),
            "steps_results": steps_results,
            "aggregate_output": aggregate_output,
        }

    def _execute_action(
        self, action_name: str, action_input: dict[str, Any]
    ) -> dict[str, Any]:
        """Look up and execute an action by name."""
        action = ACTIONS_REGISTRY.get(action_name)
        if action is None:
            return {
                "status": "error",
                "error": f"Unknown action: {action_name}",
                "available_actions": list(ACTIONS_REGISTRY.keys()),
            }

        logger.info(f"[Worker] Calling {action_name} with input: {json.dumps(action_input, default=str)[:100]}")
        result = action.execute(action_input)
        return result

    def _aggregate(
        self, steps_results: list[dict[str, Any]]
    ) -> dict[str, Any]:
        """Aggregate results from all steps into a unified output."""
        outputs = []
        scores = []

        for sr in steps_results:
            result = sr.get("result", {})
            output = result.get("output", {})
            if isinstance(output, dict):
                outputs.append(output)
                if "score" in output:
                    try:
                        scores.append(float(output["score"]))
                    except (ValueError, TypeError):
                        pass

        avg_score = sum(scores) / len(scores) if scores else 0.0

        return {
            "total_steps": len(steps_results),
            "successful_steps": sum(
                1 for sr in steps_results
                if sr.get("result", {}).get("status") == "success"
            ),
            "average_score": round(avg_score, 3),
            "details": outputs,
        }

    def _save_results(
        self,
        task_id: str,
        goal: str,
        steps_results: list[dict[str, Any]],
        aggregate: dict[str, Any],
        status: str,
    ) -> None:
        """Persist execution results to logs/ and deliveries/."""
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Save execution log
        log_entry = {
            "task_id": task_id,
            "goal": goal,
            "status": status,
            "steps": steps_results,
            "aggregate": aggregate,
            "executed_at": now,
        }
        log_path = LOGS_DIR / f"task_{task_id}_execution.json"
        with open(log_path, "w", encoding="utf-8") as f:
            json.dump(log_entry, f, indent=2, ensure_ascii=False)
        logger.info(f"[Worker] Execution log saved: {log_path}")

        # Save deliverables
        output_path = OUTPUTS_DIR / f"delivery_{task_id}.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump({
                "task_id": task_id,
                "goal": goal,
                "status": status,
                "aggregate_output": aggregate,
                "completed_at": now,
            }, f, indent=2, ensure_ascii=False)
        logger.info(f"[Worker] Deliverable saved: {output_path}")

        # ── Materialize code files from write_code actions ──────────
        gen_dir = PROJECT_ROOT / "generated_outputs" / task_id
        gen_dir.mkdir(parents=True, exist_ok=True)
        generated_files: list[str] = []
        for sr in steps_results:
            result = sr.get("result", {})
            output = result.get("output", {})
            code = output.get("code", "")
            filename = output.get("filename", "")
            language = output.get("language", "")
            if code and filename:
                filepath = gen_dir / filename
                with open(filepath, "w", encoding="utf-8") as cf:
                    cf.write(code)
                generated_files.append(str(filepath))
                logger.info(f"[Worker] Code file saved: {filepath}")
        # Write manifest
        manifest_path = gen_dir / "manifest.json"
        with open(manifest_path, "w", encoding="utf-8") as mf:
            json.dump({
                "task_id": task_id, "goal": goal, "status": status,
                "files": generated_files, "completed_at": now,
            }, mf, indent=2, ensure_ascii=False)
        logger.info(f"[Worker] {len(generated_files)} code file(s) materialised in {gen_dir}")


# ══════════════════════════════════════════════════════════════════════════════
#  Standalone subprocess entrypoint — for Popen-based execution from task_listener
# ══════════════════════════════════════════════════════════════════════════════

def _run_standalone():
    """
    Standalone Worker process entrypoint.

    Reads a Plan JSON dict from stdin, executes it via WorkerExecutor,
    and writes the result JSON to stdout.  All errors are captured and
    returned as structured JSON so the parent process never hangs on
    a broken pipe or unhandled exception.

    Expected input format (stdin):
        {"plan": {...}, "circuit_breaker_enabled": true/false}

    Output format (stdout, single line JSON):
        {"status": "ok"/"error", "result": {...}, "error": "..."}
    """
    import traceback
    import signal as _signal

    # Ignore SIGINT in child — parent controls lifecycle via os.kill / taskkill
    try:
        _signal.signal(_signal.SIGINT, _signal.SIG_IGN)
    except Exception:
        pass

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [Worker] %(levelname)s %(message)s",
        stream=sys.stderr,  # stderr is for logs, stdout is for result JSON
    )

    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            _emit_error("Empty stdin — no Plan JSON received")
            return

        input_data = json.loads(raw_input)
        plan = input_data.get("plan", {})
        breaker_enabled = input_data.get("circuit_breaker_enabled", False)

        if not plan or not plan.get("steps"):
            _emit_error("Plan missing or empty — no steps to execute")
            return

        # Optionally instantiate CircuitBreaker
        breaker = None
        if breaker_enabled:
            try:
                from safety.circuit_breaker import CircuitBreaker
                breaker = CircuitBreaker()
            except ImportError:
                logger.warning("[Worker-standalone] CircuitBreaker not available, continuing without")

        executor = WorkerExecutor(circuit_breaker=breaker)
        execution_result = executor.execute_plan(plan)

        _emit_ok(execution_result)

    except json.JSONDecodeError as e:
        logger.error(f"[Worker-standalone] JSON parse error: {e}")
        _emit_error(f"JSON parse error: {e}")
    except Exception:
        logger.error(f"[Worker-standalone] Fatal exception:\n{traceback.format_exc()}")
        _emit_error(traceback.format_exc())


def _emit_ok(result: dict):
    """Write a success envelope to stdout."""
    sys.stdout.write(json.dumps({"status": "ok", "result": result}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _emit_error(message: str):
    """Write an error envelope to stdout."""
    sys.stdout.write(json.dumps({"status": "error", "error": str(message)}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


if __name__ == "__main__":
    _run_standalone()