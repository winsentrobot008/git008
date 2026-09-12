#!/usr/bin/env python3
"""GIT008 工厂统一命令行入口。

子路由统一管理三个制造模块的命令：
    video    —— 008-video-factory（视频工厂 / HyperFrames）
    voice    —— VOICE22（参数化配音导演台）
    indexer  —— MediaIndexerPro（媒体索引 / 视频生成流水线）

用法示例：
    python src/cli.py video render --target calorie-ai --full
    python src/cli.py video storyboard -i configs/hook.json
    python src/cli.py voice generate
    python src/cli.py indexer scheduler --once
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from src.core.paths import mediaindexer_dir, voice22_dir  # noqa: E402

# 视频制造模块已收拢到 products/008-video-factory/modules/，由产品内包提供
PRODUCT_ROOT = REPO_ROOT / "products" / "008-video-factory"
if str(PRODUCT_ROOT) not in sys.path:
    sys.path.insert(0, str(PRODUCT_ROOT))

from modules.video_factory import pipeline as video_pipeline  # noqa: E402


def _run_python(
    script_rel: str,
    extra_args: list[str],
    *,
    product_dir: Path,
    label: str,
) -> int:
    cmd = [sys.executable, str(product_dir / script_rel), *extra_args]
    print(f"[{label}] $ {' '.join(cmd)}")
    try:
        return subprocess.call(cmd, cwd=str(product_dir))
    except FileNotFoundError as exc:
        print(f"[{label}] 启动失败：{exc}", file=sys.stderr)
        return 1


# ----------------------------------------------------------------------
# voice —— VOICE22
# ----------------------------------------------------------------------


def cmd_voice_generate(args: argparse.Namespace) -> int:
    """运行 VOICE22 参数化配音（读取 products/VOICE22/input.json）。"""
    extra = ["--input", args.input] if args.input else []
    return _run_python(
        "src/generate.py",
        extra,
        product_dir=voice22_dir(),
        label="voice",
    )


def cmd_voice_server(args: argparse.Namespace) -> int:
    """启动 VOICE22 调音台 Web 服务（http://localhost:8080）。"""
    extra = ["--port", str(args.port)] if args.port else []
    return _run_python(
        "frontend/server.py",
        extra,
        product_dir=voice22_dir(),
        label="voice",
    )


def add_voice_parser(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(
        "voice",
        help="语音制造：VOICE22 参数化配音导演台",
    )
    sub = parser.add_subparsers(dest="voice_command", required=True)

    generate = sub.add_parser("generate", help="按 products/VOICE22/input.json 生成双角色配音")
    generate.add_argument("--input", help="覆盖 input.json 路径（生成器仍按 VOICE22 契约读取）")
    generate.set_defaults(handler=cmd_voice_generate)

    server = sub.add_parser("server", help="启动 VOICE22 调音台 Web 界面")
    server.add_argument("--port", type=int, help="覆盖默认端口 8080")
    server.set_defaults(handler=cmd_voice_server)


# ----------------------------------------------------------------------
# indexer —— MediaIndexerPro
# ----------------------------------------------------------------------


def cmd_indexer_server(args: argparse.Namespace) -> int:
    """启动 MediaIndexerPro 控制台（FastAPI + 浏览器）。"""
    del args
    return _run_python(
        "start_sandbox.py",
        [],
        product_dir=mediaindexer_dir(),
        label="indexer",
    )


def cmd_indexer_scheduler(args: argparse.Namespace) -> int:
    """运行 MediaIndexerPro 调度器（默认守护进程；--once 单轮扫描）。"""
    extra = ["--once"] if args.once else []
    return _run_python(
        "workflow/scheduler.py",
        extra,
        product_dir=mediaindexer_dir(),
        label="indexer",
    )


def add_indexer_parser(subparsers: argparse._SubParsersAction) -> None:
    parser = subparsers.add_parser(
        "indexer",
        help="媒体制造：MediaIndexerPro 索引 / 调度 / 控制台",
    )
    sub = parser.add_subparsers(dest="indexer_command", required=True)

    server = sub.add_parser("server", help="启动 MediaIndexerPro 控制台（端口 8000）")
    server.set_defaults(handler=cmd_indexer_server)

    scheduler = sub.add_parser("scheduler", help="运行批量调度器（监听 scripts/ 目录）")
    scheduler.add_argument("--once", action="store_true", help="只处理一次新脚本后退出")
    scheduler.set_defaults(handler=cmd_indexer_scheduler)


# ----------------------------------------------------------------------
# 入口
# ----------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="git008-factory",
        description="GIT008 工厂统一 CLI —— video（视频）/ voice（语音）/ indexer（媒体）子路由",
    )
    subparsers = parser.add_subparsers(dest="command", required=True, metavar="<command>")
    video_pipeline.add_video_parser(subparsers)
    add_voice_parser(subparsers)
    add_indexer_parser(subparsers)
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
