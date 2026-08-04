"""
MediaIndexerPro v3 — FFmpeg Pipeline (P5)

High-performance video assembly using FFmpeg.

Provides:
  - ``concat_clips_ffmpeg`` — Concatenate multiple video clips
  - ``add_audio_ffmpeg``   — Add/mix audio track with ducking
  - ``add_subtitles_ffmpeg`` — Burn subtitles into video

All functions normalise codec (H.264 + AAC), resolution, and frame rate
to produce a consistent output.

Usage:
    from auto_editor.ffmpeg_pipeline import (
        concat_clips_ffmpeg, add_audio_ffmpeg, add_subtitles_ffmpeg
    )

    # Step 1: Concatenate clips
    temp_video = concat_clips_ffmpeg(["clip1.mp4", "clip2.mp4"], "temp.mp4")

    # Step 2: Add audio
    temp_av = add_audio_ffmpeg(temp_video, "voice.wav", "temp_av.mp4")

    # Step 3: Add subtitles
    final = add_subtitles_ffmpeg(temp_av, "subtitles.srt", "final.mp4")
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any, Optional

# Ensure project root is in path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

logger = logging.getLogger("MediaIndexerPro.FFmpegPipeline")

# ─── Constants ───────────────────────────────────────────────────────────────

TARGET_CODEC_VIDEO = "libx264"
TARGET_CODEC_AUDIO = "aac"
TARGET_FPS = 30
TARGET_PIX_FMT = "yuv420p"
TARGET_CRF = 23
TARGET_AUDIO_BITRATE = "128k"
TARGET_AUDIO_SAMPLE_RATE = 44100

RETRY_COUNT = 2
RETRY_DELAY = 2  # seconds

# Audio ducking
BACKGROUND_GAIN_DB = -12  # dB reduction for background audio when voice is present
VOICE_GAIN_DB = 3        # dB boost for voice track


# ═══════════════════════════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _check_ffmpeg() -> bool:
    """Check if ffmpeg is available."""
    try:
        r = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True, timeout=5)
        return r.returncode == 0
    except Exception:
        return False


def _check_ffprobe() -> bool:
    """Check if ffprobe is available."""
    try:
        r = subprocess.run(["ffprobe", "-version"], capture_output=True, text=True, timeout=5)
        return r.returncode == 0
    except Exception:
        return False


def _get_stream_spec(path: str) -> Optional[dict[str, Any]]:
    """Get first video stream info via ffprobe."""
    if not _check_ffprobe():
        return None
    try:
        import json
        r = subprocess.run(
            [
                "ffprobe", "-v", "quiet",
                "-print_format", "json",
                "-show_streams",
                path,
            ],
            capture_output=True, text=True, timeout=15,
        )
        if r.returncode != 0:
            return None
        data = json.loads(r.stdout)
        for s in data.get("streams", []):
            if s.get("codec_type") == "video":
                return {
                    "width": s.get("width", 0),
                    "height": s.get("height", 0),
                    "fps": _parse_fps(s.get("r_frame_rate", "30/1")),
                    "codec": s.get("codec_name", ""),
                }
        return None
    except Exception:
        return None


def _parse_fps(fps_str: str) -> float:
    """Parse FFmpeg frame rate string (e.g. '30000/1001') to float."""
    try:
        if "/" in fps_str:
            num, den = fps_str.split("/")
            return float(num) / float(den)
        return float(fps_str)
    except (ValueError, ZeroDivisionError):
        return float(TARGET_FPS)


def _get_target_resolution(clip_paths: list[str]) -> tuple[int, int]:
    """
    Determine the target resolution from the first valid clip.
    Falls back to 1920x1080 if no clip info available.
    """
    for path in clip_paths:
        info = _get_stream_spec(path)
        if info and info["width"] > 0 and info["height"] > 0:
            # Normalise to even dimensions (required by libx264)
            w = info["width"] if info["width"] % 2 == 0 else info["width"] + 1
            h = info["height"] if info["height"] % 2 == 0 else info["height"] + 1
            return (w, h)
    return (1920, 1080)


def _run_ffmpeg(cmd: list[str], description: str, retries: int = RETRY_COUNT) -> Optional[str]:
    """
    Run an FFmpeg command with retry logic.

    Args:
        cmd: Full ffmpeg command list.
        description: Human-readable description for logging.
        retries: Number of retry attempts.

    Returns:
        The last argument (output path) on success, None on failure.
    """
    for attempt in range(1, retries + 1):
        try:
            logger.info(f"FFmpeg {description} (attempt {attempt}/{retries})")
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=600,  # 10 min timeout for long videos
            )
            if result.returncode == 0:
                output_path = cmd[-1]
                if Path(output_path).exists():
                    logger.info(f"FFmpeg {description} success: {output_path}")
                    return output_path
                logger.warning(f"FFmpeg {description}: output file not found")
            else:
                # Truncate stderr to avoid huge log output
                err = result.stderr[:500] if result.stderr else "no stderr"
                logger.warning(f"FFmpeg {description} failed: {err}")
        except subprocess.TimeoutExpired:
            logger.warning(f"FFmpeg {description} timed out")
        except Exception as e:
            logger.warning(f"FFmpeg {description} error: {e}")

        if attempt < retries:
            import time
            time.sleep(RETRY_DELAY)

    logger.error(f"FFmpeg {description} failed after {retries} attempts")
    return None


# ═══════════════════════════════════════════════════════════════════════════════
#  1. concat_clips_ffmpeg
# ═══════════════════════════════════════════════════════════════════════════════

def concat_clips_ffmpeg(
    clip_paths: list[str],
    output_path: str,
    target_fps: int = TARGET_FPS,
) -> Optional[str]:
    """
    Concatenate multiple video clips into a single file.

    Uses FFmpeg ``concat`` demuxer for frame-accurate concatenation.
    All clips are normalised to the same resolution, codec, and frame rate
    via a pre-processing step if they differ.

    Args:
        clip_paths: List of paths to video clips.
        output_path: Path for the output MP4 file.
        target_fps: Target frame rate (default 30).

    Returns:
        ``output_path`` on success, ``None`` on failure.
    """
    if not clip_paths:
        logger.error("concat_clips_ffmpeg: empty clip list")
        return None

    # Filter to existing files
    valid_clips = [p for p in clip_paths if Path(p).exists()]
    if not valid_clips:
        logger.error("concat_clips_ffmpeg: no valid clip files")
        return None

    skipped = len(clip_paths) - len(valid_clips)
    if skipped:
        logger.warning(f"concat_clips_ffmpeg: {skipped} clip(s) not found, skipping")

    logger.info(
        f"concat_clips_ffmpeg: {len(valid_clips)} clip(s) -> {output_path}"
    )

    target_w, target_h = _get_target_resolution(valid_clips)

    # Create temp directory for normalised clips and concat list
    temp_dir = Path(tempfile.mkdtemp(prefix="mip_concat_"))

    try:
        # Step 1: Normalise all clips to uniform codec/resolution/fps
        normalised = []
        for i, clip_path in enumerate(valid_clips):
            norm_path = str(temp_dir / f"norm_{i:04d}.mp4")
            cmd = [
                "ffmpeg", "-y",
                "-i", clip_path,
                "-c:v", TARGET_CODEC_VIDEO,
                "-preset", "fast",
                "-crf", str(TARGET_CRF),
                "-pix_fmt", TARGET_PIX_FMT,
                "-r", str(target_fps),
                "-vf", f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
                       f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2",
                "-c:a", TARGET_CODEC_AUDIO,
                "-b:a", TARGET_AUDIO_BITRATE,
                "-ar", str(TARGET_AUDIO_SAMPLE_RATE),
                "-ac", "2",
                norm_path,
            ]
            result = _run_ffmpeg(cmd, f"normalise clip {i}")
            if result:
                normalised.append(norm_path)
            else:
                logger.warning(f"Failed to normalise clip {i}, using original")
                normalised.append(clip_path)

        if not normalised:
            logger.error("concat_clips_ffmpeg: no clips could be normalised")
            return None

        # Step 2: Create concat demuxer file
        concat_file = str(temp_dir / "concat.txt")
        with open(concat_file, "w", encoding="utf-8") as f:
            for path in normalised:
                # Escape single quotes for FFmpeg
                escaped = path.replace("'", "'\\''")
                f.write(f"file '{escaped}'\n")

        # Step 3: Run concat demuxer
        cmd = [
            "ffmpeg", "-y",
            "-f", "concat",
            "-safe", "0",
            "-i", concat_file,
            "-c", "copy",  # Already normalised, safe to stream copy
            output_path,
        ]
        result = _run_ffmpeg(cmd, "concat clips")

        if result:
            size_kb = Path(output_path).stat().st_size / 1024
            logger.info(
                f"Concat success: {len(normalised)} clips, "
                f"{target_w}x{target_h} @ {target_fps}fps, {size_kb:.0f} KB"
            )
            return result

        # Fallback: single FFmpeg command with concat filter
        logger.info("Concat demuxer failed, trying concat filter...")
        filter_parts = [f"[{i}:v][{i}:a]" for i in range(len(normalised))]
        filter_inputs = "".join(filter_parts)
        filter_complex = (
            f"{filter_inputs}concat=n={len(normalised)}:v=1:a=1"
            f"[v][a]"
        )

        cmd = (
            ["ffmpeg", "-y"]
            + sum([["-i", p] for p in normalised], [])
            + [
                "-filter_complex", filter_complex,
                "-map", "[v]",
                "-map", "[a]",
                "-c:v", TARGET_CODEC_VIDEO,
                "-preset", "fast",
                "-crf", str(TARGET_CRF),
                "-c:a", TARGET_CODEC_AUDIO,
                "-b:a", TARGET_AUDIO_BITRATE,
                output_path,
            ]
        )
        return _run_ffmpeg(cmd, "concat filter fallback")

    except Exception as e:
        logger.error(f"concat_clips_ffmpeg error: {e}", exc_info=True)
        return None
    finally:
        # Cleanup temp files
        try:
            for f in Path(temp_dir).iterdir():
                f.unlink(missing_ok=True)
            Path(temp_dir).rmdir()
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════════════════════
#  2. add_audio_ffmpeg
# ═══════════════════════════════════════════════════════════════════════════════

def add_audio_ffmpeg(
    video_path: str,
    audio_path: Optional[str],
    output_path: str,
    ducking: bool = True,
) -> Optional[str]:
    """
    Add an audio track to a video with optional voice ducking.

    The voice track is boosted (+3 dB) and the original video audio is
    lowered (-12 dB) when ``ducking=True``, creating a podcast-style mix
    where the voiceover is clearly audible over background audio.

    Args:
        video_path: Path to the input video.
        audio_path: Path to the voiceover audio file. If ``None`` or missing,
                    the original video audio is kept unchanged.
        output_path: Path for the output MP4.
        ducking: Whether to apply audio ducking (default ``True``).

    Returns:
        ``output_path`` on success, ``None`` on failure.
    """
    if not Path(video_path).exists():
        logger.error(f"add_audio_ffmpeg: video not found: {video_path}")
        return None

    # If no audio track, keep original video audio
    if not audio_path or not Path(audio_path).exists():
        logger.warning("add_audio_ffmpeg: no audio file, keeping original audio")
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-c:v", "copy",
            "-c:a", "copy",
            output_path,
        ]
        return _run_ffmpeg(cmd, "copy audio (no voice track)")

    try:
        if ducking:
            # Complex audio mixing with ducking:
            # - Map video's original audio, lower by BACKGROUND_GAIN_DB
            # - Map voiceover audio, boost by VOICE_GAIN_DB
            # - Mix both into stereo output
            cmd = [
                "ffmpeg", "-y",
                "-i", video_path,
                "-i", audio_path,
                "-filter_complex",
                f"[0:a]volume={BACKGROUND_GAIN_DB}dB[bg];"
                f"[1:a]volume={VOICE_GAIN_DB}dB[voice];"
                f"[bg][voice]amix=inputs=2:duration=first:dropout_transition=2"
                f",aformat=sample_rates={TARGET_AUDIO_SAMPLE_RATE}:channel_layouts=stereo[out]",
                "-map", "0:v",   # Video from first input
                "-map", "[out]",  # Mixed audio
                "-c:v", "copy",
                "-c:a", TARGET_CODEC_AUDIO,
                "-b:a", TARGET_AUDIO_BITRATE,
                "-shortest",      # Match shortest input (usually video)
                output_path,
            ]
        else:
            # Simple audio replacement (no ducking)
            cmd = [
                "ffmpeg", "-y",
                "-i", video_path,
                "-i", audio_path,
                "-map", "0:v",
                "-map", "1:a",
                "-c:v", "copy",
                "-c:a", TARGET_CODEC_AUDIO,
                "-b:a", TARGET_AUDIO_BITRATE,
                "-shortest",
                output_path,
            ]

        # If video has no audio stream, use a simpler command
        # Check by trying the complex filter; fall back to simple if it fails
        result = _run_ffmpeg(cmd, "add audio" + (" (ducking)" if ducking else ""))

        if result:
            return result

        # Fallback: simple audio overlay without ducking
        logger.info("Ducking failed, trying simple audio overlay...")
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", audio_path,
            "-c:v", "copy",
            "-map", "0:v",
            "-map", "1:a",
            "-c:a", TARGET_CODEC_AUDIO,
            "-b:a", TARGET_AUDIO_BITRATE,
            "-shortest",
            output_path,
        ]
        return _run_ffmpeg(cmd, "add audio simple")

    except Exception as e:
        logger.error(f"add_audio_ffmpeg error: {e}", exc_info=True)
        return None


# ═══════════════════════════════════════════════════════════════════════════════
#  3. add_subtitles_ffmpeg
# ═══════════════════════════════════════════════════════════════════════════════

def add_subtitles_ffmpeg(
    video_path: str,
    srt_path: Optional[str],
    output_path: str,
) -> Optional[str]:
    """
    Burn subtitles into a video using FFmpeg's ``subtitles`` filter.

    Handles UTF-8 BOM, special character escaping, and automatic newline
    handling via SRT formatting.

    Args:
        video_path: Path to the input video.
        srt_path: Path to the SRT subtitle file. If ``None`` or missing,
                  the video is copied through without change.
        output_path: Path for the output MP4.

    Returns:
        ``output_path`` on success, ``None`` on failure.
    """
    if not Path(video_path).exists():
        logger.error(f"add_subtitles_ffmpeg: video not found: {video_path}")
        return None

    # If no subtitles, pass through
    if not srt_path or not Path(srt_path).exists():
        logger.warning("add_subtitles_ffmpeg: no subtitle file, copying video")
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-c:v", "copy",
            "-c:a", "copy",
            output_path,
        ]
        return _run_ffmpeg(cmd, "copy (no subtitles)")

    try:
        # Normalise SRT: ensure UTF-8 without BOM, escape for FFmpeg filter
        import shutil
        normalised_srt = str(Path(srt_path).parent / f"_norm_{Path(srt_path).name}")

        with open(srt_path, "r", encoding="utf-8-sig") as f:
            content = f.read()

        with open(normalised_srt, "w", encoding="utf-8") as f:
            f.write(content)

        # Escape the SRT path for FFmpeg filter (escape : and \)
        filter_path = normalised_srt.replace("\\", "/").replace(":", "\\:")
        # On Windows, also handle drive letter colon
        if ":" in filter_path and len(filter_path) > 2 and filter_path[1] == ":":
            # Drive letter like C: - escape the colon
            filter_path = filter_path[0] + "\\:" + filter_path[2:]

        # Use subtitles filter
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vf", f"subtitles={filter_path}",
            "-c:v", TARGET_CODEC_VIDEO,
            "-preset", "fast",
            "-crf", str(TARGET_CRF),
            "-c:a", "copy",
            output_path,
        ]

        result = _run_ffmpeg(cmd, "add subtitles")

        # Cleanup normalised SRT
        try:
            Path(normalised_srt).unlink(missing_ok=True)
        except Exception:
            pass

        if result:
            return result

        # Fallback: try with -c:s mov_text for soft subtitles
        logger.info("Subtitle burn-in failed, trying soft subtitles...")
        cmd = [
            "ffmpeg", "-y",
            "-i", video_path,
            "-i", normalised_srt,
            "-c:v", "copy",
            "-c:a", "copy",
            "-c:s", "mov_text",
            "-metadata:s:s:0", "language=eng",
            output_path,
        ]
        return _run_ffmpeg(cmd, "add soft subtitles")

    except Exception as e:
        logger.error(f"add_subtitles_ffmpeg error: {e}", exc_info=True)
        return None
