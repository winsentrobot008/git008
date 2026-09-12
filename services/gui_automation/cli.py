"""GUI 自动化 CLI：python -m services.gui_automation。

用法示例：
  python -m services.gui_automation health          # 后端/会话状态（无副作用）
  python -m services.gui_automation status          # 锁屏/无人值守详情
  python -m services.gui_automation demo            # dry-run 演示动作
  python -m services.gui_automation run --script actions.json
  python -m services.gui_automation screenshot out.png
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from services.config import load_config
from services.gui_automation.computer_use import ComputerUseController


def _print_json(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def main(argv: list[str] | None = None) -> int:
    cfg = load_config()
    parser = argparse.ArgumentParser(description="GIT008 GUI 兜底层（Computer Use）")
    sub = parser.add_subparsers(dest="action", required=True)

    sub.add_parser("health", help="后端健康 / 会话状态（无副作用）")
    sub.add_parser("status", help="锁屏 / 无人值守状态")

    p_demo = sub.add_parser("demo", help="dry-run 演示动作序列")
    p_demo.add_argument("--live", action="store_true", help="实际注入输入（危险，谨慎）")

    p_run = sub.add_parser("run", help="执行 JSON 动作脚本")
    p_run.add_argument("--script", required=True, help="动作脚本 JSON 文件")

    p_shot = sub.add_parser("screenshot", help="截屏")
    p_shot.add_argument("path", nargs="?", default=str(Path(cfg.computer_use.screenshot_dir) / "screen.png"))

    args = parser.parse_args(argv)

    if args.action == "demo" and args.live:
        cfg.computer_use.dry_run = False
    controller = ComputerUseController(cfg.computer_use)

    if args.action == "health":
        _print_json(controller.health())
        return 0
    if args.action == "status":
        _print_json(controller.session_status())
        return 0
    if args.action == "demo":
        script = [
            {"action": "mouse_move", "args": {"x": 400, "y": 300}},
            {"action": "click", "args": {"x": 400, "y": 300}},
            {"action": "key", "args": {"keys": ["ctrl", "s"]}},
        ]
        results = controller.run_script(script)
        _print_json([r.to_dict() for r in results])
        return 0 if all(r.ok for r in results) else 1
    if args.action == "run":
        script = json.loads(Path(args.script).read_text(encoding="utf-8"))
        results = controller.run_script(script)
        _print_json([r.to_dict() for r in results])
        return 0 if all(r.ok for r in results) else 1
    if args.action == "screenshot":
        result = controller.screenshot(args.path)
        _print_json(result.to_dict())
        return 0 if result.ok else 1
    return 1


if __name__ == "__main__":
    sys.exit(main())
