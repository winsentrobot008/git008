"""
MediaIndexerPro v3 — Main Pipeline (P7)

End-to-end video generation pipeline that orchestrates P3–P6:

  "script -> scenes -> clips -> voice + subtitles -> assembly -> timeline"

Pipeline flow::

    run_pipeline(script)
        │
        ├─ 1. split_script_into_scenes()
        │      (LLM-based semantic scene splitting)
        │      → scene_list: [{"id", "prompt", "duration", "ratio"}, ...]
        │
        ├─ 2. generate_all_clips(scene_list)
        │      (calls P4: workflow.video_generator.generate_clips)
        │      → scene_results: [{scene_id, path, status}, ...]
        │
        ├─ 3. generate_voice_and_subtitles(script)
        │      (calls P3: workflow.voice_generator.generate_voice_and_subtitles)
        │      → voice_result: {"audio", "subtitles", "duration"}
        │
        ├─ 4. assemble_video(scene_results, voice_result)
        │      (calls P5: auto_editor.generate_final_video)
        │      → final_video_path
        │
        ├─ 5. build_timeline(scene_results, voice_result)
        │      (calls P6: timeline_editor.editor_ui.Timeline.from_auto_pipeline)
        │      → timeline object (editable)
        │
        └─ Return combined result dict

Usage:
    from workflow.pipeline import run_pipeline

    result = run_pipeline(
        script="Life is like a box of chocolates...",
        ratio="1:1",
    )
    # {
    #   "final_video": "/path/to/final.mp4",
    #   "timeline": { ... },
    #   "scenes": [...],
    #   "clips": [...],
    #   "voice": {...},
    #   "status": "ok" | "partial" | "failed"
    # }
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Optional

# Ensure project root is in path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

logger = logging.getLogger("MediaIndexerPro.Pipeline")

# ─── Constants ───────────────────────────────────────────────────────────────

DEFAULT_RATIO = "1:1"
MIN_SCENES = 1
MAX_SCENES = 10
FALLBACK_SCENE_DURATION = 10  # seconds

# Scene splitting prompts
SCENE_SPLIT_PROMPT = """You are a professional video script director. Split the following script into {num_scenes} visual scenes for a video.

For each scene, provide:
1. A detailed visual prompt (what the viewer sees) — write as an image/video generation prompt
2. Suggested duration in seconds ({min_duration}-{max_duration}s per scene)
3. Aspect ratio: {ratio}

Respond ONLY with a valid JSON array. No markdown, no explanation.

[
  {{
    "prompt": "A wide shot of a calm beach at sunset, gentle waves...",
    "duration": 12,
    "ratio": "{ratio}"
  }},
  ...
]"""

FALLBACK_SCENE_PROMPT = (
    "A calm, contemplative scene with soft lighting, suitable for "
    "narrative storytelling and reflective voiceover."
)


# ═══════════════════════════════════════════════════════════════════════════════
#  1. split_script_into_scenes
# ═══════════════════════════════════════════════════════════════════════════════

def split_script_into_scenes(
    script: str,
    ratio: str = DEFAULT_RATIO,
    min_scenes: int = 4,
    max_scenes: int = 10,
) -> list[dict[str, Any]]:
    """
    Split a script into visual scenes using an LLM (Qwen2-VL / fallback).

    Each scene gets a visual prompt, suggested duration, and aspect ratio.

    The function tries:
      1. Qwen2-VL (via transformers) — best quality
      2. Simple heuristic fallback — sentence-based splitting

    Args:
        script: The full script text.
        ratio: Target aspect ratio for all scenes (e.g. ``"1:1"``).
        min_scenes: Minimum number of scenes (default 4).
        max_scenes: Maximum number of scenes (default 10).

    Returns:
        A list of scene dicts::

            [
                {"id": 1, "prompt": "...", "duration": 12, "ratio": "1:1"},
                {"id": 2, "prompt": "...", "duration": 15, "ratio": "1:1"},
            ]
    """
    if not script or not script.strip():
        logger.error("split_script_into_scenes: empty script")
        return _fallback_scenes(script)

    # Clean the script
    cleaned = _clean_script(script)
    if not cleaned:
        return _fallback_scenes(script)

    logger.info(
        f"split_script_into_scenes: {len(cleaned)} chars, "
        f"target {min_scenes}-{max_scenes} scenes"
    )

    # ── Method 1: LLM-based splitting (Qwen2-VL or other) ───────────────
    scenes = _split_via_llm(cleaned, ratio, min_scenes, max_scenes)
    if scenes:
        logger.info(f"LLM split: {len(scenes)} scenes")
        return scenes

    # ── Method 2: Heuristic fallback ─────────────────────────────────────
    scenes = _split_heuristic(cleaned, ratio, min_scenes, max_scenes)
    if scenes:
        logger.info(f"Heuristic split: {len(scenes)} scenes")
        return scenes

    # ── Method 3: Single fallback scene ──────────────────────────────────
    logger.warning("All splitting methods failed, using single fallback scene")
    return _fallback_scenes(cleaned)


def _clean_script(script: str) -> str:
    """Normalise whitespace in script."""
    text = script.replace("\r\n", "\n").replace("\r", "\n")
    # Remove multiple blank lines
    text = re.sub(r"\n\s*\n", "\n", text)
    # Normalise spaces
    text = re.sub(r" +", " ", text)
    return text.strip()


def _split_via_llm(
    script: str,
    ratio: str,
    min_scenes: int,
    max_scenes: int,
) -> Optional[list[dict[str, Any]]]:
    """
    Split script using Qwen2-VL or another LLM via transformers.

    Returns None if LLM is unavailable or parsing fails.
    """
    try:
        # Try to use Qwen2-VL
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        # Use a smaller/available model; Qwen2-VL is heavy
        # Fallback to Qwen2.5-7B-Instruct or similar
        model_name = "Qwen/Qwen2.5-7B-Instruct"

        logger.info(f"Loading LLM: {model_name}")

        tokenizer = AutoTokenizer.from_pretrained(
            model_name, trust_remote_code=True
        )
        model = AutoModelForCausalLM.from_pretrained(
            model_name,
            torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
            device_map="auto",
            trust_remote_code=True,
        )

        prompt = SCENE_SPLIT_PROMPT.format(
            num_scenes=max_scenes,
            min_duration=8,
            max_duration=20,
            ratio=ratio,
        )

        messages = [
            {
                "role": "system",
                "content": "You are a video script director. Output only valid JSON.",
            },
            {"role": "user", "content": f"{prompt}\n\nScript:\n{script[:2000]}"},
        ]

        text = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        inputs = tokenizer(
            [text], return_tensors="pt", truncation=True, max_length=4096
        ).to(model.device)

        generated_ids = model.generate(
            **inputs,
            max_new_tokens=1024,
            temperature=0.7,
            do_sample=True,
            top_p=0.9,
        )
        output = tokenizer.batch_decode(
            generated_ids, skip_special_tokens=True
        )[0]

        # Extract JSON array from response
        json_match = re.search(r"\[[\s\S]*\]", output)
        if json_match:
            scenes = json.loads(json_match.group(0))
            return _validate_scenes(scenes, ratio)

        return None

    except ImportError:
        logger.info("LLM not available (transformers/torch not installed)")
        return None
    except Exception as e:
        logger.warning(f"LLM scene splitting failed: {e}")
        return None


def _split_heuristic(
    script: str,
    ratio: str,
    min_scenes: int,
    max_scenes: int,
) -> list[dict[str, Any]]:
    """
    Heuristic scene splitting based on sentence count and paragraph breaks.

    Each paragraph becomes a scene. If there are fewer paragraphs than
    min_scenes, sentences are grouped.
    """
    # Split by paragraph breaks first
    paragraphs = [p.strip() for p in script.split("\n") if p.strip()]

    if len(paragraphs) < min_scenes:
        # Split by sentences instead
        sentences = re.split(r"(?<=[。！？；：.!?;])\s*", script)
        sentences = [s.strip() for s in sentences if len(s.strip()) > 10]

        if len(sentences) < min_scenes:
            # Even fewer sentences — split by chunks
            chunks = _split_into_chunks(script, max_scenes)
            segments = chunks
        else:
            segments = sentences[:max_scenes]
    else:
        segments = paragraphs[:max_scenes]

    # Generate scene prompts from segments
    scenes: list[dict[str, Any]] = []
    for i, segment in enumerate(segments):
        duration = max(8, min(20, len(segment) // 5))
        prompt = _segment_to_prompt(segment, i, len(segments))

        scenes.append({
            "id": i + 1,
            "prompt": prompt,
            "duration": duration,
            "ratio": ratio,
        })

    return scenes


def _split_into_chunks(text: str, num_chunks: int) -> list[str]:
    """Split text into roughly equal chunks."""
    if not text:
        return []
    chunk_size = max(1, len(text) // num_chunks)
    chunks: list[str] = []
    for i in range(0, len(text), chunk_size):
        chunk = text[i : i + chunk_size].strip()
        if chunk:
            chunks.append(chunk)
    return chunks


def _segment_to_prompt(segment: str, idx: int, total: int) -> str:
    """
    Convert a text segment into a visual prompt for T2V models.

    Builds a cinematic scene description based on the segment's position
    in the narrative arc.
    """
    # Narrative positioning
    if total == 1:
        mood = "calm and engaging"
    elif idx == 0:
        mood = "captivating establishing shot"
    elif idx == total - 1:
        mood = "emotional concluding scene"
    elif idx % 2 == 0:
        mood = "dynamic and engaging"
    else:
        mood = "calm and reflective"

    # Extract key nouns for visual context
    key_words = segment.split()[:10]
    visual_context = " ".join(key_words)

    prompt = (
        f"A {mood} visual scene depicting: {visual_context}. "
        f"Cinematic lighting, professional composition, "
        f"soft color palette, shallow depth of field. "
        f"The scene should match the narrative tone of: "
        f"'{segment[:100].strip()}'"
    )

    return prompt


def _validate_scenes(
    scenes: list[Any],
    default_ratio: str,
) -> Optional[list[dict[str, Any]]]:
    """Validate and normalise LLM-generated scene list."""
    if not isinstance(scenes, list) or len(scenes) < 1:
        return None

    validated: list[dict[str, Any]] = []
    for i, scene in enumerate(scenes):
        if not isinstance(scene, dict):
            continue
        prompt = scene.get("prompt", "")
        if not prompt or not isinstance(prompt, str):
            continue
        duration = int(scene.get("duration", FALLBACK_SCENE_DURATION))
        duration = max(5, min(30, duration))
        ratio = scene.get("ratio", default_ratio)
        if not isinstance(ratio, str) or ":" not in ratio:
            ratio = default_ratio

        validated.append({
            "id": i + 1,
            "prompt": prompt.strip(),
            "duration": duration,
            "ratio": ratio,
        })

    return validated if validated else None


def _fallback_scenes(script: str) -> list[dict[str, Any]]:
    """Generate a single fallback scene."""
    prompt = FALLBACK_SCENE_PROMPT
    if script and script.strip():
        # Use first 100 chars as visual hint
        hint = script.strip()[:100]
        prompt = (
            f"A cinematic scene illustrating: {hint}. "
            f"Soft lighting, professional composition."
        )
    return [{
        "id": 1,
        "prompt": prompt,
        "duration": FALLBACK_SCENE_DURATION,
        "ratio": DEFAULT_RATIO,
    }]


# ═══════════════════════════════════════════════════════════════════════════════
#  2. generate_all_clips
# ═══════════════════════════════════════════════════════════════════════════════

def generate_all_clips(
    scene_list: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Generate video clips for all scenes using P4.

    Calls :func:`~workflow.video_generator.generate_clips`.

    Args:
        scene_list: List of scene dicts from ``split_script_into_scenes()``.

    Returns:
        List of scene result dicts with generation status.
    """
    from workflow.video_generator import generate_clips

    if not scene_list:
        logger.warning("generate_all_clips: empty scene list")
        return []

    logger.info(f"generate_all_clips: {len(scene_list)} scene(s)")

    try:
        scenes_for_p4 = [
            {
                "prompt": s.get("prompt", ""),
                "duration": s.get("duration", 10),
                "ratio": s.get("ratio", DEFAULT_RATIO),
            }
            for s in scene_list
        ]

        report = generate_clips(scenes_for_p4)
        results = report.get("results", [])

        # Attach original scene IDs
        for i, r in enumerate(results):
            if i < len(scene_list):
                r["scene_id"] = scene_list[i].get("id", i + 1)

        logger.info(
            f"generate_all_clips: {report.get('succeeded', 0)}/"
            f"{report.get('total', 0)} succeeded"
        )
        return results

    except Exception as e:
        logger.error(f"generate_all_clips failed: {e}", exc_info=True)
        return []


# ═══════════════════════════════════════════════════════════════════════════════
#  3. generate_voice_and_subtitles
# ═══════════════════════════════════════════════════════════════════════════════

def generate_voice_and_subtitles(
    script: str,
    voice: str = "default",
    speed: float = 1.0,
) -> dict[str, Any]:
    """
    Generate voiceover audio and subtitles using P3.

    Calls :func:`~workflow.voice_generator.generate_voice_and_subtitles`.

    Args:
        script: The full script text.
        voice: Voice preset name.
        speed: Speaking speed.

    Returns:
        Voice result dict with keys ``audio``, ``subtitles``, ``duration``.
    """
    from workflow.voice_generator import generate_voice_and_subtitles as _gen_voice

    if not script or not script.strip():
        logger.warning("generate_voice_and_subtitles: empty script")
        return {"audio": None, "subtitles": None, "duration": 0.0}

    logger.info(
        f"generate_voice_and_subtitles: {len(script)} chars, "
        f"voice={voice}, speed={speed}"
    )

    try:
        result = _gen_voice(script, voice, speed)

        # Normalise result
        if not isinstance(result, dict):
            result = {"audio": None, "subtitles": None, "duration": 0.0}

        logger.info(
            f"generate_voice_and_subtitles: "
            f"audio={'yes' if result.get('audio') else 'no'}, "
            f"subs={'yes' if result.get('subtitles') else 'no'}, "
            f"dur={result.get('duration', 0):.1f}s"
        )
        return result

    except Exception as e:
        logger.error(f"generate_voice_and_subtitles failed: {e}", exc_info=True)
        return {"audio": None, "subtitles": None, "duration": 0.0}


# ═══════════════════════════════════════════════════════════════════════════════
#  4. assemble_video
# ═══════════════════════════════════════════════════════════════════════════════

def assemble_video(
    scene_results: list[dict[str, Any]],
    voice_result: dict[str, Any],
    output_path: Optional[str] = None,
) -> Optional[str]:
    """
    Assemble the final video from clips, audio, and subtitles using P5.

    Calls :func:`~auto_editor.generate_final_video`.

    Args:
        scene_results: Scene results from ``generate_all_clips()``.
        voice_result: Voice result from ``generate_voice_and_subtitles()``.
        output_path: Desired output path. Auto-generated if ``None``.

    Returns:
        Path to the final video file, or ``None`` on failure.
    """
    from auto_editor import generate_final_video

    if not scene_results:
        logger.warning("assemble_video: no scene results")
        return None

    if output_path is None:
        output_dir = Path("local_assets/generated")
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = str(output_dir / f"final_{uuid.uuid4().hex}.mp4")

    logger.info(
        f"assemble_video: {len(scene_results)} clips, "
        f"output={Path(output_path).name}"
    )

    try:
        result = generate_final_video(scene_results, voice_result, output_path)

        video_path = result.get("video_path")
        if video_path and Path(video_path).exists():
            size_mb = Path(video_path).stat().st_size / (1024 * 1024)
            logger.info(
                f"assemble_video success: {video_path} "
                f"({size_mb:.1f} MB, engine={result.get('engine', '?')})"
            )
            return video_path

        logger.warning(
            f"assemble_video: no output from engine "
            f"(engine={result.get('engine', '?')})"
        )
        return None

    except Exception as e:
        logger.error(f"assemble_video failed: {e}", exc_info=True)
        return None


# ═══════════════════════════════════════════════════════════════════════════════
#  5. build_timeline
# ═══════════════════════════════════════════════════════════════════════════════

def build_timeline(
    scene_results: list[dict[str, Any]],
    voice_result: dict[str, Any],
    name: str = "AI Generated Video",
) -> dict[str, Any]:
    """
    Build an editable timeline from pipeline results using P6.

    Calls :meth:`~timeline_editor.editor_ui.Timeline.from_auto_pipeline`.

    Args:
        scene_results: Scene results from ``generate_all_clips()``.
        voice_result: Voice result from ``generate_voice_and_subtitles()``.
        name: Timeline name.

    Returns:
        Timeline dict (from ``to_dict()``), or an empty dict on failure.
    """
    from timeline_editor.editor_ui import Timeline

    if not scene_results and not voice_result:
        logger.warning("build_timeline: no data provided")
        return {"error": "empty timeline"}

    logger.info("build_timeline: creating Timeline from pipeline results")

    try:
        timeline = Timeline.from_auto_pipeline(scene_results, voice_result, name)
        result = timeline.to_dict()
        logger.info(
            f"build_timeline: {result.get('timeline_id', '?')[:8]} — "
            f"{len(result.get('video', []))} clips, "
            f"{len(result.get('audio', []))} audio, "
            f"{len(result.get('subtitles', []))} subs"
        )
        return result

    except Exception as e:
        logger.error(f"build_timeline failed: {e}", exc_info=True)
        return {"error": f"timeline build failed: {e}"}


# ═══════════════════════════════════════════════════════════════════════════════
#  6. run_pipeline (Unified Entry)
# ═══════════════════════════════════════════════════════════════════════════════

def run_pipeline(
    script: str,
    ratio: str = DEFAULT_RATIO,
    voice: str = "default",
    speed: float = 1.0,
    output_path: Optional[str] = None,
) -> dict[str, Any]:
    """
    Run the complete AI video generation pipeline.

    This is the **single entry point** for the entire MediaIndexerPro v3
    system. It orchestrates all modules from P3 to P6:

    .. code-block::

        split_script → generate_clips → generate_voice+subs → assemble → timeline

    Args:
        script: The full script text to turn into a video.
        ratio: Aspect ratio for all scenes (``"1:1"``, ``"16:9"``, ``"9:16"``).
        voice: Voice preset name for TTS.
        speed: Speaking speed (0.5–2.0).
        output_path: Optional output path for the final video.

    Returns:
        A comprehensive result dict::

            {
                "status": "ok" | "partial" | "failed",
                "final_video": "/path/to/final.mp4" | None,
                "timeline": { ... } | {"error": "..."},
                "scenes": [{"id", "prompt", "duration", "ratio"}, ...],
                "clips": [{"scene_id", "path", "status"}, ...],
                "voice": {"audio", "subtitles", "duration"},
                "error": str | None,
            }
    """
    # ── Validate ─────────────────────────────────────────────────────────
    if not script or not script.strip():
        logger.error("run_pipeline: empty script")
        return {"status": "failed", "error": "empty script"}

    logger.info("=" * 60)
    logger.info("MediaIndexerPro v3 Pipeline START")
    logger.info(f"Script: {len(script)} chars, ratio={ratio}, voice={voice}")
    logger.info("=" * 60)

    start_time = time.time()
    result: dict[str, Any] = {
        "status": "ok",
        "final_video": None,
        "timeline": {},
        "scenes": [],
        "clips": [],
        "voice": {},
        "error": None,
    }

    # ── Step 1: Split script into scenes ─────────────────────────────────
    logger.info("\n--- Step 1/5: Split script into scenes ---")
    try:
        scene_list = split_script_into_scenes(script, ratio)
        result["scenes"] = scene_list
        logger.info(f"  -> {len(scene_list)} scene(s)")
    except Exception as e:
        logger.error(f"Step 1 failed: {e}")
        scene_list = _fallback_scenes(script)
        result["scenes"] = scene_list
        result["status"] = "partial"

    # ── Step 2: Generate video clips ─────────────────────────────────────
    logger.info(f"\n--- Step 2/5: Generate {len(scene_list)} clip(s) ---")
    try:
        scene_results = generate_all_clips(scene_list)
        result["clips"] = scene_results
        succeeded = sum(1 for r in scene_results if r.get("status") == "ok")
        logger.info(f"  -> {succeeded}/{len(scene_results)} clip(s) generated")
    except Exception as e:
        logger.error(f"Step 2 failed: {e}")
        scene_results = []
        result["clips"] = []
        result["status"] = "partial"

    # ── Step 3: Generate voice and subtitles ─────────────────────────────
    logger.info("\n--- Step 3/5: Generate voice and subtitles ---")
    try:
        voice_result = generate_voice_and_subtitles(script, voice, speed)
        result["voice"] = voice_result
        logger.info(
            f"  -> audio={'yes' if voice_result.get('audio') else 'no'}, "
            f"subs={'yes' if voice_result.get('subtitles') else 'no'}"
        )
    except Exception as e:
        logger.error(f"Step 3 failed: {e}")
        voice_result = {"audio": None, "subtitles": None, "duration": 0.0}
        result["voice"] = voice_result
        result["status"] = "partial"

    # ── Step 4: Assemble final video ─────────────────────────────────────
    logger.info("\n--- Step 4/5: Assemble final video ---")
    try:
        final_video = assemble_video(scene_results, voice_result, output_path)
        result["final_video"] = final_video
        if final_video:
            logger.info(f"  -> Final video: {final_video}")
        else:
            logger.warning("  -> Final video assembly returned None")
            if result["status"] == "ok":
                result["status"] = "partial"
    except Exception as e:
        logger.error(f"Step 4 failed: {e}")
        result["status"] = "partial"

    # ── Step 5: Build timeline ───────────────────────────────────────────
    logger.info("\n--- Step 5/5: Build timeline ---")
    try:
        timeline = build_timeline(scene_results, voice_result)
        result["timeline"] = timeline
        logger.info("  -> Timeline built")
    except Exception as e:
        logger.error(f"Step 5 failed: {e}")
        result["timeline"] = {"error": f"timeline build failed: {e}"}
        if result["status"] == "ok":
            result["status"] = "partial"

    # ── Summary ──────────────────────────────────────────────────────────
    elapsed = time.time() - start_time
    logger.info("\n" + "=" * 60)
    logger.info(f"Pipeline COMPLETE ({result['status']}) in {elapsed:.1f}s")
    logger.info(f"  Scenes:  {len(result.get('scenes', []))}")
    logger.info(f"  Clips:   {sum(1 for r in result.get('clips', []) if r.get('status') == 'ok')}"
                f"/{len(result.get('clips', []))}")
    logger.info(f"  Audio:   {'yes' if result.get('voice', {}).get('audio') else 'no'}")
    logger.info(f"  Video:   {'yes' if result.get('final_video') else 'no'}")
    logger.info("=" * 60)

    return result


# ═══════════════════════════════════════════════════════════════════════════════
#  CLI Entry Point
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    """CLI entry: python -m workflow.pipeline --script <text> or --file <path>"""
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-5s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    parser = argparse.ArgumentParser(
        description="MediaIndexerPro v3 — Full Pipeline",
    )
    parser.add_argument("--script", type=str, help="Script text inline")
    parser.add_argument("--file", type=str, help="Path to script file")
    parser.add_argument("--ratio", type=str, default=DEFAULT_RATIO, help="Aspect ratio")
    parser.add_argument("--voice", type=str, default="default", help="Voice preset")
    parser.add_argument("--speed", type=float, default=1.0, help="Speaking speed")
    parser.add_argument("--output", type=str, help="Output video path")
    args = parser.parse_args()

    # Read script
    script = args.script or ""
    if args.file:
        file_path = Path(args.file)
        if file_path.exists():
            script = file_path.read_text(encoding="utf-8")
        else:
            print(f"Error: file not found: {args.file}")
            sys.exit(1)

    if not script:
        print("Error: no script provided. Use --script or --file.")
        sys.exit(1)

    result = run_pipeline(script, args.ratio, args.voice, args.speed, args.output)

    # Print summary
    print(f"\n{'='*60}")
    print(f"Pipeline Result: {result.get('status', 'unknown')}")
    print(f"{'='*60}")
    print(f"  Final video: {result.get('final_video', 'N/A')}")
    print(f"  Scenes:      {len(result.get('scenes', []))}")
    clips_ok = sum(1 for r in result.get('clips', []) if r.get('status') == 'ok')
    print(f"  Clips:       {clips_ok}/{len(result.get('clips', []))}")
    print(f"  Voiceover:   {'yes' if result.get('voice', {}).get('audio') else 'no'}")
    print(f"  Subtitles:   {'yes' if result.get('voice', {}).get('subtitles') else 'no'}")
    print(f"  Timeline:    {'yes' if result.get('timeline', {}).get('timeline_id') else 'no'}")
    if result.get("error"):
        print(f"  Error:       {result['error']}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
