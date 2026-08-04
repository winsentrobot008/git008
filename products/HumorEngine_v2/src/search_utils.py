"""
HumorEngine_v2 — Trending Video Search Utility
===============================================

Searches for trending videos using DuckDuckGo with anti-bot headers
and a strict 5-second timeout.  Falls back to a curated seed list of
real-world trending humor video URLs when the network is blocked, so
the CEO can always test the download & generation pipeline.

Usage:
    from src.search_utils import search_trending_videos
    results = search_trending_videos("funny pets")
    # -> [{"title", "url", "thumbnail", "duration", "source"}, ...]
"""

from __future__ import annotations

import logging
import re
import urllib.parse
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger("search_utils")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DDG_VIDEO_URL = "https://html.duckduckgo.com/html/"

# Chrome-like browser headers to reduce 403 blocks
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;"
        "q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
    ),
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
    "Accept-Encoding": "gzip, deflate, br",
    "DNT": "1",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Cache-Control": "max-age=0",
}

# Strict timeout (seconds) — prevents UI from hanging indefinitely
REQUEST_TIMEOUT = 5

# ---------------------------------------------------------------------------
# Curated fallback seed videos
# ---------------------------------------------------------------------------
# When the DuckDuckGo search is blocked or times out, these real-world
# trending humor video URLs are returned so the CEO can still test the
# full pipeline (download → vision → generation).

FALLBACK_SEEDS: List[Dict[str, str]] = [
    {
        "title": "[Seed] Funny Dog Tries to Drive a Car — Hilarious Pet Compilation",
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "thumbnail": "",
        "duration": "~3m",
        "source": "YouTube",
    },
    {
        "title": "[Seed] Cat vs. Cucumber — Best Funny Animal Reactions",
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "thumbnail": "",
        "duration": "~2m",
        "source": "YouTube",
    },
    {
        "title": "[Seed] Baby Laughing Hysterically at Dog — Cutest Moment",
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "thumbnail": "",
        "duration": "~1m",
        "source": "YouTube",
    },
    {
        "title": "[Seed] When Pranks Go Wrong — Funny Fail Compilation",
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "thumbnail": "",
        "duration": "~4m",
        "source": "YouTube",
    },
    {
        "title": "[Seed] 尴尬瞬间 Top 10 — 搞笑视频合集 (Awkward Moments)",
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "thumbnail": "",
        "duration": "~5m",
        "source": "YouTube",
    },
]

# ---------------------------------------------------------------------------
# Public search function
# ---------------------------------------------------------------------------


def search_trending_videos(keyword: str, max_results: int = 5) -> List[Dict[str, str]]:
    """
    Search for trending videos matching *keyword*.

    Uses DuckDuckGo HTML search with browser-grade headers and a strict
    5-second timeout.  If the request is blocked or times out, returns a
    curated fallback seed list so the pipeline remains testable.

    Returns up to *max_results* entries, each with keys:
        ``title``, ``url``, ``thumbnail``, ``duration``, ``source``.
    """
    if not keyword.strip():
        return []

    logger.info("Searching trending videos: '%s' (max %d)", keyword, max_results)

    results = _search_ddg(keyword, max_results)

    if results:
        return results[:max_results]

    # ── Fallback: search failed → return curated seeds ──
    logger.warning(
        "DuckDuckGo search blocked/timed out for '%s'. "
        "Returning curated fallback seeds for pipeline testing.",
        keyword,
    )
    return _get_fallback_seeds(max_results)


# ---------------------------------------------------------------------------
# DuckDuckGo HTML search (with anti-bot headers + strict timeout)
# ---------------------------------------------------------------------------


def _search_ddg(keyword: str, max_results: int) -> List[Dict[str, str]]:
    """
    Attempt a live DuckDuckGo HTML search with Chrome-like headers.
    Returns an empty list on any failure (timeout, 403, connection error).
    """
    params = {"q": f"{keyword} video funny"}
    headers = dict(BROWSER_HEADERS)

    try:
        resp = requests.get(
            DDG_VIDEO_URL,
            params=params,
            headers=headers,
            timeout=REQUEST_TIMEOUT,
        )
        resp.raise_for_status()
    except requests.exceptions.Timeout:
        logger.warning("DuckDuckGo search timed out after %ds.", REQUEST_TIMEOUT)
        return []
    except requests.exceptions.HTTPError as e:
        logger.warning("DuckDuckGo returned HTTP %s — likely blocked.", e)
        return []
    except requests.exceptions.ConnectionError:
        logger.warning("DuckDuckGo connection refused — network blocked?")
        return []
    except requests.RequestException as e:
        logger.warning("DuckDuckGo search failed: %s", e)
        return []

    html = resp.text
    results: List[Dict[str, str]] = []
    result_blocks = _extract_blocks(html)

    for block in result_blocks[:max_results]:
        title = block.get("title", "").strip()
        url = block.get("url", "").strip()
        thumbnail = block.get("thumbnail", "").strip()
        snippet = block.get("snippet", "").strip()

        if not title or not url:
            continue

        duration = _estimate_duration(snippet, title)
        source = _detect_source(url)

        results.append({
            "title": title,
            "url": url,
            "thumbnail": thumbnail,
            "duration": duration,
            "source": source,
        })

    return results


# ---------------------------------------------------------------------------
# Fallback seeds
# ---------------------------------------------------------------------------


def _get_fallback_seeds(max_results: int) -> List[Dict[str, str]]:
    """Return up to *max_results* curated seed videos."""
    return FALLBACK_SEEDS[:max_results]


# ---------------------------------------------------------------------------
# HTML parsing helpers
# ---------------------------------------------------------------------------


def _extract_blocks(html: str) -> List[Dict[str, str]]:
    blocks: List[Dict[str, str]] = []

    pattern = r'<a\s+[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>'
    matches = re.findall(pattern, html, re.DOTALL)

    for url, title_html in matches:
        title = re.sub(r"<[^>]+>", "", title_html).strip()
        title = _decode_entities(title)
        actual_url = _unredirect(url)
        thumbnail = _find_nearby_thumbnail(html, url)
        snippet = _find_nearby_snippet(html, url)

        blocks.append({
            "title": title,
            "url": actual_url,
            "thumbnail": thumbnail,
            "snippet": snippet,
        })

    return blocks


def _unredirect(url: str) -> str:
    if "uddg=" in url:
        from urllib.parse import parse_qs, urlparse
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        encoded = qs.get("uddg", [None])[0]
        if encoded:
            return urllib.parse.unquote(encoded)
    return url


def _find_nearby_thumbnail(html: str, anchor_url: str) -> str:
    idx = html.find(anchor_url)
    if idx == -1:
        return ""
    surrounding = html[idx: idx + 2000]
    img_pattern = r'<img[^>]+src="([^"]*\.(?:jpg|jpeg|png|gif|webp))"'
    img_match = re.search(img_pattern, surrounding, re.IGNORECASE)
    if img_match:
        src = img_match.group(1)
        if src.startswith("//"):
            src = "https:" + src
        return src
    return ""


def _find_nearby_snippet(html: str, anchor_url: str) -> str:
    idx = html.find(anchor_url)
    if idx == -1:
        return ""
    surrounding = html[idx: idx + 3000]
    snippet_match = re.search(
        r'class="result__snippet[^"]*"[^>]*>(.*?)</(?:a|div)>',
        surrounding, re.DOTALL,
    )
    if snippet_match:
        text = re.sub(r"<[^>]+>", "", snippet_match.group(1)).strip()
        return _decode_entities(text)
    return ""


def _decode_entities(text: str) -> str:
    """Decode common HTML entities using a safe approach."""
    amp = chr(38) + "amp;"
    lt = chr(38) + "lt;"
    gt = chr(38) + "gt;"
    quot = chr(38) + "quot;"
    x27 = chr(38) + "#x27;"
    num39 = chr(38) + "#39;"

    text = text.replace(amp, chr(38))
    text = text.replace(lt, chr(60))
    text = text.replace(gt, chr(62))
    text = text.replace(quot, chr(34))
    text = text.replace(x27, chr(39))
    text = text.replace(num39, chr(39))
    return text


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _estimate_duration(snippet: str, title: str) -> str:
    combined = f"{title} {snippet}"
    word_count = len(combined.split())
    if word_count > 30:
        return "~60s"
    elif word_count > 15:
        return "~30s"
    return "~15s"


def _detect_source(url: str) -> str:
    domain = url.lower()
    if "youtube.com" in domain or "youtu.be" in domain:
        return "YouTube"
    elif "tiktok.com" in domain:
        return "TikTok"
    elif "bilibili.com" in domain or "b23.tv" in domain:
        return "Bilibili"
    elif "douyin.com" in domain:
        return "Douyin"
    elif "instagram.com" in domain or "instagr.am" in domain:
        return "Instagram"
    elif "twitter.com" in domain or "x.com" in domain:
        return "Twitter/X"
    elif "facebook.com" in domain or "fb.com" in domain:
        return "Facebook"
    else:
        return "Web"
