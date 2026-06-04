"""
WorkerExecutor — 工兵部门执行器
读取 HQ 生成的 Plan → 逐步执行 Actions → 调用 DeepSeek API
集成 CircuitBreaker 实现防卡死保护。

路径规范：所有路径通过 pathlib 处理相对路径。
"""

from __future__ import annotations

import json
import logging
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

            logger.info(
                f"[Worker] Step {step_num}/{len(steps)}: {action_name}"
            )

            # Heartbeat from Cline-anti-freeze rules
            if step_num % 5 == 0:
                logger.info("[Worker] [治理心跳] 运行中")

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