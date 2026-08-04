"""
MediaIndexerPro — Source Adapter: Web Page Image Extraction

Uses requests/bs4 to extract images from web pages found via DuckDuckGo.
Engine: ddgs + requests + beautifulsoup4
Mode: metadata-only — NO files are downloaded.
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
    Extract web page images and cover images matching keywords.

    Uses DuckDuckGo to find relevant pages, then parses HTML to extract
    the first meaningful image from each page.

    Args:
        keywords: List of search keywords.
        config: Global configuration dict.

    Returns:
        List of MediaItem with type=IMAGE.
    """
    results: list[MediaItem] = []

    try:
        import requests
        from bs4 import BeautifulSoup
        from urllib.parse import urljoin
    except ImportError:
        print("[web_image_search] requests/bs4 not installed.")
        return results

    DDGS, ddgs_module = _get_ddgs()
    if DDGS is None:
        print("[web_image_search] DDGS not installed.")
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

                        title = ""
                        if soup.title and soup.title.get_text(strip=True):
                            title = soup.title.get_text(strip=True)
                        else:
                            title = result.get("title", "")

                        # Find first meaningful image
                        found_img = None
                        img_selectors = [
                            "article img[src*='.jpg'], article img[src*='.png']",
                            ".content img[src*='.jpg'], .content img[src*='.png']",
                            ".post img[src*='.jpg'], .post img[src*='.png']",
                            "img[src$='.jpg']",
                            "img[src$='.png']",
                        ]
                        for selector in img_selectors:
                            imgs = soup.select(selector)
                            for img in imgs:
                                src = img.get("src") or img.get("data-src") or ""
                                if not src:
                                    continue
                                if src.startswith("//"):
                                    src = "https:" + src
                                elif src.startswith("/"):
                                    src = urljoin(page_url, src)
                                if src.startswith("http") and not src.endswith(".svg"):
                                    found_img = src
                                    break
                            if found_img:
                                break

                        if found_img and title:
                            results.append(MediaItem(
                                title=title[:200],
                                thumbnail=found_img,
                                url=page_url,
                                source="Web",
                                type=SourceType.IMAGE,
                                keywords=[kw],
                            ))

                    except Exception as e:
                        print(f"[web_image_search] Page error {page_url}: {e}")

                time.sleep(0.5)
            except Exception as e:
                print(f"[web_image_search] DDG error for '{kw}': {e}")

    return results
