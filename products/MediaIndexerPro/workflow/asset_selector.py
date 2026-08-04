"""
asset_selector.py — Emotion-Driven Asset Selection

Selects media assets (video clips, images) based on emotion-driven
keywords and visual style hints.

Input:  Scene list with emotion_labels and keywords
Output: Scene list enriched with asset paths/previews

Dependencies: emotion_engine, local media index (media_index.json)
"""

from __future__ import annotations

import json
import logging
import os
import random
from pathlib import Path
from typing import Any, Optional

from workflow.emotion_engine import get_asset_keywords_for_emotion

logger = logging.getLogger("ZOO.AssetSelector")

# ─── Paths ─────────────────────────────────────────────────────────────────
MIP_ROOT = Path(__file__).resolve().parent.parent
MEDIA_INDEX_PATH = MIP_ROOT / "media_index.json"
ASSETS_DIR = MIP_ROOT / "assets"
LOCAL_ASSETS = MIP_ROOT / "local_assets"

from dataclasses import dataclass, field


@dataclass
class AssetRef:
    """Reference to a selected media asset."""
    source: str              # "local", "url", "generated", "placeholder"
    path: str                # File path or URL
    type: str                # "video", "image", "audio"
    preview: str = ""        # Thumbnail URL
    keywords: list[str] = field(default_factory=list)


def _load_media_index() -> list[dict]:
    """Load media_index.json and return file list."""
    if MEDIA_INDEX_PATH.exists():
        try:
            with open(MEDIA_INDEX_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data.get("files", [])
        except Exception as e:
            logger.warning(f"Failed to load media index: {e}")
    return []


def _scan_local_assets() -> list[Path]:
    """Scan local_assets directory for media files."""
    videos = []
    if LOCAL_ASSETS.exists():
        for ext in ("*.mp4", "*.mov", "*.avi", "*.jpg", "*.png"):
            videos.extend(LOCAL_ASSETS.rglob(ext))
    if ASSETS_DIR.exists():
        for ext in ("*.mp4", "*.mov", "*.jpg", "*.png"):
            videos.extend(ASSETS_DIR.rglob(ext))
    return videos


def _keyword_match_score(file_name: str, keywords: list[str]) -> int:
    """Score how well a filename matches given keywords."""
    name_lower = file_name.lower()
    score = 0
    for kw in keywords:
        if kw.lower() in name_lower:
            score += 1
        # Partial match
        for word in kw.lower().split():
            if word in name_lower:
                score += 0.5
    return score


def select_assets(
    scenes: list,
    max_assets_per_scene: int = 1,
) -> list:
    """Enrich each scene with matching asset references.
    
    Uses emotion label to generate keywords, then matches against
    local assets and media index. Falls back to placeholder.
    """
    local_files = _scan_local_assets()
    media_index = _load_media_index()
    
    enriched_scenes = []
    
    for scene in scenes:
        emotion = getattr(scene, 'emotion_label', '平静') if hasattr(scene, 'emotion_label') else '平静'
        keywords = get_asset_keywords_for_emotion(emotion)
        
        # Also add scene text keywords
        text = getattr(scene, 'text', '') if hasattr(scene, 'text') else ''
        text_words = [w for w in text.split() if len(w) > 2][:5]
        all_keywords = keywords + text_words
        
        assets: list[AssetRef] = []
        
        # Try local_assets first
        scored_files = []
        for f in local_files:
            score = _keyword_match_score(f.name, all_keywords)
            if score > 0:
                scored_files.append((score, f))
        
        scored_files.sort(key=lambda x: -x[0])
        
        for _, f in scored_files[:max_assets_per_scene]:
            ext = f.suffix.lower()
            asset_type = "video" if ext in (".mp4", ".mov", ".avi") else "image"
            assets.append(AssetRef(
                source="local",
                path=str(f),
                type=asset_type,
                keywords=all_keywords,
            ))
        
        # If no local match, try media index
        if not assets:
            for item in media_index:
                score = _keyword_match_score(item.get("name", ""), all_keywords)
                if score > 0:
                    assets.append(AssetRef(
                        source="media_index",
                        path=item.get("absolute_path", item.get("path", "")),
                        type=item.get("type", "image"),
                    ))
                    break
        
        # Absolute fallback: placeholder
        if not assets:
            assets.append(AssetRef(
                source="placeholder",
                path="",
                type="image",
                preview="",
            ))
        
        # Attach to scene
        if hasattr(scene, 'asset_keywords'):
            scene.asset_keywords = all_keywords
        
        enriched_scenes.append({
            "scene_id": getattr(scene, 'id', 0) if hasattr(scene, 'id') else 0,
            "emotion": emotion,
            "duration": getattr(scene, 'duration', 10) if hasattr(scene, 'duration') else 10,
            "assets": [{"source": a.source, "path": a.path, "type": a.type} for a in assets],
            "prompt": getattr(scene, 'prompt', '') if hasattr(scene, 'prompt') else '',
        })
    
    logger.info(f"select_assets: enriched {len(enriched_scenes)} scenes " +
                f"(local matches: {sum(1 for s in enriched_scenes for a in s['assets'] if a['source']=='local')})")
    
    return enriched_scenes
