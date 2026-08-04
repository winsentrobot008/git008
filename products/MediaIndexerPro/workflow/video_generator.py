"""
MediaIndexerPro v3 — Video Generator (P4)

AI-powered video clip generation with Pika Labs API (primary) and
open-source T2V fallbacks (ModelScope / Stable Video Diffusion).

Pipeline:
  1. Validate prompt and parameters
  2. Primary: Pika Labs free API → download result
  3. Fallback 1: Open-source T2V (ModelScope / SVD) via diffusers
  4. Fallback 2: FFmpeg image-based placeholder clip
  5. Validate output with ffprobe
  6. Return local file path

Usage:
    from workflow.video_generator import generate_clip, generate_clips, validate_clip

    # Single clip
    path = generate_clip("A calm bedroom with morning sunlight", duration=5, ratio="1:1")

    # Batch clips
    results = generate_clips([
        {"prompt": "...", "duration": 15, "ratio": "1:1"},
        {"prompt": "...", "duration": 12, "ratio": "16:9"},
    ])

    # Validate
    is_valid = validate_clip("/path/to/clip.mp4")
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Optional

# Ensure project root is in path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

logger = logging.getLogger("MediaIndexerPro.VideoGenerator")

# ─── Optional dependency flags ───────────────────────────────────────────────

# Pika Labs API client
try:
    import requests as req_lib
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

# Open-source T2V (diffusers-based)
try:
    import torch
    import diffusers
    HAS_DIFFUSERS = True
except ImportError:
    HAS_DIFFUSERS = False
    if not HAS_DIFFUSERS:
        logger.info(
            "diffusers + torch not installed. Install with:\n"
            "  pip install diffusers transformers torch accelerate"
        )

# FFmpeg for video processing
HAS_FFMPEG = True  # Checked at runtime via subprocess

# Pillow for image generation in fallback
try:
    from PIL import Image, ImageDraw, ImageFont
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

# ─── Constants ───────────────────────────────────────────────────────────────

# Output directory
GENERATED_DIR = PROJECT_ROOT / "local_assets" / "generated"
GENERATED_DIR.mkdir(parents=True, exist_ok=True)

# Retry
T2V_RETRIES = 2
T2V_RETRY_DELAY = 3  # seconds

# Validation
MIN_CLIP_DURATION = 1.0  # seconds
MIN_CLIP_SIZE = 50 * 1024  # 50 KB

# Aspect ratio presets (width, height)
RATIO_MAP: dict[str, tuple[int, int]] = {
    "1:1": (1024, 1024),
    "16:9": (1024, 576),
    "9:16": (576, 1024),
    "4:3": (1024, 768),
    "3:4": (768, 1024),
}

DEFAULT_RATIO = "1:1"

# Pika Labs API
PIKA_API_BASE = "https://api.pika.art"
PIKA_DEFAULT_MODEL = "pika-2.0"

# ModelScope T2V models (HuggingFace IDs)
MODELSCOPE_T2V_MODEL = "ali-vilab/text-to-video-ms-1.7b"
SVD_MODEL = "stabilityai/stable-video-diffusion-img2vid"


# ═══════════════════════════════════════════════════════════════════════════════
#  Utility Functions
# ═══════════════════════════════════════════════════════════════════════════════

def _check_ffmpeg() -> bool:
    """Check if ffmpeg is available on the system."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.returncode == 0
    except Exception:
        return False


def _check_ffprobe() -> bool:
    """Check if ffprobe is available on the system."""
    try:
        result = subprocess.run(
            ["ffprobe", "-version"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.returncode == 0
    except Exception:
        return False


HAS_FFMPEG = _check_ffmpeg()
HAS_FFPROBE = _check_ffprobe()

if not HAS_FFMPEG:
    logger.warning("ffmpeg not found. Install ffmpeg for video processing.")
if not HAS_FFPROBE:
    logger.warning("ffprobe not found. Install ffprobe for video validation.")


def _resolve_ratio(ratio: str) -> tuple[int, int]:
    """Resolve aspect ratio string to (width, height) tuple."""
    ratio_clean = ratio.strip().lower()
    if ratio_clean in RATIO_MAP:
        return RATIO_MAP[ratio_clean]

    # Try to parse custom ratio like "1920:1080"
    match = re.match(r"^(\d+)\s*[:x]\s*(\d+)$", ratio_clean)
    if match:
        return (int(match.group(1)), int(match.group(2)))

    logger.warning(f"Unknown ratio '{ratio}', defaulting to {DEFAULT_RATIO}")
    return RATIO_MAP[DEFAULT_RATIO]


def _ffprobe_get_info(path: str) -> Optional[dict[str, Any]]:
    """Get video file information using ffprobe."""
    if not HAS_FFPROBE:
        return None

    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                "-show_streams",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if result.returncode == 0 and result.stdout.strip():
            return json.loads(result.stdout)
        return None
    except Exception as e:
        logger.debug(f"ffprobe failed for {path}: {e}")
        return None


# ═══════════════════════════════════════════════════════════════════════════════
#  validate_clip
# ═══════════════════════════════════════════════════════════════════════════════

def validate_clip(path: str) -> bool:
    """
    Validate a video clip file.

    Checks:
      1. File exists and size ≥ 50 KB
      2. ffprobe can read the file (playability)
      3. Duration ≥ 1 second
      4. Resolution is valid (width and height > 0)

    Args:
        path: Path to the video file.

    Returns:
        ``True`` if the clip is valid, ``False`` otherwise.
    """
    # Check 1: File exists and minimum size
    file_path = Path(path)
    if not file_path.exists():
        logger.warning(f"validate_clip: file not found: {path}")
        return False

    file_size = file_path.stat().st_size
    if file_size < MIN_CLIP_SIZE:
        logger.warning(
            f"validate_clip: file too small: {file_size} bytes "
            f"(min {MIN_CLIP_SIZE})"
        )
        return False

    # Check 2: ffprobe readability
    info = _ffprobe_get_info(path)
    if info is None:
        logger.warning(f"validate_clip: ffprobe cannot read: {path}")
        return False

    # Check 3: Duration
    format_info = info.get("format", {})
    duration_str = format_info.get("duration", "0")
    try:
        duration = float(duration_str)
    except (ValueError, TypeError):
        duration = 0.0

    if duration < MIN_CLIP_DURATION:
        logger.warning(
            f"validate_clip: duration too short: {duration:.2f}s "
            f"(min {MIN_CLIP_DURATION}s)"
        )
        return False

    # Check 4: Resolution
    streams = info.get("streams", [])
    video_streams = [s for s in streams if s.get("codec_type") == "video"]
    if not video_streams:
        logger.warning(f"validate_clip: no video stream found in {path}")
        return False

    vs = video_streams[0]
    width = vs.get("width", 0)
    height = vs.get("height", 0)
    if width <= 0 or height <= 0:
        logger.warning(
            f"validate_clip: invalid resolution: {width}x{height}"
        )
        return False

    logger.debug(
        f"validate_clip OK: {Path(path).name} "
        f"({width}x{height}, {duration:.1f}s, {file_size / 1024:.0f} KB)"
    )
    return True


# ═══════════════════════════════════════════════════════════════════════════════
#  Pika Labs API (Primary T2V Engine)
# ═══════════════════════════════════════════════════════════════════════════════

def _generate_pika_clip(
    prompt: str,
    duration: int,
    width: int,
    height: int,
    output_path: str,
    api_key: Optional[str] = None,
) -> Optional[str]:
    """
    Generate a video clip using Pika Labs free API.

    Args:
        prompt: Text prompt for video generation.
        duration: Target duration in seconds (5-20).
        width: Output video width.
        height: Output video height.
        output_path: Local path to save the result.
        api_key: Optional Pika API key. If None, reads from env ``PIKA_API_KEY``.

    Returns:
        Output path on success, None on failure.
    """
    if not HAS_REQUESTS:
        logger.warning("Pika API: requests not installed")
        return None

    api_key = api_key or os.environ.get("PIKA_API_KEY", "")
    if not api_key:
        logger.warning(
            "Pika API: no API key found. Set PIKA_API_KEY env var or "
            "install open-source fallback."
        )
        return None

    try:
        import requests

        # Step 1: Submit generation task
        logger.info(f"Pika API: submitting task (prompt='{prompt[:50]}...')")

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": PIKA_DEFAULT_MODEL,
            "prompt": prompt,
            "width": width,
            "height": height,
            "duration": min(max(duration, 5), 20),
            "cfg_scale": 7,
            "motion": 1,
        }

        resp = requests.post(
            f"{PIKA_API_BASE}/v1/generate",
            headers=headers,
            json=payload,
            timeout=60,
        )

        if resp.status_code != 200:
            logger.warning(
                f"Pika API submission failed: HTTP {resp.status_code} "
                f"{resp.text[:200]}"
            )
            return None

        result = resp.json()
        task_id = result.get("data", {}).get("id", "")
        if not task_id:
            logger.warning("Pika API: no task ID in response")
            return None

        # Step 2: Poll for completion
        max_polls = 60  # 5 minutes at 5s intervals
        poll_interval = 5

        for poll in range(max_polls):
            time.sleep(poll_interval)

            status_resp = requests.get(
                f"{PIKA_API_BASE}/v1/generate/{task_id}",
                headers=headers,
                timeout=30,
            )

            if status_resp.status_code != 200:
                logger.warning(
                    f"Pika API poll failed: HTTP {status_resp.status_code}"
                )
                continue

            status_data = status_resp.json().get("data", {})
            state = status_data.get("state", "").lower()

            if state == "completed":
                video_url = status_data.get("video_url", "")
                if not video_url:
                    logger.warning("Pika API: completed but no video_url")
                    return None

                # Download video
                logger.info(f"Pika API: downloading result from {video_url[:60]}...")
                download_resp = requests.get(video_url, timeout=120)
                download_resp.raise_for_status()

                with open(output_path, "wb") as f:
                    f.write(download_resp.content)

                if Path(output_path).exists():
                    logger.info(f"Pika API: clip saved to {output_path}")
                    return output_path
                return None

            elif state in ("failed", "error"):
                error_msg = status_data.get("error_message", "unknown")
                logger.warning(f"Pika API: generation failed: {error_msg}")
                return None

            # else: still processing

        logger.warning("Pika API: poll timeout after 5 minutes")
        return None

    except Exception as e:
        logger.warning(f"Pika API error: {e}")
        return None


# ═══════════════════════════════════════════════════════════════════════════════
#  Open-Source T2V (Fallback 1)
# ═══════════════════════════════════════════════════════════════════════════════

def _generate_diffusers_clip(
    prompt: str,
    duration: int,
    width: int,
    height: int,
    output_path: str,
) -> Optional[str]:
    """
    Generate a video clip using open-source T2V models via diffusers.

    Tries ModelScope T2V first, then Stable Video Diffusion.

    Args:
        prompt: Text prompt.
        duration: Target duration (frames = duration * fps).
        width, height: Output resolution.
        output_path: Local path to save the result.

    Returns:
        Output path on success, None on failure.
    """
    if not HAS_DIFFUSERS:
        logger.warning("diffusers not installed — cannot use open-source T2V")
        return None

    try:
        import torch
        from diffusers import DiffusionPipeline, StableVideoDiffusionPipeline
        from diffusers.utils import export_to_video
        import numpy as np

        # ── Try ModelScope T2V ──────────────────────────────────────────
        logger.info(f"Loading ModelScope T2V: {MODELSCOPE_T2V_MODEL}")
        try:
            pipe = DiffusionPipeline.from_pretrained(
                MODELSCOPE_T2V_MODEL,
                torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
                variant="fp16" if torch.cuda.is_available() else None,
            )
            pipe = pipe.to("cuda" if torch.cuda.is_available() else "cpu")
            if torch.cuda.is_available():
                pipe.enable_model_cpu_offload()

            # Generate frames
            num_frames = min(max(duration * 8, 16), 80)  # 8 fps, cap at 80 frames
            logger.info(f"ModelScope: generating {num_frames} frames...")

            result = pipe(
                prompt,
                num_frames=num_frames,
                width=width,
                height=height,
                num_inference_steps=25,
                guidance_scale=7.0,
            ).frames[0]

            # Export to video
            export_to_video(result, output_path, fps=8)
            if Path(output_path).exists():
                logger.info(f"ModelScope T2V success: {output_path}")
                return output_path

        except Exception as e:
            logger.warning(f"ModelScope T2V failed: {e}")

        # ── Try Stable Video Diffusion ───────────────────────────────────
        logger.info(f"Loading SVD: {SVD_MODEL}")
        try:
            pipe = StableVideoDiffusionPipeline.from_pretrained(
                SVD_MODEL,
                torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
                variant="fp16" if torch.cuda.is_available() else None,
            )
            pipe = pipe.to("cuda" if torch.cuda.is_available() else "cpu")
            if torch.cuda.is_available():
                pipe.enable_model_cpu_offload()

            # SVD requires an initial image; generate one from prompt
            # Use a simple color gradient as conditioning image
            if HAS_PIL:
                img = Image.new("RGB", (width, height), color=(100, 150, 200))
                # Add simple text overlay
                draw = ImageDraw.Draw(img)
                draw.text((width // 4, height // 2), prompt[:50], fill=(255, 255, 255))
                init_image = img
            else:
                # Pure numpy fallback
                import numpy as np
                init_image = np.random.randint(0, 255, (height, width, 3), dtype=np.uint8)

            num_frames = min(max(duration * 4, 8), 40)  # 4 fps
            result = pipe(
                init_image,
                num_frames=num_frames,
                decode_chunk_size=8,
                motion_bucket_id=127,
                noise_aug_strength=0.02,
            ).frames[0]

            export_to_video(result, output_path, fps=4)
            if Path(output_path).exists():
                logger.info(f"SVD success: {output_path}")
                return output_path

        except Exception as e:
            logger.warning(f"SVD failed: {e}")

        return None

    except Exception as e:
        logger.warning(f"Diffusers pipeline error: {e}")
        return None


# ═══════════════════════════════════════════════════════════════════════════════
#  FFmpeg Placeholder Clip (Emergency Fallback)
# ═══════════════════════════════════════════════════════════════════════════════

def _generate_placeholder_clip(
    prompt: str,
    duration: int,
    width: int,
    height: int,
    output_path: str,
) -> Optional[str]:
    """
    Generate a placeholder video clip using FFmpeg.

    Creates a colored frame with the prompt text, looped for the specified
    duration. Used when all T2V engines are unavailable.

    Args:
        prompt: Text to display on the placeholder.
        duration: Duration in seconds.
        width, height: Output resolution.
        output_path: Local path to save the result.

    Returns:
        Output path on success, None on failure.
    """
    if not HAS_FFMPEG:
        logger.error("FFmpeg not available for placeholder generation")
        return None

    if not HAS_PIL:
        logger.error("Pillow not available for placeholder generation")
        return None

    try:
        # Create a single placeholder frame image
        temp_dir = Path(output_path).parent
        temp_dir.mkdir(parents=True, exist_ok=True)
        frame_path = str(temp_dir / f"placeholder_frame_{uuid.uuid4().hex}.png")

        img = Image.new("RGB", (width, height), color=(30, 30, 50))
        draw = ImageDraw.Draw(img)

        # Try to load a font; fallback to default
        try:
            font = ImageFont.truetype("arial.ttf", 24)
        except (IOError, OSError):
            font = ImageFont.load_default()

        # Draw prompt text centered
        lines = []
        words = prompt.split()
        current_line = ""
        for word in words:
            test_line = (current_line + " " + word).strip()
            try:
                bbox = draw.textbbox((0, 0), test_line, font=font)
                text_width = bbox[2] - bbox[0]
            except Exception:
                text_width = len(test_line) * 10
            if text_width < width - 40:
                current_line = test_line
            else:
                lines.append(current_line)
                current_line = word
        if current_line:
            lines.append(current_line)

        y_start = height // 2 - len(lines) * 15
        for i, line in enumerate(lines):
            try:
                bbox = draw.textbbox((0, 0), line, font=font)
                text_width = bbox[2] - bbox[0]
            except Exception:
                text_width = len(line) * 10
            x = (width - text_width) // 2
            draw.text((x, y_start + i * 30), line, fill=(255, 255, 255), font=font)

        # Draw "AI Generated" label and duration info
        info_text = f"AI Generated - {duration}s"
        try:
            bbox = draw.textbbox((0, 0), info_text, font=font)
            info_width = bbox[2] - bbox[0]
        except Exception:
            info_width = len(info_text) * 10
        draw.text(
            ((width - info_width) // 2, height - 60),
            info_text,
            fill=(200, 200, 200),
            font=font,
        )

        img.save(frame_path)

        # Use FFmpeg to loop the image for the duration
        cmd = [
            "ffmpeg", "-y",
            "-loop", "1",
            "-i", frame_path,
            "-c:v", "libx264",
            "-t", str(duration),
            "-pix_fmt", "yuv420p",
            "-vf", f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
                   f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2",
            "-r", "24",
            "-preset", "fast",
            "-crf", "23",
            output_path,
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

        # Cleanup frame
        try:
            Path(frame_path).unlink(missing_ok=True)
        except Exception:
            pass

        if result.returncode == 0 and Path(output_path).exists():
            logger.info(f"Placeholder clip created: {output_path}")
            return output_path

        logger.warning(f"FFmpeg placeholder failed: {result.stderr[:200]}")
        return None

    except Exception as e:
        logger.warning(f"Placeholder generation error: {e}")
        return None


# ═══════════════════════════════════════════════════════════════════════════════
#  Public API 1: generate_clip
# ═══════════════════════════════════════════════════════════════════════════════

def generate_clip(
    prompt: str,
    duration: int = 5,
    ratio: str = "1:1",
    api_key: Optional[str] = None,
) -> Optional[str]:
    """
    Generate a video clip from a text prompt.

    Engine priority:
      1. Pika Labs API (requires ``PIKA_API_KEY`` env var or ``api_key`` arg)
      2. Open-source T2V (ModelScope → SVD via diffusers)
      3. FFmpeg placeholder (displays prompt text on colored background)

    Args:
        prompt: Text description of the desired video.
        duration: Target duration in seconds (5–20, default 5).
        ratio: Aspect ratio (``"1:1"``, ``"16:9"``, ``"9:16"``, or custom ``W:H``).
        api_key: Optional Pika API key. Uses ``PIKA_API_KEY`` env var if omitted.

    Returns:
        Absolute path to the generated video file, or ``None`` on failure.
    """
    # ── Validate ─────────────────────────────────────────────────────────
    if not prompt or not prompt.strip():
        logger.error("generate_clip: empty prompt")
        return None

    duration = max(1, min(duration, 20))
    width, height = _resolve_ratio(ratio)

    output_path = str(GENERATED_DIR / f"{uuid.uuid4().hex}.mp4")

    logger.info(
        f"generate_clip: prompt='{prompt[:60]}...', "
        f"duration={duration}s, ratio={ratio} ({width}x{height})"
    )

    # ── Try engines in priority order with retries ───────────────────────
    engines = [
        ("Pika API", lambda: _generate_pika_clip(
            prompt, duration, width, height, output_path, api_key
        )),
        ("Open-Source T2V", lambda: _generate_diffusers_clip(
            prompt, duration, width, height, output_path
        )),
        ("Placeholder", lambda: _generate_placeholder_clip(
            prompt, duration, width, height, output_path
        )),
    ]

    for engine_name, engine_fn in engines:
        for attempt in range(1, T2V_RETRIES + 1):
            logger.info(
                f"Engine '{engine_name}' attempt {attempt}/{T2V_RETRIES}"
            )
            try:
                result = engine_fn()
                if result and validate_clip(result):
                    abs_path = os.path.abspath(result)
                    file_size = Path(result).stat().st_size
                    logger.info(
                        f"generate_clip SUCCESS: {abs_path} "
                        f"({file_size / 1024:.0f} KB)"
                    )
                    return abs_path

                if result:
                    logger.warning(
                        f"Engine '{engine_name}' produced invalid clip "
                        f"(validation failed)"
                    )
                else:
                    logger.warning(
                        f"Engine '{engine_name}' returned no result"
                    )

            except Exception as e:
                logger.warning(
                    f"Engine '{engine_name}' attempt {attempt} error: {e}"
                )

            if attempt < T2V_RETRIES:
                time.sleep(T2V_RETRY_DELAY)

    logger.error(
        f"All engines failed for prompt: '{prompt[:60]}...'"
    )
    return None


# ═══════════════════════════════════════════════════════════════════════════════
#  Public API 2: generate_clips
# ═══════════════════════════════════════════════════════════════════════════════

def generate_clips(scene_list: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Generate video clips for a list of scenes.

    Each scene is processed independently. Failures do not block other scenes.

    Args:
        scene_list: List of scene dicts, each with keys:
            - ``prompt`` (str, required): Text description
            - ``duration`` (int, optional, default 5)
            - ``ratio`` (str, optional, default ``"1:1"``)

    Returns:
        A dict with::

            {
                "total": int,
                "succeeded": int,
                "failed": int,
                "results": [
                    {
                        "scene_id": int,
                        "prompt": str,
                        "status": "ok" | "failed",
                        "path": str | null,
                        "error": str | null,
                    },
                    ...
                ],
            }
    """
    if not scene_list:
        logger.warning("generate_clips: empty scene list")
        return {
            "total": 0,
            "succeeded": 0,
            "failed": 0,
            "results": [],
        }

    logger.info(f"generate_clips: {len(scene_list)} scene(s) to generate")

    results: list[dict[str, Any]] = []
    succeeded = 0
    failed = 0

    for idx, scene in enumerate(scene_list):
        scene_id = idx + 1
        prompt = scene.get("prompt", "")
        duration = scene.get("duration", 5)
        ratio = scene.get("ratio", "1:1")

        scene_result: dict[str, Any] = {
            "scene_id": scene_id,
            "prompt": prompt,
            "status": "failed",
            "path": None,
            "error": None,
        }

        if not prompt or not prompt.strip():
            scene_result["error"] = "empty prompt"
            results.append(scene_result)
            failed += 1
            continue

        try:
            clip_path = generate_clip(prompt, duration, ratio)
            if clip_path:
                scene_result["status"] = "ok"
                scene_result["path"] = clip_path
                succeeded += 1
            else:
                scene_result["error"] = "generation failed after all retries"
                failed += 1
        except Exception as e:
            logger.error(f"Scene {scene_id} unexpected error: {e}")
            scene_result["error"] = str(e)
            failed += 1

        results.append(scene_result)
        logger.info(
            f"Scene {scene_id}/{len(scene_list)}: "
            f"{'OK' if scene_result['status'] == 'ok' else 'FAIL'}"
            f" - {prompt[:40]}"
        )

    report: dict[str, Any] = {
        "total": len(scene_list),
        "succeeded": succeeded,
        "failed": failed,
        "results": results,
    }

    logger.info(
        f"generate_clips complete: {succeeded}/{len(scene_list)} succeeded"
    )
    return report


# ═══════════════════════════════════════════════════════════════════════════════
#  CLI Entry Point
# ═══════════════════════════════════════════════════════════════════════════════

def main():
    """CLI entry point: python -m workflow.video_generator <prompt>"""
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-5s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    parser = argparse.ArgumentParser(
        description="MediaIndexerPro v3 — Video Generator",
    )
    parser.add_argument("prompt", type=str, help="Text prompt for video generation")
    parser.add_argument("--duration", type=int, default=5, help="Clip duration (s)")
    parser.add_argument("--ratio", type=str, default="1:1", help="Aspect ratio")
    parser.add_argument(
        "--scenes",
        type=str,
        help="Path to JSON file with scene list (alternative to single prompt)",
    )
    args = parser.parse_args()

    if args.scenes:
        # Batch mode from JSON file
        scenes_path = Path(args.scenes)
        if not scenes_path.exists():
            print(f"Error: scenes file not found: {args.scenes}")
            sys.exit(1)
        scene_list = json.loads(scenes_path.read_text(encoding="utf-8"))
        report = generate_clips(scene_list)

        print(f"\n{'='*60}")
        print(f"Batch Generation Report")
        print(f"{'='*60}")
        print(f"  Total:     {report['total']}")
        print(f"  Succeeded: {report['succeeded']}")
        print(f"  Failed:    {report['failed']}")
        for r in report["results"]:
            status_icon = "OK" if r["status"] == "ok" else "FAIL"
            print(f"  [{status_icon}] Scene {r['scene_id']}: {r['prompt'][:40]}")
            if r["path"]:
                print(f"         Path: {r['path']}")
            if r["error"]:
                print(f"         Error: {r['error']}")
        print(f"{'='*60}")

    else:
        # Single clip mode
        path = generate_clip(args.prompt, args.duration, args.ratio)
        if path:
            info = _ffprobe_get_info(path)
            if info:
                streams = info.get("streams", [])
                vs = next((s for s in streams if s.get("codec_type") == "video"), {})
                print(f"\nVideo generated: {path}")
                print(f"  Resolution: {vs.get('width', '?')}x{vs.get('height', '?')}")
                print(f"  Duration:   {info.get('format', {}).get('duration', '?')}s")
                print(f"  Size:       {Path(path).stat().st_size / 1024:.0f} KB")
            else:
                print(f"\nVideo generated: {path}")
        else:
            print("\nFailed to generate video clip")
            sys.exit(1)


if __name__ == "__main__":
    main()
