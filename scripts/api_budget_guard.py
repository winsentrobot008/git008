# -*- coding: utf-8 -*-
r"""
api_budget_guard.py — 单次 Task API 消耗保护锁（L0 本地静默守护）
====================================================================
- 为每个任务登记 / 累计 API 调用次数、Token 消耗与成本（USD）。
- 达到 clinerules.yaml 中 api_cost_governance.task_budget 上限即触发熔断（circuit_break），
  防止 Agent 陷入死循环调用导致 DeepSeek API 成本失控。
- 纯本地执行，零 API 成本；符合宪法 Article 5.10 第 3 条（单次 Task 保护锁）。

用法:
    python scripts/api_budget_guard.py start  --task <task_id>
    python scripts/api_budget_guard.py record  --task <task_id> --tokens 1234 [--usd 0.01] [--api-call]
    python scripts/api_budget_guard.py check   --task <task_id>
    python scripts/api_budget_guard.py end     --task <task_id>

退出码: 0 = 预算内 / 操作成功; 1 = 达到上限触发熔断 / 参数错误
"""
import argparse
import json
import sys
import time
from pathlib import Path

# ---------- 路径锚定：git008 根目录 ----------
ROOT_DIR = Path(__file__).resolve().parent.parent
LEDGER_DIR = ROOT_DIR / "runtime_data" / "data" / "api_budget"
LEDGER_FILE = LEDGER_DIR / "api_budget_ledger.json"

# ---------- 默认预算（与 clinerules.yaml 的 api_cost_governance.task_budget 一致） ----------
DEFAULT_LIMITS = {
    "max_api_calls_per_task": 50,
    "max_tokens_per_task": 300000,
    "max_usd_per_task": 1.0,
}

# ---------- 配置读取（零依赖优先；yaml 可用时读取唯一源） ----------
CONFIG_SOURCE = ROOT_DIR / "factory_components" / "tools" / "Cline-anti-freeze" / "clinerules.yaml"


def _load_limits():
    """从 clinerules.yaml 读取 task_budget；读取失败则回退默认值。"""
    limits = dict(DEFAULT_LIMITS)
    try:
        import yaml  # 可选依赖

        if CONFIG_SOURCE.exists():
            data = yaml.safe_load(CONFIG_SOURCE.read_text(encoding="utf-8"))
            tb = (data or {}).get("governance", {}).get("api_cost_governance", {}).get("task_budget", {})
            if tb.get("max_api_calls_per_task"):
                limits["max_api_calls_per_task"] = int(tb["max_api_calls_per_task"])
            if tb.get("max_tokens_per_task"):
                limits["max_tokens_per_task"] = int(tb["max_tokens_per_task"])
            if tb.get("max_usd_per_task"):
                limits["max_usd_per_task"] = float(tb["max_usd_per_task"])
    except Exception:
        pass  # 无 PyYAML 时使用默认值
    return limits


def _load_ledger():
    if LEDGER_FILE.exists():
        try:
            return json.loads(LEDGER_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_ledger(ledger):
    LEDGER_DIR.mkdir(parents=True, exist_ok=True)
    LEDGER_FILE.write_text(
        json.dumps(ledger, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _new_task_state(task_id):
    return {
        "task_id": task_id,
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "ended_at": None,
        "api_calls": 0,
        "tokens": 0,
        "usd": 0.0,
        "circuit_break": False,
        "log": [],
    }


def _exceeded(state, limits):
    """任一指标达到/超过上限即视为超限熔断。"""
    if state["circuit_break"]:
        return True
    return (
        state["api_calls"] >= limits["max_api_calls_per_task"]
        or state["tokens"] >= limits["max_tokens_per_task"]
        or state["usd"] >= limits["max_usd_per_task"]
    )


def cmd_start(task_id, limits):
    ledger = _load_ledger()
    state = _new_task_state(task_id)
    state["limits"] = dict(limits)
    ledger[task_id] = state
    _save_ledger(ledger)
    print(f"[BudgetGuard] start task={task_id} limits={limits}")
    return 0


def cmd_record(task_id, tokens, usd, api_call, limits):
    ledger = _load_ledger()
    state = ledger.get(task_id)
    if state is None:
        print(f"[BudgetGuard] ERROR: unknown task={task_id} (run start first)", file=sys.stderr)
        return 1
    if state["circuit_break"]:
        print(f"[BudgetGuard] CIRCUIT_BREAK task={task_id} already tripped; refusing further record")
        return 1
    state["tokens"] += max(0, tokens)
    state["usd"] = round(state["usd"] + max(0.0, usd), 6)
    if api_call:
        state["api_calls"] += 1
    state["log"].append({
        "t": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "tokens": tokens,
        "usd": usd,
        "api_call": api_call,
    })
    tripped = _exceeded(state, limits)
    if tripped:
        state["circuit_break"] = True
        state["ended_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    _save_ledger(ledger)
    summary = (f"calls={state['api_calls']}/{limits['max_api_calls_per_task']} "
               f"tokens={state['tokens']}/{limits['max_tokens_per_task']} "
               f"usd={state['usd']:.4f}/{limits['max_usd_per_task']}")
    if tripped:
        print(f"[BudgetGuard] CIRCUIT_BREAK task={task_id} exceeded budget ({summary})")
        return 1
    print(f"[BudgetGuard] recorded task={task_id} {summary}")
    return 0


def cmd_check(task_id, limits):
    ledger = _load_ledger()
    state = ledger.get(task_id)
    if state is None:
        print(f"[BudgetGuard] OK task={task_id} (no ledger entry)")
        return 0
    tripped = _exceeded(state, limits)
    summary = (f"calls={state['api_calls']}/{limits['max_api_calls_per_task']} "
               f"tokens={state['tokens']}/{limits['max_tokens_per_task']} "
               f"usd={state['usd']:.4f}/{limits['max_usd_per_task']}")
    if tripped:
        print(f"[BudgetGuard] CIRCUIT_BREAK task={task_id} ({summary})")
        return 1
    print(f"[BudgetGuard] OK task={task_id} ({summary})")
    return 0


def cmd_end(task_id):
    ledger = _load_ledger()
    state = ledger.get(task_id)
    if state is None:
        print(f"[BudgetGuard] ERROR: unknown task={task_id}", file=sys.stderr)
        return 1
    state["ended_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    _save_ledger(ledger)
    print(f"[BudgetGuard] end task={task_id}")
    return 0


def main():
    parser = argparse.ArgumentParser(description="单次 Task API 消耗保护锁（本地静默）")
    sub = parser.add_subparsers(dest="action", required=True)

    p_start = sub.add_parser("start", help="登记任务并初始化预算")
    p_start.add_argument("--task", required=True)

    p_rec = sub.add_parser("record", help="登记一次 API 消耗")
    p_rec.add_argument("--task", required=True)
    p_rec.add_argument("--tokens", type=int, default=0, help="本次消耗 Token 数")
    p_rec.add_argument("--usd", type=float, default=0.0, help="本次成本（USD）")
    p_rec.add_argument("--api-call", action="store_true", dest="api_call", help="计数为一次 API 调用")

    p_chk = sub.add_parser("check", help="检查任务预算是否超限")
    p_chk.add_argument("--task", required=True)

    p_end = sub.add_parser("end", help="结束任务")
    p_end.add_argument("--task", required=True)

    args = parser.parse_args()
    limits = _load_limits()

    if args.action == "start":
        return cmd_start(args.task, limits)
    if args.action == "record":
        return cmd_record(args.task, args.tokens, args.usd, args.api_call, limits)
    if args.action == "check":
        return cmd_check(args.task, limits)
    if args.action == "end":
        return cmd_end(args.task)
    return 1


if __name__ == "__main__":
    sys.exit(main())
