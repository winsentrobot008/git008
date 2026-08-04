"""
MediaIndexerPro v3 — Subtitle Track (P6)

Manages subtitle entries on the timeline with SRT import/export.

Supports:
  - Load from SRT file
  - Add/remove individual subtitles
  - Global time shift
  - Export to SRT format

Usage:
    from timeline_editor.track_subtitle import SubtitleTrack

    track = SubtitleTrack()
    track.load_srt("/path/to/subtitles.srt")
    track.add_subtitle("Hello world", 0.0, 3.5)
    track.shift_all(2.0)          # Shift all by +2s
    track.export_srt("/path/to/output.srt")
"""

from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("MediaIndexerPro.SubtitleTrack")


class SubtitleTrack:
    """
    A timeline subtitle track with SRT import/export.

    Each subtitle entry has:
      - index (int): sequential number (1-based)
      - id (str): UUID hex for internal reference
      - text (str): subtitle text
      - start (float): start time in seconds
      - end (float): end time in seconds
    """

    def __init__(self) -> None:
        """Initialise an empty subtitle track."""
        self.subtitles: list[dict[str, Any]] = []

    # ── Public API ─────────────────────────────────────────────────────────

    def load_srt(self, path: str) -> int:
        """
        Load subtitles from an SRT file.

        Replaces any existing subtitles. The SRT file can have UTF-8 BOM.

        Args:
            path: Path to the SRT file.

        Returns:
            Number of subtitle entries loaded.

        Raises:
            FileNotFoundError: If the SRT file does not exist.
        """
        srt_path = Path(path)
        if not srt_path.exists():
            raise FileNotFoundError(f"SRT file not found: {path}")

        content = srt_path.read_text(encoding="utf-8-sig")

        # SRT block pattern
        block_pattern = re.compile(
            r"(\d+)\s*\n"
            r"(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})\s*\n"
            r"((?:.+\n?)*?)(?:\n|$)",
            re.MULTILINE,
        )

        self.subtitles = []
        for match in block_pattern.finditer(content):
            start = self._srt_time_to_seconds(match.group(2))
            end = self._srt_time_to_seconds(match.group(3))
            text = match.group(4).strip().replace("\n", " ")
            self.subtitles.append({
                "index": int(match.group(1)),
                "id": uuid.uuid4().hex,
                "text": text,
                "start": start,
                "end": end,
            })

        logger.info(f"SubtitleTrack.load_srt: loaded {len(self.subtitles)} entries")
        return len(self.subtitles)

    def add_subtitle(
        self,
        text: str,
        start: float,
        end: float,
    ) -> str:
        """
        Add a subtitle entry.

        Args:
            text: Subtitle text.
            start: Start time in seconds.
            end: End time in seconds.

        Returns:
            The generated entry ID (UUID hex).
        """
        if end <= start:
            logger.warning(
                f"SubtitleTrack.add_subtitle: end ({end}) <= start ({start})"
            )
            end = start + 2.0

        if not text or not text.strip():
            logger.warning("SubtitleTrack.add_subtitle: empty text")
            text = "..."

        entry_id = uuid.uuid4().hex
        self.subtitles.append({
            "index": len(self.subtitles) + 1,
            "id": entry_id,
            "text": text.strip(),
            "start": start,
            "end": end,
        })
        self._renumber()

        logger.info(
            f"SubtitleTrack.add_subtitle: {entry_id[:8]} "
            f"'{text[:30]}' [{start:.1f}s-{end:.1f}s]"
        )
        return entry_id

    def remove_subtitle(self, entry_id: str) -> bool:
        """
        Remove a subtitle entry by its UUID hex.

        Args:
            entry_id: The UUID hex of the entry to remove.

        Returns:
            ``True`` if removed, ``False`` if not found.
        """
        for i, sub in enumerate(self.subtitles):
            if sub["id"] == entry_id:
                self.subtitles.pop(i)
                self._renumber()
                logger.info(f"SubtitleTrack.remove_subtitle: {entry_id[:8]}")
                return True
        logger.warning(f"SubtitleTrack.remove_subtitle: not found: {entry_id[:8]}")
        return False

    def shift_all(self, delta: float) -> None:
        """
        Shift all subtitle entries by a time delta (supports negative).

        Args:
            delta: Time offset in seconds (can be negative).
        """
        for sub in self.subtitles:
            sub["start"] = max(0.0, sub["start"] + delta)
            sub["end"] = max(0.0, sub["end"] + delta)
        logger.info(f"SubtitleTrack.shift_all: shifted by {delta:.1f}s")

    def export_srt(self, path: str) -> str:
        """
        Export subtitles to an SRT file.

        Args:
            path: Output path for the SRT file.

        Returns:
            The absolute path to the written SRT file.
        """
        self._renumber()
        output_path = Path(path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        lines: list[str] = []
        for sub in self.subtitles:
            lines.append(str(sub["index"]))
            lines.append(
                f"{self._seconds_to_srt_time(sub['start'])}"
                f" --> "
                f"{self._seconds_to_srt_time(sub['end'])}"
            )
            lines.append(sub["text"])
            lines.append("")

        output_path.write_text("\n".join(lines), encoding="utf-8")
        abs_path = str(output_path.resolve())
        logger.info(
            f"SubtitleTrack.export_srt: {abs_path} "
            f"({len(self.subtitles)} entries)"
        )
        return abs_path

    def to_timeline(self) -> list[dict[str, Any]]:
        """Return all subtitle entries sorted by start time."""
        self.subtitles.sort(key=lambda s: s["start"])
        return list(self.subtitles)

    # ── Internal ──────────────────────────────────────────────────────────

    @staticmethod
    def _srt_time_to_seconds(t: str) -> float:
        """Convert SRT timestamp ``HH:MM:SS,mmm`` to seconds."""
        h, m, s_ms = t.split(":")
        s, ms = s_ms.split(",")
        return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000

    @staticmethod
    def _seconds_to_srt_time(seconds: float) -> str:
        """Convert seconds to SRT timestamp ``HH:MM:SS,mmm``."""
        if seconds < 0:
            seconds = 0.0
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int((seconds - int(seconds)) * 1000)
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

    def _renumber(self) -> None:
        """Re-number subtitle indices sequentially."""
        self.subtitles.sort(key=lambda s: s["start"])
        for i, sub in enumerate(self.subtitles, 1):
            sub["index"] = i

    def __len__(self) -> int:
        return len(self.subtitles)

    def __repr__(self) -> str:
        return f"SubtitleTrack({len(self.subtitles)} entries)"
