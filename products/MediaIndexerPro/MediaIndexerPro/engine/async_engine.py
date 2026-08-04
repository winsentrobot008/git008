"""
MediaIndexerPro — Async Engine Layer

Hybrid async engine:
- IO-bound adapters (web scraping, DuckDuckGo): asyncio + aiohttp
- CPU-bound adapters (yt-dlp): ThreadPoolExecutor
- All executed concurrently via asyncio.gather() with timeout
"""

from __future__ import annotations

import sys
import asyncio
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).parent.parent))

from domain.models import MediaItem
from sources import (
    yt_search, pexels_search, pixabay_search, mixkit_search,
    bing_image_search, web_image_search, web_screenshot,
)

logger = logging.getLogger("MediaIndexerPro.AsyncEngine")

ASYNC_TIMEOUT = 10  # seconds per adapter


class AsyncUniversalStockEngine:
    """
    Hybrid async engine. IO adapters run via asyncio, CPU via ThreadPool.
    """

    def __init__(self, config: Optional[dict] = None):
        self.config = config or {}
        self._thread_pool = ThreadPoolExecutor(max_workers=4)

    def _get_adapters(self, category: str = "all") -> list[dict]:
        """Returns list of adapter configs."""
        all_adapters = [
            {"name": "yt-dlp (YouTube)", "fn": yt_search.search, "cat": "video", "io": False},
            {"name": "Pexels", "fn": pexels_search.search, "cat": "all", "io": True},
            {"name": "Pixabay", "fn": pixabay_search.search, "cat": "all", "io": True},
            {"name": "Mixkit", "fn": mixkit_search.search, "cat": "video", "io": True},
            {"name": "DuckDuckGo / Bing", "fn": bing_image_search.search, "cat": "image", "io": True},
            {"name": "Web Images", "fn": web_image_search.search, "cat": "image", "io": True},
            {"name": "Web Screenshots", "fn": web_screenshot.search, "cat": "page", "io": True},
        ]
        return [
            a for a in all_adapters
            if category == "all" or a["cat"] == category or a["cat"] == "all"
        ]

    async def _run_adapter(self, adapter: dict, keywords: list[str]) -> tuple[str, list[MediaItem], float, Optional[str]]:
        """Run a single adapter (sync wrapped in executor)."""
        name = adapter["name"]
        start = time.time()
        try:
            loop = asyncio.get_running_loop()
            if adapter["io"]:
                # IO-bound: run in thread pool
                results = await asyncio.wait_for(
                    loop.run_in_executor(self._thread_pool, adapter["fn"], keywords, self.config),
                    timeout=ASYNC_TIMEOUT
                )
            else:
                # CPU-bound (yt-dlp): run in thread pool
                results = await asyncio.wait_for(
                    loop.run_in_executor(self._thread_pool, adapter["fn"], keywords, self.config),
                    timeout=ASYNC_TIMEOUT
                )
            elapsed = time.time() - start
            return name, results, elapsed, None
        except asyncio.TimeoutError:
            elapsed = time.time() - start
            return name, [], elapsed, "timeout"
        except Exception as e:
            elapsed = time.time() - start
            return name, [], elapsed, str(e)

    async def search_async(self, topic: str, keywords: list[str],
                           category: str = "all") -> dict:
        """
        Execute all adapters concurrently via asyncio.gather().

        Returns:
            (deduplicated_items, perf_data)
        """
        engine_start = time.time()
        adapters = self._get_adapters(category)
        logger.info(f"AsyncEngine START | topic='{topic}' | {len(adapters)} adapters | category={category}")

        # ── Concurrent execution ──
        tasks = [self._run_adapter(a, keywords) for a in adapters]
        raw_results = await asyncio.gather(*tasks, return_exceptions=True)

        # Handle any unexpected exceptions from gather itself
        processed_results = []
        for i, r in enumerate(raw_results):
            if isinstance(r, Exception):
                name = adapters[i]["name"] if i < len(adapters) else f"adapter_{i}"
                logger.error(f"  ADAPTER GATHER EXCEPTION | {name} | {r}")
                processed_results.append((name, [], 0, str(r)))
            else:
                processed_results.append(r)
        raw_results = processed_results

        # ── Aggregate ──
        all_items: list[MediaItem] = []
        adapter_times = {}
        for name, items, elapsed, error in raw_results:
            all_items.extend(items)
            adapter_times[name] = {
                "items": len(items),
                "time_s": round(elapsed, 2),
                "error": error,
            }
            if error == "timeout":
                logger.warning(f"  ADAPTER TIMEOUT | {name} | {elapsed:.2f}s")
            elif error:
                logger.error(f"  ADAPTER FAIL  | {name} | {elapsed:.2f}s | {error}")
            else:
                logger.info(f"  ADAPTER END   | {name} | {len(items)} items | {elapsed:.2f}s")

        # ── Dedup ──
        seen_urls: set[str] = set()
        deduped: list[MediaItem] = []
        for item in all_items:
            if item.url and item.url not in seen_urls:
                seen_urls.add(item.url)
                deduped.append(item)

        # ── Sort ──
        def _sort_key(item: MediaItem) -> tuple:
            kw_match = len([kw for kw in keywords if kw.lower() in item.title.lower()])
            return (-kw_match, -len(item.title or ""))
        deduped.sort(key=_sort_key)

        total_time = time.time() - engine_start
        active_count = len([v for v in adapter_times.values() if v["items"] > 0])

        logger.info(f"  ENGINE END | {len(deduped)} items | {total_time:.2f}s | {active_count} sources")

        # ── Perf data ──
        # ── Collect errors ──
        error_list = [
            f"{name}: {info['error']}" for name, info in adapter_times.items()
            if info.get("error") and info["error"] != "timeout"
        ]

        perf_data = {
            "total_ms": round(total_time * 1000),
            "adapter_count": len(adapter_times),
            "active_count": active_count,
            "adapters": [
                {
                    "name": name,
                    "ms": round(info["time_s"] * 1000),
                    "count": info["items"],
                    "error": info["error"],
                }
                for name, info in sorted(adapter_times.items(), key=lambda x: -x[1]["time_s"])
            ],
        }

        # Serialize MediaItem to dicts for JSON response
        serialized = [item.to_dict() for item in deduped]
        return {
            "items": serialized,
            "perf": perf_data,
            "errors": error_list,
            "total_items": len(deduped),
            "topic": topic,
        }
