"""网络数据感知层：bb-browser MCP/CLI 适配器 + 流行文案/热点素材结构化 JSON 提取。

设计目标：
  - 复用本机已登录 Chrome 的 Cookie/Session（bb-browser daemon + CDP）；
  - 站点 adapter 直接输出结构化 JSON，仅投影必要字段 → 低 Token 消耗；
  - CLI / daemon / OpenClaw 逐级回退，全部失败回退本地模板并落盘回退日志。
"""

from services.crawler.bb_browser import BbBrowserClient
from services.crawler.fetchers import (
    build_batch_config,
    fetch_reference_material,
    fetch_viral_copy,
)

__all__ = [
    "BbBrowserClient",
    "fetch_viral_copy",
    "fetch_reference_material",
    "build_batch_config",
]
