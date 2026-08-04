"""AnimateDiff local video generation module.

Converts a sequence of images into a short video clip using AnimateDiff.
Requires PyTorch + CUDA GPU + diffusers + AnimateDiff models.

Falls back to ffmpeg image-to-video if AnimateDiff is not available.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


def animate_images_to_video(
    image_paths: list[str],
    output_path: str | None = None,
    fps: int = 8,
    duration_per_clip: int = 3,
) -> str:
    """Convert a sequence of images into a video.

    Strategy:
    1. AnimateDiff (requires GPU) — generates motion between frames
    2. ffmpeg fallback — simple image slideshow

    Args:
        image_paths: Paths to input PNG images.
        output_path: Path for the output mp4.
        fps: Frames per second for output.
        duration_per_clip: Seconds per image in fallback mode.

    Returns:
        Path to the generated video file.
    """
    if output_path is None:
        output_path = str(Path(tempfile.gettempdir()) / f"animate_{abs(hash(str(image_paths))) % 100000}.mp4")

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    # Check if we can use AnimateDiff
    animate_path = _try_animate_diff(image_paths, output_path)
    if animate_path:
        return animate_path

    # Fallback: use ffmpeg to create video from images
    return _ffmpeg_slideshow(image_paths, output_path, fps, duration_per_clip)


def _try_animate_diff(image_paths: list[str], output_path: str) -> str | None:
    """Try to generate video using AnimateDiff (requires GPU)."""
    try:
        import torch
    except ImportError:
        print("[AnimateDiff] PyTorch not installed")
        return None

    if not torch.cuda.is_available():
        print("[AnimateDiff] No CUDA GPU available")
        return None

    try:
        from diffusers import AnimateDiffPipeline, MotionAdapter, DDIMScheduler
        from diffusers.utils import export_to_gif
    except ImportError:
        print("[AnimateDiff] diffusers not installed")
        return None

    model_path = Path(r"C:\Users\aoogoost\models\animatediff")
    if not model_path.exists():
        print(f"[AnimateDiff] Model not found at {model_path}")
        print("[AnimateDiff] Download from: https://huggingface.co/guoyww/animatediff")
        return None

    try:
        print("[AnimateDiff] Loading motion adapter...")
        adapter = MotionAdapter.from_pretrained(
            str(model_path / "motion_adapter"),
            torch_dtype=torch.float16,
        )
        pipe = AnimateDiffPipeline.from_pretrained(
            str(model_path / "base_model"),
            motion_adapter=adapter,
            torch_dtype=torch.float16,
        )
        pipe.scheduler = DDIMScheduler.from_config(pipe.scheduler.config)
        pipe = pipe.to("cuda")
        pipe.enable_vae_slicing()

        print(f"[AnimateDiff] Generating video from {len(image_paths)} frames...")
        output = pipe(
            prompt=[f" cinematic video"] * len(image_paths),
            negative_prompt="low quality, bad quality, blurry",
            num_frames=min(16, len(image_paths) * 4),
            guidance_scale=7.5,
        )
        frames = output.frames[0]

        # Export to video
        export_to_gif(frames, str(output_path).replace(".mp4", ".gif"))
        print(f"[AnimateDiff] Video generated: {output_path}")
        return output_path

    except Exception as e:
        print(f"[AnimateDiff] Error: {e}")
        return None


def _ffmpeg_slideshow(
    image_paths: list[str],
    output_path: str,
    fps: int = 8,
    duration_per_clip: int = 3,
) -> str:
    """Fallback: create video from images using ffmpeg slideshow."""
    try:
        # Find ffmpeg
        ffmpeg = _find_ffmpeg()
        if not ffmpeg:
            print("[AnimateDiff] FFmpeg not found — cannot create video")
            return output_path

        with tempfile.TemporaryDirectory(prefix="animate_concat_") as tmp_dir:
            tmp = Path(tmp_dir)

            # Create individual video segments from each image
            segment_files = []
            for i, img_path in enumerate(image_paths):
                if not Path(img_path).exists():
                    continue
                seg_path = tmp / f"seg_{i:03d}.mp4"
                subprocess.run(
                    [ffmpeg, "-y", "-loop", "1", "-i", img_path,
                     "-c:v", "libx264", "-t", str(duration_per_clip),
                     "-pix_fmt", "yuv420p",
                     "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2",
                     "-r", str(fps), str(seg_path)],
                    capture_output=True, timeout=30,
                )
                if seg_path.exists():
                    segment_files.append(str(seg_path))

            if not segment_files:
                print("[AnimateDiff] No segments created")
                return output_path

            # Concatenate segments
            concat_list = tmp / "concat.txt"
            concat_list.write_text(
                "\n".join(f"file '{Path(f).as_posix()}'" for f in segment_files),
                encoding="utf-8",
            )

            subprocess.run(
                [ffmpeg, "-y", "-f", "concat", "-safe", "0",
                 "-i", str(concat_list), "-c:v", "libx264",
                 "-pix_fmt", "yuv420p", output_path],
                capture_output=True, timeout=120,
            )

            if Path(output_path).exists():
                size_mb = Path(output_path).stat().st_size / (1024 * 1024)
                print(f"[AnimateDiff] ffmpeg slideshow: {output_path} ({size_mb:.1f} MB)")
            return output_path

    except Exception as e:
        print(f"[AnimateDiff] ffmpeg fallback error: {e}")
        return output_path


def _find_ffmpeg() -> str | None:
    """Find ffmpeg executable."""
    import shutil
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    for candidate in [
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\ffmpeg\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe",
    ]:
        if Path(candidate).exists():
            return candidate
    return None
