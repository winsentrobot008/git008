"""流行文案 / 热点素材 / 参考素材的结构化 JSON 提取器（低 Token 优先）。

策略：
  - 每个站点 adapter 只取前 N 条，并用 --jq 投影 title/content/url 等必要字段；
  - 平台 API/DOM 数据由 bb-browser 在浏览器内完成反爬与鉴权，本层零 Token 解析；
  - 全部失败 → 回退 services/crawler/templates/offline_copy.json（明确 FALLBACK 日志）。
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Iterable, Sequence

from services.common.logging import get_logger, log_fallback
from services.crawler.bb_browser import BbBrowserClient, normalize_site_rows
from services.config import BbBrowserSettings

logger = get_logger("crawler.fetchers")

TEMPLATE_DIR = Path(__file__).resolve().parent / "templates"
OFFLINE_TEMPLATE = TEMPLATE_DIR / "offline_copy.json"

# 平台 → adapter 与 jq 投影（只保留下游需要的字段，天然低 Token）
DEFAULT_VIRAL_SOURCES: tuple[tuple[str, str, str | None], ...] = (
    ("zhihu/hot", "", ".{title, url, excerpt}"),
    ("twitter/search", "", ".{text, url, retweetCount, likeCount}"),
    ("bilibili/popular", "", ".{title, url, play, duration}"),
    ("reddit/hot", "", ".{title, url, ups, numComments}"),
)


def _ts() -> str:
    return time.strftime("%Y%m%dT%H%M%S")


def _pick_field(item: dict[str, Any], *names: str) -> Any:
    for name in names:
        if item.get(name) not in (None, ""):
            return item[name]
    return ""


def _normalize_item(item: dict[str, Any], platform: str, adapter: str) -> dict[str, Any]:
    return {
        "platform": platform,
        "adapter": adapter,
        "title": str(_pick_field(item, "title", "text", "headline", "name", "question"))[:200],
        "content": str(_pick_field(item, "content", "text", "excerpt", "desc", "summary", "answer"))[:500],
        "url": str(_pick_field(item, "url", "link", "permalink", "href"))[:500],
        "engagement": {
            "likes": _pick_field(item, "likeCount", "likes", "ups", "play", "viewCount"),
            "comments": _pick_field(item, "numComments", "comments", "replyCount"),
            "shares": _pick_field(item, "retweetCount", "reposts", "shareCount"),
        },
    }


def _save_manifest(data: dict[str, Any], output_dir: str | Path, prefix: str) -> Path:
    out_dir = Path(output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"{prefix}_{_ts()}.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


def load_offline_template() -> dict[str, Any]:
    """加载离线回退模板（内置示例，保证流水线无网络可演示）。"""
    if OFFLINE_TEMPLATE.exists():
        return json.loads(OFFLINE_TEMPLATE.read_text(encoding="utf-8"))
    return {
        "source": "local-template",
        "items": [],
        "note": "未找到离线模板，返回空清单",
    }


def fetch_viral_copy(
    client: BbBrowserClient | None = None,
    *,
    sources: Sequence[tuple[str, str, str | None]] | None = None,
    max_items: int = 8,
    output_dir: str | Path | None = None,
    offline: bool = False,
) -> dict[str, Any]:
    """Step 1 Fetch：抓取多平台流行文案/热点素材并落盘 JSON 清单。

    :param sources: ((adapter, args, jq), ...)，默认 DEFAULT_VIRAL_SOURCES
    :param offline: True 时跳过网络，直接回退本地模板（CI/演示）
    """
    settings = BbBrowserSettings()
    output_dir = Path(output_dir) if output_dir else Path(settings.data_dir)
    src_list = list(sources or DEFAULT_VIRAL_SOURCES)
    client = client or BbBrowserClient()

    if offline or not client.available:
        log_fallback(
            logger,
            module="crawler",
            reason="offline-or-no-binary" if offline else "bb-browser-missing",
            detail="使用本地离线模板",
            fallback="local-template",
        )
        template = load_offline_template()
        manifest = {
            "source": "local-template",
            "fetched_at": _ts(),
            "items": template.get("items", [])[:max_items],
            "fallback": "local-template",
        }
        path = _save_manifest(manifest, output_dir, "viral_copy")
        manifest["manifest_path"] = str(path)
        return manifest

    items: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    for adapter, args, jq in src_list:
        platform = adapter.split("/", 1)[0]
        result = client.run_site(adapter, args, jq=jq, limit=max_items)
        if not result.ok:
            failures.append({"adapter": adapter, "error": result.error or "unknown"})
            continue
        for row in normalize_site_rows(result.data):
            item = _normalize_item(row, platform, adapter)
            if item["title"] or item["content"]:
                items.append(item)
        if len(items) >= max_items:
            break

    fallback_used = False
    if not items and failures:
        fallback_used = True
        log_fallback(
            logger,
            module="crawler",
            reason="all-sites-failed",
            detail="; ".join(f"{f['adapter']}={f['error']}" for f in failures),
            fallback="local-template",
        )
        items = load_offline_template().get("items", [])[:max_items]

    manifest = {
        "source": "bb-browser" if not fallback_used else "local-template",
        "fetched_at": _ts(),
        "items": items[:max_items],
        "failures": failures,
        "fallback": "local-template" if fallback_used else None,
    }
    path = _save_manifest(manifest, output_dir, "viral_copy")
    manifest["manifest_path"] = str(path)
    return manifest


def fetch_reference_material(
    client: BbBrowserClient | None = None,
    *,
    query: str = "",
    sources: Sequence[str] = ("bilibili/video", "youtube/search", "pexels/search"),
    max_items: int = 5,
    output_dir: str | Path | None = None,
) -> dict[str, Any]:
    """Step 1 Fetch：参考素材元数据（视频/图片 URL），供渲染层下载使用。"""
    settings = BbBrowserSettings()
    output_dir = Path(output_dir) if output_dir else Path(settings.data_dir)
    client = client or BbBrowserClient()
    items: list[dict[str, Any]] = []
    failures: list[dict[str, str]] = []
    for adapter in sources:
        args = [query] if query else []
        result = client.run_site(adapter, args, limit=max_items)
        if not result.ok:
            failures.append({"adapter": adapter, "error": result.error or "unknown"})
            continue
        platform = adapter.split("/", 1)[0]
        for row in normalize_site_rows(result.data):
            url = _pick_field(row, "url", "link", "downloadUrl", "thumbnail")
            if url:
                items.append(
                    {
                        "platform": platform,
                        "adapter": adapter,
                        "title": str(_pick_field(row, "title", "name", "text"))[:200],
                        "url": str(url)[:500],
                        "duration": _pick_field(row, "duration", "length"),
                    }
                )
        if len(items) >= max_items:
            break
    fallback_used = not items and bool(failures)
    if fallback_used:
        log_fallback(
            logger,
            module="crawler.reference",
            reason="all-sources-failed",
            detail="; ".join(f"{f['adapter']}={f['error']}" for f in failures),
            fallback="local-template",
        )
    manifest = {
        "source": "bb-browser" if not fallback_used else "local-template",
        "fetched_at": _ts(),
        "query": query,
        "items": items[:max_items],
        "failures": failures,
        "fallback": "local-template" if fallback_used else None,
    }
    path = _save_manifest(manifest, output_dir, "reference_material")
    manifest["manifest_path"] = str(path)
    return manifest


def build_batch_config(
    manifest: dict[str, Any],
    *,
    product: str = "calorieai",
    target: str = "calorie-ai",
    lang: str = "zh",
    resolution: str = "1080x1920",
    background: str = "ui",
    extra_lines: Iterable[dict[str, str]] = (),
) -> dict[str, Any]:
    """把 crawler 清单转换成 008-video-factory --batch 配置（Step 2 输入）。

    文案来源优先使用清单条目的 title/content（去重、限量），避免整段灌入模型。
    """
    seen: set[str] = set()
    lines: list[dict[str, str]] = []
    for item in manifest.get("items", []):
        text = str(item.get("content") or item.get("title") or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        lines.append({"text": text[:80], "voice": "zh-cn" if lang == "zh" else "en"})
        if len(lines) >= 4:  # 15s 短片 4 句为上限
            break
    if not lines:
        lines = [
            {"text": "拍张照片，立刻知道卡路里。", "voice": "zh-cn"},
            {"text": "CalorieAI 自动识别餐盘里的每一道菜。", "voice": "zh-cn"},
            {"text": "记录饮食，达成目标，轻松自律。", "voice": "zh-cn"},
            {"text": "今天就试试 CalorieAI。", "voice": "zh-cn"},
        ]
    for extra in extra_lines:
        text = str(extra.get("text", "")).strip()
        if text and text not in seen:
            lines.append({"text": text[:80], "voice": extra.get("voice") or "zh-cn"})
            seen.add(text)

    return {
        "product": product,
        "target": target,
        "hooks": [{"id": "crawler", "lang": lang, "lines": lines}],
        "jobs": [
            {
                "hook": "crawler",
                "resolution": resolution,
                "background": background,
            }
        ],
    }


__all__ = [
    "fetch_viral_copy",
    "fetch_reference_material",
    "build_batch_config",
    "load_offline_template",
    "OFFLINE_TEMPLATE",
]
