"""
MediaIndexerPro v4 — Source Adapter: Unsplash

Uses Unsplash public API to search high-quality photos.
Auth: Authorization: Client-ID <access_key>
All keys loaded from environment — zero hardcoded credentials.

Usage:
    from sources.unsplash_search import search

    results = search(["funny chicken", "cute kittens"])
    # Returns List[MediaItem] with high-resolution image URLs
"""

from __future__ import annotations

import json
import logging
import os
import urllib.parse
import urllib.request
from typing import Optional

from domain.models import MediaItem, SourceType

logger = logging.getLogger("MediaIndexerPro.UnsplashSearch")

UNSPLASH_API_BASE = "https://api.unsplash.com"


def search(keywords: list[str], config: Optional[dict] = None) -> list[MediaItem]:
    """
    Search Unsplash for photos matching keywords.

    Requires UNSPLASH_ACCESS_KEY in environment.
    Uses Authorization: Client-ID header.

    Args:
        keywords: List of search keywords.
        config: Global configuration (unused — keys from env only).

    Returns:
        List of MediaItem with high-res image URLs.
    """
    results: list[MediaItem] = []

    # 🔒 Load from environment only
    access_key = os.environ.get("UNSPLASH_ACCESS_KEY", "")
    if not access_key:
        logger.warning("UNSPLASH_ACCESS_KEY not set in environment")
        return results

    headers = {
        "Authorization": f"Client-ID {access_key}",
        "Accept-Version": "v1",
        "User-Agent": "MediaIndexerPro/4.0",
    }

    for kw in keywords[:3]:  # limit to 3 keyword variations
        try:
            safe_q = urllib.parse.quote(kw)
            url = f"{UNSPLASH_API_BASE}/search/photos?query={safe_q}&per_page=5&orientation=landscape"

            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            for photo in data.get("results", []):
                urls = photo.get("urls", {})
                # Prefer small/raw for preview quality
                img_url = urls.get("small") or urls.get("raw") or urls.get("regular", "")

                results.append(MediaItem(
                    title=photo.get("alt_description") or photo.get("description") or kw,
                    thumbnail=urls.get("thumb", img_url),
                    url=img_url,
                    source="Unsplash",
                    type=SourceType.IMAGE,
                    keywords=[kw],
                ))

            logger.info(f"  Unsplash: {len(data.get('results',[]))} photos for '{kw}'")

        except urllib.error.HTTPError as e:
            if e.code == 403:
                logger.warning(f"  Unsplash API 403 — check UNSPLASH_ACCESS_KEY")
            elif e.code == 401:
                logger.warning(f"  Unsplash API 401 — invalid key")
            else:
                logger.warning(f"  Unsplash HTTP {e.code}")
        except Exception as e:
            logger.debug(f"  Unsplash error for '{kw}': {e}")

    logger.info(f"[UnsplashSearch] Total: {len(results)} photos")
    return results
