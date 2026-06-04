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

PLAN_SYSTEM_PROMPT = """You are HQ Commander. Decompose user goal into steps.
Output ONLY valid JSON. Actions: analyze_market, write_code, generate_content, review.
JSON: {"task_id":"<UUID>","goal":"<goal>","created_at":"<ISO>","model":"<model>","steps":[{"step":1,"action":"<action>","input":{}},...]}"""


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
        if any(k in gl for k in ["analyze", "market", "research"]):
            sn += 1
            steps.append({"step": sn, "action": "analyze_market", "input": {"topic": goal}})
        if any(k in gl for k in ["code", "develop", "build", "python", "script"]):
            sn += 1
            steps.append({"step": sn, "action": "write_code", "input": {"description": goal}})
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