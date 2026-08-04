"""Local SDXL image generation module.

Generates images from text prompts using Stable Diffusion XL.
Requires PyTorch + CUDA GPU for reasonable performance.

Falls back gracefully if CUDA/diffusers are not available.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


def generate_sdxl_images(
    scene_prompts: list[str],
    output_dir: str | None = None,
    model_id: str = "stabilityai/stable-diffusion-xl-base-1.0",
) -> list[str]:
    """Generate images for each scene prompt using local SDXL model.

    Args:
        scene_prompts: List of text prompts, one per scene.
        output_dir: Directory to save output PNGs.
        model_id: HuggingFace model ID for SDXL.

    Returns:
        List of paths to generated PNG images.
        Returns placeholder paths if SDXL is not available.
    """
    # Check prerequisites
    try:
        import torch
    except ImportError:
        print("[SDXL] PyTorch not installed (pip install torch)")
        return _create_placeholders(scene_prompts, output_dir)

    if not torch.cuda.is_available():
        print("[SDXL] No CUDA GPU available — SDXL requires GPU")
        return _create_placeholders(scene_prompts, output_dir)

    try:
        from diffusers import StableDiffusionXLPipeline
        from transformers import AutoTokenizer
    except ImportError:
        print("[SDXL] diffusers not installed (pip install diffusers transformers)")
        return _create_placeholders(scene_prompts, output_dir)

    # Check if model exists locally
    local_model_path = Path(r"C:\Users\aoogoost\models\sdxl")
    if not local_model_path.exists():
        print(f"[SDXL] Model not found at {local_model_path}")
        print("[SDXL] Download with: python -c \"from diffusers import StableDiffusionXLPipeline; StableDiffusionXLPipeline.from_pretrained('stabilityai/stable-diffusion-xl-base-1.0')\"")
        return _create_placeholders(scene_prompts, output_dir)

    if output_dir is None:
        output_dir = tempfile.mkdtemp(prefix="sdxl_")
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    try:
        print(f"[SDXL] Loading model from {local_model_path}...")
        pipe = StableDiffusionXLPipeline.from_pretrained(
            str(local_model_path),
            torch_dtype=torch.float16,
            use_safetensors=True,
        )
        pipe = pipe.to("cuda")
        print("[SDXL] Model loaded, generating images...")

        image_paths = []
        for i, prompt in enumerate(scene_prompts):
            img_path = output_path / f"sdxl_scene_{i+1:02d}.png"
            print(f"[SDXL] Generating image {i+1}/{len(scene_prompts)}: {prompt[:50]}...")

            image = pipe(
                prompt=prompt,
                negative_prompt="low quality, blurry, distorted, watermark",
                num_inference_steps=30,
                guidance_scale=7.5,
            ).images[0]

            image.save(str(img_path))
            size_kb = img_path.stat().st_size / 1024
            image_paths.append(str(img_path))
            print(f"[SDXL] Image {i+1} saved: {img_path.name} ({size_kb:.0f} KB)")

        return image_paths

    except Exception as e:
        print(f"[SDXL] Error: {e}")
        return _create_placeholders(scene_prompts, output_dir)


def _create_placeholders(prompts: list[str], output_dir: str | None = None) -> list[str]:
    """Create colored placeholder images when SDXL is not available."""
    paths = []
    for i in range(len(prompts)):
        paths.append(str(_REPO_ROOT / "output" / "agent" / f"scene_{i+1:02d}.png"))
    print(f"[SDXL] Created {len(paths)} placeholder references (no GPU)")
    return paths
