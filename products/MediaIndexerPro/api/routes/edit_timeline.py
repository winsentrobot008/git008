"""
MediaIndexerPro v3 — Timeline Editor API Route (P9)

Provides REST API endpoints for frontend timeline editing:

  - ``GET  /api/timeline/{timeline_id}`` — Retrieve timeline
  - ``POST /api/timeline/{timeline_id}/update`` — Modify tracks
  - ``POST /api/timeline/{timeline_id}/render`` — Render to video
  - ``POST /api/timeline/new`` — Create empty timeline

All timelines are stored in an in-memory dict (``TIMELINE_STORE``).

Integration with ``api/server.py``::

    from api.routes.edit_timeline import router as timeline_router
    app.include_router(timeline_router)
"""

from __future__ import annotations

import logging
import sys
import uuid
from pathlib import Path
from typing import Any, Optional

# Ensure project root is in path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from timeline_editor.editor_ui import Timeline
from auto_editor import generate_final_video

logger = logging.getLogger("MediaIndexerPro.API.Timeline")

# ─── Router ─────────────────────────────────────────────────────────────────

router = APIRouter(prefix="/api", tags=["v3 Timeline"])

# ─── Persistent Store ──────────────────────────────────────────────────────
# Timelines are stored in api/data/timelines/{timeline_id}.json
# and loaded into memory on startup.

import json
import os
from pathlib import Path
from typing import Optional

TIMELINE_STORE: dict[str, Timeline] = {}
TIMELINE_DIR = Path(__file__).resolve().parent.parent / "data" / "timelines"


def _load_timelines_from_disk() -> None:
    """Load all timeline files from disk into memory on startup."""
    if not TIMELINE_DIR.exists():
        TIMELINE_DIR.mkdir(parents=True, exist_ok=True)
        return
    count = 0
    for f in sorted(TIMELINE_DIR.iterdir()):
        if f.suffix == ".json":
            try:
                with open(f, "r", encoding="utf-8") as fp:
                    data = json.load(fp)
                tl_id = data.get("timeline_id", f.stem)
                if tl_id not in TIMELINE_STORE:
                    from timeline_editor.editor_ui import Timeline
                    tl = Timeline.from_dict(data)
                    TIMELINE_STORE[tl_id] = tl
                    count += 1
            except Exception as e:
                logger.warning(f"Failed to load timeline {f.name}: {e}")
    logger.info(f"Loaded {count} timelines from {TIMELINE_DIR}")


def _save_timeline_to_disk(timeline_id: str, timeline) -> None:
    """Persist a timeline to disk as JSON."""
    TIMELINE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        data = timeline.to_dict() if hasattr(timeline, 'to_dict') else timeline.__dict__
        path = TIMELINE_DIR / f"{timeline_id}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False, default=str)
    except Exception as e:
        logger.warning(f"Failed to save timeline {timeline_id}: {e}")


def _delete_timeline_from_disk(timeline_id: str) -> None:
    """Remove a timeline file from disk."""
    path = TIMELINE_DIR / f"{timeline_id}.json"
    if path.exists():
        path.unlink()


# Load existing timelines on module import
_load_timelines_from_disk()


# ─── Helpers ────────────────────────────────────────────────────────────────

def _get_timeline(timeline_id: str) -> Timeline:
    """Retrieve a timeline from the store, or raise 404."""
    timeline = TIMELINE_STORE.get(timeline_id)
    if timeline is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "timeline not found", "timeline_id": timeline_id},
        )
    return timeline


def _store_timeline(timeline: Timeline) -> None:
    """Store a timeline in the in-memory store and persist to disk."""
    TIMELINE_STORE[timeline.timeline_id] = timeline
    _save_timeline_to_disk(timeline.timeline_id, timeline)
    logger.debug(f"Timeline stored: {timeline.timeline_id[:8]}")


# ─── Pydantic Models ────────────────────────────────────────────────────────

class UpdateTimelineRequest(BaseModel):
    """Request body for ``POST /api/timeline/{id}/update``."""

    video: Optional[list[dict[str, Any]]] = Field(
        default=None,
        description="Full replacement for video track clips",
    )
    audio: Optional[list[dict[str, Any]]] = Field(
        default=None,
        description="Full replacement for audio track segments",
    )
    subtitles: Optional[list[dict[str, Any]]] = Field(
        default=None,
        description="Full replacement for subtitle entries",
    )
    overlays: Optional[list[dict[str, Any]]] = Field(
        default=None,
        description="Full replacement for overlay elements",
    )


class NewTimelineRequest(BaseModel):
    """Request body for ``POST /api/timeline/new``."""

    name: str = Field(
        default="Untitled Timeline",
        description="Optional timeline name",
    )


# ═══════════════════════════════════════════════════════════════════════════════
#  1. GET /api/timeline/{timeline_id}
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/timeline/{timeline_id}")
async def api_get_timeline(timeline_id: str):
    """
    Retrieve a timeline by its ID.

    Returns the full timeline JSON structure including all four tracks
    (video, audio, subtitles, overlays) and metadata.
    """
    timeline = _get_timeline(timeline_id)
    result = timeline.to_dict()
    logger.info(
        f"GET /api/timeline/{timeline_id[:8]}: "
        f"{len(result.get('video', []))}v, "
        f"{len(result.get('audio', []))}a, "
        f"{len(result.get('subtitles', []))}s, "
        f"{len(result.get('overlays', []))}o"
    )
    return result


# ═══════════════════════════════════════════════════════════════════════════════
#  2. POST /api/timeline/{timeline_id}/update
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/timeline/{timeline_id}/update")
async def api_update_timeline(timeline_id: str, request: UpdateTimelineRequest):
    """
    Update a timeline's tracks with new data from the frontend.

    Each track field is optional — only provided fields are updated.
    Tracks are fully replaced (not merged) with the provided data.

    Request body (all fields optional)::

        {
            "video": [{"id", "path", "start", "end"}, ...],
            "audio": [{"id", "path", "start", "end", "type"}, ...],
            "subtitles": [{"id", "text", "start", "end"}, ...],
            "overlays": [{"id", "type", "content", "start", "end", "position"}, ...]
        }
    """
    timeline = _get_timeline(timeline_id)

    try:
        # ── Update video track ───────────────────────────────────────────
        if request.video is not None:
            timeline.video_track.clips = []
            for clip_data in request.video:
                clip_path = clip_data.get("path", "")
                if clip_path and Path(clip_path).exists():
                    timeline.video_track.add_clip(
                        path=clip_path,
                        start=clip_data.get("start"),
                        end=clip_data.get("end"),
                    )
            logger.info(
                f"  Video track updated: {len(timeline.video_track)} clips"
            )

        # ── Update audio track ───────────────────────────────────────────
        if request.audio is not None:
            timeline.audio_track.segments = []
            for seg_data in request.audio:
                seg_path = seg_data.get("path", "")
                if seg_path and Path(seg_path).exists():
                    timeline.audio_track.add_segment(
                        path=seg_path,
                        start=seg_data.get("start", 0.0),
                        end=seg_data.get("end"),
                        segment_type=seg_data.get("type", "bgm"),
                    )
            logger.info(
                f"  Audio track updated: {len(timeline.audio_track)} segments"
            )

        # ── Update subtitle track ────────────────────────────────────────
        if request.subtitles is not None:
            timeline.subtitle_track.subtitles = []
            for sub_data in request.subtitles:
                text = sub_data.get("text", "")
                if text:
                    timeline.subtitle_track.add_subtitle(
                        text=text,
                        start=sub_data.get("start", 0.0),
                        end=sub_data.get("end", 5.0),
                    )
            logger.info(
                f"  Subtitle track updated: {len(timeline.subtitle_track)} entries"
            )

        # ── Update overlay track ─────────────────────────────────────────
        if request.overlays is not None:
            timeline.overlay_track.elements = []
            for el_data in request.overlays:
                content = el_data.get("content", "")
                if content:
                    timeline.overlay_track.add_overlay(
                        content=content,
                        overlay_type=el_data.get("type", "text"),
                        start=el_data.get("start", 0.0),
                        end=el_data.get("end"),
                        position=el_data.get("position", "center"),
                    )
            logger.info(
                f"  Overlay track updated: {len(timeline.overlay_track)} elements"
            )

        # Persist
        _store_timeline(timeline)

        return {
            "status": "ok",
            "timeline": timeline.to_dict(),
        }

    except Exception as e:
        logger.error(
            f"POST /api/timeline/{timeline_id[:8]}/update failed: {e}",
            exc_info=True,
        )
        return {
            "status": "failed",
            "error": f"update failed: {e}",
        }


# ═══════════════════════════════════════════════════════════════════════════════
#  3. POST /api/timeline/{timeline_id}/render
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/timeline/{timeline_id}/render")
async def api_render_timeline(timeline_id: str):
    """
    Render the current timeline into a final video.

    Converts the timeline into a render spec and passes it to
    :func:`~auto_editor.generate_final_video` for assembly.

    Supports all four tracks:
      - Video: concatenated in order
      - Audio: voice + BGM with ducking
      - Subtitles: SRT burned in
      - Overlays: text/image/chart/avatar composited
    """
    timeline = _get_timeline(timeline_id)
    render_spec = timeline.to_render_spec()

    logger.info(
        f"POST /api/timeline/{timeline_id[:8]}/render: "
        f"{len(render_spec.get('clips', []))} clips, "
        f"{len(render_spec.get('audio', []))} audio, "
        f"{len(render_spec.get('overlays', []))} overlays"
    )

    # Build scene_results for generate_final_video
    scene_results = []
    for clip in render_spec.get("clips", []):
        scene_results.append({
            "scene_id": clip.get("id", "?"),
            "path": clip.get("path", ""),
            "status": "ok",
        })

    # Build voice_result
    voice_result: dict[str, Any] = {
        "audio": None,
        "subtitles": render_spec.get("subtitles"),
        "duration": render_spec.get("duration", 0),
    }

    # Find first audio voice segment
    for seg in render_spec.get("audio", []):
        if seg.get("type") == "voice" and seg.get("path"):
            voice_result["audio"] = seg["path"]
            break
    if voice_result["audio"] is None and render_spec.get("audio"):
        # Fallback: use any audio segment
        voice_result["audio"] = render_spec["audio"][0].get("path")

    # Generate output path
    output_dir = Path("local_assets/generated")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = str(output_dir / f"timeline_render_{timeline_id[:8]}.mp4")

    try:
        result = generate_final_video(
            scene_results=scene_results,
            voice_result=voice_result,
            output_path=output_path,
        )

        video_path = result.get("video_path")
        engine = result.get("engine", "?")

        if video_path and Path(video_path).exists():
            size_mb = Path(video_path).stat().st_size / (1024 * 1024)
            logger.info(
                f"Render complete: {video_path} "
                f"({size_mb:.1f} MB, engine={engine})"
            )
            return {
                "status": "ok",
                "final_video": video_path,
                "engine": engine,
                "duration": result.get("duration", 0),
            }

        logger.warning(f"Render returned no video (engine={engine})")
        return {
            "status": "partial",
            "final_video": None,
            "engine": engine,
            "error": result.get("error", "render failed"),
        }

    except Exception as e:
        logger.error(
            f"Render failed for timeline {timeline_id[:8]}: {e}",
            exc_info=True,
        )
        return {
            "status": "failed",
            "final_video": None,
            "error": f"render crashed: {e}",
        }


# ═══════════════════════════════════════════════════════════════════════════════
#  4. POST /api/timeline/new
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/timeline/new")
async def api_new_timeline(request: NewTimelineRequest = NewTimelineRequest()):
    """
    Create a new empty timeline.

    Returns a ``timeline_id`` for subsequent operations.

    Request body (optional)::

        {"name": "My Timeline"}

    Response::

        {
            "timeline_id": "abc123...",
            "timeline": { ... }
        }
    """
    import datetime

    timeline = Timeline()
    timeline.name = request.name
    timeline.created_at = datetime.datetime.now().isoformat()

    _store_timeline(timeline)

    logger.info(
        f"POST /api/timeline/new: "
        f"id={timeline.timeline_id[:8]}, name='{request.name}'"
    )

    return {
        "timeline_id": timeline.timeline_id,
        "timeline": timeline.to_dict(),
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  Integration Helper
# ═══════════════════════════════════════════════════════════════════════════════

def register_routes(app):
    """Register all timeline routes on a FastAPI app."""
    app.include_router(router)
    logger.info("Registered /api/timeline/* endpoints")
