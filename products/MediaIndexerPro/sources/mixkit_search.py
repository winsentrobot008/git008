"""
MediaIndexerPro — Source Adapter: Mixkit (Web Scraping)

Uses HTTP requests + HTML parsing to scrape Mixkit free stock video pages.
Engine: requests + beautifulsoup4
Source: https://mixkit.co/
Mode: metadata-only — NO files are downloaded.
"""

from typing import Optional

from domain.models import MediaItem, SourceType


def search(keywords: list[str], config: Optional[dict] = None) -> list[MediaItem]:
    """
    Search Mixkit for free stock videos matching keywords.

    Uses requests + BeautifulSoup to scrape Mixkit search pages.
    Mixkit has no official API, so web scraping is used.

    Args:
        keywords: List of search keywords.
        config: Global configuration dict.

    Returns:
        List of MediaItem with type=VIDEO.
    """
    results: list[MediaItem] = []

    try:
        import requests
        from bs4 import BeautifulSoup
    except ImportError:
        print("[mixkit_search] requests/bs4 not installed. Run: pip install requests beautifulsoup4")
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

    for kw in keywords:
        try:
            url = f"https://mixkit.co/search/?q={kw.replace(' ', '+')}"
            resp = requests.get(url, headers=headers, timeout=15)
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "lxml")

            # Mixkit video cards — multiple possible selectors
            cards = soup.select(
                "article, .media-card, .video-card, "
                "[class*='video']:not(header):not(nav), "
                "[class*='card']:not(header):not(nav)"
            )

            for card in cards:
                title_elem = card.select_one("h3, h2, .title, [class*='title']")
                thumb_elem = card.select_one("img[src], img[data-src]")
                link_elem = card.select_one("a[href*='/video/']")

                if not title_elem or not link_elem:
                    continue

                # Resolve thumbnail
                thumb = ""
                if thumb_elem:
                    thumb = (
                        thumb_elem.get("data-src")
                        or thumb_elem.get("src")
                        or thumb_elem.get("data-lazy-src")
                        or ""
                    )
                    if thumb and thumb.startswith("//"):
                        thumb = "https:" + thumb

                href = link_elem.get("href", "")
                full_url = f"https://mixkit.co{href}" if href.startswith("/") else href

                results.append(MediaItem(
                    title=title_elem.get_text(strip=True),
                    thumbnail=thumb,
                    url=full_url,
                    source="Mixkit",
                    type=SourceType.VIDEO,
                    keywords=[kw],
                ))

                # Limit to 5 results per keyword to avoid excessive scraping
                if len([r for r in results if kw in (r.keywords or [])]) >= 5:
                    break

        except Exception as e:
            print(f"[mixkit_search] Error for '{kw}': {e}")

    return results
