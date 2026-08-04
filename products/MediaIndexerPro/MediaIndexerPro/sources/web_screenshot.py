"""
MediaIndexerPro — Source Adapter: Web Page Screenshot / Cover Image

Extracts Open Graph (og:image) meta tags and large images from web pages.
Generates preview URLs without saving any files.
Engine: ddgs + requests + beautifulsoup4
Mode: metadata-only — NO screenshots saved, only OG image URLs extracted.
"""

import time
from typing import Optional

from domain.models import MediaItem, SourceType


def _get_ddgs():
    """Get DDGS class from available module (ddgs or duckduckgo_search)."""
    try:
        import ddgs as _ddgs
        return _ddgs.DDGS, 'ddgs'
    except ImportError:
        try:
            from duckduckgo_search import DDGS as _DDGS
            return _DDGS, 'duckduckgo_search'
        except ImportError:
            return None, None


def _search_text(ddgs, query: str, ddgs_module: str, max_results: int = 3):
    """Search text using the available DDGS module."""
    if ddgs_module == 'ddgs':
        return ddgs.text(query=query, max_results=max_results)
    else:
        return ddgs.text(keywords=query, max_results=max_results)


def search(keywords: list[str], config: Optional[dict] = None) -> list[MediaItem]:
    """
    Extract web page cover/screenshot images for the given keywords.

    Uses DuckDuckGo to find relevant pages, then parses OG meta tags.

    Args:
        keywords: List of search keywords.
        config: Global configuration dict.

    Returns:
        List of MediaItem with type=PAGE.
    """
    results: list[MediaItem] = []

    try:
        import requests
        from bs4 import BeautifulSoup
    except ImportError:
        print("[web_screenshot] requests/bs4 not installed.")
        return results

    DDGS, ddgs_module = _get_ddgs()
    if DDGS is None:
        print("[web_screenshot] DDGS not installed.")
        return results

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }

    with DDGS() as ddgs:
        for kw in keywords:
            try:
                for result in _search_text(ddgs, kw, ddgs_module, max_results=3):
                    page_url = result.get("href", "")
                    if not page_url:
                        continue

                    try:
                        resp = requests.get(page_url, headers=headers, timeout=10)
                        resp.raise_for_status()
                        soup = BeautifulSoup(resp.text, "lxml")

                        # 1. OG image
                        thumbnail = ""
                        og_image = soup.select_one("meta[property='og:image']")
                        if og_image:
                            thumbnail = og_image.get("content", "")

                        # 2. Twitter card
                        if not thumbnail:
                            tw_image = soup.select_one("meta[name='twitter:image']")
                            if tw_image:
                                thumbnail = tw_image.get("content", "")

                        # 3. First JPG/PNG
                        if not thumbnail:
                            for img in soup.select(
                                "img[src*='.jpg'], img[src*='.png'], "
                                "img[src*='.jpeg'], img[src*='.webp']"
                            ):
                                src = img.get("src", "")
                                if src:
                                    thumbnail = "https:" + src if src.startswith("//") else src
                                    break

                        title = ""
                        if soup.title and soup.title.get_text(strip=True):
                            title = soup.title.get_text(strip=True)
                        else:
                            title = result.get("title", "")

                        if thumbnail and title:
                            results.append(MediaItem(
                                title=title[:200],
                                thumbnail=thumbnail,
                                url=page_url,
                                source="Web Screenshot",
                                type=SourceType.PAGE,
                                keywords=[kw],
                            ))

                    except Exception as e:
                        print(f"[web_screenshot] Error for {page_url}: {e}")

                time.sleep(0.5)
            except Exception as e:
                print(f"[web_screenshot] DDG error for '{kw}': {e}")

    return results
