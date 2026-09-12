#!/usr/bin/env python3
"""
auto_enforce.py — Cline-anti-freeze Token 控费规则执行器 (CLI-only, v2.0)
=========================================================================
纯命令行工具，无任何后台常驻进程、无端口监听、无 UI 启动。

职责（单次巡检 / 按需调用）：
  1. 读取 .codex/governance.json 中的 Auto-Clear 阈值（软 80k / 硬 100k / 轮数）
  2. 依据 codex_metrics 实时报告判定 SOFT / CRITICAL 熔断
  3. 将 /clear 信号落盘到 governance_logs/auto_clear_signal.json
  4. 大文件全文读取门禁（长上下文模式下阻断 >500 行全文读取）

自 2026-08-23 起，VS Code 治理侧边栏（cline-governance-center v3.0）已接管
Token 熔断触发器与 Auto-Clear 信号生命周期，本工具仅作为 CLI 兜底入口，
不再提供 --monitor / 自动拉起治理面板等常驻能力。

用法：
  python auto_enforce.py --auto-clear-config      # 输出当前 Auto-Clear 配置
  python auto_enforce.py --enforce                 # 执行一轮自动治理巡检
  python auto_enforce.py --check-read PATH         # 检查大文件读取门禁
"""

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

# ============================================================
# Paths
# ============================================================
THIS_DIR = Path(__file__).resolve().parent


def _find_workspace_root(start: Path) -> Path:
    """向上锚定 git008 工作区根：首个包含 .codex/governance.json 的目录。"""
    for parent in (start, *start.parents):
        if (parent / ".codex" / "governance.json").exists():
            return parent
    return start.parents[-1] if start.parents else start


WORKSPACE_ROOT = _find_workspace_root(THIS_DIR)
GOVERNANCE_JSON = WORKSPACE_ROOT / ".codex" / "governance.json"
GOVERNANCE_LOGS_DIR = THIS_DIR / "governance_logs"
AUTO_CLEAR_SIGNAL_FILE = GOVERNANCE_LOGS_DIR / "auto_clear_signal.json"
AUTO_CLEAR_EVENT_LOG = GOVERNANCE_LOGS_DIR / "auto_clear_events.jsonl"
READ_BLOCK_EVENT_LOG = GOVERNANCE_LOGS_DIR / "read_block_events.jsonl"

DEFAULT_AUTO_CLEAR = {
    "auto_clear_enabled": True,
    "max_context_tokens": 80000,
    "max_turns": 5,
}
DEFAULT_HARD_CONTEXT_TOKENS = 100000
MAX_LINES_FULL_READ = 500  # 长上下文模式下禁止全文读取的行数上限


# ============================================================
# Auto-Clear 配置
# ============================================================
def load_auto_clear_config() -> Dict:
    """读取 .codex/governance.json 中的自动清理配置（实时生效，带兜底默认值）。"""
    cfg = dict(DEFAULT_AUTO_CLEAR)
    cfg["hard_context_tokens"] = DEFAULT_HARD_CONTEXT_TOKENS
    if GOVERNANCE_JSON.exists():
        try:
            data = json.loads(GOVERNANCE_JSON.read_text(encoding="utf-8"))
            for key in ("auto_clear_enabled", "max_context_tokens", "max_turns"):
                if key in data and isinstance(data[key], (int, float, bool)):
                    cfg[key] = data[key]
            nested = data.get("auto_clear", {})
            if isinstance(nested, dict):
                for key in ("auto_clear_enabled", "max_context_tokens", "max_turns"):
                    if key in nested and isinstance(nested[key], (int, float, bool)):
                        cfg[key] = nested[key]
            # 100k 硬熔断线来自 token_guardrails（保留原语义）
            tg = data.get("token_guardrails", {})
            hard = tg.get("max_context_tokens")
            if isinstance(hard, (int, float)):
                cfg["hard_context_tokens"] = int(hard)
        except (json.JSONDecodeError, OSError):
            pass
    cfg["auto_clear_enabled"] = bool(cfg.get("auto_clear_enabled", True))
    cfg["max_context_tokens"] = int(cfg.get("max_context_tokens", 80000))
    cfg["max_turns"] = int(cfg.get("max_turns", 5))
    cfg["hard_context_tokens"] = int(cfg.get("hard_context_tokens", DEFAULT_HARD_CONTEXT_TOKENS))
    return cfg


def save_auto_clear_enabled(enabled: bool) -> Dict:
    """持久化 Auto-Clear 开关到 .codex/governance.json。"""
    cfg: Dict = {}
    if GOVERNANCE_JSON.exists():
        try:
            cfg = json.loads(GOVERNANCE_JSON.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            cfg = {}
    cfg["auto_clear_enabled"] = bool(enabled)
    GOVERNANCE_JSON.parent.mkdir(parents=True, exist_ok=True)
    GOVERNANCE_JSON.write_text(
        json.dumps(cfg, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return load_auto_clear_config()


def get_codex_metrics() -> Optional[Dict]:
    """获取 codex_metrics 实时报告（context_tokens / rounds / breach）。"""
    try:
        sys.path.insert(0, str(THIS_DIR))
        from codex_metrics import compute_codex_report
        return compute_codex_report()
    except Exception as exc:
        print(f"[auto_enforce] ⚠️ codex_metrics 读取失败: {exc}")
        return None


# ============================================================
# 信号写入
# ============================================================
def _append_event(event: Dict) -> None:
    """追加一条 auto-clear 事件到 governance_logs（供侧边栏面板消费）。"""
    try:
        GOVERNANCE_LOGS_DIR.mkdir(parents=True, exist_ok=True)
        event.setdefault("ts", datetime.now().astimezone().isoformat())
        with AUTO_CLEAR_EVENT_LOG.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, ensure_ascii=False) + "\n")
    except OSError:
        pass


def write_clear_signal(
    reason: str,
    *,
    context_tokens: int,
    rounds: int,
    severity: str = "SOFT",
    enabled: bool = True,
) -> Dict:
    """
    向 governance_logs/auto_clear_signal.json 写入 /clear 指令信号。
    - 软提醒（SOFT）：Context ≥ 80k 或轮数 ≥ 5
    - 硬熔断（CRITICAL）：Context ≥ 100k
    - 恢复（NONE）：上下文回落至阈值以下时清除旧信号
    """
    GOVERNANCE_LOGS_DIR.mkdir(parents=True, exist_ok=True)
    signal = {
        "command": "/clear" if severity != "NONE" else None,
        "severity": severity,
        "reason": reason,
        "context_tokens": int(context_tokens),
        "rounds": int(rounds),
        "auto_clear_enabled": bool(enabled),
        "written_at": datetime.now().astimezone().isoformat(),
        "source": "auto_enforce.py",
    }
    try:
        AUTO_CLEAR_SIGNAL_FILE.write_text(
            json.dumps(signal, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        _append_event({"type": "AUTO_CLEAR_SIGNAL", **signal})
        print(f"[auto_enforce] ⚡ /clear 信号已写入 {AUTO_CLEAR_SIGNAL_FILE.name} | {reason} | {severity}")
    except OSError as exc:
        print(f"[auto_enforce] ⚠️ /clear 信号写入失败: {exc}")
    return signal


# ============================================================
# 核心自动治理规则（单次巡检）
# ============================================================
def check_context_rules(report: Optional[Dict] = None) -> Dict:
    """
    核心自动治理规则（每次巡检执行）：
      1. Context ≥ max_context_tokens(80k) 或轮数 ≥ max_turns(5) → 软提醒 + /clear 指令注入
      2. Context ≥ 100k 硬熔断线 → 强阻断 /clear 信号
    """
    cfg = load_auto_clear_config()
    result = {
        "active": bool(cfg.get("auto_clear_enabled")),
        "soft_breach": False,
        "hard_breach": False,
        "reasons": [],
        "clear_signal": None,
        "metrics": None,
        "thresholds": cfg,
    }
    report = report if report is not None else get_codex_metrics()
    if not report:
        return result

    metrics = report.get("metrics", {})
    ctx = int(metrics.get("context_tokens", 0))
    rounds = int(report.get("rounds", 0))
    soft_ctx = int(cfg["max_context_tokens"])
    hard_ctx = int(cfg["hard_context_tokens"])
    max_turns = int(cfg["max_turns"])
    result["metrics"] = {"context_tokens": ctx, "rounds": rounds}

    reasons = []
    if ctx >= soft_ctx:
        reasons.append(f"Context {ctx:,} ≥ {soft_ctx:,} Tokens")
    if rounds >= max_turns:
        reasons.append(f"对话轮数 {rounds} ≥ {max_turns} 轮")
    if reasons and cfg.get("auto_clear_enabled"):
        result["soft_breach"] = True
        result["reasons"] = reasons
        result["clear_signal"] = write_clear_signal(
            "auto_clear_soft",
            context_tokens=ctx,
            rounds=rounds,
            severity="SOFT",
            enabled=cfg.get("auto_clear_enabled", True),
        )

    if ctx >= hard_ctx:
        result["hard_breach"] = True
        result["clear_signal"] = write_clear_signal(
            "circuit_breaker_100k",
            context_tokens=ctx,
            rounds=rounds,
            severity="CRITICAL",
            enabled=cfg.get("auto_clear_enabled", True),
        )
    return result


def run_enforcement_cycle() -> Dict:
    """执行一轮自动治理巡检：检测 → 软提醒/指令注入 → 硬熔断信号。"""
    result = check_context_rules()
    state = result.get("metrics")
    print(
        f"[auto_enforce] 规则巡检: soft_breach={result.get('soft_breach')} "
        f"hard_breach={result.get('hard_breach')} metrics={state}"
    )
    return result


# ============================================================
# 大文件读取门禁
# ============================================================
def count_file_lines(path) -> Optional[int]:
    """统计文件行数（不做全文读取缓存，逐行计数）。"""
    try:
        p = Path(path)
        if not p.is_file():
            return None
        n = 0
        with open(p, "r", encoding="utf-8", errors="replace") as fh:
            for _ in fh:
                n += 1
        return n
    except OSError:
        return None


def _append_read_block(path: Path, lines: int) -> None:
    try:
        GOVERNANCE_LOGS_DIR.mkdir(parents=True, exist_ok=True)
        event = {
            "type": "READ_BLOCKED",
            "path": str(path),
            "lines": lines,
            "max_lines": MAX_LINES_FULL_READ,
            "ts": datetime.now().astimezone().isoformat(),
        }
        with READ_BLOCK_EVENT_LOG.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(event, ensure_ascii=False) + "\n")
    except OSError:
        pass


def block_large_file_read(path, *, max_lines: int = MAX_LINES_FULL_READ) -> Dict:
    """大文件全文读取门禁：超过 max_lines(500) 行即阻断，强制分段读取或先总结。"""
    lines = count_file_lines(path)
    if lines is None:
        return {"allowed": True, "reason": "not_a_file", "message": "非文件或不可读，放行"}
    if lines > max_lines:
        msg = (
            f"⛔ 大文件读取阻断：{Path(path).name} 共 {lines} 行（> {max_lines} 行）。"
            "长上下文模式下禁止全文读取，请分段读取或先总结。"
        )
        _append_read_block(Path(path), lines)
        print(f"[auto_enforce] {msg}")
        return {
            "allowed": False,
            "reason": "file_too_long",
            "lines": lines,
            "max_lines": max_lines,
            "message": msg,
            "instruction": "分段读取（每段 ≤ 200 行），或先用 rg/检索定位目标代码块后再读取。",
        }
    return {
        "allowed": True,
        "reason": "ok",
        "lines": lines,
        "message": f"✅ 文件 {lines} 行，允许读取",
    }


def check_read_allowed(path, *, max_lines: int = MAX_LINES_FULL_READ) -> Dict:
    """读取门禁（自动阻断长上下文的一部分）：仅当 soft_breach 已触发时生效。"""
    state = check_context_rules()
    if state.get("soft_breach"):
        return block_large_file_read(path, max_lines=max_lines)
    lines = count_file_lines(path)
    return {
        "allowed": True,
        "reason": "context_healthy",
        "lines": lines,
        "message": "✅ 上下文健康，读取放行",
    }


# ============================================================
# CLI
# ============================================================
def enforce_cli() -> int:
    """独立 CLI 入口：--enforce / --check-read / --auto-clear-config。"""
    import argparse

    parser = argparse.ArgumentParser(description="auto_enforce Token 控费规则执行器 (CLI-only)")
    parser.add_argument("--enforce", action="store_true", help="执行一轮自动治理巡检")
    parser.add_argument("--check-read", metavar="PATH", help="检查大文件读取门禁")
    parser.add_argument("--max-read-lines", type=int, default=MAX_LINES_FULL_READ, help="读取阻断行数上限")
    parser.add_argument("--auto-clear-config", action="store_true", help="输出当前 Auto-Clear 配置")
    args = parser.parse_args()

    if args.auto_clear_config:
        print(json.dumps(load_auto_clear_config(), ensure_ascii=False, indent=2))
        return 0
    if args.enforce:
        print(json.dumps(run_enforcement_cycle(), ensure_ascii=False, indent=2))
        return 0
    if args.check_read:
        print(json.dumps(check_read_allowed(args.check_read, max_lines=args.max_read_lines), ensure_ascii=False, indent=2))
        return 0
    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(enforce_cli())
