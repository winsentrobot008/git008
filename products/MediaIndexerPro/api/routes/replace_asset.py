"""
MediaIndexerPro v3 — Replace Asset API Route (P10)

"剪影式替换" (Silhouette-style Replace) — replace content while keeping
all timeline structure (timing, position, effects) intact.

Endpoints:

  - ``POST /api/timeline/{timeline_id}/replace_clip``
  - ``POST /api/timeline/{timeline_id}/replace_audio``
  - ``POST /api/timeline/{timeline_id}/replace_subtitle``
  - ``POST /api/timeline/{timeline_id}/replace_overlay``
  - ``POST /api/timeline/{timeline_id}/replace_and_render``

All endpoints share the ``TIMELINE_STORE`` from
:mod:`~api.routes.edit_timeline`.

Integration with ``api/server.py``::

    from api.routes.replace_asset import router as replace_router
    app.include_router(replace_router)
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any, Optional

# Ensure project root is in path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from api.routes.edit_timeline import TIMELINE_STORE, _store_timeline
from auto_editor import generate_final_video

logger = logging.getLogger("MediaIndexerPro.API.ReplaceAsset")

# ─── Router ─────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api", tags=["v3 Replace"])


# ─── Helpers ────────────────────────────────────────────────────────────────

def _get_timeline(timeline_id: str):
    """Retrieve timeline or raise 404."""
    tl = TIMELINE_STORE.get(timeline_id)
    if tl is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "timeline not found", "timeline_id": timeline_id},
        )
    return tl


def _validate_video_path(path: str) -> bool:
    """Validate that a path exists and is a valid video file."""
    p = Path(path)
    if not p.exists():
        return False
    if not p.is_file():
        return False
    if p.stat().st_size < 50 * 1024:  # 50 KB minimum
        return False
    # Try ffprobe validation
    try:
        from workflow.video_generator import validate_clip
        return validate_clip(path)
    except Exception:
        # ffprobe not available — just check extension
        return p.suffix.lower() in (".mp4", ".webm", ".mkv", ".avi", ".mov")


def _validate_audio_path(path: str) -> bool:
    """Validate that a path exists and is a valid audio file."""
    p = Path(path)
    if not p.exists():
        return False
    if not p.is_file():
        return False
    if p.stat().st_size < 10 * 1024:  # 10 KB minimum
        return False
    return True


# ─── Pydantic Models ────────────────────────────────────────────────────────

class ReplaceClipRequest(BaseModel):
    clip_id: str = Field(..., description="UUID of the clip to replace")
    new_path: str = Field(..., description="Path to the new video file")


class ReplaceAudioRequest(BaseModel):
    segment_id: str = Field(..., description="UUID of the audio segment to replace")
    new_path: str = Field(..., description="Path to the new audio file")


class ReplaceSubtitleRequest(BaseModel):
    subtitle_id: str = Field(..., description="UUID of the subtitle entry to replace")
    new_text: str = Field(..., description="New subtitle text")


class ReplaceOverlayRequest(BaseModel):
    overlay_id: str = Field(..., description="UUID of the overlay element to replace")
    new_content: str = Field(..., description="New content (text or file path)")
    new_type: str = Field(default="text", description='Element type: text|image|chart|avatar')
    new_position: str = Field(default="center", description='Position preset or "(x,y)"')


class ReplaceAndRenderRequest(BaseModel):
    clip_id: str = Field(..., description="UUID of the clip to replace")
    new_path: str = Field(..., description="Path to the new video file")


# ═══════════════════════════════════════════════════════════════════════════════
#  1. POST /api/timeline/{timeline_id}/replace_clip
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/timeline/{timeline_id}/replace_clip")
async def api_replace_clip(timeline_id: str, request: ReplaceClipRequest):
    """
    Replace a video clip in the timeline while preserving its timing.

    This is a **剪影式替换** (silhouette-style replace) operation:
    the clip's start time, end time, and position in the track are
    preserved — only the media file is swapped.

    The new path is validated with ``validate_clip()`` before replacement.
    """
    timeline = _get_timeline(timeline_id)

    # Validate new path
    if not _validate_video_path(request.new_path):
        return {"status": "failed", "error": "invalid new_path"}

    # Find and replace clip
    found = False
    for clip in timeline.video_track.clips:
        if clip["id"] == request.clip_id:
            old_path = clip["path"]
            clip["path"] = str(Path(request.new_path).resolve())
            _store_timeline(timeline)
            found = True
            logger.info(
                f"replace_clip: {timeline_id[:8]} / {request.clip_id[:8]} "
                f"'{Path(old_path).name}' -> '{Path(request.new_path).name}'"
            )
            break

    if not found:
        return {"status": "failed", "error": "clip not found"}

    return {"status": "ok", "timeline": timeline.to_dict()}


# ═══════════════════════════════════════════════════════════════════════════════
#  2. POST /api/timeline/{timeline_id}/replace_audio
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/timeline/{timeline_id}/replace_audio")
async def api_replace_audio(timeline_id: str, request: ReplaceAudioRequest):
    """
    Replace an audio segment while preserving its timing and type (voice/BGM).

    Silhouette-style: start, end, and segment type remain unchanged.
    """
    timeline = _get_timeline(timeline_id)

    # Validate new path
    if not _validate_audio_path(request.new_path):
        return {"status": "failed", "error": "invalid new_path"}

    # Find and replace audio segment
    found = False
    for seg in timeline.audio_track.segments:
        if seg["id"] == request.segment_id:
            old_path = seg["path"]
            seg["path"] = str(Path(request.new_path).resolve())
            _store_timeline(timeline)
            found = True
            logger.info(
                f"replace_audio: {timeline_id[:8]} / {request.segment_id[:8]} "
                f"'{Path(old_path).name}' -> '{Path(request.new_path).name}'"
            )
            break

    if not found:
        return {"status": "failed", "error": "audio segment not found"}

    return {"status": "ok", "timeline": timeline.to_dict()}


# ═══════════════════════════════════════════════════════════════════════════════
#  3. POST /api/timeline/{timeline_id}/replace_subtitle
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/timeline/{timeline_id}/replace_subtitle")
async def api_replace_subtitle(timeline_id: str, request: ReplaceSubtitleRequest):
    """
    Replace a subtitle entry's text while preserving its timing.

    Silhouette-style: start and end times remain unchanged.
    """
    timeline = _get_timeline(timeline_id)

    # Validate new text
    if not request.new_text or not request.new_text.strip():
        return {"status": "failed", "error": "empty new_text"}

    # Find and replace subtitle
    found = False
    for sub in timeline.subtitle_track.subtitles:
        if sub["id"] == request.subtitle_id:
            old_text = sub["text"]
            sub["text"] = request.new_text.strip()
            _store_timeline(timeline)
            found = True
            logger.info(
                f"replace_subtitle: {timeline_id[:8]} / {request.subtitle_id[:8]} "
                f"'{old_text[:30]}' -> '{request.new_text[:30]}'"
            )
            break

    if not found:
        return {"status": "failed", "error": "subtitle not found"}

    return {"status": "ok", "timeline": timeline.to_dict()}


# ═══════════════════════════════════════════════════════════════════════════════
#  4. POST /api/timeline/{timeline_id}/replace_overlay
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/timeline/{timeline_id}/replace_overlay")
async def api_replace_overlay(timeline_id: str, request: ReplaceOverlayRequest):
    """
    Replace an overlay element's content, type, and/or position.

    Silhouette-style: start and end times remain unchanged.

    All fields are optional; only provided fields are updated.
    """
    timeline = _get_timeline(timeline_id)

    # Validate type
    valid_types = {"text", "image", "chart", "avatar"}
    if request.new_type not in valid_types:
        return {
            "status": "failed",
            "error": f"invalid new_type '{request.new_type}'. "
                     f"Must be one of: {valid_types}",
        }

    # Validate content
    if not request.new_content or not request.new_content.strip():
        return {"status": "failed", "error": "empty new_content"}

    # For file-based types, validate file existence
    if request.new_type in ("image", "chart", "avatar"):
        if not Path(request.new_content).exists():
            return {
                "status": "failed",
                "error": f"file not found: {request.new_content}",
            }

    # Find and replace overlay
    found = False
    for el in timeline.overlay_track.elements:
        if el["id"] == request.overlay_id:
            el["content"] = request.new_content.strip()
            el["type"] = request.new_type
            el["position"] = request.new_position
            # Re-resolve position coordinates
            el["position_xy"] = list(
                timeline.overlay_track._resolve_position(request.new_position)
            )
            _store_timeline(timeline)
            found = True
            logger.info(
                f"replace_overlay: {timeline_id[:8]} / {request.overlay_id[:8]} "
                f"type={request.new_type}, pos={request.new_position}"
            )
            break

    if not found:
        return {"status": "failed", "error": "overlay not found"}

    return {"status": "ok", "timeline": timeline.to_dict()}


# ═══════════════════════════════════════════════════════════════════════════════
#  5. POST /api/timeline/{timeline_id}/replace_and_render
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/timeline/{timeline_id}/replace_and_render")
async def api_replace_and_render(
    timeline_id: str,
    request: ReplaceAndRenderRequest,
):
    """
    Replace a clip AND immediately re-render the video in one operation.

    This is a convenience endpoint for the frontend's "替换并导出" workflow.

    Pipeline:
      1. Replace the clip (silhouette-style)
      2. Build scene_results from the updated timeline
      3. Build voice_result from the updated timeline
      4. Call ``generate_final_video()``
      5. Return new video path + updated timeline
    """
    # Step 1: Replace clip
    timeline = _get_timeline(timeline_id)

    if not _validate_video_path(request.new_path):
        return {"status": "failed", "error": "invalid new_path"}

    found = False
    for clip in timeline.video_track.clips:
        if clip["id"] == request.clip_id:
            clip["path"] = str(Path(request.new_path).resolve())
            _store_timeline(timeline)
            found = True
            break

    if not found:
        return {"status": "failed", "error": "clip not found"}

    # Step 2: Build render inputs from timeline
    render_spec = timeline.to_render_spec()

    scene_results = []
    for clip in render_spec.get("clips", []):
        scene_results.append({
            "scene_id": clip.get("id", "?"),
            "path": clip.get("path", ""),
            "status": "ok",
        })

    voice_result: dict[str, Any] = {
        "audio": None,
        "subtitles": render_spec.get("subtitles"),
        "duration": render_spec.get("duration", 0),
    }
    for seg in render_spec.get("audio", []):
        if seg.get("type") == "voice" and seg.get("path"):
            voice_result["audio"] = seg["path"]
            break
    if voice_result["audio"] is None and render_spec.get("audio"):
        voice_result["audio"] = render_spec["audio"][0].get("path")

    # Step 3: Render
    output_dir = Path("local_assets/generated")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = str(output_dir / f"replace_render_{timeline_id[:8]}.mp4")

    try:
        render_result = generate_final_video(
            scene_results=scene_results,
            voice_result=voice_result,
            output_path=output_path,
        )

        video_path = render_result.get("video_path")

        if video_path and Path(video_path).exists():
            size_mb = Path(video_path).stat().st_size / (1024 * 1024)
            logger.info(
                f"replace_and_render complete: {video_path} "
                f"({size_mb:.1f} MB)"
            )
            return {
                "status": "ok",
                "final_video": video_path,
                "timeline": timeline.to_dict(),
                "engine": render_result.get("engine", "?"),
            }

        return {
            "status": "partial",
            "final_video": None,
            "timeline": timeline.to_dict(),
            "error": render_result.get("error", "render failed"),
        }

    except Exception as e:
        logger.error(
            f"replace_and_render failed for {timeline_id[:8]}: {e}",
            exc_info=True,
        )
        return {
            "status": "failed",
            "final_video": None,
            "timeline": timeline.to_dict(),
            "error": f"render crashed: {e}",
        }


# ═══════════════════════════════════════════════════════════════════════════════
#  Integration Helper
# ═══════════════════════════════════════════════════════════════════════════════

def register_routes(app):
    """Register all replace routes on a FastAPI app."""
    app.include_router(router)
    logger.info("Registered /api/timeline/*/replace_* endpoints")
