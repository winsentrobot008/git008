"""
MediaIndexerPro v3 — Generate Video API Route (P8)

Provides the ``POST /api/generate_video`` endpoint that runs the full
AI video generation pipeline from a script.

Request::

    POST /api/generate_video
    {
        "script": "你的文案...",
        "ratio": "1:1",
        "voice": "default",
        "speed": 1.0
    }

Response::

    {
        "status": "ok" | "partial" | "failed",
        "final_video": "/abs/path/final.mp4" | null,
        "timeline": { ... } | {"error": "..."},
        "scenes": [...],
        "clips": [...],
        "voice": {...},
        "error": null | str
    }

Integration with ``api/server.py``::

    # In server.py, add:
    from api.routes.generate_video import router as generate_router
    app.include_router(generate_router)
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any, Optional

# Ensure project root is in path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi import APIRouter
from pydantic import BaseModel, Field

from workflow.pipeline import run_pipeline

logger = logging.getLogger("MediaIndexerPro.API.GenerateVideo")

# ─── Router ─────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api", tags=["v3 Generation"])


# ─── Pydantic Models ────────────────────────────────────────────────────────

class GenerateVideoRequest(BaseModel):
    """Request body for ``POST /api/generate_video``."""

    script: str = Field(
        default="",
        description="Full script text to turn into a video",
        examples=["Life is like a box of chocolates..."],
    )
    ratio: str = Field(
        default="1:1",
        description='Aspect ratio: "1:1", "16:9", "9:16", or custom "W:H"',
    )
    voice: str = Field(
        default="default",
        description='Voice preset: "default", "cosy:zh_female_warm", '
                    '"edge:en_female_jenny", etc.',
    )
    speed: float = Field(
        default=1.0,
        description="Speaking speed (0.5–2.0)",
        ge=0.5,
        le=2.0,
    )


class GenerateVideoResponse(BaseModel):
    """Response body for ``POST /api/generate_video``."""

    status: str = Field(description='"ok", "partial", or "failed"')
    final_video: Optional[str] = Field(
        default=None,
        description="Absolute path to the generated video file, or null",
    )
    timeline: dict[str, Any] = Field(
        default_factory=dict,
        description="Editable timeline data structure",
    )
    scenes: list[dict[str, Any]] = Field(
        default_factory=list,
        description="List of scene definitions from script splitting",
    )
    clips: list[dict[str, Any]] = Field(
        default_factory=list,
        description="List of generated video clip results",
    )
    voice: dict[str, Any] = Field(
        default_factory=dict,
        description="Voice generation result with audio/subtitle paths",
    )
    error: Optional[str] = Field(
        default=None,
        description="Error message if status is 'failed' or 'partial'",
    )


# ─── Input Validation ───────────────────────────────────────────────────────

def _validate_ratio(ratio: str) -> str:
    """Validate and normalise aspect ratio."""
    valid_ratios = {"1:1", "16:9", "9:16", "4:3", "3:4"}
    if ratio in valid_ratios:
        return ratio
    # Check custom format like "1920:1080"
    import re
    if re.match(r"^\d+[:x]\d+$", ratio):
        return ratio
    logger.warning(f"Invalid ratio '{ratio}', defaulting to '1:1'")
    return "1:1"


def _validate_speed(speed: float) -> float:
    """Validate and clamp speed."""
    return max(0.5, min(2.0, speed))


# ─── Endpoint ───────────────────────────────────────────────────────────────

@router.post("/generate_video")
async def api_generate_video(request: GenerateVideoRequest):
    """
    Generate a complete video from a script.

    Runs the full pipeline (P7) which orchestrates:
      1. Split script into visual scenes
      2. Generate video clips for each scene (P4)
      3. Generate voiceover audio + subtitles (P3)
      4. Assemble final video (P5)
      5. Build editable timeline (P6)

    All pipeline steps are resilient — individual failures produce
    ``"partial"`` status rather than crashing the entire request.

    Returns a ``GenerateVideoResponse`` with the final video path,
    timeline, scenes, clips, and voice metadata.
    """
    # ── Validate input ───────────────────────────────────────────────────
    if not request.script or not request.script.strip():
        logger.warning("POST /api/generate_video: empty script")
        return {
            "status": "failed",
            "final_video": None,
            "timeline": {},
            "scenes": [],
            "clips": [],
            "voice": {},
            "error": "empty script",
        }

    ratio = _validate_ratio(request.ratio)
    speed = _validate_speed(request.speed)

    logger.info(
        f"POST /api/generate_video: "
        f"script_len={len(request.script)}, "
        f"ratio={ratio}, voice={request.voice}, speed={speed}"
    )

    # ── Run pipeline ────────────────────────────────────────────────────
    try:
        result = run_pipeline(
            script=request.script,
            ratio=ratio,
            voice=request.voice,
            speed=speed,
        )

        response = {
            "status": result.get("status", "failed"),
            "final_video": result.get("final_video"),
            "timeline": result.get("timeline", {}),
            "scenes": result.get("scenes", []),
            "clips": result.get("clips", []),
            "voice": result.get("voice", {}),
            "error": result.get("error"),
        }

        clips = response["clips"]
        clips_ok = sum(1 for c in clips if c.get("status") == "ok")
        logger.info(
            f"POST /api/generate_video response: "
            f"status={response['status']}, "
            f"video={'yes' if response['final_video'] else 'no'}, "
            f"scenes={len(response['scenes'])}, "
            f"clips_ok={clips_ok}/{len(clips)}"
        )

        return response

    except Exception as e:
        logger.error(
            f"POST /api/generate_video UNEXPECTED ERROR: {e}",
            exc_info=True,
        )
        return {
            "status": "failed",
            "final_video": None,
            "timeline": {},
            "scenes": [],
            "clips": [],
            "voice": {},
            "error": f"pipeline crashed: {e}",
        }


# ─── Integration Helper ─────────────────────────────────────────────────────

def register_routes(app):
    """
    Register all v3 routes on a FastAPI app.

    Convenience function::

        from api.routes.generate_video import register_routes
        register_routes(app)
    """
    app.include_router(router)
    logger.info("Registered /api/generate_video endpoint")
