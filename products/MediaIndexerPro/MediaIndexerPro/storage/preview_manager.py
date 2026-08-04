"""
MediaIndexerPro — Preview Manager

Open thumbnails or links in the browser for preview.
Provides lightweight utility functions for the API layer.
"""

import webbrowser
from typing import Optional


def open_preview(url: str) -> dict:
    """
    Open a URL in the default browser for preview.

    Args:
        url: The URL to open.

    Returns:
        Dict with status info.
    """
    try:
        webbrowser.open(url)
        return {"status": "ok", "message": f"Opened {url}"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def get_thumbnail_html(item: dict) -> str:
    """
    Generate an HTML <img> tag for a result item's thumbnail.

    Args:
        item: A result dict with a 'thumbnail' key.

    Returns:
        HTML string or empty string if no thumbnail.
    """
    thumbnail = item.get("thumbnail")
    title = item.get("title", "Preview")
    if thumbnail:
        return f'<img src="{thumbnail}" alt="{title}" style="max-width:200px;max-height:150px;">'
    return ""


def format_preview_link(item: dict) -> str:
    """
    Generate an HTML anchor tag for preview.

    Args:
        item: A result dict with 'link' and 'title' keys.

    Returns:
        HTML anchor string.
    """
    link = item.get("link", "#")
    title = item.get("title", "View")
    return f'<a href="{link}" target="_blank" rel="noopener">{title}</a>'
