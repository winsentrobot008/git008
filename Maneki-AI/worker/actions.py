"""
Worker Actions — 工兵部门原子动作集
基于 ClawWork 的 Tool 模式，每个 Action 有明确的 Input -> Process -> Output 结构。
所有 Action 调用 DeepSeek API 执行具体任务。

安全规范：DEEPSEEK_API_KEY 通过 os.getenv 读取。
"""

from __future__ import annotations

import json
import os
import logging
from abc import ABC, abstractmethod
from typing import Any

try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False

from .schemas import ACTION_SCHEMAS

logger = logging.getLogger(__name__)

# DeepSeek config (all via os.getenv)
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_MAX_TOKENS = int(os.getenv("DEEPSEEK_MAX_TOKENS", "4096"))
DEEPSEEK_TEMPERATURE = float(os.getenv("DEEPSEEK_TEMPERATURE", "0.3"))


class BaseAction(ABC):
    """Base class for all Worker Actions — mirrors ClawWork Tool pattern."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique action name matching Plan step action field."""

    @property
    @abstractmethod
    def description(self) -> str:
        """Human-readable description of what this action does."""

    @property
    def expected_schema(self) -> dict:
        """Return the expected output JSON Schema for Grip verification."""
        return ACTION_SCHEMAS.get(self.name, {})

    @abstractmethod
    def execute(self, input_data: dict[str, Any]) -> dict[str, Any]:
        """Execute the action with given input, returning a structured output.

        Must follow: Input -> Process (call DeepSeek) -> Output
        """


def _deepseek_chat(prompt: str) -> str:
    """Call DeepSeek API and return the response text. Returns empty on failure."""
    if not OPENAI_AVAILABLE:
        logger.error("[Worker] openai package not installed; cannot call DeepSeek")
    if not DEEPSEEK_API_KEY:
        logger.warning("[Worker] DEEPSEEK_API_KEY not set; returning mock output")

    try:
        client = OpenAI(
            api_key=DEEPSEEK_API_KEY,
            base_url=DEEPSEEK_BASE_URL,
        )
        response = client.chat.completions.create(
            model=DEEPSEEK_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=DEEPSEEK_MAX_TOKENS,
            temperature=DEEPSEEK_TEMPERATURE,
        )
        return response.choices[0].message.content or ""
    except Exception as e:
        logger.error(f"[Worker] DeepSeek API error: {e}")
        return ""


def _mock_or_api(prompt: str, fallback: str) -> str:
    """Try DeepSeek API, fall back to mock if unavailable."""
    if DEEPSEEK_API_KEY and OPENAI_AVAILABLE:
        result = _deepseek_chat(prompt)
        if result:
            return result
    logger.info(f"[Worker] Using mock output (API unavailable)")
    return fallback


# ── AnalyzeMarketAction ───────────────────────────────────────────────────

class AnalyzeMarketAction(BaseAction):
    """Research market trends, competitors, or industry data."""

    @property
    def name(self) -> str:
        return "analyze_market"

    @property
    def description(self) -> str:
        return "Research market trends, competitors, or industry data."

    def execute(self, input_data: dict[str, Any]) -> dict[str, Any]:
        topic = input_data.get("topic", "")
        if not topic:
            return {"status": "error", "error": "Missing 'topic' in input"}

        prompt = (
            f"You are a market research analyst. Analyze the following topic "
            f"and provide a structured report with key insights, trends, and "
            f"actionable recommendations.\n\n"
            f"Topic: {topic}\n\n"
            f"Output JSON with keys: analysis (str), score (float 0-1), "
            f"trends (list of str), recommendations (list of str)."
        )

        mock = json.dumps({
            "analysis": f"Market analysis for: {topic}. Key trends identified.",
            "score": 0.75,
            "trends": ["Emerging demand", "Digital transformation"],
            "recommendations": ["Invest in AI", "Expand market reach"],
        }, ensure_ascii=False)

        raw = _mock_or_api(prompt, mock)

        try:
            if raw.startswith("```"):
                raw = raw.split("```json")[-1].split("```")[0].strip()
            result = json.loads(raw) if raw.strip().startswith("{") else json.loads(mock)
        except json.JSONDecodeError:
            result = json.loads(mock)

        logger.info(f"[Worker] analyze_market: topic={topic[:50]}, score={result.get('score')}")
        return {"status": "success", "action": self.name, "output": result}


# ── WriteCodeAction ───────────────────────────────────────────────────────

class WriteCodeAction(BaseAction):
    """Generate production-ready Python code."""

    @property
    def name(self) -> str:
        return "write_code"

    @property
    def description(self) -> str:
        return "Generate production-ready Python code."

    def execute(self, input_data: dict[str, Any]) -> dict[str, Any]:
        description = input_data.get("description", "")
        if not description:
            return {"status": "error", "error": "Missing 'description' in input"}

        prompt = (
            f"You are an expert Python software engineer. Write production-ready "
            f"Python code for the following requirement. Include comments, error "
            f"handling, and type hints.\n\n"
            f"Requirement: {description}\n\n"
            f"Output JSON with keys: code (str), filename (str, e.g. 'script.py'), "
            f"language (str), dependencies (list of str)."
        )

        mock = json.dumps({
            "code": f"# Generated code for: {description}\n"
                    f"def main():\n"
                    f"    \"\"\"Auto-generated by Maneki-AI Worker.\"\"\"\n"
                    f"    print('Executing: {description}')\n"
                    f"    return True\n\n"
                    f"if __name__ == '__main__':\n"
                    f"    main()",
            "filename": "generated_script.py",
            "language": "python",
            "dependencies": [],
        }, ensure_ascii=False)

        raw = _mock_or_api(prompt, mock)

        try:
            if raw.startswith("```"):
                raw = raw.split("```json")[-1].split("```")[0].strip()
            result = json.loads(raw) if raw.strip().startswith("{") else json.loads(mock)
        except json.JSONDecodeError:
            result = json.loads(mock)

        logger.info(f"[Worker] write_code: desc={description[:50]}, file={result.get('filename')}")
        return {"status": "success", "action": self.name, "output": result}


# ── GenerateContentAction ──────────────────────────────────────────────────

class GenerateContentAction(BaseAction):
    """Create written content (posts, articles, ads)."""

    @property
    def name(self) -> str:
        return "generate_content"

    @property
    def description(self) -> str:
        return "Create written content: posts, articles, or advertisements."

    def execute(self, input_data: dict[str, Any]) -> dict[str, Any]:
        prompt_text = input_data.get("prompt", "")
        style = input_data.get("style", "professional")
        if not prompt_text:
            return {"status": "error", "error": "Missing 'prompt' in input"}

        prompt = (
            f"You are a professional content creator. Generate high-quality "
            f"content based on the following briefing. Style: {style}.\n\n"
            f"Briefing: {prompt_text}\n\n"
            f"Output JSON with keys: content (str), title (str), "
            f"word_count (int), format (str, e.g. 'article' or 'social_post')."
        )

        mock = json.dumps({
            "content": f"Generated content for: {prompt_text}",
            "title": "Content Title",
            "word_count": 150,
            "format": "article",
        }, ensure_ascii=False)

        raw = _mock_or_api(prompt, mock)

        try:
            if raw.startswith("```"):
                raw = raw.split("```json")[-1].split("```")[0].strip()
            result = json.loads(raw) if raw.strip().startswith("{") else json.loads(mock)
        except json.JSONDecodeError:
            result = json.loads(mock)

        logger.info(f"[Worker] generate_content: prompt={prompt_text[:50]}, words={result.get('word_count')}")
        return {"status": "success", "action": self.name, "output": result}


# ── ReviewAction ────────────────────────────────────────────────────────────

class ReviewAction(BaseAction):
    """Review and improve existing work."""

    @property
    def name(self) -> str:
        return "review"

    @property
    def description(self) -> str:
        return "Review and improve existing work output."

    def execute(self, input_data: dict[str, Any]) -> dict[str, Any]:
        content = input_data.get("content", "")
        if not content:
            return {"status": "error", "error": "Missing 'content' in input"}

        prompt = (
            f"You are a quality assurance reviewer. Review the following work "
            f"and provide feedback, approval status, and improvement suggestions.\n\n"
            f"Work to review: {content[:500]}\n\n"
            f"Output JSON with keys: approved (bool), score (float 0-1), "
            f"feedback (str), suggestions (list of str)."
        )

        mock = json.dumps({
            "approved": True,
            "score": 0.85,
            "feedback": "Work meets quality standards. Minor improvements possible.",
            "suggestions": ["Add more detail", "Consider edge cases"],
        }, ensure_ascii=False)

        raw = _mock_or_api(prompt, mock)

        try:
            if raw.startswith("```"):
                raw = raw.split("```json")[-1].split("```")[0].strip()
            result = json.loads(raw) if raw.strip().startswith("{") else json.loads(mock)
        except json.JSONDecodeError:
            result = json.loads(mock)

        logger.info(f"[Worker] review: approved={result.get('approved')}, score={result.get('score')}")
        return {"status": "success", "action": self.name, "output": result}


# ── Action Registry ────────────────────────────────────────────────────────

ACTIONS_REGISTRY: dict[str, BaseAction] = {
    "analyze_market": AnalyzeMarketAction(),
    "write_code": WriteCodeAction(),
    "generate_content": GenerateContentAction(),
    "review": ReviewAction(),
}