"""Stable Diffusion 1.5 local image generation + placeholder fallback.

Auto-detects GPU. Falls back to colored placeholder images if no CUDA.
Always returns 3 frame paths.
"""

from __future__ import annotations

import os
import struct
import sys
import tempfile
import time
import zlib
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent

# Output directory for SD1.5 frames
SD15_OUTPUT = _REPO_ROOT / "output" / "sd15"


def generate_sd15_images(prompt: str, num_frames: int = 3) -> list[str]:
    """Generate N frames for a small video.

    Tries SD1.5 first (requires CUDA GPU), falls back to colored placeholders.

    Args:
        prompt: Text description.
        num_frames: Number of frames to generate.

    Returns:
        List of paths to PNG frames.
    """
    SD15_OUTPUT.mkdir(parents=True, exist_ok=True)

    # Try SD1.5 with CUDA
    images = _try_sd15(prompt, num_frames)
    if images:
        return images

    # Fallback: colored placeholders (always works)
    print(f"[SD1.5] Using placeholder frames (no GPU)")
    return _create_placeholder_frames(num_frames)


def _try_sd15(prompt: str, num_frames: int) -> list[str] | None:
    """Try generating with Stable Diffusion 1.5 (requires CUDA)."""
    try:
        import torch
    except ImportError:
        return None

    if not torch.cuda.is_available():
        return None

    try:
        from diffusers import StableDiffusionPipeline
    except ImportError:
        return None

    try:
        print("[SD1.5] Loading model (low VRAM mode)...")
        pipe = StableDiffusionPipeline.from_pretrained(
            "runwayml/stable-diffusion-v1-5",
            torch_dtype=torch.float16,
            safety_checker=None,
        )
        pipe.enable_attention_slicing()
        pipe.enable_vae_slicing()
        pipe = pipe.to("cuda")

        frames = []
        variations = [
            prompt,
            f"{prompt}, different angle",
            f"{prompt}, close up view",
        ]

        for i in range(min(num_frames, len(variations))):
            print(f"[SD1.5] Frame {i+1}/{num_frames}...")
            image = pipe(
                prompt=variations[i],
                negative_prompt="low quality, blurry",
                num_inference_steps=20,
                guidance_scale=7.0,
                width=512,
                height=512,
            ).images[0]

            path = str(SD15_OUTPUT / f"frame_{i}.png")
            image.save(path)
            frames.append(path)

        print(f"[SD1.5] Generated {len(frames)} frames")
        return frames

    except Exception as e:
        print(f"[SD1.5] Error: {e}")
        return None


# ─── Placeholder Fallback ─────────────────────────────────────────

COLORS = ["#e94560", "#0f3460", "#533483", "#1a1a2e", "#16213e"]

def _create_placeholder_frames(num_frames: int) -> list[str]:
    """Create colored placeholder PNGs (always works, no GPU)."""
    paths = []
    for i in range(num_frames):
        path = str(SD15_OUTPUT / f"frame_{i}.png")
        _write_minimal_png(path, COLORS[i % len(COLORS)])
        paths.append(path)
    print(f"[SD1.5] Placeholder frames: {paths}")
    return paths


def _write_minimal_png(path: str, color: str = "#1a1a2e") -> None:
    """Write a minimal valid 512x512 PNG."""
    c = color.lstrip("#")
    r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)

    def chunk(ctype: bytes, data: bytes) -> bytes:
        c = ctype + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    # Create a 1x1 PNG that stretches
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = chunk(b'IHDR', struct.pack(">IIBBBBB", 512, 512, 8, 2, 0, 0, 0))
    
    # Generate striped pattern
    raw_data = bytearray()
    for y in range(512):
        raw_data.append(0)  # filter byte
        for x in range(512):
            raw_data.extend([r, g, b])
    
    idat = chunk(b'IDAT', zlib.compress(bytes(raw_data)))
    iend = chunk(b'IEND', b'')

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(sig + ihdr + idat + iend)
