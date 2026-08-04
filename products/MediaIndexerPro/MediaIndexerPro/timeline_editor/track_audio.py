"""
MediaIndexerPro v3 — Audio Track (P6)

Manages audio segments on the timeline, supporting:
  - Voiceover segments (``type="voice"``)
  - Background music segments (``type="bgm"``)
  - Ducking metadata generation for FFmpeg audio mixing

The ducking metadata produced by ``duck_voice_over()`` is designed to
be consumed by :func:`~auto_editor.ffmpeg_pipeline.add_audio_ffmpeg`.

Usage:
    from timeline_editor.track_audio import AudioTrack

    track = AudioTrack()
    track.add_segment("/path/to/bgm.mp3", 0, 30, type="bgm")
    track.add_segment("/path/to/voice.wav", 2, 10, type="voice")
    track.add_segment("/path/to/voice2.wav", 15, 25, type="voice")

    duck_spec = track.duck_voice_over()
    # → [{"start": 2, "end": 10, "voice_gain": 3, "bgm_gain": -12},
    #     {"start": 15, "end": 25, "voice_gain": 3, "bgm_gain": -12}]
"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("MediaIndexerPro.AudioTrack")


class AudioTrack:
    """
    A timeline audio track managing voiceover and background music segments.

    Segments are maintained in start-time order. Overlaps between BGM and
    voice segments are resolved through ducking metadata rather than shifting.
    """

    def __init__(self) -> None:
        """Initialise an empty audio track."""
        self.segments: list[dict[str, Any]] = []

    # ── Public API ─────────────────────────────────────────────────────────

    def add_segment(
        self,
        path: str,
        start: float = 0.0,
        end: Optional[float] = None,
        segment_type: str = "bgm",
    ) -> Optional[str]:
        """
        Add an audio segment to the track.

        Args:
            path: Path to the audio file.
            start: Start time on the timeline in seconds (default 0).
            end: End time on the timeline. If ``None``, set to start + 10s.
            segment_type: ``"voice"`` (voiceover) or ``"bgm"`` (background).

        Returns:
            The generated segment ID (UUID hex), or ``None`` if path invalid.
        """
        if not path or not Path(path).exists():
            logger.warning(f"AudioTrack.add_segment: invalid path: {path}")
            return None

        if segment_type not in ("voice", "bgm"):
            logger.warning(
                f"AudioTrack.add_segment: unknown type '{segment_type}', "
                f"defaulting to 'bgm'"
            )
            segment_type = "bgm"

        seg_id = uuid.uuid4().hex

        if end is None:
            end = start + 10.0

        if end <= start:
            logger.warning(
                f"AudioTrack.add_segment: end ({end}) <= start ({start}), swapping"
            )
            start, end = end, start
            if end <= start:
                end = start + 10.0

        segment: dict[str, Any] = {
            "id": seg_id,
            "path": str(Path(path).resolve()),
            "start": start,
            "end": end,
            "type": segment_type,
        }

        self.segments.append(segment)
        self._sort()

        logger.info(
            f"AudioTrack.add_segment: {seg_id[:8]} "
            f"({Path(path).name}, {segment_type}) "
            f"[{start:.1f}s-{end:.1f}s]"
        )
        return seg_id

    def remove_segment(self, seg_id: str) -> bool:
        """
        Remove an audio segment by its ID.

        Args:
            seg_id: The UUID hex of the segment to remove.

        Returns:
            ``True`` if removed, ``False`` if not found.
        """
        for i, seg in enumerate(self.segments):
            if seg["id"] == seg_id:
                self.segments.pop(i)
                logger.info(f"AudioTrack.remove_segment: {seg_id[:8]}")
                return True
        logger.warning(f"AudioTrack.remove_segment: not found: {seg_id[:8]}")
        return False

    def duck_voice_over(
        self,
        voice_gain_db: float = 3.0,
        bgm_gain_db: float = -12.0,
    ) -> list[dict[str, Any]]:
        """
        Generate ducking metadata for FFmpeg audio mixing.

        For each voice segment, this method identifies the time range where
        the BGM volume should be lowered and the voice should be boosted.

        Returns:
            A list of ducking specs, each with::

                {
                    "start": float,       # Start time in seconds
                    "end": float,         # End time in seconds
                    "voice_gain": float,  # Gain in dB for voice
                    "bgm_gain": float,    # Gain in dB for BGM
                }
        """
        voice_segments = [s for s in self.segments if s["type"] == "voice"]
        if not voice_segments:
            return []

        duck_specs: list[dict[str, Any]] = []
        for vs in voice_segments:
            duck_specs.append({
                "start": vs["start"],
                "end": vs["end"],
                "voice_gain": voice_gain_db,
                "bgm_gain": bgm_gain_db,
            })

        # Sort and merge overlapping voice segments
        duck_specs.sort(key=lambda d: d["start"])
        merged: list[dict[str, Any]] = []
        for spec in duck_specs:
            if merged and spec["start"] <= merged[-1]["end"]:
                # Overlap: extend end time
                merged[-1]["end"] = max(merged[-1]["end"], spec["end"])
            else:
                merged.append(dict(spec))

        logger.info(
            f"AudioTrack.duck_voice_over: {len(merged)} ducking range(s)"
        )
        return merged

    def to_timeline(self) -> list[dict[str, Any]]:
        """
        Return all segments sorted by start time.

        Returns:
            List of segment dicts sorted by ``start``.
        """
        self._sort()
        return list(self.segments)

    def total_duration(self) -> float:
        """Get the maximum end time across all segments."""
        if not self.segments:
            return 0.0
        return max(s["end"] for s in self.segments)

    # ── Internal ──────────────────────────────────────────────────────────

    def _sort(self) -> None:
        """Sort segments by start time."""
        self.segments.sort(key=lambda s: s["start"])

    def __len__(self) -> int:
        return len(self.segments)

    def __repr__(self) -> str:
        voice_count = sum(1 for s in self.segments if s["type"] == "voice")
        bgm_count = sum(1 for s in self.segments if s["type"] == "bgm")
        return (
            f"AudioTrack({len(self.segments)} segments: "
            f"{voice_count} voice, {bgm_count} bgm)"
        )
