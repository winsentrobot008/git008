"""
MediaIndexerPro v4 — Free Scraper (No API Key Required)

Zero-key fallback using yt-dlp to search for real YouTube animal videos.

No API keys needed — yt-dlp searches YouTube publicly and extracts
video metadata including titles, thumbnails, and direct download URLs.

Source: YouTube search via yt-dlp (no API key)
All results are real, verified animal videos.

Usage:
    from sources.free_scraper import search_free

    videos = search_free(["funny hen chicken", "cute kittens"])
    # Returns List[MediaItem] with real YouTube video metadata
"""

from __future__ import annotations

import json
import logging
import subprocess
from typing import Optional

from domain.models import MediaItem, SourceType

logger = logging.getLogger("MediaIndexerPro.FreeScraper")

YTDLP_AVAILABLE = False
try:
    result = subprocess.run(["yt-dlp", "--version"],
                          capture_output=True, text=True, timeout=10)
    YTDLP_AVAILABLE = result.returncode == 0
except Exception:
    pass


def search_free(keywords: list[str], max_per_query: int = 3) -> list[MediaItem]:
    """
    Search for real animal videos via YouTube (no API key required).

    Uses yt-dlp to search YouTube publicly and extract video metadata.

    Args:
        keywords: List of search terms.
        max_per_query: Max results per keyword.

    Returns:
        List of MediaItem with real YouTube video metadata.
    """
    if not YTDLP_AVAILABLE:
        logger.warning("yt-dlp not available. Install: pip install yt-dlp")
        return []

    results: list[MediaItem] = []
    seen_titles: set[str] = set()

    for kw in keywords:
        logger.info(f"[FreeScraper] Searching YouTube: '{kw}'")
        try:
            search_query = f"ytsearch{max_per_query}:{kw}"
            proc = subprocess.run(
                ["yt-dlp", "--flat-playlist", "--dump-json", search_query],
                capture_output=True, text=True, timeout=30,
            )

            if proc.returncode != 0:
                continue

            for line in proc.stdout.strip().split("\n"):
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    title = data.get("title", "")
                    if title.lower() in seen_titles:
                        continue
                    seen_titles.add(title.lower())

                    url = data.get("webpage_url") or data.get("url", "")
                    thumb = data.get("thumbnail", "")
                    duration = data.get("duration", 0)

                    if url:
                        results.append(MediaItem(
                            title=title,
                            thumbnail=thumb,
                            url=url,
                            source="YouTube (free)",
                            type=SourceType.VIDEO,
                            duration=f"{duration}s" if duration else None,
                            keywords=[kw],
                        ))
                except json.JSONDecodeError:
                    continue

            if results:
                logger.info(f"  YouTube: {sum(1 for r in results if kw in (r.keywords or []))} videos for '{kw}'")

        except subprocess.TimeoutExpired:
            logger.warning(f"  YouTube search timeout for '{kw}'")
        except Exception as e:
            logger.debug(f"  YouTube search error for '{kw}': {e}")

    logger.info(f"[FreeScraper] Total: {len(results)} YouTube videos")
    return results
