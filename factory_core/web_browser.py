"""轻量网页感知层：bb-browser → 结构化 JSON（低 Token）。

复用 services.crawler 的 bb-browser 适配器：以已登录 Chrome 的 Cookie/Session
访问平台 API/DOM，站点 adapter 直接产出结构化 JSON；全部失败回退离线模板。
"""

from __future__ import annotations

from typing import Any, Sequence

from services.common.logging import get_logger
from services.crawler.bb_browser import BbBrowserClient, normalize_site_rows
from services.crawler.fetchers import fetch_viral_copy

logger = get_logger("factory_core.web_browser")


class WebBrowser:
    """网页感知层统一入口（thin wrapper，逻辑复用 services.crawler）。"""

    def __init__(self, client: BbBrowserClient | None = None) -> None:
        self.client = client or BbBrowserClient()

    def health(self) -> dict[str, Any]:
        return self.client.health()

    def fetch_structured(
        self,
        adapter: str,
        args: Sequence[str] = (),
        *,
        jq: str | None = None,
        limit: int = 8,
    ) -> dict[str, Any]:
        """调用 bb-browser 站点 adapter，返回归一化 JSON 条目列表。"""
        result = self.client.run_site(adapter, args, jq=jq, limit=limit)
        return {
            "ok": result.ok,
            "source": "bb-browser",
            "adapter": adapter,
            "items": normalize_site_rows(result.data) if result.ok else [],
            "fallback": result.fallback,
            "error": result.error,
        }

    def fetch_viral(
        self,
        *,
        sources: Sequence[tuple[str, str, str | None]] | None = None,
        max_items: int = 8,
        offline: bool = False,
    ) -> dict[str, Any]:
        """抓取多平台流行文案/热点素材清单（离线自动回退本地模板）。"""
        return fetch_viral_copy(
            self.client,
            sources=sources,
            max_items=max_items,
            offline=offline,
        )

    def fetch_page_text(self, url: str) -> dict[str, Any]:
        """打开页面并提取正文文本（复杂 DOM 兜底通道）。"""
        opened = self.client.open(url)
        if not opened.ok:
            return {"ok": False, "url": url, "error": opened.error, "fallback": opened.fallback}
        tab = None
        if isinstance(opened.data, dict) and opened.data.get("tabId"):
            tab = str(opened.data["tabId"])
        text = self.client.get_text(tab=tab)
        return {
            "ok": text.ok,
            "url": url,
            "text": text.data if text.ok else None,
            "error": text.error,
        }

    def eval_js(self, js: str, tab: str | None = None) -> dict[str, Any]:
        """页内执行 JavaScript（平台 webpack/Pinia 内部数据兜底）。"""
        result = self.client.eval_js(js, tab=tab)
        return {"ok": result.ok, "data": result.data, "error": result.error}


__all__ = ["WebBrowser"]
