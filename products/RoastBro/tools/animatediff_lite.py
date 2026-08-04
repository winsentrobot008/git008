"""AnimateDiff Lite — lightweight local video generation.

Requires: 2GB+ VRAM, PyTorch, diffusers.
Model: guoyww/animatediff-motion-adapter-v1-5-2 (~700MB).

Falls back to ffmpeg slideshow if unavailable.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


def animatediff_generate_video(
    image_prompts: list[str],
    output_path: str | None = None,
    num_frames: int = 16,
) -> str | None:
    """Generate a short video from image prompts using AnimateDiff Lite.

    Args:
        image_prompts: Text prompts for each frame/scene.
        output_path: Output path for video.
        num_frames: Number of frames to generate.

    Returns:
        Path to video, or None if unavailable (falls back to ffmpeg).
    """
    try:
        import torch
    except ImportError:
        print("[AnimateDiff Lite] PyTorch not installed")
        return None

    if not torch.cuda.is_available():
        print("[AnimateDiff Lite] No CUDA GPU")
        return None

    try:
        from diffusers import AnimateDiffPipeline, MotionAdapter, DDIMScheduler
        from diffusers.utils import export_to_gif
    except ImportError:
        print("[AnimateDiff Lite] diffusers not installed")
        return None

    try:
        print("[AnimateDiff Lite] Loading motion adapter...")
        adapter = MotionAdapter.from_pretrained(
            "guoyww/animatediff-motion-adapter-v1-5-2",
            torch_dtype=torch.float16,
        )

        pipe = AnimateDiffPipeline.from_pretrained(
            "runwayml/stable-diffusion-v1-5",
            motion_adapter=adapter,
            torch_dtype=torch.float16,
            safety_checker=None,
        )
        pipe.scheduler = DDIMScheduler.from_config(pipe.scheduler.config)
        pipe.enable_vae_slicing()
        pipe = pipe.to("cuda")

        print(f"[AnimateDiff Lite] Generating video ({num_frames} frames)...")
        output = pipe(
            prompt=image_prompts,
            negative_prompt=["low quality, blurry"] * len(image_prompts),
            num_frames=num_frames,
            guidance_scale=7.5,
        )
        frames = output.frames[0]

        out_path = output_path or str(
            Path(tempfile.gettempdir()) / f"animatediff_{int(time.time())}.gif"
        )
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        export_to_gif(frames, out_path)
        
        kb = Path(out_path).stat().st_size / 1024
        print(f"[AnimateDiff Lite] Video saved: {out_path} ({kb:.0f} KB)")
        return out_path

    except Exception as e:
        print(f"[AnimateDiff Lite] Error: {e}")
        return None
