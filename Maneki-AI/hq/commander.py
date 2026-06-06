"""HQCommander - Claude API -> Plan.json"""
import json, os, uuid, logging
from pathlib import Path
from datetime import datetime, timezone

try:
    from anthropic import Anthropic, APIError, APITimeoutError, RateLimitError
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False

logger = logging.getLogger(__name__)
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-3-5-sonnet-20241022")
CLAUDE_MAX_TOKENS = int(os.getenv("CLAUDE_MAX_TOKENS", "4096"))
CLAUDE_TEMPERATURE = float(os.getenv("CLAUDE_TEMPERATURE", "0.3"))
PROJECT_ROOT = Path(__file__).resolve().parent.parent
PLANS_DIR = PROJECT_ROOT / "plans"

PLAN_SYSTEM_PROMPT = """你不仅是分析师，更是首席架构师。对于开发类任务，严禁只输出分析步骤，必须规划出完整的工程实施路径。

## 强制规划规范（设计/开发/构建类需求）
当用户提出"设计、开发、构建、创建、实现"等需求时，必须生成至少 4 个步骤的完整蓝图：

- Step 1: 需求分析与核心功能定义 — 细化用户目标，明确MVP范围和关键功能点
- Step 2: 系统架构与数据结构设计 — 规划技术栈、模块划分、数据模型与API接口
- Step 3: UI/UX 逻辑与功能实现 — 规划界面交互流程、组件树、状态管理与用户操作路径
- Step 4: 代码生成与验证 — 输出具体代码实现方案，包含测试与验证策略

## 可用动作
actions: analyze_market, define_requirements, design_architecture, design_ui_ux, write_code, generate_content, review, test_verify

## 输出格式
仅输出合法 JSON，格式如下：
{"task_id":"<UUID>","goal":"<goal>","created_at":"<ISO>","model":"<model>","steps":[{"step":1,"action":"<action>","input":{},"description":"<中文描述>"},...]}

严禁输出任何非 JSON 内容。"""


class HQCommander:
    """HQ Commander - calls Claude API to generate execution plans."""
    def __init__(self):
        self._api_key = ANTHROPIC_API_KEY
        self._model = CLAUDE_MODEL
        self._max_tokens = CLAUDE_MAX_TOKENS
        self._temperature = CLAUDE_TEMPERATURE
        self._client = None
        if not ANTHROPIC_AVAILABLE:
            logger.warning("[HQ] anthropic not installed; mock mode")
        elif not self._api_key:
            logger.warning("[HQ] ANTHROPIC_API_KEY not set; mock mode")

    @property
    def is_available(self):
        return ANTHROPIC_AVAILABLE and bool(self._api_key)

    def _get_client(self):
        if self._client is None and self.is_available:
            self._client = Anthropic(api_key=self._api_key)
        return self._client

    def generate_plan(self, goal):
        task_id = f"FAC-{uuid.uuid4().hex[:8].upper()}"
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        if not goal or not goal.strip():
            return self._error_plan(task_id, "Goal cannot be empty", now)
        if self.is_available:
            plan = self._call_claude(goal, task_id, now)
        else:
            plan = self._mock_plan(goal, task_id, now)
        self._save_plan(plan)
        return plan

    def _call_claude(self, goal, task_id, now):
        try:
            client = self._get_client()
            if client is None:
                return self._mock_plan(goal, task_id, now)
            resp = client.messages.create(
                model=self._model, max_tokens=self._max_tokens,
                temperature=self._temperature, system=PLAN_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": goal}],
            )
            raw = resp.content[0].text.strip() if resp.content else ""
            if raw.startswith("```"):
                lines = raw.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].strip() == "```":
                    lines = lines[:-1]
                raw = "\n".join(lines).strip()
            plan = json.loads(raw)
            plan["task_id"] = task_id
            plan["goal"] = goal
            plan["created_at"] = now
            plan["model"] = self._model
            plan["generated_by"] = "claude_api"
            n = len(plan.get("steps", []))
            logger.info(f"[HQ] Claude plan: {task_id} ({n} steps)")
            return plan
        except json.JSONDecodeError as e:
            logger.error(f"[HQ] Parse: {e}")
            return self._mock_plan(goal, task_id, now, reason=str(e))
        except APITimeoutError:
            return self._error_plan(task_id, "API timeout", now)
        except RateLimitError:
            return self._error_plan(task_id, "Rate limit", now)
        except APIError as e:
            return self._error_plan(task_id, str(e), now)
        except Exception as e:
            logger.exception(f"[HQ] Error: {e}")
            return self._mock_plan(goal, task_id, now, reason=str(e))

    def _mock_plan(self, goal, task_id, now, reason=""):
        logger.info(f"[HQ] Mock: {task_id}")
        gl = goal.lower()
        steps = []
        sn = 0
        is_dev = any(k in gl for k in ["design", "develop", "build", "create", "code", "app", "构建", "开发", "设计", "实现", "创建", "网页", "网站", "前端"])
        if is_dev:
            steps = [
                {"step": 1, "action": "define_requirements", "input": {"goal": goal}, "description": "需求分析与核心功能定义"},
                {"step": 2, "action": "design_architecture", "input": {"goal": goal}, "description": "系统架构与数据结构设计"},
                {"step": 3, "action": "design_ui_ux", "input": {"goal": goal}, "description": "UI/UX 逻辑与功能实现"},
                {"step": 4, "action": "write_code", "input": {"description": goal}, "description": "代码生成与验证"},
                {"step": 5, "action": "build_artifact", "input": {"source_file": "{{GENERATED_FILE}}", "language": "{{GENERATED_LANGUAGE}}"}, "description": "总装编译 · 构建可执行产物"},
            ]
        else:
            if any(k in gl for k in ["analyze", "market", "research"]):
                sn += 1
                steps.append({"step": sn, "action": "analyze_market", "input": {"topic": goal}})
            if any(k in gl for k in ["content", "write", "post", "article", "copy"]):
                sn += 1
                steps.append({"step": sn, "action": "generate_content", "input": {"prompt": goal, "style": "professional"}})
            if len(steps) > 1:
                sn += 1
                steps.append({"step": sn, "action": "review", "input": {"content": "All outputs"}})
            if not steps:
                sn += 1
                steps.append({"step": sn, "action": "analyze_market", "input": {"topic": goal}})
        return {"task_id": task_id, "goal": goal, "created_at": now, "model": "mock", "generated_by": "mock_rules", "steps": steps}

    def _error_plan(self, task_id, error, now):
        return {"task_id": task_id, "goal": "", "created_at": now, "model": self._model, "generated_by": "error", "steps": [], "status": "error", "error": error}

    def _save_plan(self, plan):
        PLANS_DIR.mkdir(parents=True, exist_ok=True)
        tid = plan.get("task_id", "unknown")
        fp = PLANS_DIR / f"plan_{tid}.json"
        with open(fp, "w", encoding="utf-8") as f:
            json.dump(plan, f, indent=2, ensure_ascii=False)
        return str(fp)