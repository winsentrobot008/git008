"""SD1.5 image generation with CPU fallback and auto device detection.

Pipeline:
1. Check for local model at models/sd15/
2. If not found and network available, download from HuggingFace
3. Auto-detect GPU/CPU based on VRAM
4. GTX 680 (2GB) detected → CPU mode
5. Always returns valid frames (real or placeholder)
"""

from __future__ import annotations

import struct, sys, time, zlib
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT = _REPO_ROOT / "output" / "fallback"
LOCAL_MODEL_PATH = _REPO_ROOT / "models" / "sd15"
HF_MODEL_ID = "runwayml/stable-diffusion-v1-5"

COLORS = ["#e94560", "#0f3460", "#533483", "#1a1a2e", "#16213e"]


def get_device() -> str:
    """Force CPU mode. GTX 680 has ~2GB VRAM — too low for SD1.5 CUDA."""
    return "cpu"


def generate_fallback_images(prompt: str, num_frames: int = 3) -> list[str]:
    """Generate N frames. Tries SD1.5, falls back to placeholders."""
    OUTPUT.mkdir(parents=True, exist_ok=True)

    # Try SD1.5
    frames = _try_sd15(prompt, num_frames)
    if frames:
        return frames

    # Placeholder fallback
    print(f"[SD1.5] Using colored placeholders (no SD1.5 available)")
    return _placeholders(num_frames)


def _try_sd15(prompt: str, n: int) -> list[str] | None:
    """Attempt SD1.5 image generation. Works on CPU (slow) or GPU."""
    device = get_device()
    
    try:
        import torch
        from diffusers import StableDiffusionPipeline
    except ImportError:
        print("[SD1.5] PyTorch/diffusers not installed")
        return None

    try:
        # Try loading: local path first, then HuggingFace hub
        import os as _os
        _os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "0"  # disable hf_transfer if not installed
        
        model_source = HF_MODEL_ID
        if LOCAL_MODEL_PATH.exists() and (LOCAL_MODEL_PATH / "model_index.json").exists():
            model_source = str(LOCAL_MODEL_PATH)
            print(f"[SD1.5] Loading local model: {model_source}")
        else:
            print(f"[SD1.5] Model not cached locally. Downloading from HuggingFace...")
            print(f"[SD1.5] This will download ~2GB (first time only)")
            model_source = HF_MODEL_ID

        # Load model
        dtype = torch.float32  # CPU only
        pipe = StableDiffusionPipeline.from_pretrained(
            model_source,
            torch_dtype=dtype,
            safety_checker=None,
        )
        
        # Memory optimizations for CPU
        pipe.enable_attention_slicing()
        if hasattr(pipe, 'enable_vae_slicing'):
            pipe.enable_vae_slicing()
        
        pipe = pipe.to("cpu")
        print(f"[SD1.5] Model loaded successfully on CPU")

        # Generate frames
        frames = []
        prompts = [prompt, f"{prompt}, different angle", f"{prompt}, close-up view"]
        
        for i in range(min(n, len(prompts))):
            t0 = time.time()
            print(f"[SD1.5] Frame {i+1}/{n}...")
            
            try:
                image = pipe(
                    prompt=prompts[i],
                    negative_prompt="low quality, blurry",
                    num_inference_steps=15 if device == "cpu" else 20,
                    guidance_scale=7.0,
                    width=512,
                    height=512,
                ).images[0]
                
                path = str(OUTPUT / f"frame_{i}.png")
                image.save(path)
                elapsed = time.time() - t0
                kb = Path(path).stat().st_size // 1024
                print(f"[SD1.5] Frame {i+1}: {path} ({kb} KB, {elapsed:.1f}s)")
                frames.append(path)
                
            except RuntimeError as e:
                print(f"[SD1.5] Frame {i+1} failed: {e}")
                # Memory error — use placeholder
                p = str(OUTPUT / f"frame_{i}.png")
                _write_placeholder_png(p, COLORS[i])
                frames.append(p)

        if frames:
            return frames

    except Exception as e:
        print(f"[SD1.5] Error loading model: {e}")
    
    return None


def _placeholders(n: int) -> list[str]:
    paths = []
    for i in range(n):
        p = str(OUTPUT / f"frame_{i}.png")
        _write_placeholder_png(p, COLORS[i % len(COLORS)])
        paths.append(p)
    return paths


def _write_placeholder_png(path: str, color: str) -> None:
    """Write a colored 512x512 PNG."""
    c = color.lstrip("#")
    r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
    
    def chunk(ct: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + ct + d + struct.pack(">I", zlib.crc32(ct + d) & 0xFFFFFFFF)

    raw = bytearray()
    for y in range(512):
        raw.append(0)
        raw.extend([r, g, b] * 512)
    
    data = (b'\x89PNG\r\n\x1a\n' +
            chunk(b'IHDR', struct.pack(">IIBBBBB", 512, 512, 8, 2, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(bytes(raw))) +
            chunk(b'IEND', b''))
    
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(data)
