"""
MediaIndexerPro v3 — Overlay Track (P6)

Manages overlay elements on the timeline such as text, images, charts,
and AI avatars for compositing over the video.

Each overlay element has:
  - id (str): UUID hex
  - type (str): ``"text"`` | ``"image"`` | ``"chart"`` | ``"avatar"``
  - content (str): Text content or image/chart file path
  - start (float): Start time in seconds
  - end (float): End time in seconds
  - position (str | tuple): Position preset or custom ``(x, y)``

Position presets:
  ``top-left``, ``top-center``, ``top-right``,
  ``center-left``, ``center``, ``center-right``,
  ``bottom-left``, ``bottom-center``, ``bottom-right``

Usage:
    from timeline_editor.track_overlay import OverlayTrack

    track = OverlayTrack()
    track.add_overlay("Hello!", "text", 0, 10, "top-center")
    track.add_overlay("/path/to/logo.png", "image", 0, 30, "bottom-right")
    track.add_overlay("/path/to/chart.png", "chart", 5, 15, "center")

    spec = track.to_composite_spec()
    # → List of overlay dicts for MoviePy/FFmpeg compositing
"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Any, Optional, Union

logger = logging.getLogger("MediaIndexerPro.OverlayTrack")

# Valid overlay types
VALID_TYPES = {"text", "image", "chart", "avatar"}

# Position presets with (x, y) normalised coordinates (0..1)
POSITION_PRESETS: dict[str, tuple[float, float]] = {
    "top-left": (0.05, 0.05),
    "top-center": (0.5, 0.05),
    "top-right": (0.95, 0.05),
    "center-left": (0.05, 0.5),
    "center": (0.5, 0.5),
    "center-right": (0.95, 0.5),
    "bottom-left": (0.05, 0.95),
    "bottom-center": (0.5, 0.95),
    "bottom-right": (0.95, 0.95),
}


class OverlayTrack:
    """
    A timeline track for overlay elements (text, images, charts, avatars).
    """

    def __init__(self) -> None:
        """Initialise an empty overlay track."""
        self.elements: list[dict[str, Any]] = []

    # ── Public API ─────────────────────────────────────────────────────────

    def add_overlay(
        self,
        content: str,
        overlay_type: str = "text",
        start: float = 0.0,
        end: Optional[float] = None,
        position: Union[str, tuple[float, float]] = "center",
    ) -> Optional[str]:
        """
        Add an overlay element to the track.

        Args:
            content: Text content (for ``"text"``) or file path
                     (for ``"image"``, ``"chart"``, ``"avatar"``).
            overlay_type: Element type (``"text"``, ``"image"``,
                          ``"chart"``, ``"avatar"``).
            start: Start time on the timeline in seconds.
            end: End time in seconds. If ``None``, set to start + 10s.
            position: Position preset name (e.g. ``"top-center"``) or
                      custom ``(x, y)`` tuple in pixels.

        Returns:
            The generated element ID (UUID hex), or ``None`` if invalid.
        """
        # Validate type
        if overlay_type not in VALID_TYPES:
            logger.warning(
                f"OverlayTrack.add_overlay: unknown type '{overlay_type}', "
                f"defaulting to 'text'"
            )
            overlay_type = "text"

        # Validate content
        if not content or not content.strip():
            logger.warning("OverlayTrack.add_overlay: empty content")
            return None

        # For file-based types, validate path
        if overlay_type in ("image", "chart", "avatar"):
            if not Path(content).exists():
                logger.warning(
                    f"OverlayTrack.add_overlay: file not found: {content}"
                )
                return None

        if end is None:
            end = start + 10.0

        if end <= start:
            end = start + 2.0

        # Resolve position
        resolved_position = self._resolve_position(position)

        element_id = uuid.uuid4().hex
        element: dict[str, Any] = {
            "id": element_id,
            "type": overlay_type,
            "content": content.strip() if overlay_type == "text" else content,
            "start": start,
            "end": end,
            "position": position if isinstance(position, str) else list(position),
            "position_xy": resolved_position,
        }

        self.elements.append(element)
        logger.info(
            f"OverlayTrack.add_overlay: {element_id[:8]} "
            f"({overlay_type}, '{str(content)[:20]}') "
            f"[{start:.1f}s-{end:.1f}s] @ {position}"
        )
        return element_id

    def remove_overlay(self, element_id: str) -> bool:
        """
        Remove an overlay element by its ID.

        Args:
            element_id: UUID hex of the element to remove.

        Returns:
            ``True`` if removed, ``False`` if not found.
        """
        for i, el in enumerate(self.elements):
            if el["id"] == element_id:
                self.elements.pop(i)
                logger.info(f"OverlayTrack.remove_overlay: {element_id[:8]}")
                return True
        logger.warning(f"OverlayTrack.remove_overlay: not found: {element_id[:8]}")
        return False

    def to_composite_spec(self) -> list[dict[str, Any]]:
        """
        Generate a compositing specification for consumption by
        :mod:`~auto_editor.moviepy_pipeline` or FFmpeg filter chains.

        Returns:
            List of overlay specs sorted by start time, each with keys:
            ``id``, ``type``, ``content``, ``start``, ``end``,
            ``position``, ``position_xy`` (normalised 0..1 coords).
        """
        sorted_els = sorted(self.elements, key=lambda e: e["start"])
        return list(sorted_els)

    def total_duration(self) -> float:
        """Get the maximum end time across all elements."""
        if not self.elements:
            return 0.0
        return max(e["end"] for e in self.elements)

    # ── Internal ──────────────────────────────────────────────────────────

    @staticmethod
    def _resolve_position(
        position: Union[str, tuple[float, float]],
    ) -> tuple[float, float]:
        """
        Resolve a position preset or custom coordinate to normalised (x, y).

        Args:
            position: Preset name or ``(x, y)`` tuple in pixels or
                      normalised (0..1) coordinates.

        Returns:
            ``(x, y)`` normalised coordinates (0..1).
        """
        if isinstance(position, str):
            preset = POSITION_PRESETS.get(position.lower())
            if preset:
                return preset
            logger.warning(
                f"OverlayTrack: unknown position preset '{position}', "
                f"defaulting to center"
            )
            return (0.5, 0.5)

        # Custom (x, y) — assume normalised if ≤ 1, else assume pixels
        x, y = float(position[0]), float(position[1])
        if x > 1.0 or y > 1.0:
            # Probably pixel coordinates — normalise to ~1920x1080
            x = x / 1920.0
            y = y / 1080.0
        return (min(1.0, max(0.0, x)), min(1.0, max(0.0, y)))

    def __len__(self) -> int:
        return len(self.elements)

    def __repr__(self) -> str:
        type_counts = {t: sum(1 for e in self.elements if e["type"] == t)
                       for t in VALID_TYPES}
        return (
            f"OverlayTrack({len(self.elements)} elements: "
            f"{dict((k, v) for k, v in type_counts.items() if v > 0)})"
        )
