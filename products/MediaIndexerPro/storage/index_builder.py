"""
MediaIndexerPro v4 — Index Builder (Storage Layer)

Input: serialized MediaItem dicts from the engine layer.
Output: index.json stored at assets/index/<topic>/index.json.

Unified metadata storage:
  - Platform tags (YouTube categories, Pexels tags, etc.)
  - Cloud-API captions (description, objects, emotions, scenes)
  - All mapped into a single CPU-bound JSON shadow index

Merges all source results, generates source-grouped statistics,
and saves a comprehensive JSON index to disk.
"""

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


def build_index(topic: str, items: list[dict], config: Optional[dict] = None) -> dict:
    """
    Build a comprehensive JSON index from all source search results.

    Merges metadata from all sources, including Cloud-API captions,
    generates source-grouped stats, and saves to disk at:
    assets/index/<sanitized_topic>/index.json

    Args:
        topic: The search topic.
        items: List of MediaItem dicts (serialized via MediaItem.to_dict()).
        config: Global configuration (for output path).

    Returns:
        Dict containing the full index data with summary stats and saved path.
    """
    if config is None:
        config = {}

    output_base = config.get("index_output_path", "assets/index/")
    project_root = Path(__file__).parent.parent
    output_dir = project_root / output_base / _sanitize_topic(topic)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Build source-grouped summary
    source_counts = Counter(item.get("source", "Unknown") for item in items)
    type_counts = Counter(item.get("type", "unknown") for item in items)

    # Collect all caption data across items
    caption_stats = {
        "items_with_captions": sum(
            1 for item in items if item.get("caption")
        ),
        "total_objects": sum(
            len(item.get("caption", {}).get("objects", []))
            for item in items if item.get("caption")
        ),
        "total_emotions": sum(
            len(item.get("caption", {}).get("emotions", []))
            for item in items if item.get("caption")
        ),
    }

    # Collect all unique tags across items
    all_tags: list[str] = []
    for item in items:
        all_tags.extend(item.get("tags", []))
        caption = item.get("caption", {})
        if caption:
            for obj in caption.get("objects", []):
                all_tags.append(f"object:{obj.lower()}")
            for emotion in caption.get("emotions", []):
                all_tags.append(f"emotion:{emotion.lower()}")
            for scene in caption.get("scenes", []):
                all_tags.append(f"scene:{scene.lower()}")
            for action in caption.get("actions", []):
                all_tags.append(f"action:{action.lower()}")

    tag_counts = Counter(all_tags).most_common(50)

    # Group items by source
    by_source: dict[str, list[dict]] = {}
    for item in items:
        src = item.get("source", "Unknown")
        by_source.setdefault(src, []).append(item)

    index_data = {
        "topic": topic,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_items": len(items),
        "summary": {
            "by_source": dict(source_counts),
            "by_type": dict(type_counts),
            "captions": caption_stats,
        },
        "top_tags": [
            {"tag": tag, "count": count}
            for tag, count in tag_counts
        ],
        "by_source": by_source,
        "items": items,
        "index_path": None,  # filled below
    }

    index_path = output_dir / "index.json"
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index_data, f, ensure_ascii=False, indent=2)

    index_data["index_path"] = str(index_path)
    print(f"[index_builder] Index saved to {index_path}")
    print(f"[index_builder] Sources: {dict(source_counts)}")
    print(f"[index_builder] Types: {dict(type_counts)}")
    print(f"[index_builder] Captions: {caption_stats}")
    return index_data


def read_index(topic: str, config: Optional[dict] = None) -> Optional[dict]:
    """
    Read an existing index.json for a given topic.

    Args:
        topic: The search topic.
        config: Global configuration (for output path).

    Returns:
        Index data dict, or None if not found.
    """
    if config is None:
        config = {}

    output_base = config.get("index_output_path", "assets/index/")
    project_root = Path(__file__).parent.parent
    index_path = project_root / output_base / _sanitize_topic(topic) / "index.json"

    if not index_path.exists():
        return None

    with open(index_path, "r", encoding="utf-8") as f:
        return json.load(f)


def _sanitize_topic(topic: str) -> str:
    """Sanitize topic string for use as a directory name."""
    sanitized = "".join(c if c.isalnum() or c in "-_" else "_" for c in topic)
    return sanitized.strip("_").lower() or "untitled"
