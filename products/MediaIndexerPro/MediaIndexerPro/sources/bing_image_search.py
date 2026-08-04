"""
MediaIndexerPro — Source Adapter: DuckDuckGo Image Search

Uses ddgs (successor to duckduckgo-search) for privacy-respecting image search.
Engine: ddgs (https://github.com/AvdLee/ddgs)
Mode: metadata-only — NO files are downloaded.
"""

import time
from typing import Optional

from domain.models import MediaItem, SourceType


def search(keywords: list[str], config: Optional[dict] = None) -> list[MediaItem]:
    """
    Search for images using DuckDuckGo image search.

    No API key required. Adds a small delay between keyword batches
    to respect rate limits.

    Args:
        keywords: List of search keywords.
        config: Global configuration dict.

    Returns:
        List of MediaItem with type=IMAGE.
    """
    results: list[MediaItem] = []

    # Try ddgs first (newer), fallback to duckduckgo_search (older)
    DDGS = None
    ddgs_module = None
    try:
        import ddgs as _ddgs
        DDGS = _ddgs.DDGS
        ddgs_module = 'ddgs'
    except ImportError:
        try:
            from duckduckgo_search import DDGS as _DDGS
            DDGS = _DDGS
            ddgs_module = 'duckduckgo_search'
        except ImportError:
            print("[bing_image_search] Neither ddgs nor duckduckgo-search installed.")
            return results

    with DDGS() as ddgs:
        for kw in keywords:
            try:
                # ddgs uses query= keyword, duckduckgo_search uses keywords=
                if ddgs_module == 'ddgs':
                    img_results = ddgs.images(query=kw, max_results=10)
                else:
                    img_results = ddgs.images(keywords=kw, max_results=10)

                for img in img_results:
                    results.append(MediaItem(
                        title=img.get("title", ""),
                        thumbnail=img.get("thumbnail", "") or img.get("image", ""),
                        url=img.get("image", ""),
                        source="DuckDuckGo",
                        type=SourceType.IMAGE,
                        keywords=[kw],
                    ))
                time.sleep(0.5)  # rate limit between keywords
            except Exception as e:
                print(f"[bing_image_search] DDG error for '{kw}': {e}")

    return results
