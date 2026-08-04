"""
MediaIndexerPro v3 — Auto Editor Module (P5)

Unified entry point for video assembly.

``generate_final_video`` orchestrates the full assembly pipeline:
  1. Concatenate video clips (FFmpeg → MoviePy)
  2. Add voiceover audio with ducking
  3. Burn in subtitles
  4. Validate the final output

Usage:
    from auto_editor import generate_final_video

    result = generate_final_video(
        scene_results=[
            {"scene_id": 1, "path": "/path/to/clip1.mp4"},
            {"scene_id": 2, "path": "/path/to/clip2.mp4"},
        ],
        voice_result={
            "audio": "/path/to/voice.wav",
            "subtitles": "/path/to/subtitles.srt",
            "duration": 178.5,
        },
        output_path="/path/to/final.mp4",
    )
    # → {"video_path": "/path/to/final.mp4", "duration": 178.5, ...}
"""

from __future__ import annotations

import logging
import os
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any, Optional

# Ensure project root is in path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

logger = logging.getLogger("MediaIndexerPro.AutoEditor")

# ─── Lazy imports (heavy dependencies loaded only when needed) ───────────────

def _get_ffmpeg_pipeline():
    from auto_editor.ffmpeg_pipeline import (
        concat_clips_ffmpeg, add_audio_ffmpeg, add_subtitles_ffmpeg,
    )
    return concat_clips_ffmpeg, add_audio_ffmpeg, add_subtitles_ffmpeg


def _get_moviepy_pipeline():
    from auto_editor.moviepy_pipeline import pipeline_moviepy
    return pipeline_moviepy


def _get_video_validator():
    from workflow.video_generator import validate_clip
    return validate_clip


# ═══════════════════════════════════════════════════════════════════════════════
#  generate_final_video
# ═══════════════════════════════════════════════════════════════════════════════

def generate_final_video(
    scene_results: list[dict[str, Any]],
    voice_result: dict[str, Any],
    output_path: str,
) -> dict[str, Any]:
    """
    Assemble the final video from scene clips, voiceover, and subtitles.

    Pipeline:
        1. Extract valid clip paths from ``scene_results``
        2. **concat_clips_ffmpeg** → temp video (no audio)
        3. **add_audio_ffmpeg** → voiceover with ducking
        4. **add_subtitles_ffmpeg** → burn in subtitles
        5. **validate_clip** → verify the final output
        6. Failover: if any FFmpeg step fails → **pipeline_moviepy**
        7. Return result dict with path, duration, and stats

    Args:
        scene_results: List of scene result dicts from
            :func:`~workflow.video_generator.generate_clips`.
            Each should have ``"path"`` (str) for successful scenes.
        voice_result: Dict from
            :func:`~workflow.voice_generator.generate_voice_and_subtitles`.
            Expected keys: ``"audio"``, ``"subtitles"``, ``"duration"``.
        output_path: Desired output path for the final MP4.

    Returns:
        A dict with keys::

            {
                "video_path": str | None,   # Path to final video
                "duration": float,           # Total duration in seconds
                "clips_used": int,           # Number of clips assembled
                "clips_total": int,          # Total scenes requested
                "engine": str,               # "ffmpeg" | "moviepy" | "failed"
                "error": str | None,         # Error message if failed
            }
    """
    logger.info("generate_final_video: starting assembly")

    # ── Extract valid clip paths ────────────────────────────────────────
    clip_paths: list[str] = []
    for scene in scene_results:
        path = scene.get("path")
        if path and Path(path).exists():
            clip_paths.append(path)

    clips_total = len(scene_results)
    clips_used = len(clip_paths)

    if not clip_paths:
        logger.error("generate_final_video: no valid video clips")
        return {
            "video_path": None,
            "duration": 0.0,
            "clips_used": 0,
            "clips_total": clips_total,
            "engine": "failed",
            "error": "no valid video clips",
        }

    # ── Extract audio / subtitle paths ──────────────────────────────────
    audio_path = voice_result.get("audio") if isinstance(voice_result, dict) else None
    subtitle_path = voice_result.get("subtitles") if isinstance(voice_result, dict) else None
    estimated_duration = voice_result.get("duration", 0.0) if isinstance(voice_result, dict) else 0.0

    # ── Try FFmpeg pipeline first ───────────────────────────────────────
    engine_used = "failed"
    final_path: Optional[str] = None
    error: Optional[str] = None

    try:
        concat, add_audio, add_subs = _get_ffmpeg_pipeline()
        validate = _get_video_validator()

        temp_dir = tempfile.mkdtemp(prefix="mip_final_")
        temp_concat = str(Path(temp_dir) / "concat.mp4")
        temp_av = str(Path(temp_dir) / "with_audio.mp4")

        # Step 1: Concatenate clips
        logger.info("Step 1/3: Concatenating clips (FFmpeg)...")
        concat_result = concat(clip_paths, temp_concat)
        if not concat_result:
            logger.warning("FFmpeg concat failed, will try MoviePy fallback")
            raise RuntimeError("FFmpeg concat failed")

        # Step 2: Add audio
        logger.info("Step 2/3: Adding audio (FFmpeg)...")
        audio_result = add_audio(temp_concat, audio_path, temp_av)
        if not audio_result:
            logger.warning("FFmpeg add_audio failed, using concat video without audio")
            temp_av = temp_concat

        # Step 3: Add subtitles
        logger.info("Step 3/3: Adding subtitles (FFmpeg)...")
        sub_result = add_subs(temp_av, subtitle_path, output_path)
        if sub_result:
            final_path = sub_result
            engine_used = "ffmpeg"
        else:
            logger.warning("FFmpeg subtitles failed, using video without subtitles")
            # Copy video without subtitles
            import shutil
            shutil.copy2(temp_av, output_path)
            final_path = output_path
            engine_used = "ffmpeg"

        # Validate
        if final_path and validate(final_path):
            logger.info(f"FFmpeg pipeline success: {final_path}")
        else:
            logger.warning(f"Final video validation failed, trying MoviePy fallback")
            final_path = None
            engine_used = "failed"

        # Cleanup temp
        try:
            for f in Path(temp_dir).iterdir():
                f.unlink(missing_ok=True)
            Path(temp_dir).rmdir()
        except Exception:
            pass

    except Exception as e:
        logger.warning(f"FFmpeg pipeline failed: {e}")
        engine_used = "failed"

    # ── Fallback: MoviePy pipeline ──────────────────────────────────────
    if not final_path:
        try:
            logger.info("Falling back to MoviePy pipeline...")
            moviepy = _get_moviepy_pipeline()

            # If output_path already exists from partial FFmpeg work, remove it
            Path(output_path).unlink(missing_ok=True)

            moviepy_result = moviepy(
                clips=clip_paths,
                audio=audio_path if (audio_path and Path(audio_path).exists()) else None,
                subtitles=subtitle_path if (subtitle_path and Path(subtitle_path).exists()) else None,
                output_path=output_path,
                ratio="16:9",
            )

            if moviepy_result:
                final_path = moviepy_result
                engine_used = "moviepy"
            else:
                error = "MoviePy pipeline also failed"
                logger.error(error)

        except Exception as e:
            error = f"MoviePy fallback failed: {e}"
            logger.error(error)

    # ── Get actual duration from final video ────────────────────────────
    actual_duration = estimated_duration
    if final_path and Path(final_path).exists():
        try:
            import subprocess, json
            r = subprocess.run(
                [
                    "ffprobe", "-v", "quiet",
                    "-print_format", "json",
                    "-show_format",
                    final_path,
                ],
                capture_output=True, text=True, timeout=15,
            )
            if r.returncode == 0:
                data = json.loads(r.stdout)
                dur = data.get("format", {}).get("duration", "0")
                actual_duration = float(dur)
        except Exception:
            pass

    # ── Build result ────────────────────────────────────────────────────
    result: dict[str, Any] = {
        "video_path": final_path,
        "duration": actual_duration,
        "clips_used": clips_used,
        "clips_total": clips_total,
        "engine": engine_used,
        "error": error,
    }

    if final_path:
        size_mb = Path(final_path).stat().st_size / (1024 * 1024)
        logger.info(
            f"generate_final_video complete: "
            f"engine={engine_used}, "
            f"{clips_used}/{clips_total} clips, "
            f"{actual_duration:.1f}s, "
            f"{size_mb:.1f} MB"
        )
    else:
        logger.error(f"generate_final_video FAILED: {error}")

    return result
