"""
MediaIndexerPro v3 — Video Track (P6)

Manages a sequence of video clips on a timeline with automatic
overlap resolution, insert/remove/move/trim operations.

Each clip has:
  - id (UUID): unique identifier
  - path (str): local file path
  - start (float): start time on timeline (seconds)
  - end (float): end time on timeline (seconds)

Usage:
    from timeline_editor.track_video import VideoTrack

    track = VideoTrack()
    track.add_clip("/path/to/clip1.mp4")           # auto-positions at 0s
    track.add_clip("/path/to/clip2.mp4")           # auto-positions after clip1
    track.trim_clip(track.clips[0]["id"], 2, 8)    # trim first clip
    track.to_timeline()  # sorted timeline data
"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("MediaIndexerPro.VideoTrack")


class VideoTrack:
    """
    A timeline video track managing ordered video clips.

    Clips are maintained in display order. When a clip is added without
    explicit start/end times, it is automatically placed after the last clip.
    Overlapping clips are resolved by shifting subsequent clips.
    """

    def __init__(self) -> None:
        """Initialise an empty video track."""
        self.clips: list[dict[str, Any]] = []

    # ── Public API ─────────────────────────────────────────────────────────

    def add_clip(
        self,
        path: str,
        start: Optional[float] = None,
        end: Optional[float] = None,
    ) -> Optional[str]:
        """
        Add a video clip to the track.

        If ``start`` is ``None``, the clip is placed immediately after the
        last clip's end time. If ``end`` is ``None``, the clip duration is
        set to 5 seconds (default placeholder).

        Args:
            path: Local path to the video file.
            start: Start time on the timeline in seconds (auto if ``None``).
            end: End time on the timeline in seconds (auto if ``None``).

        Returns:
            The generated ``clip_id`` (UUID hex), or ``None`` if the path
            is invalid.
        """
        if not path or not Path(path).exists():
            logger.warning(f"VideoTrack.add_clip: invalid path: {path}")
            return None

        clip_id = uuid.uuid4().hex

        # Auto-determine start time
        if start is None:
            if self.clips:
                start = self.clips[-1]["end"]
            else:
                start = 0.0

        # Auto-determine end time (default 5s placeholder)
        if end is None:
            end = start + 5.0

        # Validate
        if end <= start:
            logger.warning(
                f"VideoTrack.add_clip: end ({end}) <= start ({start}), swapping"
            )
            start, end = end, start
            if end <= start:
                end = start + 5.0

        clip: dict[str, Any] = {
            "id": clip_id,
            "path": str(Path(path).resolve()),
            "start": start,
            "end": end,
        }

        # Insert in sorted position (by start time)
        self.clips.append(clip)
        self._sort_and_resolve_overlaps()

        logger.info(
            f"VideoTrack.add_clip: {clip_id[:8]} "
            f"({Path(path).name}) [{start:.1f}s-{end:.1f}s]"
        )
        return clip_id

    def remove_clip(self, clip_id: str) -> bool:
        """
        Remove a clip by its ID.

        Args:
            clip_id: The UUID hex of the clip to remove.

        Returns:
            ``True`` if removed, ``False`` if not found.
        """
        for i, clip in enumerate(self.clips):
            if clip["id"] == clip_id:
                self.clips.pop(i)
                logger.info(f"VideoTrack.remove_clip: {clip_id[:8]}")
                return True
        logger.warning(f"VideoTrack.remove_clip: clip not found: {clip_id[:8]}")
        return False

    def move_clip(self, clip_id: str, new_index: int) -> bool:
        """
        Move a clip to a new position in the track order.

        Args:
            clip_id: The UUID hex of the clip to move.
            new_index: Target index (0-based).

        Returns:
            ``True`` if moved, ``False`` if not found.
        """
        for i, clip in enumerate(self.clips):
            if clip["id"] == clip_id:
                self.clips.pop(i)
                # Clamp index
                new_index = max(0, min(new_index, len(self.clips)))
                self.clips.insert(new_index, clip)
                self._sort_and_resolve_overlaps()
                logger.info(f"VideoTrack.move_clip: {clip_id[:8]} -> index {new_index}")
                return True
        logger.warning(f"VideoTrack.move_clip: clip not found: {clip_id[:8]}")
        return False

    def trim_clip(
        self,
        clip_id: str,
        new_start: float,
        new_end: float,
    ) -> bool:
        """
        Trim a clip to new start/end times.

        Adjacent clips are NOT shifted — only the specified clip's times
        are changed. Use ``move_clip`` to reorder afterwards if needed.

        Args:
            clip_id: The UUID hex of the clip to trim.
            new_start: New start time on timeline.
            new_end: New end time on timeline.

        Returns:
            ``True`` if trimmed, ``False`` if not found.
        """
        if new_end <= new_start:
            logger.warning(
                f"VideoTrack.trim_clip: end ({new_end}) <= start ({new_start})"
            )
            new_end = new_start + 1.0

        for clip in self.clips:
            if clip["id"] == clip_id:
                clip["start"] = new_start
                clip["end"] = new_end
                self._sort_and_resolve_overlaps()
                logger.info(
                    f"VideoTrack.trim_clip: {clip_id[:8]} "
                    f"[{new_start:.1f}s-{new_end:.1f}s]"
                )
                return True
        logger.warning(f"VideoTrack.trim_clip: clip not found: {clip_id[:8]}")
        return False

    def to_timeline(self) -> list[dict[str, Any]]:
        """
        Return the timeline as a sorted list of clip dicts.

        Returns:
            List of clips sorted by ``start`` time, each with keys:
            ``id``, ``path``, ``start``, ``end``.
        """
        sorted_clips = sorted(self.clips, key=lambda c: c["start"])
        return list(sorted_clips)

    def total_duration(self) -> float:
        """
        Calculate the total duration of the track.

        Returns:
            The maximum ``end`` time across all clips.
        """
        if not self.clips:
            return 0.0
        return max(c["end"] for c in self.clips)

    # ── Internal ──────────────────────────────────────────────────────────

    def _sort_and_resolve_overlaps(self) -> None:
        """
        Sort clips by start time and resolve overlaps by pushing
        overlapping clips to the right.
        """
        if len(self.clips) < 2:
            return

        sorted_clips = sorted(self.clips, key=lambda c: c["start"])

        for i in range(1, len(sorted_clips)):
            prev = sorted_clips[i - 1]
            curr = sorted_clips[i]

            if curr["start"] < prev["end"]:
                # Shift current clip after previous
                shift = prev["end"] - curr["start"]
                curr["start"] += shift
                curr["end"] += shift

        self.clips = sorted_clips

    def __len__(self) -> int:
        return len(self.clips)

    def __repr__(self) -> str:
        return (
            f"VideoTrack({len(self.clips)} clips, "
            f"total {self.total_duration():.1f}s)"
        )
