"""
MediaIndexerPro — Source Adapter: yt-dlp (YouTube / Web Video)

Uses yt-dlp Python API to extract video metadata WITHOUT downloading.
Engine: yt-dlp (https://github.com/yt-dlp/yt-dlp)
Mode: metadata-only — NO files are downloaded.
"""

from typing import Optional

from domain.models import MediaItem, SourceType


def search(keywords: list[str], config: Optional[dict] = None) -> list[MediaItem]:
    """
    Search videos using yt-dlp metadata extraction.

    For each keyword, performs a yt-dlp search with extract_flat=True
    and returns MediaItem objects (no file downloads).

    Args:
        keywords: List of search keywords.
        config: Global configuration dict.

    Returns:
        List of MediaItem with type=VIDEO.
    """
    results: list[MediaItem] = []

    try:
        from yt_dlp import YoutubeDL
    except ImportError:
        print("[yt_search] yt-dlp not installed. Run: pip install yt-dlp")
        return results

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,       # metadata only, no download
        "skip_download": True,
        "default_search": "ytsearch10",
    }

    with YoutubeDL(ydl_opts) as ydl:
        for kw in keywords:
            try:
                info = ydl.extract_info(f"ytsearch10:{kw}", download=False)
                if info and "entries" in info:
                    for entry in info["entries"]:
                        if not entry:
                            continue

                        # Extract thumbnail from best available source
                        thumb = entry.get("thumbnail") or ""
                        if not thumb:
                            thumbs = entry.get("thumbnails") or []
                            thumb = thumbs[0].get("url", "") if thumbs else ""

                        video_id = entry.get("id", "")
                        results.append(MediaItem(
                            title=entry.get("title", ""),
                            thumbnail=thumb,
                            url=f"https://youtube.com/watch?v={video_id}" if video_id else entry.get("webpage_url", ""),
                            source="YouTube",
                            type=SourceType.VIDEO,
                            duration=_format_duration(entry.get("duration")),
                            keywords=[kw],
                        ))
            except Exception as e:
                print(f"[yt_search] yt-dlp error for '{kw}': {e}")

    return results


def _format_duration(seconds: Optional[int]) -> Optional[str]:
    """Convert seconds to MM:SS or HH:MM:SS format."""
    if seconds is None:
        return None
    seconds = int(seconds)
    h, remainder = divmod(seconds, 3600)
    m, s = divmod(remainder, 60)
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"
