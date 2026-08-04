"""
MediaIndexerPro v3 — MoviePy Pipeline (P5)

MoviePy-based video assembly as a fallback when FFmpeg is unavailable or
when Python-level frame manipulation is needed.

Provides:
  - ``pipeline_moviepy`` — Full assembly pipeline (concat + audio + subtitles)

This module MUST NOT require FFmpeg. It uses MoviePy's native capabilities
with Pillow-based subtitle rendering.

Usage:
    from auto_editor.moviepy_pipeline import pipeline_moviepy

    result = pipeline_moviepy(
        clips=["clip1.mp4", "clip2.mp4"],
        audio="voiceover.wav",
        subtitles="captions.srt",
        output_path="final_video.mp4",
        ratio="1:1",
    )
"""

from __future__ import annotations

import logging
import os
import re
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any, Optional

# Ensure project root is in path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

logger = logging.getLogger("MediaIndexerPro.MoviePyPipeline")

# ─── Optional dependency flags ───────────────────────────────────────────────

try:
    from moviepy import (
        VideoFileClip, AudioFileClip, CompositeVideoClip,
        concatenate_videoclips, TextClip, ColorClip,
    )
    HAS_MOVIEPY = True
except ImportError:
    try:
        # Fallback for older MoviePy versions
        from moviepy.editor import (
            VideoFileClip, AudioFileClip, CompositeVideoClip,
            concatenate_videoclips, TextClip, ColorClip,
        )
        HAS_MOVIEPY = True
    except ImportError:
        HAS_MOVIEPY = False

if HAS_MOVIEPY:
    logger.info("MoviePy available — using as FFmpeg fallback")
else:
    logger.warning("MoviePy not installed. Install with: pip install moviepy")

try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

# ─── Constants ───────────────────────────────────────────────────────────────

TARGET_FPS = 30

# Subtitle style
SUBTITLE_FONT_SIZE = 36
SUBTITLE_FONT_COLOR = "white"
SUBTITLE_BG_COLOR = (0, 0, 0, 128)  # Semi-transparent black
SUBTITLE_MARGIN = 50  # Pixels from bottom

# Aspect ratio presets
RATIO_MAP: dict[str, tuple[int, int]] = {
    "1:1": (1080, 1080),
    "16:9": (1920, 1080),
    "9:16": (1080, 1920),
    "4:3": (1440, 1080),
    "3:4": (1080, 1440),
}

DEFAULT_RATIO = "16:9"


# ═══════════════════════════════════════════════════════════════════════════════
#  SRT Parsing
# ═══════════════════════════════════════════════════════════════════════════════

def _parse_srt(srt_path: str) -> list[dict[str, Any]]:
    """
    Parse an SRT subtitle file into a list of subtitle dicts.

    Each dict has keys: ``index``, ``start`` (seconds), ``end`` (seconds),
    ``text``.
    """
    subs: list[dict[str, Any]] = []

    try:
        with open(srt_path, "r", encoding="utf-8-sig") as f:
            content = f.read()
    except Exception as e:
        logger.warning(f"Failed to read SRT: {e}")
        return subs

    # SRT block pattern
    block_pattern = re.compile(
        r"(\d+)\s*\n"
        r"(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})\s*\n"
        r"((?:.+\n?)*?)(?:\n|$)",
        re.MULTILINE,
    )

    def _srt_time_to_seconds(t: str) -> float:
        h, m, s_ms = t.split(":")
        s, ms = s_ms.split(",")
        return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000

    for match in block_pattern.finditer(content):
        start = _srt_time_to_seconds(match.group(2))
        end = _srt_time_to_seconds(match.group(3))
        text = match.group(4).strip().replace("\n", " ")
        subs.append({
            "index": int(match.group(1)),
            "start": start,
            "end": end,
            "text": text,
        })

    return subs


# ═══════════════════════════════════════════════════════════════════════════════
#  Subtitle Frame Generation
# ═══════════════════════════════════════════════════════════════════════════════

def _make_subtitle_clip(
    text: str,
    start: float,
    end: float,
    video_size: tuple[int, int],
) -> Optional[Any]:
    """
    Create a MoviePy TextClip for a single subtitle entry.

    Args:
        text: Subtitle text.
        start: Start time in seconds.
        end: End time in seconds.
        video_size: (width, height) of the video.

    Returns:
        A ``TextClip`` positioned at the bottom of the frame, or ``None``.
    """
    if not HAS_MOVIEPY:
        return None

    try:
        duration = end - start

        # Try to use a nice font; fallback to default
        font_path = None
        if os.name == "nt":  # Windows
            candidates = [
                "C:/Windows/Fonts/arial.ttf",
                "C:/Windows/Fonts/msyh.ttc",  # Microsoft YaHei
                "C:/Windows/Fonts/seguiemj.ttf",
            ]
            for c in candidates:
                if Path(c).exists():
                    font_path = c
                    break

        clip = TextClip(
            text=text,
            font_size=SUBTITLE_FONT_SIZE,
            color=SUBTITLE_FONT_COLOR,
            font=font_path,
            stroke_color="black",
            stroke_width=1,
            method="caption",
            size=(video_size[0] - 80, None),  # Width with margins
        )

        # Position at bottom center
        clip = clip.with_position(
            ("center", video_size[1] - SUBTITLE_MARGIN - clip.size[1])
        ).with_start(start).with_duration(duration)

        return clip

    except Exception as e:
        logger.warning(f"Failed to create subtitle clip: {e}")
        return None


# ═══════════════════════════════════════════════════════════════════════════════
#  Public API: pipeline_moviepy
# ═══════════════════════════════════════════════════════════════════════════════

def pipeline_moviepy(
    clips: list[str],
    audio: Optional[str] = None,
    subtitles: Optional[str] = None,
    output_path: str = "",
    ratio: str = "16:9",
) -> Optional[str]:
    """
    Full video assembly pipeline using MoviePy.

    Pipeline:
        1. Load and concatenate all video clips
        2. Resize/crop to target aspect ratio
        3. Add audio track (if provided)
        4. Render and burn subtitles (if provided)
        5. Export to MP4

    This is designed as a **fallback** for when FFmpeg is not available
    or the FFmpeg pipeline fails.

    Args:
        clips: List of paths to video clips.
        audio: Optional path to audio file.
        subtitles: Optional path to SRT subtitle file.
        output_path: Path for the output MP4.
        ratio: Target aspect ratio (``"1:1"``, ``"16:9"``, ``"9:16"``, etc.).

    Returns:
        ``output_path`` on success, ``None`` on failure.
    """
    if not HAS_MOVIEPY:
        logger.error("MoviePy is not installed")
        return None

    if not clips:
        logger.error("pipeline_moviepy: no clips provided")
        return None

    # Filter to existing files
    valid_clips = [p for p in clips if Path(p).exists()]
    if not valid_clips:
        logger.error("pipeline_moviepy: no valid clip files")
        return None

    skipped = len(clips) - len(valid_clips)
    if skipped:
        logger.warning(f"pipeline_moviepy: {skipped} clip(s) not found, skipping")

    logger.info(
        f"pipeline_moviepy: {len(valid_clips)} clip(s), "
        f"audio={'yes' if audio else 'no'}, "
        f"subtitles={'yes' if subtitles else 'no'}, "
        f"ratio={ratio}"
    )

    # Resolve target resolution
    target_size = RATIO_MAP.get(ratio)
    if target_size is None:
        # Parse custom ratio
        match = re.match(r"^(\d+)\s*[:x]\s*(\d+)$", ratio)
        if match:
            target_size = (int(match.group(1)), int(match.group(2)))
        else:
            target_size = RATIO_MAP[DEFAULT_RATIO]

    temp_dir = None

    try:
        temp_dir = tempfile.mkdtemp(prefix="mip_moviepy_")

        # ── Step 1: Load and concatenate clips ──────────────────────────
        video_clips: list[Any] = []
        for i, clip_path in enumerate(valid_clips):
            try:
                vc = VideoFileClip(clip_path)
                # Resize to target resolution
                if vc.size != target_size:
                    vc = vc.resized(newsize=target_size)
                video_clips.append(vc)
            except Exception as e:
                logger.warning(f"Failed to load clip {i} ({clip_path}): {e}")

        if not video_clips:
            logger.error("pipeline_moviepy: no clips could be loaded")
            return None

        final_clip = concatenate_videoclips(video_clips, method="compose")

        # ── Step 2: Add audio ───────────────────────────────────────────
        if audio and Path(audio).exists():
            try:
                audio_clip = AudioFileClip(audio)
                # If audio is shorter than video, loop it; if longer, trim
                if audio_clip.duration < final_clip.duration:
                    from moviepy import afx
                    audio_clip = audio_clip.with_effects([
                        afx.AudioLoop(duration=final_clip.duration)
                    ])
                else:
                    audio_clip = audio_clip.subclipped(0, final_clip.duration)

                final_clip = final_clip.with_audio(audio_clip)
            except Exception as e:
                logger.warning(f"Failed to add audio: {e}")

        # ── Step 3: Add subtitles ───────────────────────────────────────
        if subtitles and Path(subtitles).exists():
            try:
                sub_data = _parse_srt(subtitles)
                sub_clips: list[Any] = []
                for sub in sub_data:
                    sc = _make_subtitle_clip(
                        sub["text"],
                        sub["start"],
                        sub["end"],
                        target_size,
                    )
                    if sc:
                        sub_clips.append(sc)

                if sub_clips:
                    # Composite: video + subtitles overlay
                    all_clips = [final_clip] + sub_clips
                    final_clip = CompositeVideoClip(all_clips, size=target_size)
            except Exception as e:
                logger.warning(f"Failed to add subtitles: {e}")

        # ── Step 4: Export ──────────────────────────────────────────────
        output_dir = Path(output_path).parent
        output_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"Exporting to {output_path}...")
        final_clip.write_videofile(
            output_path,
            codec="libx264",
            audio_codec="aac",
            fps=TARGET_FPS,
            preset="medium",
            bitrate="2000k",
            audio_bitrate="128k",
            threads=2,
            logger=None,  # Suppress MoviePy's verbose output
        )

        # Cleanup
        for vc in video_clips:
            try:
                vc.close()
            except Exception:
                pass
        try:
            final_clip.close()
        except Exception:
            pass

        if Path(output_path).exists():
            size_mb = Path(output_path).stat().st_size / (1024 * 1024)
            logger.info(
                f"MoviePy pipeline success: {output_path} ({size_mb:.1f} MB)"
            )
            return output_path

        logger.error("MoviePy pipeline: output file not created")
        return None

    except Exception as e:
        logger.error(f"MoviePy pipeline error: {e}", exc_info=True)
        return None
    finally:
        if temp_dir:
            try:
                for f in Path(temp_dir).iterdir():
                    f.unlink(missing_ok=True)
                Path(temp_dir).rmdir()
            except Exception:
                pass
