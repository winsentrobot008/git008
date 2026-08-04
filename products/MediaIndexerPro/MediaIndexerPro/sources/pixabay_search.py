"""
MediaIndexerPro — Source Adapter: Pixabay

Uses pixabay-python to search free stock photos, vectors, and videos.
Engine: pixabay-python (https://pypi.org/project/pixabay-python/)
API: https://pixabay.com/api/docs/
Mode: metadata-only — NO files are downloaded.
"""

import os
from typing import Optional

from domain.models import MediaItem, SourceType


def search(keywords: list[str], config: Optional[dict] = None) -> list[MediaItem]:
    """
    Search Pixabay for images and videos matching keywords.

    Requires PIXABAY_API_KEY in config["api_keys"]["pixabay"] or env var.
    Returns MediaItem objects (no downloads).

    Args:
        keywords: List of search keywords.
        config: Global configuration dict (requires api_keys.pixabay).

    Returns:
        List of MediaItem with type=IMAGE or type=VIDEO.
    """
    results: list[MediaItem] = []

    try:
        import pixabay_python
    except ImportError:
        print("[pixabay_search] pixabay-python not installed. Run: pip install pixabay-python")
        return results

    # Resolve API key
    api_key = ""
    if config:
        api_key = config.get("api_keys", {}).get("pixabay", "")
    if not api_key:
        api_key = os.getenv("PIXABAY_API_KEY", "")
    if not api_key:
        print("[pixabay_search] No Pixabay API key configured. Set PIXABAY_API_KEY env var or update config.yaml")
        return results

    client = pixabay_python.PixabayClient(api_key=api_key)

    for kw in keywords:
        # --- Images ---
        try:
            img_data = client.search_image(q=kw, per_page=10)
            for hit in img_data.get("hits", []):
                results.append(MediaItem(
                    title=hit.get("tags", ""),
                    thumbnail=hit.get("webformatURL", ""),
                    url=hit.get("pageURL", ""),
                    source="Pixabay",
                    type=SourceType.IMAGE,
                    keywords=[kw],
                ))
        except Exception as e:
            print(f"[pixabay_search] Image error for '{kw}': {e}")

        # --- Videos ---
        try:
            vid_data = client.search_video(q=kw, per_page=10)
            for hit in vid_data.get("hits", []):
                # Extract best quality thumbnail from videos dict
                thumb = ""
                videos_dict = hit.get("videos") or {}
                for quality in ["medium", "small", "large"]:
                    if videos_dict.get(quality):
                        thumb = videos_dict[quality].get("url", "")
                        break

                duration_val = hit.get("duration")
                duration_str = f"{int(duration_val)}s" if duration_val else None

                results.append(MediaItem(
                    title=hit.get("tags", ""),
                    thumbnail=thumb,
                    url=hit.get("pageURL", ""),
                    source="Pixabay",
                    type=SourceType.VIDEO,
                    duration=duration_str,
                    keywords=[kw],
                ))
        except Exception as e:
            print(f"[pixabay_search] Video error for '{kw}': {e}")

    return results
