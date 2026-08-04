"""
emotion_engine.py — Emotion Analysis for Scripts

Analyzes a script and produces:
  - Emotion segments: which parts convey which emotion
  - Emotion curve: intensity over time
  - Style hints per segment

Input:  script (str)
Output: EmotionAnalysis (dataclass)

Dependencies: none beyond stdlib (heuristic mode)
Optional: sentence-transformers for semantic scoring
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("ZOO.EmotionEngine")

# ─── Emotion Lexicon ───────────────────────────────────────────────────────
# Chinese emotion keywords mapped to categories with intensity weights

EMOTION_LEXICON: dict[str, list[tuple[str, float]]] = {
    "孤独": [("孤单", 0.8), ("一个人", 0.7), ("寂寞", 0.9), ("独自", 0.6),
            ("alone", 0.7), ("lonely", 0.9), ("solitary", 0.7)],
    "悲伤": [("悲伤", 0.9), ("难过", 0.8), ("哭泣", 0.8), ("失去", 0.7),
            ("sad", 0.8), ("grief", 0.9), ("heartbroken", 0.9)],
    "希望": [("希望", 0.9), ("期待", 0.7), ("未来", 0.6), ("光明", 0.8),
            ("hope", 0.9), ("future", 0.7), ("dream", 0.7)],
    "释怀": [("释怀", 0.9), ("放下", 0.7), ("接受", 0.6), ("平静", 0.5),
            ("let go", 0.8), ("accept", 0.6), ("peace", 0.7)],
    "温暖": [("温暖", 0.9), ("拥抱", 0.8), ("陪伴", 0.8), ("温柔", 0.7),
            ("warm", 0.8), ("hug", 0.8), ("comfort", 0.8)],
    "焦虑": [("焦虑", 0.9), ("担心", 0.7), ("不安", 0.8), ("紧张", 0.7),
            ("anxiety", 0.9), ("worry", 0.7), ("nervous", 0.7)],
    "平静": [("平静", 0.9), ("宁静", 0.8), ("安详", 0.8), ("沉默", 0.5),
            ("calm", 0.8), ("peaceful", 0.8), ("quiet", 0.6)],
    "迷茫": [("迷茫", 0.9), ("困惑", 0.7), ("找不到", 0.6), ("不知道", 0.5),
            ("lost", 0.8), ("confused", 0.7), ("uncertain", 0.7)],
}

# Emotion → visual style mapping
EMOTION_STYLE: dict[str, dict] = {
    "孤独": {"tone": "cold", "pace": "slow", "camera": "wide", "light": "dim"},
    "悲伤": {"tone": "cold", "pace": "slow", "camera": "close", "light": "dark"},
    "希望": {"tone": "warm", "pace": "medium", "camera": "wide_up", "light": "bright"},
    "释怀": {"tone": "neutral", "pace": "slow", "camera": "wide", "light": "golden"},
    "温暖": {"tone": "warm", "pace": "medium", "camera": "medium", "light": "soft"},
    "焦虑": {"tone": "cold", "pace": "fast", "camera": "close", "light": "harsh"},
    "平静": {"tone": "neutral", "pace": "slow", "camera": "wide", "light": "natural"},
    "迷茫": {"tone": "cool", "pace": "slow", "camera": "dutch", "light": "foggy"},
}

# Keywords for asset matching per emotion
EMOTION_ASSET_KEYWORDS: dict[str, list[str]] = {
    "孤独": ["empty room", "night", "lonely", "alone", "shadow", "silhouette"],
    "悲伤": ["rain", "tears", "sad", "gloomy", "melancholy", "grey"],
    "希望": ["sunrise", "light", "hope", "growing", "spring", "flower"],
    "释怀": ["ocean", "sunset", "release", "fly", "open", "horizon"],
    "温暖": ["warm light", "cozy", "hug", "fireplace", "soft", "together"],
    "焦虑": ["city", "crowd", "fast", "chaotic", "clock", "traffic"],
    "平静": ["lake", "forest", "calm water", "zen", "garden", "meditation"],
    "迷茫": ["fog", "crossroad", "blur", "reflection", "mist", "abstract"],
}


@dataclass
class EmotionPhase:
    """A contiguous segment of script with a dominant emotion."""
    start_idx: int          # Character index in script
    end_idx: int            # Character index in script
    label: str              # Emotion label (Chinese)
    intensity: float        # 0.0 - 1.0
    keywords: list[str] = field(default_factory=list)
    text: str = ""


@dataclass
class EmotionAnalysis:
    """Full emotion analysis result."""
    curve: list[EmotionPhase] = field(default_factory=list)
    dominant_emotion: str = "平静"
    summary: str = ""


def _score_text(text: str) -> list[tuple[str, float]]:
    """Score a text segment against all emotion categories.
    
    Returns list of (emotion_label, score) sorted descending.
    """
    text_lower = text.lower()
    scores: dict[str, float] = {}
    
    for emotion, keywords in EMOTION_LEXICON.items():
        total = 0.0
        for keyword, weight in keywords:
            count = text_lower.count(keyword.lower())
            if count > 0:
                total += weight * (1 + 0.3 * (count - 1))
        if total > 0:
            scores[emotion] = total
    
    if not scores:
        return [("平静", 0.3)]
    
    return sorted(scores.items(), key=lambda x: -x[1])


def analyze_script(script: str, max_phases: int = 6) -> EmotionAnalysis:
    """Analyze a script and return emotion curve.
    
    Splits the script into segments (by paragraphs or sentences),
    scores each segment for emotion, and returns structured result.
    """
    if not script or not script.strip():
        return EmotionAnalysis(curve=[], dominant_emotion="平静", summary="Empty script")
    
    # Split by paragraphs first, then by sentences for long paragraphs
    paragraphs = [p.strip() for p in script.replace("\r\n", "\n").split("\n") if p.strip()]
    
    if len(paragraphs) < 2:
        # Try sentence splitting
        sentences = re.split(r"(?<=[。！？；：.!?;])\s*", script)
        sentences = [s.strip() for s in sentences if len(s.strip()) > 5]
        segments = sentences if len(sentences) > 1 else [script]
    else:
        segments = paragraphs
    
    # Limit number of phases
    segments = segments[:max_phases]
    
    phases: list[EmotionPhase] = []
    char_idx = 0
    
    for seg in segments:
        scores = _score_text(seg)
        label = scores[0][0] if scores else "平静"
        intensity = min(1.0, scores[0][1]) if scores else 0.3
        
        end_idx = char_idx + len(seg)
        keywords = [kw for kw, _ in EMOTION_LEXICON.get(label, [("", 0)])[:3]]
        
        phases.append(EmotionPhase(
            start_idx=char_idx,
            end_idx=end_idx,
            label=label,
            intensity=intensity,
            keywords=keywords,
            text=seg[:80] + ("..." if len(seg) > 80 else ""),
        ))
        char_idx = end_idx + 1
    
    # Determine dominant emotion
    if phases:
        dominant = max(phases, key=lambda p: p.intensity)
        dominant_label = dominant.label
    else:
        dominant_label = "平静"
    
    summary_parts = [f"{p.label}({p.intensity:.1f})" for p in phases]
    summary = " → ".join(summary_parts)
    
    return EmotionAnalysis(
        curve=phases,
        dominant_emotion=dominant_label,
        summary=summary,
    )


def get_style_for_emotion(emotion_label: str) -> dict:
    """Return visual style parameters for an emotion label."""
    return EMOTION_STYLE.get(emotion_label, EMOTION_STYLE["平静"])


def get_asset_keywords_for_emotion(emotion_label: str) -> list[str]:
    """Return search keywords for asset matching given an emotion."""
    return EMOTION_ASSET_KEYWORDS.get(emotion_label, ["neutral", "background"])
