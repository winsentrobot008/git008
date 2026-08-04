"""
MediaIndexerPro v4 — Image Analyzer (Cloud-API Routing)

Analyzes image content using the configured Cloud API endpoint.
No local torch, transformers, or Qwen2-VL dependencies required.

The CloudAnalyzer sends images as base64 payloads to the configured
cloud vision API. Falls back to CPU-friendly Pillow statistics if
the cloud endpoint is unreachable.

Usage:
    from auto_understanding.image_analyzer import analyze_image

    result = analyze_image("local_assets/emotion/happy.jpg")
    # {
    #   "description": "A smiling woman in a sunny park",
    #   "objects": ["person", "park", "trees"],
    #   "emotions": ["joy", "happiness"],
    #   "scene": "outdoor_park",
    #   "colors": ["#4A7C59", "#87CEEB", "#F5DEB3"]
    # }
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from auto_understanding.cloud_api import CloudAnalyzer

logger = logging.getLogger("MediaIndexerPro.ImageAnalyzer")

# Global singleton analyzer (lazy-initialized)
_ANALYZER: CloudAnalyzer | None = None


def _get_analyzer() -> CloudAnalyzer:
    """Lazy-init singleton CloudAnalyzer."""
    global _ANALYZER
    if _ANALYZER is None:
        _ANALYZER = CloudAnalyzer()
    return _ANALYZER


# ═══════════════════════════════════════════════════════════════════════════════
#  Public API
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_image(path: str) -> dict[str, Any]:
    """
    Analyze an image file and return structured metadata.

    Pipeline:
        1. Validate file exists
        2. Delegate to CloudAnalyzer (cloud API with local fallback)
        3. Return structured JSON

    Args:
        path: Path to the image file.

    Returns:
        A dict with keys:
            - description: str
            - objects: list[str]
            - emotions: list[str]
            - scene: str
            - colors: list[str] (hex color codes)
    """
    if not os.path.isfile(path):
        logger.error(f"Image file not found: {path}")
        return {"error": "file not found"}

    logger.info(f"Analyzing image: {path}")

    analyzer = _get_analyzer()
    result = analyzer.analyze_image(path)

    if "error" in result:
        logger.warning(f"Image analysis error for {path}: {result['error']}")
    else:
        logger.info(
            f"Analysis complete for '{Path(path).name}': "
            f"{len(result.get('objects', []))} objects, "
            f"{len(result.get('emotions', []))} emotions, "
            f"scene={result.get('scene', '?')}"
        )

    return result
