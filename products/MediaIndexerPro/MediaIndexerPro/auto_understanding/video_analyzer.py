"""
MediaIndexerPro v4 — Video Analyzer (Cloud-API Routing)

Analyzes video content using the configured Cloud API endpoint.
No local torch, transformers, cv2, or Qwen2-VL dependencies required.

The CloudAnalyzer extracts a single keyframe locally (via ffmpeg) and
sends it as a base64 payload to the configured cloud vision API.
Falls back to CPU-friendly metadata-only analysis if the cloud
endpoint is unreachable.

Usage:
    from auto_understanding.video_analyzer import analyze_video

    result = analyze_video("local_assets/emotion/sample.mp4")
    # {
    #   "description": "A person walking on a sunny beach, looking happy",
    #   "objects": ["person", "beach", "ocean", "sun"],
    #   "actions": ["walking", "smiling"],
    #   "emotions": ["joy", "calm"],
    #   "scenes": ["outdoor", "beach", "daytime"],
    #   "duration": 12.5
    # }
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from auto_understanding.cloud_api import CloudAnalyzer

logger = logging.getLogger("MediaIndexerPro.VideoAnalyzer")

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

def analyze_video(path: str) -> dict[str, Any]:
    """
    Analyze a video file and return structured metadata.

    Pipeline:
        1. Validate file exists
        2. Delegate to CloudAnalyzer (cloud API with local fallback)
        3. Return structured JSON

    Args:
        path: Path to the video file.

    Returns:
        A dict with keys:
            - description: str
            - objects: list[str]
            - actions: list[str]
            - emotions: list[str]
            - scenes: list[str]
            - duration: float or None
    """
    if not os.path.isfile(path):
        logger.error(f"Video file not found: {path}")
        return {"error": "file not found"}

    logger.info(f"Analyzing video: {path}")

    analyzer = _get_analyzer()
    result = analyzer.analyze_video(path)

    if "error" in result:
        logger.warning(f"Video analysis error for {path}: {result['error']}")
    else:
        logger.info(
            f"Analysis complete for '{Path(path).name}': "
            f"{len(result.get('objects', []))} objects, "
            f"{len(result.get('actions', []))} actions, "
            f"{len(result.get('emotions', []))} emotions, "
            f"duration={result.get('duration', '?')}s"
        )

    return result
