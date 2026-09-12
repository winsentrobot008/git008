#!/usr/bin/env python3
"""governance_hooks.py — git008 治理中心 · AGENTS.md 宪法动态联动钩子

职责：
  1. 运行时解析根目录 `AGENTS.md` 宪法，动态提取：
     - Forbidden Directories / 敏感文件 → 同步注入黑名单；
     - Token Limits（单会话 / 单请求 / 上下文 / 全天）→ 控制会话与上下文体积。
  2. 将解析结果与 `.codex/governance.json` 双向同步（宪法为唯一源）。
  3. Token 实时大盘 + 自动熔断器：
     - 单会话超限 → Force Stop 强制切断（记录熔断事件）；
     - 单次请求超限 → 拒绝该请求；
     - 全天额度超限 → 暂停会话。
  4. 上下文膨胀提醒：连续对话 > 5 轮或上下文 ≥ 10 万 Token →
     弹窗提示"上下文膨胀，请立刻运行 /clear"，支持一键清空会话。
  5. 违规阻断：Agent 试图读取黑名单目录/文件或超大文件时立即拦截并告警。

作用域：仅 git008 工作区（检测根目录 `.codex/governance.json` 存在性），
其他 VS Code 项目不加载。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

# ============================================================
# 路径常量
# ============================================================
THIS_DIR = Path(__file__).resolve().parent


def _find_project_root(start: Path) -> Path:
    """向上锚定 git008 根：首个包含 .codex/governance.json 的目录。"""
    for parent in (start, *start.parents):
        if (parent / ".codex" / "governance.json").exists():
            return parent
    return start.parents[3] if len(start.parents) > 3 else start


PROJECT_ROOT = _find_project_root(THIS_DIR)
GOVERNANCE_JSON = PROJECT_ROOT / ".codex" / "governance.json"
AGENTS_MD = PROJECT_ROOT / "AGENTS.md"
TOKEN_LEDGER = THIS_DIR / "governance_logs" / "token_ledger.json"
EVENT_LOG = THIS_DIR / "governance_logs" / "hooks_events.jsonl"

# 默认护栏（AGENTS.md / governance.json 缺失时的兜底值）
DEFAULT_GUARDRAILS = {
    "max_session_tokens": 500000,
    "max_request_tokens": 80000,
    "max_context_tokens": 100000,
    "context_warn_rounds": 5,
    "daily_budget_tokens": 2000000,
}


# ============================================================
# 工作区作用域校验
# ============================================================
def is_git008_workspace(project_root: Optional[Path] = None) -> bool:
    """治理联动仅对 git008 生效：以 .codex/governance.json 存在性为标记。"""
    root = Path(project_root or PROJECT_ROOT)
    return (root / ".codex" / "governance.json").exists()


# ============================================================
# AGENTS.md 宪法动态解析
# ============================================================
def _strip_comment(line: str) -> str:
    """去掉行内注释（# 开头），保留 'key: value' 主体。"""
    idx = line.find("#")
    if idx != -1:
        line = line[:idx]
    return line.strip()


def parse_agents_md(
    agents_md: Optional[Path] = None,
) -> Dict:
    """解析 AGENTS.md，提取禁读目录/文件与 Token 限制。"""
    path = Path(agents_md or AGENTS_MD)
    result = {
        "constitution_file": str(path),
        "parsed_at": datetime.now(timezone.utc).isoformat(),
        "forbidden_dirs": [],
        "forbidden_files": [],
        "token_limits": {},
    }
    if not path.exists():
        result["error"] = f"AGENTS.md 不存在: {path}"
        return result

    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError as exc:
        result["error"] = str(exc)
        return result

    # 1) Forbidden Directories 区块：'- output/' 或 '- output' 形式
    section = re.search(
        r"^##\s+Forbidden Directories\s*$(.*?)(?=^##\s|\Z)",
        text,
        flags=re.M | re.S,
    )
    if section:
        for line in section.group(1).splitlines():
            line = _strip_comment(line).lstrip("-").strip()
            line = line.strip("`").strip()
            if line and not line.startswith("以下") and not line.startswith("禁止"):
                if line.endswith("/") or line in ("node_modules", ".git"):
                    result["forbidden_dirs"].append(line.rstrip("/"))
                else:
                    result["forbidden_files"].append(line.rstrip("/"))

    # 2) Token Limits 区块：'- max_session_tokens: 500000' 形式
    token_section = re.search(
        r"^##\s+Token Limits\s*$(.*?)(?=^##\s|\Z)",
        text,
        flags=re.M | re.S,
    )
    if token_section:
        for line in token_section.group(1).splitlines():
            clean = _strip_comment(line).lstrip("-").strip()
            # 兼容 Markdown 反引号包裹与行尾尾注：`max_session_tokens: 500000` — 单会话上限
            clean = clean.strip("`").strip()
            match = re.match(r"^([a-z_]+)\s*:\s*(\d+)\b", clean)
            if match:
                result["token_limits"][match.group(1)] = int(match.group(2))
    return result


def sync_governance_config(parsed: Optional[Dict] = None) -> Dict:
    """把 AGENTS.md 解析结果同步进 .codex/governance.json（宪法优先）。"""
    parsed = parsed or parse_agents_md()
    config: Dict = {}
    if GOVERNANCE_JSON.exists():
        try:
            config = json.loads(GOVERNANCE_JSON.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            config = {}

    blacklist = config.setdefault("blacklist", {})
    if parsed.get("forbidden_dirs"):
        # AGENTS.md 为唯一源：每次解析覆盖，避免残留过期条目
        blacklist["directories"] = list(dict.fromkeys(parsed["forbidden_dirs"]))
    if parsed.get("forbidden_files"):
        blacklist["files"] = list(dict.fromkeys(parsed["forbidden_files"]))

    limits = config.setdefault("token_guardrails", {})
    for key, value in parsed.get("token_limits", {}).items():
        limits[key] = value
    for key, value in DEFAULT_GUARDRAILS.items():
        limits.setdefault(key, value)

    config.setdefault("version", "1.0.0")
    config.setdefault("project", "git008")
    config.setdefault("scope", "workspace-only")
    config["constitution"] = {
        "file": "AGENTS.md",
        "dynamic_parse": True,
        "last_synced": parsed.get("parsed_at"),
    }
    GOVERNANCE_JSON.parent.mkdir(parents=True, exist_ok=True)
    GOVERNANCE_JSON.write_text(
        json.dumps(config, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return config


def load_guardrails() -> Dict:
    """加载当前护栏（governance.json > 默认值）。"""
    guardrails = dict(DEFAULT_GUARDRAILS)
    if GOVERNANCE_JSON.exists():
        try:
            stored = json.loads(GOVERNANCE_JSON.read_text(encoding="utf-8"))
            guardrails.update(stored.get("token_guardrails", {}))
        except (json.JSONDecodeError, OSError):
            pass
    return guardrails


def load_blacklist() -> Dict:
    """加载当前黑名单（AGENTS.md 已同步进 governance.json）。"""
    blacklist = {"directories": [], "files": []}
    if GOVERNANCE_JSON.exists():
        try:
            stored = json.loads(GOVERNANCE_JSON.read_text(encoding="utf-8"))
            blacklist.update(stored.get("blacklist", {}))
        except (json.JSONDecodeError, OSError):
            pass
    return blacklist


# ============================================================
# 事件日志（供 UI / 控制台读取）
# ============================================================
def _append_event(event: Dict) -> None:
    try:
        EVENT_LOG.parent.mkdir(parents=True, exist_ok=True)
        event.setdefault("ts", datetime.now(timezone.utc).isoformat())
        with EVENT_LOG.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, ensure_ascii=False) + "\n")
    except OSError:
        pass


def recent_events(limit: int = 50) -> List[Dict]:
    if not EVENT_LOG.exists():
        return []
    try:
        lines = EVENT_LOG.read_text(encoding="utf-8").splitlines()
        return [json.loads(l) for l in lines[-limit:] if l.strip()]
    except (OSError, json.JSONDecodeError):
        return []


# ============================================================
# Token 实时大盘 & 自动熔断器
# ============================================================
def _load_ledger() -> Dict:
    if TOKEN_LEDGER.exists():
        try:
            return json.loads(TOKEN_LEDGER.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {
        "session": {"started_at": None, "tokens": 0, "requests": 0, "rounds": 0},
        "daily": {"date": None, "tokens": 0},
        "tripped": False,
        "tripped_at": None,
    }


def _save_ledger(ledger: Dict) -> None:
    TOKEN_LEDGER.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_LEDGER.write_text(
        json.dumps(ledger, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def record_token_usage(tokens: int, *, request: bool = True, round_: bool = False) -> Dict:
    """记录一次 Token 消耗（请求 / 对话轮），返回实时大盘快照。"""
    ledger = _load_ledger()
    today = _today()
    if ledger["daily"].get("date") != today:
        ledger["daily"] = {"date": today, "tokens": 0}
    if ledger["session"].get("started_at") is None:
        ledger["session"]["started_at"] = datetime.now(timezone.utc).isoformat()

    tokens = max(0, int(tokens))
    ledger["session"]["tokens"] += tokens
    ledger["session"]["requests"] += 1 if request else 0
    ledger["session"]["rounds"] += 1 if round_ else 0
    ledger["daily"]["tokens"] += tokens
    _save_ledger(ledger)
    return snapshot_token_usage()


def snapshot_token_usage() -> Dict:
    """Token 实时大盘快照：当前会话 / 全天 / 护栏 / 熔断状态。"""
    ledger = _load_ledger()
    guardrails = load_guardrails()
    session = ledger["session"]
    daily = ledger["daily"]
    today = _today()

    session_tokens = session.get("tokens", 0)
    daily_tokens = daily.get("tokens", 0) if daily.get("date") == today else 0
    max_session = int(guardrails.get("max_session_tokens", 500000))
    max_daily = int(guardrails.get("daily_budget_tokens", 2000000))

    tripped = bool(ledger.get("tripped"))
    trip_reasons = []
    if session_tokens >= max_session:
        trip_reasons.append(f"单会话超限 {session_tokens:,}/{max_session:,}")
    if daily_tokens >= max_daily:
        trip_reasons.append(f"全天超限 {daily_tokens:,}/{max_daily:,}")
    if trip_reasons and not tripped:
        tripped = True
        ledger["tripped"] = True
        ledger["tripped_at"] = datetime.now(timezone.utc).isoformat()
        ledger["trip_reasons"] = trip_reasons
        _save_ledger(ledger)
        _append_event({"type": "CIRCUIT_TRIP", "reasons": trip_reasons})

    return {
        "session_tokens": session_tokens,
        "session_requests": session.get("requests", 0),
        "session_rounds": session.get("rounds", 0),
        "session_started_at": session.get("started_at"),
        "daily_tokens": daily_tokens,
        "daily_date": today,
        "max_session_tokens": max_session,
        "max_request_tokens": int(guardrails.get("max_request_tokens", 80000)),
        "max_context_tokens": int(guardrails.get("max_context_tokens", 100000)),
        "context_warn_rounds": int(guardrails.get("context_warn_rounds", 5)),
        "daily_budget_tokens": max_daily,
        "tripped": tripped,
        "trip_reasons": ledger.get("trip_reasons", []),
        "tripped_at": ledger.get("tripped_at"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def check_request(tokens: int) -> Dict:
    """单次请求护栏：超限拒绝；已熔断时 Force Stop。"""
    snap = snapshot_token_usage()
    guardrails = load_guardrails()
    max_request = int(guardrails.get("max_request_tokens", 80000))
    if tokens > max_request:
        _append_event({
            "type": "REQUEST_BLOCKED",
            "tokens": tokens,
            "max_request_tokens": max_request,
            "message": f"单次请求 {tokens:,} > 上限 {max_request:,}，已拒绝",
        })
        return {
            "allowed": False,
            "reason": "request_too_large",
            "message": f"❌ 单次请求 {tokens:,} Tokens 超过上限 {max_request:,}，已拒绝执行。",
            "snapshot": snap,
        }
    if snap["tripped"]:
        return {
            "allowed": False,
            "reason": "circuit_tripped",
            "message": "⛔ 自动熔断器已触发（Force Stop），会话被强制切断，请运行 /clear 后重试。",
            "snapshot": snap,
        }
    return {"allowed": True, "message": "✅ 请求放行", "snapshot": snap}


def check_context(context_tokens: Optional[int] = None, rounds: Optional[int] = None) -> Dict:
    """上下文膨胀检测：> 5 轮或 ≥ 10 万 Token → 弹窗提醒运行 /clear。"""
    snap = snapshot_token_usage()
    guardrails = load_guardrails()
    max_ctx = int(guardrails.get("max_context_tokens", 100000))
    warn_rounds = int(guardrails.get("context_warn_rounds", 5))
    rounds = snap["session_rounds"] if rounds is None else int(rounds)
    ctx_tokens = snap["session_tokens"] if context_tokens is None else int(context_tokens)

    reasons = []
    if ctx_tokens >= max_ctx:
        reasons.append(f"上下文 {ctx_tokens:,} ≥ {max_ctx:,} Tokens")
    if rounds >= warn_rounds:
        reasons.append(f"连续对话 {rounds} 轮 ≥ {warn_rounds} 轮")
    if reasons:
        _append_event({
            "type": "CONTEXT_WARN",
            "context_tokens": ctx_tokens,
            "rounds": rounds,
            "message": "上下文膨胀，请立刻运行 /clear",
        })
        return {
            "warn": True,
            "message": "⚠️ 上下文膨胀，请立刻运行 /clear 清空会话！",
            "reasons": reasons,
            "clear_command": "/clear",
            "snapshot": snap,
        }
    return {"warn": False, "message": "✅ 上下文健康", "snapshot": snap}


def force_stop(reason: str = "manual") -> Dict:
    """手动/自动 Force Stop：切断会话并记录熔断事件。"""
    ledger = _load_ledger()
    ledger["tripped"] = True
    ledger["tripped_at"] = datetime.now(timezone.utc).isoformat()
    ledger["trip_reasons"] = ledger.get("trip_reasons", []) + [reason]
    _save_ledger(ledger)
    _append_event({"type": "FORCE_STOP", "reason": reason})
    return {"stopped": True, "reason": reason, "snapshot": snapshot_token_usage()}


def reset_session() -> Dict:
    """一键清空会话（/clear 语义）：重置会话计数与熔断状态。"""
    ledger = _load_ledger()
    ledger["session"] = {"started_at": None, "tokens": 0, "requests": 0, "rounds": 0}
    ledger["tripped"] = False
    ledger["tripped_at"] = None
    ledger["trip_reasons"] = []
    _save_ledger(ledger)
    _append_event({"type": "SESSION_CLEARED"})
    return {"cleared": True, "snapshot": snapshot_token_usage()}


# ============================================================
# 违规阻断（禁读目录 / 敏感文件 / 超大文件）
# ============================================================
def check_path_allowed(
    target: str,
    *,
    project_root: Optional[Path] = None,
    max_file_bytes: int = 2 * 1024 * 1024,
) -> Dict:
    """Agent 试图读取路径前的门禁：黑名单目录/文件与超大文件阻断。"""
    root = Path(project_root or PROJECT_ROOT).resolve()
    target_path = Path(target).resolve()

    # 仅约束 git008 工作区内路径（作用域隔离）
    try:
        target_path.relative_to(root)
    except ValueError:
        return {"allowed": True, "message": "工作区外路径，不干预"}

    blacklist = load_blacklist()
    for entry in blacklist.get("directories", []):
        # 按路径组件名匹配（output/、work/ 等在任何层级均生效）
        if entry in target_path.parts:
            msg = f"⛔ 禁读目录：{entry}/（来自 AGENTS.md 黑名单动态同步），已阻断。"
            _append_event({"type": "PATH_BLOCKED", "path": str(target_path), "rule": entry, "message": msg})
            return {"allowed": False, "reason": "forbidden_directory", "message": msg}
    for entry in blacklist.get("files", []):
        if target_path.name == entry:
            msg = f"⛔ 敏感文件：{entry}（来自 AGENTS.md 黑名单），已阻断。"
            _append_event({"type": "PATH_BLOCKED", "path": str(target_path), "rule": entry, "message": msg})
            return {"allowed": False, "reason": "forbidden_file", "message": msg}
    if target_path.is_file() and target_path.stat().st_size > max_file_bytes:
        size_mb = target_path.stat().st_size / 1024 / 1024
        msg = f"⛔ 超大文件 {target_path.name}（{size_mb:.1f}MB > {max_file_bytes // 1024 // 1024}MB），已阻断防止刷屏。"
        _append_event({"type": "FILE_BLOCKED", "path": str(target_path), "message": msg})
        return {"allowed": False, "reason": "file_too_large", "message": msg}
    return {"allowed": True, "message": "✅ 路径放行"}


def task_done_reminder() -> Dict:
    """任务完成提醒：按 AGENTS.md 准则提示运行 /clear 清空上下文。"""
    snap = snapshot_token_usage()
    _append_event({"type": "TASK_DONE_REMINDER", "message": "任务完成，请运行 /clear 清空上下文"})
    return {
        "remind": True,
        "message": "✅ 任务完成。上下文已使用 {} 轮 / {} Tokens —— 请运行 /clear 清空上下文，保持会话健康。".format(
            snap["session_rounds"], f"{snap['session_tokens']:,}"
        ),
        "clear_command": "/clear",
        "snapshot": snap,
    }


def boot_hooks() -> Dict:
    """治理钩子启动自检：解析宪法 → 同步配置 → 输出 Token 大盘。"""
    if not is_git008_workspace():
        return {
            "active": False,
            "message": "非 git008 工作区，治理联动不加载。",
        }
    parsed = parse_agents_md()
    config = sync_governance_config(parsed)
    snap = snapshot_token_usage()
    _append_event({"type": "HOOKS_BOOT", "constitution": parsed.get("constitution_file")})
    return {
        "active": True,
        "workspace": str(PROJECT_ROOT),
        "constitution_parsed": parsed.get("forbidden_dirs"),
        "governance_json": str(GOVERNANCE_JSON),
        "token_snapshot": snap,
    }


# ============================================================
# CLI
# ============================================================
def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="git008 治理钩子 — AGENTS.md 宪法联动")
    parser.add_argument("--boot", action="store_true", help="启动自检并同步宪法")
    parser.add_argument("--snapshot", action="store_true", help="输出 Token 实时大盘")
    parser.add_argument("--record", type=int, metavar="TOKENS", help="记录一次 Token 消耗")
    parser.add_argument("--round", action="store_true", help="记录一次对话轮次")
    parser.add_argument("--check-request", type=int, metavar="TOKENS", help="单次请求护栏检查")
    parser.add_argument("--check-context", action="store_true", help="上下文膨胀检查")
    parser.add_argument("--check-path", metavar="PATH", help="路径黑名单检查")
    parser.add_argument("--force-stop", action="store_true", help="强制 Force Stop")
    parser.add_argument("--reset", action="store_true", help="一键清空会话 (/clear)")
    parser.add_argument("--task-done", action="store_true", help="任务完成提醒")
    args = parser.parse_args(argv)

    if not is_git008_workspace():
        print(json.dumps({"active": False, "message": "非 git008 工作区"}, ensure_ascii=False, indent=2))
        return 0

    result = None
    if args.boot:
        result = boot_hooks()
    elif args.snapshot:
        result = snapshot_token_usage()
    elif args.record is not None:
        result = record_token_usage(args.record, round_=args.round)
    elif args.check_request is not None:
        result = check_request(args.check_request)
    elif args.check_context:
        result = check_context()
    elif args.check_path:
        result = check_path_allowed(args.check_path)
    elif args.force_stop:
        result = force_stop("cli")
    elif args.reset:
        result = reset_session()
    elif args.task_done:
        result = task_done_reminder()
    else:
        result = boot_hooks()

    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())


__all__ = [
    "is_git008_workspace",
    "parse_agents_md",
    "sync_governance_config",
    "load_guardrails",
    "load_blacklist",
    "record_token_usage",
    "snapshot_token_usage",
    "check_request",
    "check_context",
    "force_stop",
    "reset_session",
    "check_path_allowed",
    "task_done_reminder",
    "boot_hooks",
    "recent_events",
    "PROJECT_ROOT",
    "GOVERNANCE_JSON",
]
