"""
MediaIndexerPro — Domain Layer: Business Models

Defines the core domain types used throughout the system.
All source adapters must return List[MediaItem].

Supports unified metadata mapping from:
- Human-made platform tags (YouTube, Pexels, Pixabay, etc.)
- Cloud-API vision captions (description, objects, emotions, scenes)
- User-defined custom tags

All storage is CPU-bound JSON + optional ChromaDB shadow index.
No GPU or local ML models are required.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional


class SourceType(str, Enum):
    """Media source type enumeration."""
    VIDEO = "video"
    IMAGE = "image"
    PAGE = "page"


@dataclass
class CloudCaption:
    """
    Cloud-API generated caption data.

    Produced by the auto_understanding module's CloudAnalyzer.
    Mapped seamlessly into the unified index alongside platform tags.

    Attributes:
        description: Natural language description of the content.
        objects: List of detected objects (e.g., ["person", "car", "tree"]).
        emotions: List of detected emotional tones (e.g., ["joy", "calm"]).
        scenes: List of scene classifications (e.g., ["outdoor", "beach"]).
        actions: List of detected actions (video only).
        colors: List of dominant hex color codes (image only).
    """
    description: str = ""
    objects: list[str] = field(default_factory=list)
    emotions: list[str] = field(default_factory=list)
    scenes: list[str] = field(default_factory=list)
    actions: list[str] = field(default_factory=list)
    colors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        """Serialize to a plain dict for JSON output."""
        return {
            "description": self.description,
            "objects": self.objects,
            "emotions": self.emotions,
            "scenes": self.scenes,
            "actions": self.actions,
            "colors": self.colors,
        }

    @classmethod
    def from_dict(cls, data: Optional[dict]) -> CloudCaption:
        """Deserialize from a plain dict."""
        if not data:
            return cls()
        return cls(
            description=data.get("description", ""),
            objects=data.get("objects", []),
            emotions=data.get("emotions", []),
            scenes=data.get("scenes", []),
            actions=data.get("actions", []),
            colors=data.get("colors", []),
        )


@dataclass
class MediaItem:
    """
    Unified media metadata item — the core domain model.

    All source adapters MUST return List[MediaItem].
    No media files are ever downloaded — only metadata is recorded.

    The ``caption`` field stores Cloud-API vision analysis results,
    mapped seamlessly alongside the source-provided tags.

    Attributes:
        title: Media title / caption.
        thumbnail: URL to the thumbnail/preview image.
        url: Direct link to the original media or source page.
        source: Human-readable source name (e.g. "YouTube", "Pexels").
        type: Media type — VIDEO, IMAGE, or PAGE.
        duration: Optional duration string (e.g. "12:34") for video items.
        keywords: Optional list of matched search keywords.
        caption: Optional Cloud-API caption with vision analysis data.
        tags: Optional list of user-defined or platform tags.
    """
    title: str
    thumbnail: str
    url: str
    source: str
    type: SourceType
    duration: Optional[str] = None
    keywords: list[str] = field(default_factory=list)
    caption: Optional[CloudCaption] = None
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        """Serialize to a plain dict for JSON output."""
        result = {
            "title": self.title,
            "thumbnail": self.thumbnail,
            "url": self.url,
            "source": self.source,
            "type": self.type.value,
            "duration": self.duration,
            "keywords": self.keywords,
            "tags": self.tags,
        }
        if self.caption:
            result["caption"] = self.caption.to_dict()
        return result

    @classmethod
    def from_dict(cls, data: dict) -> MediaItem:
        """Deserialize from a plain dict."""
        return cls(
            title=data.get("title", ""),
            thumbnail=data.get("thumbnail", ""),
            url=data.get("url", ""),
            source=data.get("source", "Unknown"),
            type=SourceType(data.get("type", "image")),
            duration=data.get("duration"),
            keywords=data.get("keywords", []),
            caption=CloudCaption.from_dict(data.get("caption")),
            tags=data.get("tags", []),
        )
