#!/usr/bin/env python3
"""008-video-factory 自包含命令行入口。

仅收敛视频制造子路由（storyboard / render / preview / doctor / list-targets），
与仓库根 `src/cli.py` 保持同一套参数契约，方便在流水线内独立调用。

用法示例：
    python products/008-video-factory/src/cli.py video render --storyboard templates/storyboards/calorie_ai_ad.json --preview
    python products/008-video-factory/src/cli.py video render --target calorie-ai --no-pexels
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PRODUCT_ROOT.parents[1]
for entry in (str(PRODUCT_ROOT), str(REPO_ROOT)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from modules.video_factory import pipeline as video_pipeline  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="008-video-factory",
        description="008 Video Factory —— 视频制造自包含 CLI（storyboard / render）",
    )
    subparsers = parser.add_subparsers(dest="command", required=True, metavar="<command>")
    video_pipeline.add_video_parser(subparsers)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    handler = getattr(args, "handler", None)
    if handler is None:
        parser.print_help()
        return 2
    return int(handler(args) or 0)


if __name__ == "__main__":
    sys.exit(main())
