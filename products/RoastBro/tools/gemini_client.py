"""Gemini API client for AI-powered script generation.

Uses Google Gemini 1.5 Flash (free tier) to generate structured video scripts.
Supports up to 60 requests/minute on the free tier.

Usage:
    from tools.gemini_client import GeminiClient
    client = GeminiClient()
    script = client.generate_script("A video about AI")
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


class GeminiError(Exception):
    """Raised when Gemini API returns an error."""


class GeminiClient:
    """Client for Google Gemini 1.5 Flash API.

    Free tier: 60 requests/minute, 1,500 requests/day.
    No API key required for some features, but a key is recommended.
    """

    API_URL = "https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent"

    def __init__(self):
        self.api_key = self._get_api_key()

    def _get_api_key(self) -> str | None:
        """Get Gemini API key from environment or .env file."""
        key = os.environ.get("GEMINI_API_KEY")
        if key:
            return key

        # Check OpenMontage .env
        env_path = _REPO_ROOT / ".env"
        if env_path.exists():
            try:
                for line in open(env_path, encoding="utf-8", errors="ignore"):
                    line = line.strip()
                    if line.startswith("GEMINI_API_KEY="):
                        val = line.split("=", 1)[1].strip().strip("\"'")
                        if val:
                            return val
            except Exception:
                pass
        return None

    def is_available(self) -> bool:
        """Check if Gemini API is configured."""
        return bool(self.api_key)

    def generate_script(self, prompt: str, pipeline: str = "cinematic") -> dict[str, Any] | None:
        """Generate a structured video script using Gemini.

        Args:
            prompt: User's video idea.
            pipeline: Pipeline type (cinematic, documentary-montage, etc).

        Returns:
            Dict with 'scenes' array and 'full_narration', or None on failure.
        """
        if not self.is_available():
            print("[Gemini] GEMINI_API_KEY not configured")
            return None

        scene_structure = {
            "cinematic": ["OPENING", "CONFLICT", "JOURNEY", "CLIMAX", "RESOLUTION"],
            "documentary-montage": ["HOOK", "CONTEXT", "EVIDENCE", "IMPACT", "CONCLUSION"],
            "animated-explainer": ["PROBLEM", "SOLUTION", "HOW_IT_WORKS", "BENEFITS", "CTA"],
        }
        scenes = scene_structure.get(pipeline, scene_structure["cinematic"])

        system_prompt = (
            "You are a professional short-video script writer. "
            "Generate a structured video script as JSON. "
            "Each scene must have: name, narration (1 sentence, under 100 chars), "
            "visual_prompt (detailed image generation prompt), duration_seconds (3-8). "
            "Respond with ONLY valid JSON. No markdown. No code fences."
        )

        user_prompt = (
            f"Write a {len(scenes)}-scene video script for: {prompt}\n"
            f"Scene names: {', '.join(scenes)}\n"
            f"Return JSON with 'scenes' array and 'full_narration' string."
        )

        try:
            import requests

            url = f"{self.API_URL}?key={self.api_key}"
            payload = {
                "contents": [{
                    "parts": [
                        {"text": f"{system_prompt}\n\n{user_prompt}"}
                    ]
                }],
                "generationConfig": {
                    "temperature": 0.8,
                    "maxOutputTokens": 4096,
                }
            }

            print("[Gemini] Calling Gemini API...")
            response = requests.post(url, json=payload, timeout=30)

            if response.status_code == 200:
                data = response.json()
                text = data["candidates"][0]["content"]["parts"][0]["text"].strip()

                # Parse JSON from response
                json_match = re.search(r'\{[\s\S]*\}', text)
                if json_match:
                    script_data = json.loads(json_match.group())
                else:
                    script_data = json.loads(text)

                scenes_data = script_data.get("scenes", [])
                if not scenes_data:
                    print("[Gemini] Empty scenes in response")
                    return None

                result = {
                    "prompt": prompt,
                    "pipeline": pipeline,
                    "scenes": [],
                    "full_narration": script_data.get("full_narration", ""),
                    "source": "gemini",
                }

                for i, scene in enumerate(scenes_data):
                    result["scenes"].append({
                        "id": i + 1,
                        "name": str(scene.get("name", f"Scene {i+1}")),
                        "narration": str(scene.get("narration", "")),
                        "visual_prompt": str(scene.get("visual_prompt", prompt)),
                        "duration_seconds": max(3, min(8, int(scene.get("duration_seconds", 5)))),
                    })

                print(f"[Gemini] Generated {len(result['scenes'])} scenes")
                return result

            else:
                error = response.text[:300]
                if "API_KEY_INVALID" in error:
                    print("[Gemini] Invalid API key")
                elif "QUOTA_EXCEEDED" in error:
                    print("[Gemini] Free tier quota exceeded (1,500 req/day)")
                elif "RATE_LIMIT" in error:
                    print("[Gemini] Rate limited (60 req/min)")
                else:
                    print(f"[Gemini] API error {response.status_code}: {error}")
                return None

        except requests.exceptions.Timeout:
            print("[Gemini] Request timed out")
            return None
        except requests.exceptions.ConnectionError:
            print("[Gemini] Cannot connect to Gemini API")
            return None
        except json.JSONDecodeError as e:
            print(f"[Gemini] JSON parse error: {e}")
            return None
        except Exception as e:
            print(f"[Gemini] Error: {e}")
            return None
