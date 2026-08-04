"""GPU and VRAM auto-detection for model selection.

Used by the provider registry to select the best model
based on available GPU memory.
"""

from __future__ import annotations

import sys
from typing import Any


def get_gpu_info() -> dict[str, Any]:
    """Detect GPU and VRAM.

    Returns:
        Dict with: available, vram_mb, name, recommended_model, reason
    """
    try:
        import torch
    except ImportError:
        return {
            "available": False,
            "vram_mb": 0,
            "name": "N/A",
            "recommended_model": "cpu",
            "reason": "PyTorch not installed",
        }

    if not torch.cuda.is_available():
        return {
            "available": False,
            "vram_mb": 0,
            "name": "N/A",
            "recommended_model": "cpu",
            "reason": "No CUDA GPU detected",
        }

    try:
        device = torch.cuda.current_device()
        props = torch.cuda.get_device_properties(device)
        vram_mb = props.total_memory // (1024 * 1024)
        name = props.name

        # Recommend model based on VRAM
        if vram_mb >= 8000:
            model = "sdxl"  # SDXL needs 8GB+
        elif vram_mb >= 4000:
            model = "sd15"  # SD 1.5 works with 4GB+
        elif vram_mb >= 2000:
            model = "sd15_tiny"  # Tiny SD with 2GB
        else:
            model = "cpu"

        return {
            "available": True,
            "vram_mb": vram_mb,
            "name": name,
            "recommended_model": model,
            "reason": f"{name} with {vram_mb}MB VRAM",
        }

    except Exception as e:
        return {
            "available": True,
            "vram_mb": 0,
            "name": "Unknown",
            "recommended_model": "sd15",
            "reason": f"CUDA available but query failed: {e}",
        }


def get_recommended_image_model() -> str:
    """Get the best image generation model for current hardware."""
    info = get_gpu_info()
    return info["recommended_model"]


def get_recommended_video_model() -> str:
    """Get the best video generation model for current hardware."""
    info = get_gpu_info()
    if info["available"] and info["vram_mb"] >= 2000:
        return "animatediff"
    return "ffmpeg"
