"""crawler CLI：python -m services.crawler。

用法示例：
  python -m services.crawler health
  python -m services.crawler site-list
  python -m services.crawler fetch --adapter zhihu/hot --max-items 5
  python -m services.crawler fetch --offline
  python -m services.crawler build-batch --offline --product calorieai
"""

from __future__ import annotations

import argparse
import json
import sys

from services.common.logging import get_logger
from services.crawler.bb_browser import BbBrowserClient
from services.crawler.fetchers import build_batch_config, fetch_viral_copy

logger = get_logger("crawler.cli")


def _print_json(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2))


def cmd_health(client: BbBrowserClient) -> int:
    _print_json(client.health())
    return 0


def cmd_site_list(client: BbBrowserClient) -> int:
    result = client.site_list()
    if not result.ok:
        print(f"[crawler] site list 失败：{result.error}", file=sys.stderr)
        return 1
    _print_json(result.data)
    return 0


def cmd_fetch(args: argparse.Namespace) -> int:
    manifest = fetch_viral_copy(
        BbBrowserClient(),
        sources=None if args.adapter is None else [(args.adapter, [args.query] if args.query else [], None)],
        max_items=args.max_items,
        offline=args.offline,
    )
    _print_json(manifest)
    return 0


def cmd_build_batch(args: argparse.Namespace) -> int:
    manifest = fetch_viral_copy(BbBrowserClient(), offline=args.offline, max_items=args.max_items)
    cfg = build_batch_config(
        manifest,
        product=args.product,
        target=args.target,
        lang=args.lang,
        resolution=args.resolution,
        background=args.background,
    )
    _print_json(cfg)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="GIT008 网络数据感知层（bb-browser）")
    sub = parser.add_subparsers(dest="action", required=True)

    sub.add_parser("health", help="bb-browser / daemon / 浏览器可达性")
    sub.add_parser("site-list", help="列出可用站点 adapter")

    p_fetch = sub.add_parser("fetch", help="抓取流行文案/热点素材 JSON")
    p_fetch.add_argument("--adapter", help="指定单个 adapter（如 zhihu/hot），默认多平台")
    p_fetch.add_argument("--query", help="adapter 参数（如搜索词）")
    p_fetch.add_argument("--max-items", type=int, default=8)
    p_fetch.add_argument("--offline", action="store_true", help="跳过网络，回退本地模板")

    p_batch = sub.add_parser("build-batch", help="抓取并生成 008-video-factory 批次配置")
    p_batch.add_argument("--offline", action="store_true")
    p_batch.add_argument("--max-items", type=int, default=8)
    p_batch.add_argument("--product", default="calorieai")
    p_batch.add_argument("--target", default="calorie-ai")
    p_batch.add_argument("--lang", default="zh")
    p_batch.add_argument("--resolution", default="1080x1920")
    p_batch.add_argument("--background", default="ui")

    args = parser.parse_args(argv)
    client = BbBrowserClient()
    if args.action == "health":
        return cmd_health(client)
    if args.action == "site-list":
        return cmd_site_list(client)
    if args.action == "fetch":
        return cmd_fetch(args)
    if args.action == "build-batch":
        return cmd_build_batch(args)
    return 1


if __name__ == "__main__":
    sys.exit(main())
