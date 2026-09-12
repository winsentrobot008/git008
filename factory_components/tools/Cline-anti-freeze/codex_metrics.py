#!/usr/bin/env python3
"""
codex_metrics.py — CODEX 实时 Token 大盘数据源 (v1.0)
====================================================
为 Cline-anti-freeze 治理面板（CODEX 专版）提供实时指标：

  1. 当前会话 Context 上下文体积（如 15k / 100k Tokens）
  2. 累计 Token 耗费与估算成本（USD）
  3. 单次请求 Token（与 max_request_tokens 预警线比对）
  4. 对话轮数（与 context_warn_rounds 预警线比对）
  5. 宪法执行状态：AGENTS.md 是否加载、.codexignore 拦截规则是否生效

数据来源（按优先级）：
  A. Codex CLI 会话文件（~/.codex/sessions/**/*.jsonl，最新 mtime）
  B. 状态文件 runtime_data/codex/codex_metrics.json（可由 Agent 或钩子推送）

限制参数来源：.codex/governance.json（由治理中心从 AGENTS.md 动态同步）。

CLI 用法：
  python codex_metrics.py --report        # 输出完整 JSON 报告
  python codex_metrics.py --session       # 输出当前最新会话文件路径
  python codex_metrics.py --record '{"context_tokens": 15234, ...}'
                                          # 手动/钩子推送状态（无会话文件时的兜底）
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ============================================================
# 路径锚定：向上查找 git008 工作区根（含 AGENTS.md）
# ============================================================
def find_workspace_root(start: Optional[Path] = None) -> Path:
    cur = (start or Path(__file__).resolve().parent)
    for parent in [cur, *cur.parents]:
        if (parent / "AGENTS.md").exists() and (parent / ".git").exists():
            return parent
    return cur.parents[-1]


WORKSPACE_ROOT = find_workspace_root()
GOVERNANCE_JSON = WORKSPACE_ROOT / ".codex" / "governance.json"
CODEXIGNORE_PATH = WORKSPACE_ROOT / ".codexignore"
STATE_FILE = WORKSPACE_ROOT / "runtime_data" / "codex" / "codex_metrics.json"

# ============================================================
# 默认限制（与 AGENTS.md / governance.json 保持一致；运行时优先读 governance.json）
# ============================================================
DEFAULT_LIMITS = {
    "max_session_tokens": 500000,
    "max_request_tokens": 80000,
    "max_context_tokens": 100000,
    "context_warn_rounds": 5,
    "daily_budget_tokens": 2000000,
}

# 估算成本速率（USD / 百万 Token）— 可按环境变量覆盖，仅作面板估算参考
_RATES = {
    "input": float(os.environ.get("CODEX_RATE_INPUT_MTOK", "0.25")),
    "cached": float(os.environ.get("CODEX_RATE_CACHED_MTOK", "0.05")),
    "output": float(os.environ.get("CODEX_RATE_OUTPUT_MTOK", "1.25")),
}

# .codexignore 必须覆盖的宪法黑名单项
REQUIRED_IGNORE_RULES = ["output/", "work/", "node_modules/", ".git/", ".env"]


# ============================================================
# 限制参数读取
# ============================================================
def load_limits() -> Dict:
    limits = dict(DEFAULT_LIMITS)
    if GOVERNANCE_JSON.exists():
        try:
            data = json.loads(GOVERNANCE_JSON.read_text(encoding="utf-8"))
            tg = data.get("token_guardrails", {})
            for key in limits:
                if key in tg and isinstance(tg[key], (int, float)):
                    limits[key] = int(tg[key])
        except (json.JSONDecodeError, OSError):
            pass
    return limits


# ============================================================
# Codex 会话文件定位与解析
# ============================================================
def resolve_codex_home() -> Path:
    env_home = os.environ.get("CODEX_HOME")
    if env_home:
        return Path(env_home).expanduser()
    return Path.home() / ".codex"


def find_latest_session_file() -> Optional[Path]:
    """在 ~/.codex/sessions 下按 mtime 找最新的 JSONL 会话文件。"""
    codex_home = resolve_codex_home()
    search_dirs = [codex_home / "sessions"]
    candidates: List[Tuple[float, Path]] = []
    for sdir in search_dirs:
        if not sdir.exists():
            continue
        try:
            for p in sdir.rglob("*.jsonl"):
                try:
                    mtime = p.stat().st_mtime
                except OSError:
                    continue
                candidates.append((mtime, p))
        except OSError:
            continue
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def _iter_events(path: Path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def _extract_usage(event: Dict) -> Optional[Dict]:
    """从单个会话事件中提取 usage 字典（优先顶层，其次 payload，最后递归）。"""
    if isinstance(event.get("usage"), dict):
        return event["usage"]
    payload = event.get("payload")
    if isinstance(payload, dict) and isinstance(payload.get("usage"), dict):
        return payload["usage"]

    found: Dict = {}

    def walk(node) -> bool:
        if isinstance(node, dict):
            if "input_tokens" in node and isinstance(node.get("input_tokens"), (int, float)):
                found.update(node)
                return True
            for value in node.values():
                if walk(value):
                    return True
        elif isinstance(node, list):
            for value in node:
                if walk(value):
                    return True
        return False

    walk(event)
    return found or None


def _is_user_turn(event: Dict) -> bool:
    evt_type = event.get("type")
    payload = event.get("payload")
    ptype = payload.get("type") if isinstance(payload, dict) else None
    if evt_type == "user_message":
        return True
    if ptype == "user_message":
        return True
    if evt_type == "item" and ptype == "message" and payload.get("role") == "user":
        return True
    if evt_type == "event_msg" and ptype == "user_message":
        return True
    return False


def parse_session_file(path: Path) -> Tuple[List[Dict], int, Optional[str], Optional[str]]:
    """解析会话文件：返回 (usage 列表, 轮数, started_at, session_id)。"""
    usage_list: List[Dict] = []
    rounds = 0
    started_at: Optional[str] = None
    session_id: Optional[str] = None

    for evt in _iter_events(path):
        if _is_user_turn(evt):
            rounds += 1
        usage = _extract_usage(evt)
        if usage:
            usage_list.append(usage)
        if started_at is None:
            ts = evt.get("timestamp")
            if not ts and isinstance(evt.get("payload"), dict):
                ts = evt["payload"].get("timestamp")
            if ts:
                started_at = str(ts)
        sid = evt.get("session_id")
        if not sid and isinstance(evt.get("payload"), dict):
            sid = evt["payload"].get("session_id")
        if sid:
            session_id = str(sid)

    return usage_list, rounds, started_at, session_id


def compute_metrics(usage_list: List[Dict]) -> Dict:
    """由 usage 列表计算 Token 指标。"""
    input_tokens = sum(int(u.get("input_tokens") or 0) for u in usage_list)
    output_tokens = sum(int(u.get("output_tokens") or 0) for u in usage_list)
    cached_input = sum(int(u.get("cached_input_tokens") or 0) for u in usage_list)
    total_tokens = sum(int(u.get("total_tokens") or 0) for u in usage_list)

    cumulative_tokens = total_tokens or (input_tokens + output_tokens)
    last = usage_list[-1] if usage_list else {}

    context_tokens = int(last.get("input_tokens") or 0)
    if not context_tokens and last:
        context_tokens = int(last.get("total_tokens") or 0) - int(last.get("output_tokens") or 0)
    context_tokens = max(context_tokens, 0)

    cost_usd = (
        (input_tokens - cached_input) / 1_000_000 * _RATES["input"]
        + cached_input / 1_000_000 * _RATES["cached"]
        + output_tokens / 1_000_000 * _RATES["output"]
    )

    return {
        "context_tokens": context_tokens,
        "cumulative_tokens": cumulative_tokens,
        "cumulative_input_tokens": input_tokens,
        "cumulative_output_tokens": output_tokens,
        "cached_input_tokens": cached_input,
        "api_calls": len(usage_list),
        "last_request_tokens": context_tokens,
        "estimated_cost_usd": round(cost_usd, 4),
    }


# ============================================================
# 宪法执行状态
# ============================================================
def load_constitution_status() -> Dict:
    agents_md = WORKSPACE_ROOT / "AGENTS.md"
    agents_md_loaded = agents_md.exists()
    last_synced: Optional[str] = None
    governance_json_active = False

    if GOVERNANCE_JSON.exists():
        try:
            data = json.loads(GOVERNANCE_JSON.read_text(encoding="utf-8"))
            constitution = data.get("constitution", {})
            if constitution.get("file") == "AGENTS.md":
                governance_json_active = True
                last_synced = constitution.get("last_synced")
        except (json.JSONDecodeError, OSError):
            pass

    rules: List[str] = []
    if CODEXIGNORE_PATH.exists():
        rules = [
            ln.strip()
            for ln in CODEXIGNORE_PATH.read_text(encoding="utf-8").splitlines()
            if ln.strip() and not ln.lstrip().startswith("#")
        ]

    covered = [r for r in REQUIRED_IGNORE_RULES if any(r in rule for rule in rules)]
    codexignore_active = bool(rules) and len(covered) == len(REQUIRED_IGNORE_RULES)

    return {
        "agents_md_loaded": agents_md_loaded,
        "agents_md_path": str(agents_md) if agents_md_loaded else None,
        "governance_json_active": governance_json_active,
        "last_synced": last_synced,
        "codexignore_exists": CODEXIGNORE_PATH.exists(),
        "codexignore_rules": rules,
        "codexignore_active": codexignore_active,
        "required_covered": covered,
        "required_missing": [r for r in REQUIRED_IGNORE_RULES if r not in covered],
    }


# ============================================================
# 状态文件兜底（Agent / 钩子可推送）
# ============================================================
def load_state_file() -> Optional[Dict]:
    if not STATE_FILE.exists():
        return None
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def save_state_file(payload: Dict) -> Path:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    payload.setdefault("updated_at", datetime.now(timezone.utc).isoformat())
    STATE_FILE.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return STATE_FILE


# ============================================================
# 汇总报告
# ============================================================
def compute_codex_report() -> Dict:
    limits = load_limits()
    session_file = find_latest_session_file()
    source = "none"
    note = ""
    session_info = {"file": None, "id": None, "started_at": None}
    usage_list: List[Dict] = []
    rounds = 0

    if session_file is not None:
        try:
            usage_list, rounds, started_at, sid = parse_session_file(session_file)
            source = "session_file"
            session_info = {
                "file": str(session_file),
                "id": sid,
                "started_at": started_at,
            }
        except Exception as exc:  # 解析失败则降级到状态文件
            note = f"会话解析失败: {exc}"

    if source == "none":
        state = load_state_file()
        if state:
            source = "state_file"
            usage_list = [
                {
                    "input_tokens": state.get("cumulative_input_tokens", 0),
                    "output_tokens": state.get("cumulative_output_tokens", 0),
                    "cached_input_tokens": state.get("cached_input_tokens", 0),
                    "total_tokens": state.get("cumulative_tokens", 0),
                }
            ]
            if "context_tokens" in state:
                usage_list[-1]["input_tokens"] = int(state.get("context_tokens", 0))
            rounds = int(state.get("rounds", 0))
            session_info = {
                "file": STATE_FILE.name,
                "id": state.get("session_id"),
                "started_at": state.get("started_at") or state.get("updated_at"),
            }
            note = "无 Codex 会话文件，使用 runtime_data/codex/codex_metrics.json 状态数据"

    metrics = compute_metrics(usage_list)
    constitution = load_constitution_status()

    breach = {
        "context": metrics["context_tokens"] >= limits["max_context_tokens"],
        "rounds": rounds >= limits["context_warn_rounds"],
    }
    breach["triggered"] = breach["context"] or breach["rounds"]

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "note": note,
        "session": session_info,
        "limits": limits,
        "metrics": metrics,
        "rounds": rounds,
        "breach": breach,
        "constitution": constitution,
    }


# ============================================================
# CLI
# ============================================================
def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="CODEX 实时 Token 大盘数据源")
    parser.add_argument("--report", action="store_true", help="输出完整 JSON 报告")
    parser.add_argument("--session", action="store_true", help="输出最新会话文件路径")
    parser.add_argument("--record", type=str, metavar="JSON", help="写入状态文件（兜底数据源）")
    args = parser.parse_args()

    if args.session:
        path = find_latest_session_file()
        print(str(path) if path else "NO_SESSION_FILE")
        return 0

    if args.record:
        try:
            payload = json.loads(args.record)
        except json.JSONDecodeError:
            print("ERROR: --record 需要合法 JSON")
            return 2
        path = save_state_file(payload)
        print(f"[OK] 状态已写入: {path}")
        return 0

    print(json.dumps(compute_codex_report(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
