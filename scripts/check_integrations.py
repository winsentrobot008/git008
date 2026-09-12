# -*- coding: utf-8 -*-
"""check_integrations.py — bb-browser / Computer Use 集成健康检查。

验证项：
  1. config.toml 解析（集成配置是否可读）
  2. bb-browser 二进制与版本
  3. bb-browser daemon 状态（--online 时；Chrome/CDP 通道）
  4. Chrome 响应状态（bb-browser status）
  5. 站点 adapter 数量（社区库可用性）
  6. Computer Use 后端可用性（pyautogui / powershell / mcp）
  7. 本地屏幕控制接口（读取屏幕尺寸，不注入输入）
  8. 会话状态（交互 / 锁屏 / 无人值守）

用法：
  python scripts/check_integrations.py            # 在线轻量检查
  python scripts/check_integrations.py --offline  # 跳过 daemon/浏览器在线探测
  python scripts/check_integrations.py --strict   # warn 也按失败退出
  python scripts/check_integrations.py --json     # 只输出 JSON 报告

退出码：0 = 无失败；1 = 存在 fail（或 --strict 下存在 warn）。
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
for entry in (str(ROOT_DIR),):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from services.config import load_config  # noqa: E402
from services.crawler.bb_browser import BbBrowserClient  # noqa: E402
from services.gui_automation.computer_use import ComputerUseController  # noqa: E402

REPORT_DIR = ROOT_DIR / "runtime_data" / "logs"


def _check(name: str, level: str, detail: str) -> dict:
    return {"name": name, "level": level, "ok": level == "ok", "detail": detail}


def run_checks(*, online: bool, strict: bool) -> tuple[list[dict], dict]:
    checks: list[dict] = []

    # 1. 配置解析
    cfg = load_config()
    if cfg.source_file is not None:
        checks.append(_check("config/config.toml", "ok", f"解析成功: {cfg.source_file}"))
    elif hasattr(cfg, "_load_error"):
        checks.append(_check("config/config.toml", "warn", f"解析失败({getattr(cfg, '_load_error')})，使用默认配置"))
    else:
        checks.append(_check("config/config.toml", "warn", "未找到 config/config.toml，使用默认配置"))

    # 2-5. bb-browser
    client = BbBrowserClient(cfg.bb_browser)
    if not client.available:
        checks.append(_check("bb-browser.binary", "fail", "未找到 bb-browser（BB_BROWSER_BIN 或 npm 全局）"))
    else:
        checks.append(_check("bb-browser.binary", "ok", f"二进制: {client.bin}"))
        version = client.version()
        checks.append(
            _check(
                "bb-browser.version",
                "ok" if version.ok else "warn",
                f"版本: {version.data if version.ok else version.error}",
            )
        )
        if online:
            daemon = client.daemon_status()
            checks.append(
                _check(
                    "bb-browser.daemon",
                    "ok" if daemon.ok else "warn",
                    f"daemon: {daemon.data if daemon.ok else (daemon.error or '未运行')}",
                )
            )
            if daemon.ok:
                browser = client._run(["status", "--json"], json_mode=True)
                browser_data = browser.data if browser.ok else None
                reachable = browser.ok and not (
                    isinstance(browser_data, dict) and browser_data.get("running") is False
                )
                checks.append(
                    _check(
                        "chrome.cdp_response",
                        "ok" if reachable else "warn",
                        f"Chrome/CDP: {browser_data if browser.ok else (browser.error or '无响应')}",
                    )
                )
            else:
                checks.append(
                    _check(
                        "chrome.cdp_response",
                        "warn",
                        f"跳过（daemon 未就绪：{daemon.error}）",
                    )
                )
            sites = client.site_list()
            count = "0"
            if sites.ok:
                data = sites.data
                count = str(len(data) if isinstance(data, list) else len(data or {}))
            checks.append(
                _check(
                    "bb-browser.adapters",
                    "ok" if sites.ok else "warn",
                    f"站点 adapter 数量: {count}{'（拉取失败: %s）' % (sites.error or '') if not sites.ok else ''}",
                )
            )
        else:
            checks.append(_check("bb-browser.daemon", "warn", "offline 模式跳过在线探测"))
            checks.append(_check("chrome.cdp_response", "warn", "offline 模式跳过在线探测"))
            checks.append(_check("bb-browser.adapters", "warn", "offline 模式跳过在线探测"))

    # 6-8. Computer Use
    controller = ComputerUseController(cfg.computer_use)
    health = controller.health()
    backends = health.get("backends", [])
    ready = [b for b in backends if b.get("ok")]
    if not backends:
        checks.append(_check("computer_use.backends", "fail", "未配置任何后端"))
    elif ready:
        checks.append(
            _check(
                "computer_use.backends",
                "ok",
                "可用: " + ", ".join(f"{b.get('backend')}({b.get('screen') or '?'})" for b in ready),
            )
        )
    else:
        errors = "; ".join(f"{b.get('backend')}:{b.get('error')}" for b in backends)
        checks.append(_check("computer_use.backends", "fail", f"全部后端不可用：{errors}"))

    screen = health.get("screen")
    checks.append(
        _check(
            "screen.control_interface",
            "ok" if screen else "warn",
            f"屏幕控制接口（只读探测）: {screen or '无法读取屏幕尺寸'}",
        )
    )
    session = health.get("session", {})
    session_level = "ok" if not session.get("unattended") else "warn"
    checks.append(
        _check(
            "session.state",
            session_level,
            f"交互={session.get('interactive')} 锁屏={session.get('locked')} "
            f"断开={session.get('disconnected')} 无人值守={session.get('unattended')}",
        )
    )

    summary = {"ok": 0, "warn": 0, "fail": 0}
    for c in checks:
        summary[c["level"]] += 1
    exit_code = 0 if summary["fail"] == 0 and not (strict and summary["warn"] > 0) else 1
    return checks, {"summary": summary, "exit_code": exit_code}


def main() -> int:
    parser = argparse.ArgumentParser(description="GIT008 集成健康检查")
    parser.add_argument("--offline", action="store_true", help="跳过 daemon/浏览器在线探测")
    parser.add_argument("--strict", action="store_true", help="warn 也按失败退出")
    parser.add_argument("--json", action="store_true", dest="json_only", help="只输出 JSON 报告")
    args = parser.parse_args()

    checks, meta = run_checks(online=not args.offline, strict=args.strict)
    report = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "mode": "offline" if args.offline else "online",
        "strict": args.strict,
        **meta,
        "checks": checks,
    }
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_file = REPORT_DIR / f"integration_checks_{time.strftime('%Y%m%dT%H%M%S')}.json"
    report_file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.json_only:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"[check_integrations] 报告: {report_file}")
        for c in checks:
            flag = "✅" if c["level"] == "ok" else ("⚠️" if c["level"] == "warn" else "❌")
            print(f"{flag} [{c['level']}] {c['name']}: {c['detail']}")
        print(f"summary: ok={report['summary']['ok']} warn={report['summary']['warn']} fail={report['summary']['fail']}")
    return report["exit_code"]


if __name__ == "__main__":
    sys.exit(main())
