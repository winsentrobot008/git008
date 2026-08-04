"""Flux AI free image generation client.

Uses fal.ai's free tier Flux.1-schnell model (fast, free).
No credit card required — works with free FAL tier.

Falls back gracefully if rate limited or unavailable.
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


def generate_flux_image(
    prompt: str,
    output_path: str | None = None,
    model: str = "fal-ai/flux/schnell",
) -> str | None:
    """Generate an image using Flux via fal.ai.

    Uses FAL_KEY from .env. The free tier provides ~10 free images.
    
    Args:
        prompt: Text description.
        output_path: Save path (.png).
        model: FAL model ID.

    Returns:
        Path to image, or None if unavailable.
    """
    # Read FAL_KEY
    key = os.environ.get("FAL_KEY") or os.environ.get("FAL_AI_API_KEY")
    if not key:
        env_path = _REPO_ROOT / ".env"
        if env_path.exists():
            try:
                for line in open(env_path, encoding="utf-8", errors="ignore"):
                    line = line.strip()
                    if line.startswith("FAL_KEY="):
                        val = line.split("=", 1)[1].strip().strip("\"'")
                        if val and len(val) > 10:
                            key = val
                            break
            except Exception:
                pass

    if not key:
        print("[Flux] No FAL_KEY configured")
        return None

    try:
        import requests
    except ImportError:
        print("[Flux] requests not installed")
        return None

    try:
        print(f"[Flux] Generating image via {model}...")
        
        response = requests.post(
            f"https://fal.run/{model}",
            headers={
                "Authorization": f"Key {key}",
                "Content-Type": "application/json",
            },
            json={"prompt": prompt, "image_size": "square_hd"},
            timeout=30,
        )

        if response.status_code == 200:
            data = response.json()
            url = data.get("images", [{}])[0].get("url", "")
            if not url:
                print("[Flux] No image URL in response")
                return None

            img_resp = requests.get(url, timeout=60)
            if not img_resp.ok:
                return None

            path = output_path or str(
                Path(tempfile.gettempdir()) / f"flux_{int(time.time())}.png"
            )
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            with open(path, "wb") as f:
                f.write(img_resp.content)

            kb = Path(path).stat().st_size / 1024
            print(f"[Flux] Image saved: {path} ({kb:.0f} KB)")
            return path

        elif response.status_code == 403:
            print("[Flux] Rate limited or balance exhausted")
            return None
        else:
            print(f"[Flux] API error: {response.status_code}")
            return None

    except Exception as e:
        print(f"[Flux] Error: {e}")
        return None
