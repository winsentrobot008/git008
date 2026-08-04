"""
MediaIndexerPro v3 — Timeline Editor UI (P6)

Core orchestrator that combines all four tracks (video, audio, subtitle,
overlay) into a unified ``Timeline`` data structure.

Provides:
  - ``from_auto_pipeline()`` — Import results from P3/P4/P5 into a timeline
  - ``to_render_spec()`` — Export rendering config for :mod:`~auto_editor`

This is the bridge between the AI generation pipeline and the
manual/visual editing layer (``timeline.html``).

Usage:
    from timeline_editor.editor_ui import Timeline

    # Create from auto pipeline results
    timeline = Timeline.from_auto_pipeline(
        scene_results=[...],    # from P4 generate_clips()
        voice_result={...},     # from P3 generate_voice_and_subtitles()
    )

    # Export for rendering
    render_spec = timeline.to_render_spec()
    # → {"clips": [...], "audio": [...], "subtitles": "...", "overlays": [...]}
"""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any, Optional

from timeline_editor.track_video import VideoTrack
from timeline_editor.track_audio import AudioTrack
from timeline_editor.track_subtitle import SubtitleTrack
from timeline_editor.track_overlay import OverlayTrack

logger = logging.getLogger("MediaIndexerPro.Timeline")


class Timeline:
    """
    Unified timeline data structure combining all four track types.

    This is the central data model for the in-track editor (``timeline.html``)
    and the bridge between AI auto-generation and manual editing.
    """

    def __init__(self) -> None:
        """Initialise an empty timeline with all four tracks."""
        self.video_track = VideoTrack()
        self.audio_track = AudioTrack()
        self.subtitle_track = SubtitleTrack()
        self.overlay_track = OverlayTrack()

        # Metadata
        self.timeline_id: str = uuid.uuid4().hex
        self.name: str = "Untitled Timeline"
        self.created_at: str = ""  # ISO timestamp, set by caller

    # ── Factory: from_auto_pipeline ────────────────────────────────────────

    @classmethod
    def from_auto_pipeline(
        cls,
        scene_results: list[dict[str, Any]],
        voice_result: dict[str, Any],
        name: str = "AI Generated Video",
    ) -> "Timeline":
        """
        Create a ``Timeline`` from auto pipeline results.

        This is the primary integration point between the AI generation
        pipeline (P3: voice, P4: video clips, P5: assembly) and the
        in-track editor.

        Args:
            scene_results: List of scene dicts from
                :func:`~workflow.video_generator.generate_clips`.
                Successful scenes have ``"path"`` (str) and ``"scene_id"``.
            voice_result: Dict from
                :func:`~workflow.voice_generator.generate_voice_and_subtitles`.
                Expected keys: ``"audio"``, ``"subtitles"``, ``"duration"``.
            name: Optional timeline name.

        Returns:
            A populated ``Timeline`` instance ready for editing or rendering.
        """
        import datetime

        timeline = cls()
        timeline.name = name
        timeline.created_at = datetime.datetime.now().isoformat()

        # ── Populate video track ─────────────────────────────────────────
        for scene in scene_results:
            scene_path = scene.get("path")
            if scene_path:
                clip_id = timeline.video_track.add_clip(scene_path)
                if clip_id:
                    logger.debug(
                        f"Timeline.from_auto_pipeline: added video "
                        f"scene {scene.get('scene_id', '?')}: {clip_id[:8]}"
                    )

        # ── Populate audio track ─────────────────────────────────────────
        audio_path = voice_result.get("audio") if isinstance(voice_result, dict) else None
        if audio_path and Path(audio_path).exists():
            # Add voiceover spanning the entire video duration
            video_duration = timeline.video_track.total_duration()
            timeline.audio_track.add_segment(
                path=audio_path,
                start=0.0,
                end=video_duration if video_duration > 0 else None,
                segment_type="voice",
            )
            logger.info(
                f"Timeline.from_auto_pipeline: added voiceover: "
                f"{Path(audio_path).name}"
            )

        # ── Populate subtitle track ──────────────────────────────────────
        subtitle_path = voice_result.get("subtitles") if isinstance(voice_result, dict) else None
        if subtitle_path and Path(subtitle_path).exists():
            try:
                count = timeline.subtitle_track.load_srt(subtitle_path)
                logger.info(
                    f"Timeline.from_auto_pipeline: loaded {count} subtitles"
                )
            except FileNotFoundError as e:
                logger.warning(f"Timeline.from_auto_pipeline: subtitle load failed: {e}")

        logger.info(
            f"Timeline.from_auto_pipeline: created '{name}' "
            f"({len(timeline.video_track)} clips, "
            f"{len(timeline.audio_track)} audio, "
            f"{len(timeline.subtitle_track)} subtitles)"
        )

        return timeline

    # ── Export: to_render_spec ────────────────────────────────────────────

    def to_render_spec(self) -> dict[str, Any]:
        """
        Convert the timeline into a rendering specification for
        :mod:`~auto_editor.ffmpeg_pipeline` and
        :mod:`~auto_editor.moviepy_pipeline`.

        Returns:
            A dict with keys::

                {
                    "timeline_id": str,
                    "name": str,
                    "clips": [{"id", "path", "start", "end"}, ...],
                    "audio": [{"id", "path", "start", "end", "type"}, ...],
                    "ducking": [{"start", "end", "voice_gain", "bgm_gain"}, ...],
                    "subtitles": str | None,  # Path to exported SRT
                    "overlays": [{"id", "type", "content", "start", "end",
                                  "position", "position_xy"}, ...],
                    "duration": float,
                }
        """
        # Generate subtitle SRT from track
        subtitle_path: Optional[str] = None
        if self.subtitle_track.subtitles:
            export_dir = Path("local_assets/voice")
            export_dir.mkdir(parents=True, exist_ok=True)
            srt_name = f"timeline_sub_{self.timeline_id[:8]}.srt"
            subtitle_path = self.subtitle_track.export_srt(
                str(export_dir / srt_name)
            )

        # Determine total duration
        duration = max(
            self.video_track.total_duration(),
            self.audio_track.total_duration(),
            self.overlay_track.total_duration(),
        )

        spec: dict[str, Any] = {
            "timeline_id": self.timeline_id,
            "name": self.name,
            "clips": self.video_track.to_timeline(),
            "audio": self.audio_track.to_timeline(),
            "ducking": self.audio_track.duck_voice_over(),
            "subtitles": subtitle_path,
            "overlays": self.overlay_track.to_composite_spec(),
            "duration": duration,
        }

        logger.info(
            f"Timeline.to_render_spec: "
            f"{len(spec['clips'])} clips, "
            f"{len(spec['audio'])} audio segments, "
            f"{'subs' if spec['subtitles'] else 'no subs'}, "
            f"{len(spec['overlays'])} overlays, "
            f"{duration:.1f}s total"
        )

        return spec

    # ── Serialisation ─────────────────────────────────────────────────────

    def to_dict(self) -> dict[str, Any]:
        """Serialize the entire timeline to a plain dict."""
        return {
            "timeline_id": self.timeline_id,
            "name": self.name,
            "created_at": self.created_at,
            "video": self.video_track.to_timeline(),
            "audio": self.audio_track.to_timeline(),
            "subtitles": self.subtitle_track.to_timeline(),
            "overlays": self.overlay_track.to_composite_spec(),
            "duration": max(
                self.video_track.total_duration(),
                self.audio_track.total_duration(),
                self.overlay_track.total_duration(),
            ),
        }

    def to_json(self, indent: int = 2) -> str:
        """Serialize the timeline to a JSON string."""
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Timeline":
        """Deserialize a timeline from a dict (previously exported with ``to_dict``)."""
        timeline = cls()
        timeline.timeline_id = data.get("timeline_id", timeline.timeline_id)
        timeline.name = data.get("name", "Restored Timeline")

        # Restore video track
        for clip in data.get("video", []):
            timeline.video_track.clips.append(clip)

        # Restore audio track
        for seg in data.get("audio", []):
            timeline.audio_track.segments.append(seg)

        # Restore subtitle track
        for sub in data.get("subtitles", []):
            timeline.subtitle_track.subtitles.append(sub)

        # Restore overlay track
        for el in data.get("overlays", []):
            timeline.overlay_track.elements.append(el)

        return timeline

    # ── Convenience ───────────────────────────────────────────────────────

    def total_duration(self) -> float:
        """Get the total duration of the timeline across all tracks."""
        return max(
            self.video_track.total_duration(),
            self.audio_track.total_duration(),
            self.overlay_track.total_duration(),
        )

    def is_empty(self) -> bool:
        """Check if the timeline has any content."""
        return (
            len(self.video_track) == 0
            and len(self.audio_track) == 0
            and len(self.subtitle_track) == 0
            and len(self.overlay_track) == 0
        )

    def __repr__(self) -> str:
        return (
            f"Timeline('{self.name[:30]}' | "
            f"{len(self.video_track)}v/{len(self.audio_track)}a/"
            f"{len(self.subtitle_track)}s/{len(self.overlay_track)}o | "
            f"{self.total_duration():.1f}s)"
        )
