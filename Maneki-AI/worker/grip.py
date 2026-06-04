"""
GripVerifier — Grip Pattern 验证引擎
实现 Action → Grip → Commit 闭环

验证策略：
  - 结构验证：JSON Schema 校验
  - 语义验证：调用 DeepSeek 检查 output 是否匹配 input 语义
  - HQ 符合度：检查 output 是否满足 Plan step 的目标

智能模式：
  - confidence < 0.3 → 回滚
  - 0.3 ≤ confidence < 0.7 → 自动修正（最多 3 次）
  - confidence ≥ 0.7 → 通过

安全规范：DEEPSEEK_API_KEY 通过 os.getenv 读取。
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from pathlib import Path

try:
    from jsonschema import validate, ValidationError
    JSONSCHEMA_AVAILABLE = True
except ImportError:
    JSONSCHEMA_AVAILABLE = False

try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False

from .schemas import ACTION_SCHEMAS

logger = logging.getLogger(__name__)

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
GRIP_AUDIT_LOG = PROJECT_ROOT / "logs" / "grip_audit.jsonl"


class GripVerifier:
    """Grip 验证器 — 三重验证 + 智能修正 + 审计日志"""

    def __init__(self, max_auto_correct_retries: int = 3):
        self.max_retries = max_auto_correct_retries
        self._client = None
        if OPENAI_AVAILABLE and DEEPSEEK_API_KEY:
            self._client = OpenAI(
                api_key=DEEPSEEK_API_KEY,
                base_url=DEEPSEEK_BASE_URL,
            )
        # Ensure audit log directory
        GRIP_AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)

    # ── 主验证入口 ─────────────────────────────────────────────────

    def verify_action_result(
        self,
        action_name: str,
        action_input: dict[str, Any],
        action_output: dict[str, Any],
        plan_step: dict[str, Any],
    ) -> tuple[bool, float, list[str]]:
        """三重验证：结构 + 语义 + HQ 符合度

        Returns:
            (is_valid, confidence_0_to_1, issues_list)
        """
        issues: list[str] = []
        confidence = 1.0
        output_data = action_output.get("output", {})

        # ── 验证 1：结构检查 ──
        schema = ACTION_SCHEMAS.get(action_name)
        if schema and JSONSCHEMA_AVAILABLE:
            try:
                validate(instance=output_data, schema=schema)
                logger.info(f"[Grip] ✓ 结构: {action_name}")
            except ValidationError as e:
                issues.append(f"结构: {e.message}")
                confidence -= 0.4
                logger.warning(f"[Grip] ✗ 结构: {e.message}")
        elif schema and not JSONSCHEMA_AVAILABLE:
            logger.warning("[Grip] jsonschema 未安装，跳过结构验证")

        # ── 验证 2：语义一致性 ──
        if confidence > 0.3:
            semantic_valid, semantic_conf = self._verify_semantic(
                action_name, action_input, output_data
            )
            if not semantic_valid:
                issues.append("语义: 输出与输入不匹配")
                confidence = min(confidence, semantic_conf)

        # ── 验证 3：HQ 符合度 ──
        if confidence > 0.3:
            hq_valid, hq_conf = self._verify_hq_alignment(
                action_name, plan_step, output_data
            )
            if not hq_valid:
                issues.append("HQ: 未满足 Plan step 要求")
                confidence = min(confidence, hq_conf)

        confidence = max(0.0, min(1.0, confidence))
        is_valid = confidence >= 0.7

        # 写审计日志
        self._audit_log(action_name, is_valid, confidence, issues)

        logger.info(
            f"[Grip] 验证: valid={is_valid}, conf={confidence:.2f}"
            f"{', issues=' + str(issues) if issues else ''}"
        )
        return is_valid, confidence, issues

    # ── 语义验证 ──────────────────────────────────────────────────

    def _verify_semantic(
        self, action_name: str, input_data: dict, output_data: dict
    ) -> tuple[bool, float]:
        """调用 DeepSeek 检查 output 是否匹配 input 语义"""
        if not self._client:
            return True, 0.8

        prompt = (
            f"你是质量检查员。判断 Action 输出是否语义匹配输入。\n\n"
            f"Action: {action_name}\n"
            f"Input: {json.dumps(input_data, ensure_ascii=False)[:300]}\n"
            f"Output: {json.dumps(output_data, ensure_ascii=False)[:500]}\n\n"
            f'输出 JSON: {{"is_valid": true/false, "confidence": 0.0-1.0, "reason": "..."}}'
        )

        try:
            resp = self._client.chat.completions.create(
                model=DEEPSEEK_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=200,
                temperature=0.1,
            )
            raw = resp.choices[0].message.content or "{}"
            raw = raw.strip().removeprefix("```json").removesuffix("```").strip()
            result = json.loads(raw)
            return result.get("is_valid", True), result.get("confidence", 0.5)
        except Exception as e:
            logger.error(f"[Grip] 语义验证异常: {e}")
            return True, 0.5

    # ── HQ 符合度 ─────────────────────────────────────────────────

    def _verify_hq_alignment(
        self, action_name: str, plan_step: dict, output_data: dict
    ) -> tuple[bool, float]:
        """检查 output 是否满足 Plan step 的目标"""
        step_action = plan_step.get("action", "")
        if step_action != action_name:
            return False, 0.2

        required_fields: dict[str, list[str]] = {
            "analyze_market": ["analysis", "trends"],
            "write_code": ["code", "filename"],
            "generate_content": ["content", "title"],
            "review": ["approved", "feedback"],
        }

        fields = required_fields.get(action_name, [])
        missing = [f for f in fields if f not in output_data]
        if missing:
            logger.warning(f"[Grip] HQ 符合度低: 缺少字段 {missing}")
            return False, 0.4

        return True, 0.9

    # ── 自动修正 ──────────────────────────────────────────────────

    def auto_correct(
        self,
        action_name: str,
        failed_output: dict[str, Any],
        action_input: dict[str, Any],
        retry_count: int,
    ) -> dict[str, Any]:
        """自动修正：格式 + 内容修复，最多 3 次"""
        if retry_count >= self.max_retries:
            logger.error(
                f"[Grip] 自动修正失败: 已达最大重试 {self.max_retries}"
            )
            return {
                "status": "CORRECTION_FAILED",
                "error": f"Max retries ({self.max_retries}) exceeded",
            }

        if not self._client:
            logger.warning("[Grip] DeepSeek 不可用，跳过自动修正")
            return failed_output

        schema = ACTION_SCHEMAS.get(action_name, {})
        prompt = (
            f"你是代码修复专家。以下 Action 输出不符合要求，请修正。\n\n"
            f"Action: {action_name}\n"
            f"Input: {json.dumps(action_input, ensure_ascii=False)[:300]}\n"
            f"Failed Output: {json.dumps(failed_output.get('output', {}), ensure_ascii=False)[:500]}\n"
            f"Expected Schema: {json.dumps(schema, ensure_ascii=False)}\n\n"
            f"输出修正后的完整 JSON（仅输出 JSON 对象，不要 markdown 标记）。"
        )

        try:
            resp = self._client.chat.completions.create(
                model=DEEPSEEK_MODEL,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=2048,
                temperature=0.2,
            )
            raw = resp.choices[0].message.content or "{}"
            raw = raw.strip().removeprefix("```json").removesuffix("```").strip()
            corrected = json.loads(raw)
            logger.info(f"[Grip] ✓ 自动修正 (retry {retry_count + 1}/{self.max_retries})")
            return {
                "status": "success",
                "action": action_name,
                "output": corrected,
                "grip_corrected": True,
            }
        except json.JSONDecodeError as e:
            logger.error(f"[Grip] 修正输出解析失败: {e}")
            return failed_output
        except Exception as e:
            logger.error(f"[Grip] 自动修正异常: {e}")
            return failed_output

    # ── 回滚 ──────────────────────────────────────────────────────

    def rollback(self, task_id: str, step_num: int) -> None:
        """回滚：记录日志表示该步骤已回滚"""
        logger.warning(f"[Grip] 回滚: task={task_id}, step={step_num}")
        self._audit_log(
            "rollback", False, 0.0,
            [f"Step {step_num} rolled back for task {task_id}"],
        )

    # ── 审计日志 ──────────────────────────────────────────────────

    def _audit_log(
        self,
        action_name: str,
        is_valid: bool,
        confidence: float,
        issues: list[str],
    ) -> None:
        """写入 grip_audit.jsonl 审计日志"""
        from datetime import datetime, timezone
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "action": action_name,
            "valid": is_valid,
            "confidence": round(confidence, 3),
            "issues": issues,
        }
        try:
            with open(GRIP_AUDIT_LOG, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception as e:
            logger.error(f"[Grip] 审计日志写入失败: {e}")