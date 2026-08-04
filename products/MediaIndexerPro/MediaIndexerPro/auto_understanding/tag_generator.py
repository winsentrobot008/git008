"""
MediaIndexerPro v3 — Tag Generator (P2)

Generates structured tags from video/image analysis results.

Tags follow the format: ``category:value``
Category priority order: emotion > scene > object > action

Usage:
    from auto_understanding.tag_generator import generate_tags

    tags = generate_tags({
        "description": "A person walking on a sunny beach",
        "objects": ["person", "beach", "ocean", "sun"],
        "actions": ["walking", "smiling"],
        "emotions": ["joy", "calm"],
        "scenes": ["outdoor", "beach", "daytime"],
        "duration": 12.5,
    })
    # → ["emotion:joy", "emotion:calm", "scene:outdoor", "scene:beach",
    #     "scene:daytime", "object:person", "object:beach", "object:ocean",
    #     "object:sun", "action:walking", "action:smiling"]
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("MediaIndexerPro.TagGenerator")

# ─── Tag category priority (lower number = higher priority) ──────────────────

TAG_PRIORITY: dict[str, int] = {
    "emotion": 0,
    "scene": 1,
    "object": 2,
    "action": 3,
}

# ─── Keyword-to-category mappings for enhanced tag generation ────────────────

EMOTION_KEYWORDS: dict[str, list[str]] = {
    "joy": ["joy", "happy", "happiness", "smile", "laugh", "delight", "excited",
            "cheerful", "content", "pleased", "glad", "elated", "euphoric"],
    "sadness": ["sad", "sadness", "cry", "crying", "tear", "grief", "sorrow",
                "melancholy", "depressed", "gloomy", "heartbroken", "lonely"],
    "anger": ["anger", "angry", "fury", "furious", "rage", "irritated",
              "frustrated", "hostile", "annoyed", "aggressive"],
    "fear": ["fear", "scared", "afraid", "terrified", "anxious", "nervous",
             "panic", "worried", "frightened", "horror"],
    "surprise": ["surprise", "surprised", "amazed", "astonished", "shocked",
                 "stunned", "unexpected"],
    "disgust": ["disgust", "disgusted", "repulsed", "gross", "unpleasant"],
    "calm": ["calm", "peaceful", "serene", "tranquil", "relaxed", "quiet",
             "meditative", "soothing", "gentle"],
    "love": ["love", "affection", "tender", "romantic", "caring", "compassion",
             "warmth", "devotion", "admiration"],
    "hope": ["hope", "hopeful", "optimistic", "inspired", "aspiring",
             "encouraging", "uplifting", "motivation"],
    "neutral": ["neutral", "pensive", "thoughtful", "contemplative", "serious"],
}

SCENE_KEYWORDS: dict[str, list[str]] = {
    "indoor": ["indoor", "inside", "room", "office", "house", "bedroom",
               "kitchen", "living_room", "bathroom", "classroom", "gym",
               "warehouse", "garage", "hallway", "basement", "attic"],
    "outdoor": ["outdoor", "outside", "nature", "park", "garden", "street",
                "city", "urban", "beach", "forest", "mountain", "desert",
                "field", "river", "lake", "ocean", "sea", "garden", "farm",
                "countryside", "wilderness", "jungle", "snow", "rain"],
    "daytime": ["day", "daytime", "sunny", "sunlight", "morning", "afternoon",
                "noon", "bright", "clear", "sunrise"],
    "nighttime": ["night", "nighttime", "dark", "moon", "evening", "dusk",
                  "twilight", "midnight", "starry"],
    "studio": ["studio", "stage", "set", "green screen", "backdrop",
               "photography", "recording"],
    "sports": ["sports", "stadium", "arena", "field", "court", "track",
               "match", "game", "competition", "athlete", "training"],
    "underwater": ["underwater", "ocean", "sea", "reef", "diving", "aquatic",
                   "marine", "submarine"],
    "aerial": ["aerial", "drone", "bird's eye", "birds eye", "skyview",
               "overhead", "from above", "helicopter", "flying"],
    "food": ["food", "restaurant", "kitchen", "dining", "meal", "cooking",
             "baking", "cuisine", "plate", "dish", "grocery"],
    "technology": ["technology", "tech", "computer", "screen", "monitor",
                   "keyboard", "robot", "ai", "digital", "futuristic",
                   "laboratory", "lab", "server", "data"],
}


def _normalize_text(text: str) -> str:
    """Lowercase and strip punctuation for comparison."""
    import re
    text = text.lower().strip()
    text = re.sub(r"[^\w\s]", " ", text)
    return text


def _match_emotion(text: str) -> list[str]:
    """Match emotional keywords in text, return standardized emotion tags."""
    text_norm = _normalize_text(text)
    matched: list[str] = []
    for emotion, keywords in EMOTION_KEYWORDS.items():
        for kw in keywords:
            if kw in text_norm:
                matched.append(emotion)
                break  # One match per emotion category
    return matched


def _match_scene(text: str) -> list[str]:
    """Match scene keywords in text, return standardized scene tags."""
    text_norm = _normalize_text(text)
    matched: list[str] = []
    for scene, keywords in SCENE_KEYWORDS.items():
        for kw in keywords:
            if kw in text_norm:
                matched.append(scene)
                break
    return matched


# ═══════════════════════════════════════════════════════════════════════════════
#  Public API
# ═══════════════════════════════════════════════════════════════════════════════

def generate_tags(analysis_json: dict[str, Any]) -> list[str]:
    """
    Generate structured tags from an analysis result.

    Args:
        analysis_json: The output from ``analyze_video()`` or ``analyze_image()``.
            Expected keys: ``description``, ``objects``, ``actions``,
            ``emotions``, ``scenes`` (video) or ``scene`` (image), ``colors``.

    Returns:
        A sorted list of tags in ``category:value`` format, e.g.::

            ["emotion:joy", "scene:outdoor", "object:person", "action:walking"]

    Tag generation strategy:
        1. **Emotions**: Directly from ``analysis_json["emotions"]``; also
           inferred from ``description`` via keyword matching.
        2. **Scenes**: From ``analysis_json["scenes"]`` (video) or
           ``analysis_json["scene"]`` (image); also inferred from description.
        3. **Objects**: From ``analysis_json["objects"]``.
        4. **Actions**: From ``analysis_json["actions"]`` (video only).
        5. **Deduplication**: Duplicate tags are removed (case-insensitive).
        6. **Sorting**: By category priority (emotion > scene > object > action),
           then alphabetically within each category.
    """
    if not isinstance(analysis_json, dict):
        logger.warning("generate_tags received non-dict input")
        return []

    if "error" in analysis_json:
        logger.warning(f"generate_tags received error result: {analysis_json['error']}")
        return []

    tags: list[str] = []
    description = analysis_json.get("description", "")

    # ── 1. Emotion tags ──────────────────────────────────────────────────
    raw_emotions: list[str] = analysis_json.get("emotions", [])
    if isinstance(raw_emotions, list):
        for emotion in raw_emotions:
            if isinstance(emotion, str) and emotion.strip():
                tags.append(f"emotion:{emotion.strip().lower()}")

    # Also infer emotions from description
    if description:
        inferred_emotions = _match_emotion(description)
        for emotion in inferred_emotions:
            tag = f"emotion:{emotion}"
            if tag not in tags:
                tags.append(tag)

    # ── 2. Scene tags ────────────────────────────────────────────────────
    raw_scenes: list[str] = analysis_json.get("scenes", [])
    if isinstance(raw_scenes, list):
        for scene in raw_scenes:
            if isinstance(scene, str) and scene.strip():
                tags.append(f"scene:{scene.strip().lower()}")

    # Image analysis uses singular "scene" key
    raw_scene_single = analysis_json.get("scene")
    if isinstance(raw_scene_single, str) and raw_scene_single.strip():
        tag = f"scene:{raw_scene_single.strip().lower()}"
        if tag not in tags:
            tags.append(tag)

    # Also infer scenes from description
    if description:
        inferred_scenes = _match_scene(description)
        for scene in inferred_scenes:
            tag = f"scene:{scene}"
            if tag not in tags:
                tags.append(tag)

    # ── 3. Object tags ───────────────────────────────────────────────────
    raw_objects: list[str] = analysis_json.get("objects", [])
    if isinstance(raw_objects, list):
        for obj in raw_objects:
            if isinstance(obj, str) and obj.strip():
                tag_value = obj.strip().lower()
                # Skip generic/placeholder values
                if tag_value not in ("object", "image", "unknown", "scene"):
                    tags.append(f"object:{tag_value}")

    # ── 4. Action tags (video only) ──────────────────────────────────────
    raw_actions: list[str] = analysis_json.get("actions", [])
    if isinstance(raw_actions, list):
        for action in raw_actions:
            if isinstance(action, str) and action.strip():
                tag_value = action.strip().lower()
                if tag_value not in ("unknown", "action"):
                    tags.append(f"action:{tag_value}")

    # ── 5. Deduplicate (case-insensitive) ────────────────────────────────
    seen: set[str] = set()
    deduped: list[str] = []
    for tag in tags:
        tag_lower = tag.lower()
        if tag_lower not in seen:
            seen.add(tag_lower)
            deduped.append(tag)

    # ── 6. Sort by priority then alphabetically ──────────────────────────
    def _sort_key(tag: str) -> tuple[int, str]:
        category = tag.split(":", 1)[0] if ":" in tag else "unknown"
        priority = TAG_PRIORITY.get(category, 99)
        return (priority, tag)

    deduped.sort(key=_sort_key)

    logger.debug(f"Generated {len(deduped)} tags from analysis")
    return deduped
