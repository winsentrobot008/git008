"""Seedance 2.0 API client for AI video generation.

Generates complete videos from text prompts via Seedance's cloud API.
Returns a video URL or None if unavailable.

API endpoint: POST https://api.seedance.ai/v2/generate
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


class SeedanceError(Exception):
    """Raised when Seedance API returns an error."""


def seedance_generate_video(
    prompt: str,
    duration: int = 15,
    voice: bool = True,
    style: str = "cinematic",
    output_path: str | None = None,
) -> str | None:
    """Generate a video via Seedance 2.0 API.

    Args:
        prompt: Text description of the video to generate.
        duration: Target video duration in seconds.
        voice: Whether to generate voiceover.
        style: Visual style (cinematic, anime, realistic, etc.).
        output_path: Path to save the downloaded video.

    Returns:
        Local path to the generated video, or None on failure.
    """
    import requests

    api_key = os.environ.get("SEEDANCE_API_KEY")
    if not api_key:
        # Check .env file
        env_path = _REPO_ROOT / ".env"
        if env_path.exists():
            try:
                for line in open(env_path, encoding="utf-8", errors="ignore"):
                    if line.startswith("SEEDANCE_API_KEY="):
                        api_key = line.split("=", 1)[1].strip().strip("\"'")
                        break
            except Exception:
                pass

    if not api_key:
        print("[Seedance] SEEDANCE_API_KEY not configured")
        return None

    api_url = os.environ.get("SEEDANCE_API_URL", "https://api.seedance.ai/v2/generate")

    try:
        print(f"[Seedance] Generating video: prompt='{prompt[:60]}...' duration={duration}s")

        response = requests.post(
            api_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "prompt": prompt,
                "duration": duration,
                "voice": voice,
                "style": style,
            },
            timeout=120,
        )

        if response.status_code == 200:
            data = response.json()
            video_url = data.get("video_url") or data.get("url") or data.get("data", {}).get("url")

            if not video_url:
                print("[Seedance] No video URL in response")
                return None

            # Download the video
            print(f"[Seedance] Downloading video from {video_url[:80]}...")
            video_resp = requests.get(video_url, timeout=120)
            if not video_resp.ok:
                print(f"[Seedance] Download failed: {video_resp.status_code}")
                return None

            # Save to output path
            save_path = output_path or str(
                Path(tempfile.gettempdir()) / f"seedance_{abs(hash(prompt)) % 100000}.mp4"
            )
            Path(save_path).parent.mkdir(parents=True, exist_ok=True)
            with open(save_path, "wb") as f:
                f.write(video_resp.content)

            size_mb = Path(save_path).stat().st_size / (1024 * 1024)
            print(f"[Seedance] Video saved: {save_path} ({size_mb:.1f} MB)")
            return save_path

        elif response.status_code == 402:
            print("[Seedance] Payment required — free tier exhausted")
            return None
        elif response.status_code == 429:
            print("[Seedance] Rate limited — too many requests")
            return None
        elif response.status_code in (403, 401):
            print("[Seedance] Authentication failed — check SEEDANCE_API_KEY")
            return None
        else:
            print(f"[Seedance] API error {response.status_code}: {response.text[:200]}")
            return None

    except requests.exceptions.Timeout:
        print("[Seedance] Request timed out (120s)")
        return None
    except requests.exceptions.ConnectionError:
        print("[Seedance] Cannot connect to Seedance API")
        return None
    except Exception as e:
        print(f"[Seedance] Error: {e}")
        return None
