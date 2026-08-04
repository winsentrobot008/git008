"""
Prompt Builder — Flux-Optimized Psychological Mapping
======================================================
Builds a structured prompt optimized for Flux (FLUX.1-dev) image generation.
Uses an 8-section architecture designed to help Flux better understand
the psychological mapping behind the symbolic soulmate portrait.

Sections:
  1. Psychological Core  (attachment_style → emotion + expression)
  2. Aesthetic Style     (aesthetic_preference → visual style)
  3. Lighting            (emotional_needs → cinematic light direction)
  4. Facial Features     (gene_aesthetic → symbolic facial cues)
  5. Scene               (life_goals → background environment)
  6. Spiritual Element   (spiritual_preference → Earth/Fire/Water/Air)
  7. Color Palette       (derived from aesthetic + spiritual)
  8. Ethical Statement   (symbolic-only disclaimer)
"""

import logging
import time
import uuid
import os

logger = logging.getLogger(__name__)

# Debug log file path
_DEBUG_LOG_PATH = os.path.join(os.path.dirname(__file__), "..", "logs", "image_pipeline_debug.log")


def _write_debug_log(msg: str):
    """Write a timestamped debug message to the debug log file."""
    try:
        log_dir = os.path.dirname(_DEBUG_LOG_PATH)
        os.makedirs(log_dir, exist_ok=True)
        with open(_DEBUG_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {msg}\n")
    except Exception:
        pass

# ---------------------------------------------------------------------------
# Section 1 — Psychological Core: attachment → expression, pose, aura
# ---------------------------------------------------------------------------

_ATTACHMENT_MAP = {
    "安全": {
        "expression": "gentle eyes, soft natural smile, calm emotionally balanced expression",
        "pose": "relaxed open posture, head slightly tilted in warm confidence",
        "aura": "stable, grounded, trustworthy presence",
        "core_emotion": "security and warmth",
    },
    "焦虑": {
        "expression": "soft but searching gaze, slightly furrowed brow, emotionally expressive",
        "pose": "leaning forward subtly, eager yet tender posture",
        "aura": "intense emotional depth, vulnerable yet passionate",
        "core_emotion": "yearning and emotional depth",
    },
    "回避": {
        "expression": "reserved and tranquil, subtle smile, eyes with guarded warmth",
        "pose": "slightly turned, arms loosely at sides, introspective stance",
        "aura": "mysterious, self-contained, quietly observant",
        "core_emotion": "guarded tenderness",
    },
    "恐惧": {
        "expression": "cautious yet hopeful eyes, tentative soft smile",
        "pose": "protective posture, hands gently clasped",
        "aura": "fragile strength, yearning for safety",
        "core_emotion": "cautious hope",
    },
}

_DEFAULT_PSYCH = {
    "expression": "serene and thoughtful expression, emotionally open",
    "pose": "natural grounded posture",
    "aura": "balanced harmonious presence",
    "core_emotion": "emotional balance",
}

# ---------------------------------------------------------------------------
# Section 2 — Aesthetic Style
# ---------------------------------------------------------------------------

_AESTHETIC_MAP = {
    "北欧": {
        "style": "Scandinavian minimalism, clean lines, natural textures",
        "clothing": "simple elegant cashmere or linen, neutral earth tones",
        "vibe": "cool serene minimalism",
    },
    "日系": {
        "style": "Japanese wabi-sabi aesthetic, gentle imperfection, natural grace",
        "clothing": "soft flowing fabrics, kimono-inspired silhouettes",
        "vibe": "gentle poetic naturalism",
    },
    "美式": {
        "style": "American naturalism, confident relaxed elegance",
        "clothing": "classic well-tailored casual, leather and cotton textures",
        "vibe": "warm confident naturalism",
    },
    "法式": {
        "style": "French effortless chic, timeless elegance with soft edge",
        "clothing": "flowing silk, tailored nonchalance",
        "vibe": "romantic nonchalant elegance",
    },
    "复古": {
        "style": "classic vintage portraiture, timeless romantic aesthetic",
        "clothing": "vintage fabrics, lace or wool textures, heirloom quality",
        "vibe": "nostalgic timeless romance",
    },
    "自然": {
        "style": "organic naturalism, raw beauty, harmonious with nature",
        "clothing": "natural fibers, linen and cotton, botanical tones",
        "vibe": "earthy organic harmony",
    },
}

_DEFAULT_AESTHETIC = {
    "style": "contemporary portraiture with timeless elegance",
    "clothing": "classic refined clothing in complementary tones",
    "vibe": "timeless balanced elegance",
}

# ---------------------------------------------------------------------------
# Section 3 — Lighting (derived from emotional needs)
# ---------------------------------------------------------------------------

_EMOTIONAL_LIGHT_MAP = {
    "温暖": "warm golden hour light, soft amber glow",
    "信任": "clear direct soft light with gentle shadows, honest illumination",
    "优雅": "soft diffused light with subtle rim lighting, sophisticated",
    "激情": "dramatic chiaroscuro lighting, warm passionate highlights",
    "安宁": "soft silvery moonlight or gentle overcast, peaceful diffusion",
    "安全感": "wrap-around soft lighting, no harsh shadows, enveloping warmth",
    "自由": "open natural light, sunlit with airy feel, expansive brightness",
    "理解": "warm mid-tones, empathetic lighting with soft transitions",
    "浪漫": "golden sunset palette, soft flares, dreamy bokeh effect",
    "陪伴": "warm indoor amber light, cozy intimate atmosphere",
}

# ---------------------------------------------------------------------------
# Section 4 — Facial Features (symbolic, from gene_aesthetic)
# ---------------------------------------------------------------------------

_GENE_FACIAL_MAP = {
    "精致": "refined delicate features, high cheekbones, graceful jawline",
    "大气": "strong confident features, balanced proportions, dignified presence",
    "柔和": "soft gentle features, rounded contours, warm kind eyes",
    "立体": "sculpted angular features, defined bone structure, prominent brow",
    "清秀": "elegant understated features, delicate nose, gentle mouth",
}

# ---------------------------------------------------------------------------
# Section 5 — Scene (from life_goals)
# ---------------------------------------------------------------------------

_GOAL_SCENE_MAP = {
    "家庭": "warm nurturing background, cozy indoor atmosphere with soft hearth light",
    "事业": "sunlit open space with horizon visible, sense of direction and purpose",
    "自由": "open sky, wide natural landscape, wind-swept expansive setting",
    "成长": "blossoming garden or spring landscape, metaphor for growth and renewal",
    "爱": "romantic twilight setting, gentle evening ambiance",
}

# ---------------------------------------------------------------------------
# Section 6 — Spiritual Element
# ---------------------------------------------------------------------------

_SPIRITUAL_MAP = {
    "水": {
        "element": "Water",
        "symbols": "flowing water motifs, ocean wave textures, fluid organic shapes",
        "accent_colors": ["deep blue", "teal", "silver-white"],
    },
    "火": {
        "element": "Fire",
        "symbols": "subtle flame accents, warm light flares, passionate gradients",
        "accent_colors": ["amber", "crimson", "gold"],
    },
    "土": {
        "element": "Earth",
        "symbols": "earth textures, mountain silhouettes, root-like patterns",
        "accent_colors": ["terracotta", "forest green", "brown"],
    },
    "风": {
        "element": "Wind",
        "symbols": "flowing wind lines, feather-light textures, open sky gradients",
        "accent_colors": ["sky blue", "white", "soft gray"],
    },
}

# ---------------------------------------------------------------------------
# Section 8 — Ethical Statement
# ---------------------------------------------------------------------------

_ETHICAL_MARKER = (
    "symbolic artistic portrait only, not a real person, "
    "not a prediction, do not replicate any real individual"
)


def build_prompt(questionnaire: dict) -> dict:
    """
    Build an 8-section Flux-optimized prompt from questionnaire data.

    Args:
        questionnaire: dict with keys:
            - attachment_style (str)
            - emotional_needs (list[str])
            - aesthetic_preference (str)
            - spiritual_preference (str)
            - life_goals (list[str])
            - gene_aesthetic (str, optional)

    Returns:
        dict with: prompt_text (8-section structured), mapping_log, sections
    """
    mapping_log = []
    sections = {}

    # ------------------------------------------------------------------
    # Section 1: Psychological Core
    # ------------------------------------------------------------------
    attachment = questionnaire.get("attachment_style", "")
    psych = _ATTACHMENT_MAP.get(attachment, _DEFAULT_PSYCH)
    sections["psychological_core"] = psych
    mapping_log.append(
        f"[Section 1] attachment='{attachment}' → "
        f"core_emotion='{psych['core_emotion']}', "
        f"expression='{psych['expression']}'"
    )

    # ------------------------------------------------------------------
    # Section 2: Aesthetic Style
    # ------------------------------------------------------------------
    aesthetic_key = questionnaire.get("aesthetic_preference", "")
    aesthetic = _AESTHETIC_MAP.get(aesthetic_key, _DEFAULT_AESTHETIC)
    sections["aesthetic_style"] = aesthetic
    mapping_log.append(
        f"[Section 2] aesthetic='{aesthetic_key}' → "
        f"style='{aesthetic['style']}', vibe='{aesthetic['vibe']}'"
    )

    # ------------------------------------------------------------------
    # Section 3: Lighting
    # ------------------------------------------------------------------
    emotional_needs = questionnaire.get("emotional_needs", [])
    lighting_elements = []
    for need in emotional_needs:
        light = _EMOTIONAL_LIGHT_MAP.get(need, "")
        if light:
            lighting_elements.append(light)
    if not lighting_elements:
        lighting_elements = ["soft natural light with gentle emotional warmth"]
    sections["lighting"] = lighting_elements[:2]  # max 2 lighting cues
    mapping_log.append(
        f"[Section 3] emotional_needs={emotional_needs} → "
        f"lighting={lighting_elements[:2]}"
    )

    # ------------------------------------------------------------------
    # Section 4: Facial Features
    # ------------------------------------------------------------------
    gene_aesthetic = questionnaire.get("gene_aesthetic", "")
    if gene_aesthetic:
        facial_desc = _GENE_FACIAL_MAP.get(gene_aesthetic, "")
        if facial_desc:
            sections["facial_features"] = facial_desc
            mapping_log.append(
                f"[Section 4] gene_aesthetic='{gene_aesthetic}' → "
                f"facial_features='{facial_desc}'"
            )
        else:
            sections["facial_features"] = "harmonious facial features with emotional depth"
            mapping_log.append("[Section 4] gene_aesthetic unrecognized; using default")
    else:
        sections["facial_features"] = "expressive harmonious facial features"
        mapping_log.append("[Section 4] no gene_aesthetic; using default")

    # ------------------------------------------------------------------
    # Section 5: Scene
    # ------------------------------------------------------------------
    life_goals = questionnaire.get("life_goals", [])
    scene_elements = []
    for goal in life_goals:
        scene = _GOAL_SCENE_MAP.get(goal, "")
        if scene:
            scene_elements.append(scene)
    if not scene_elements:
        scene_elements = ["timeless atmospheric background"]
    sections["scene"] = scene_elements[:2]  # max 2 scene elements
    mapping_log.append(
        f"[Section 5] life_goals={life_goals} → scene={scene_elements[:2]}"
    )

    # ------------------------------------------------------------------
    # Section 6: Spiritual Element
    # ------------------------------------------------------------------
    spiritual_key = questionnaire.get("spiritual_preference", "")
    spiritual = _SPIRITUAL_MAP.get(spiritual_key, None)
    if spiritual:
        sections["spiritual_element"] = spiritual
        mapping_log.append(
            f"[Section 6] spiritual='{spiritual_key}' → "
            f"element={spiritual['element']}, symbols={spiritual['symbols'][:60]}..."
        )
    else:
        sections["spiritual_element"] = {"note": "none specified"}
        mapping_log.append("[Section 6] no spiritual preference")

    # ------------------------------------------------------------------
    # Section 7: Color Palette
    # ------------------------------------------------------------------
    # Derive colors from aesthetic style and spiritual element
    palette_parts = []
    if aesthetic_key == "北欧":
        palette_parts.append("cool minimal tones: muted blues, grays, soft cream")
    elif aesthetic_key == "日系":
        palette_parts.append("soft pastels: warm beige, sakura pink, gentle lavender")
    elif aesthetic_key == "美式":
        palette_parts.append("warm sunlit tones: amber, honey, deep forest greens")
    elif aesthetic_key == "法式":
        palette_parts.append("romantic muted roses, lavender gray, warm ivory")
    elif aesthetic_key == "复古":
        palette_parts.append("vintage sepia tones, faded ochre, dusky rose, aged gold")
    elif aesthetic_key == "自然":
        palette_parts.append("earthy greens, bark brown, sky blue, wildflower accents")
    else:
        palette_parts.append("balanced natural tones, harmonious color composition")

    # Add spiritual accent colors if available
    if spiritual and spiritual.get("accent_colors"):
        accent_str = ", ".join(spiritual["accent_colors"][:2])
        palette_parts.append(f"accented with {accent_str}")

    palette_text = "; ".join(palette_parts)
    sections["color_palette"] = palette_text
    mapping_log.append(f"[Section 7] palette derived: {palette_text[:80]}...")

    # ------------------------------------------------------------------
    # Section 8: Ethical Statement
    # ------------------------------------------------------------------
    sections["ethical"] = _ETHICAL_MARKER
    mapping_log.append("[Section 8] ethical disclaimer applied")

    # ==================================================================
    # ASSEMBLE PROMPT — 8 sections in structured format for Flux
    # ==================================================================
    prompt_parts = []

    # Header
    prompt_parts.append("Symbolic soulmate portrait")

    # 1. Psychological Core
    prompt_parts.append(
        f"Core emotion: {psych['core_emotion']}. "
        f"Expression: {psych['expression']}. "
        f"Pose: {psych['pose']}. "
        f"Aura: {psych['aura']}."
    )

    # 2. Aesthetic Style
    prompt_parts.append(
        f"Style: {aesthetic['style']}. "
        f"Clothing: {aesthetic['clothing']}."
    )

    # 3. Lighting
    prompt_parts.append(
        f"Lighting: {'; '.join(lighting_elements[:2])}."
    )

    # 4. Facial Features
    prompt_parts.append(
        f"Face: {sections['facial_features']}, emotionally expressive eyes."
    )

    # 5. Scene
    prompt_parts.append(
        f"Setting: {'; '.join(scene_elements[:2])}."
    )

    # 6. Spiritual Element
    if spiritual:
        prompt_parts.append(
            f"Spiritual element: {spiritual['element']}. "
            f"Symbols: {spiritual['symbols']}."
        )

    # 7. Color Palette
    prompt_parts.append(f"Colors: {palette_text}.")

    # 8. Ethical
    prompt_parts.append(f"Note: {_ETHICAL_MARKER}.")

    # Quality boosters for Flux
    prompt_parts.append(
        "highly detailed, photorealistic, sharp focus, "
        "emotionally evocative, cinematic quality"
    )

    prompt_text = ". ".join(prompt_parts)

    result = {
        "prompt_text": prompt_text,
        "mapping_log": mapping_log,
        "sections": sections,
        "ethical_marker": _ETHICAL_MARKER,
        "generated_at": time.time(),
        "prompt_id": str(uuid.uuid4())[:8],
    }

    # ==================================================================
    # DEBUG LOG — Output 8-segment prompt structure
    # ==================================================================
    _write_debug_log("[DEBUG] prompt-builder output:")
    _write_debug_log(f"  [Section 1] psychological_core: {psych['core_emotion']} | expression={psych['expression']} | pose={psych['pose']} | aura={psych['aura']}")
    _write_debug_log(f"  [Section 2] aesthetic_style: style={aesthetic['style']} | clothing={aesthetic['clothing']}")
    _write_debug_log(f"  [Section 3] lighting: {'; '.join(lighting_elements[:2])}")
    _write_debug_log(f"  [Section 4] facial_features: {sections['facial_features']}")
    _write_debug_log(f"  [Section 5] scene: {'; '.join(scene_elements[:2])}")
    if spiritual:
        _write_debug_log(f"  [Section 6] spiritual_element: {spiritual['element']} | symbols={spiritual['symbols'][:80]}...")
    else:
        _write_debug_log(f"  [Section 6] spiritual_element: none specified")
    _write_debug_log(f"  [Section 7] color_palette: {palette_text}")
    _write_debug_log(f"  [Section 8] ethical: {_ETHICAL_MARKER}")
    _write_debug_log(f"  [Section 9] quality_boosters: highly detailed, photorealistic, sharp focus, emotionally evocative, cinematic quality")

    logger.info("PromptBuilder (Flux-optimized) complete: prompt_id=%s, len=%d",
                result["prompt_id"], len(prompt_text))
    return result
