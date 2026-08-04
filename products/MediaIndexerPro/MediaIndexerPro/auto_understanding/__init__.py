"""
MediaIndexerPro v4 — Auto Understanding Module (Cloud-API Routing)

Unified entry point for AI-powered content analysis, now powered by
a lightweight Cloud API client instead of local torch/transformers.

No GPU required — all heavy inference is routed to a configurable
cloud vision API endpoint. Falls back to CPU-friendly Pillow
statistics when the cloud endpoint is unreachable.

Provides ``auto_understand()`` which automatically detects file type
(video or image), runs the appropriate analyzer, and generates tags.

Usage:
    from auto_understanding import auto_understand

    # Analyze any file (auto-detects video vs image)
    result = auto_understand("local_assets/emotion/sample.mp4")
    # {
    #     "type": "video",
    #     "analysis": { ... },
    #     "tags": ["emotion:joy", "scene:outdoor", ...]
    # }

    result = auto_understand("local_assets/motivation/goal.jpg")
    # {
    #     "type": "image",
    #     "analysis": { ... },
    #     "tags": ["emotion:hope", "scene:office", ...]
    # }
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger("MediaIndexerPro.AutoUnderstanding")

# ─── Supported file extensions ───────────────────────────────────────────────

VIDEO_EXTENSIONS: set[str] = {
    ".mp4", ".webm", ".mkv", ".avi", ".mov", ".flv", ".wmv",
    ".m4v", ".mpg", ".mpeg", ".3gp", ".ogv",
}

IMAGE_EXTENSIONS: set[str] = {
    ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp",
    ".tiff", ".tif", ".svg", ".ico", ".heic", ".heif",
}


def _detect_type(path: str) -> str:
    """
    Detect whether a file is a video or image based on its extension.

    Returns ``"video"``, ``"image"``, or ``"unknown"``.
    """
    ext = os.path.splitext(path)[1].lower()
    if ext in VIDEO_EXTENSIONS:
        return "video"
    if ext in IMAGE_EXTENSIONS:
        return "image"
    return "unknown"


# ═══════════════════════════════════════════════════════════════════════════════
#  Public API
# ═══════════════════════════════════════════════════════════════════════════════

def auto_understand(path: str) -> dict[str, Any]:
    """
    Analyze any media file and return structured understanding + tags.

    This is the unified entry point for the entire auto_understanding module.

    Pipeline:
        1. Detect file type (video / image) from extension.
        2. Validate file exists.
        3. Run the appropriate analyzer (``analyze_video`` or ``analyze_image``).
        4. Run ``generate_tags`` on the analysis result.
        5. Return combined JSON with type, analysis, and tags.

    Args:
        path: Path to the media file (video or image).

    Returns:
        A dict with keys:
            - ``type``: ``"video"`` | ``"image"`` | ``"unknown"``
            - ``analysis``: The full analyzer output dict
            - ``tags``: List of generated tags in ``category:value`` format
            - ``file``: The original file path
            - ``error``: Present only if something went wrong

    Examples:
        >>> result = auto_understand("video.mp4")
        >>> result["type"]
        'video'
        >>> result["tags"][0]
        'emotion:joy'
    """
    logger.info(f"auto_understand: {path}")

    # Validate file exists
    if not os.path.isfile(path):
        logger.error(f"File not found: {path}")
        return {
            "type": "unknown",
            "file": path,
            "error": "file not found",
        }

    # Detect type
    media_type = _detect_type(path)

    if media_type == "unknown":
        logger.warning(f"Unknown file type: {path}")
        return {
            "type": "unknown",
            "file": path,
            "analysis": {},
            "tags": [],
            "error": (
                f"Unsupported file extension. "
                f"Supported video: {sorted(VIDEO_EXTENSIONS)} | "
                f"Supported image: {sorted(IMAGE_EXTENSIONS)}"
            ),
        }

    # Analyze (lazy-load analyzers only when needed)
    try:
        if media_type == "video":
            from auto_understanding.video_analyzer import analyze_video
            analysis = analyze_video(path)
        else:
            from auto_understanding.image_analyzer import analyze_image
            analysis = analyze_image(path)
    except Exception as e:
        logger.error(f"Analysis crashed for {path}: {e}", exc_info=True)
        return {
            "type": media_type,
            "file": path,
            "error": f"analysis failure: {e}",
        }

    # Check if analysis itself returned an error
    if isinstance(analysis, dict) and "error" in analysis:
        logger.warning(f"Analysis returned error for {path}: {analysis['error']}")
        return {
            "type": media_type,
            "file": path,
            "analysis": analysis,
            "tags": [],
            "error": analysis["error"],
        }

    # Generate tags
    try:
        from auto_understanding.tag_generator import generate_tags
        tags = generate_tags(analysis)
    except Exception as e:
        logger.error(f"Tag generation failed for {path}: {e}")
        tags = []

    result: dict[str, Any] = {
        "type": media_type,
        "file": os.path.abspath(path),
        "analysis": analysis,
        "tags": tags,
    }

    logger.info(
        f"auto_understand complete: {media_type} | "
        f"{len(tags)} tags | "
        f"{Path(path).name}"
    )

    return result
