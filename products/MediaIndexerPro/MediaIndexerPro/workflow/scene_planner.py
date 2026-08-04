"""
scene_planner.py — Emotion-Driven Scene Planning

Takes a script + EmotionAnalysis and produces a list of Scene objects.
Each scene is bound to an emotion phase with visual style hints.

Input:  script (str), emotion_analysis (EmotionAnalysis)
Output: list[Scene]

Dependencies: emotion_engine
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Optional

from workflow.emotion_engine import (
    EmotionAnalysis,
    get_style_for_emotion,
    EMOTION_STYLE,
)

logger = logging.getLogger("ZOO.ScenePlanner")

# ─── Constants ─────────────────────────────────────────────────────────────

DEFAULT_RATIO = "1:1"
FALLBACK_DURATION = 10  # seconds
MIN_SCENES = 2
MAX_SCENES = 8


@dataclass
class Scene:
    """A single planned scene with emotion-driven metadata."""
    id: int
    text: str                  # Original text for this scene
    prompt: str                # Visual description for generation/selection
    emotion_label: str         # Dominant emotion
    intensity: float           # 0.0 - 1.0
    style_hint: str            # "warm" / "cold" / "neutral" / "cool"
    pace_hint: str             # "slow" / "medium" / "fast"
    camera_hint: str           # "wide" / "medium" / "close" / "wide_up" / "dutch"
    light_hint: str            # "bright" / "dim" / "dark" / "golden" / "natural"
    duration: float            # seconds
    ratio: str = DEFAULT_RATIO
    asset_keywords: list[str] = field(default_factory=list)


def _segment_script(script: str, max_segments: int = MAX_SCENES) -> list[str]:
    """Split script into segments by paragraphs or sentences."""
    paragraphs = [p.strip() for p in script.replace("\r\n", "\n").split("\n") if p.strip()]
    if len(paragraphs) >= MIN_SCENES:
        return paragraphs[:max_segments]
    sentences = re.split(r"(?<=[。！？；：.!?;])\s*", script)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 5]
    if len(sentences) >= MIN_SCENES:
        return sentences[:max_segments]
    return [script]


def _text_to_prompt(text: str, style: dict, emotion: str) -> str:
    """Convert text segment + style into a visual generation prompt."""
    tone_map = {
        "warm": "warm tones, soft lighting, cozy atmosphere",
        "cold": "cool tones, blue/grey palette, distant feeling",
        "neutral": "natural lighting, balanced composition",
        "cool": "muted colors, foggy atmosphere, ethereal",
    }
    pace_map = {
        "slow": "slow, contemplative, long take",
        "medium": "balanced motion, natural pace",
        "fast": "dynamic, quick cuts, energetic",
    }
    tone_desc = tone_map.get(style.get("tone", "neutral"), "natural")
    pace_desc = pace_map.get(style.get("pace", "medium"), "natural")
    return f"{tone_desc}, {pace_desc}, {emotion} mood: {text[:120]}"


def plan_scenes(
    script: str,
    emotion: EmotionAnalysis,
    ratio: str = DEFAULT_RATIO,
) -> list[Scene]:
    """Plan scenes from script + emotion analysis.
    
    Each segment of the script gets bound to the overlapping emotion phase.
    If emotion analysis is empty, uses heuristic fallback.
    """
    if not script or not script.strip():
        logger.warning("plan_scenes: empty script")
        return []

    segments = _segment_script(script)
    phases = emotion.curve if emotion.curve else []

    scenes: list[Scene] = []

    for i, seg in enumerate(segments):
        # Find matching emotion phase
        if phases and i < len(phases):
            phase = phases[i]
        elif phases:
            # Use last phase
            phase = phases[-1]
        else:
            # No emotion data — use neutral
            phase = type('obj', (object,), {
                'label': '平静', 'intensity': 0.5, 'keywords': []
            })()

        style = get_style_for_emotion(phase.label)
        duration = max(5, min(20, len(seg) // 6))

        prompt = _text_to_prompt(seg, style, phase.label)

        scenes.append(Scene(
            id=i + 1,
            text=seg[:100],
            prompt=prompt,
            emotion_label=phase.label,
            intensity=phase.intensity,
            style_hint=style.get("tone", "neutral"),
            pace_hint=style.get("pace", "medium"),
            camera_hint=style.get("camera", "medium"),
            light_hint=style.get("light", "natural"),
            duration=duration,
            ratio=ratio,
            asset_keywords=[],  # Filled by asset_selector
        ))

    logger.info(f"plan_scenes: {len(scenes)} scenes planned from " +
                f"emotion: {emotion.summary if emotion.curve else 'no emotion data'}")

    return scenes
