"""
MediaIndexerPro v4 — Cloud API Client for Vision Analysis

Security-hardened production client.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔒 ZERO hardcoded credentials — ALL tokens loaded from environment.
  🔒 Supports .env file via python-dotenv for local development.
  🔒 Dual backend: DashScope SDK (public) + OpenAI-compatible HTTP (custom).
  🔒 Humor-Profiling Prompt injected into every vision call.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Backend Selection (automatic):
  1. If DASHSCOPE_API_BASE is set → OpenAI-compatible HTTP mode
     (for custom endpoints like Alibaba Cloud PAI / vLLM / TGI)
  2. If only DASHSCOPE_API_KEY is set → DashScope SDK mode
     (standard public Alibaba Cloud DashScope API)
  3. If only OPENAI_API_KEY is set → Generic OpenAI-compatible mode
  4. Otherwise → CPU local fallback (Pillow + NumPy)

Usage:
    from auto_understanding.cloud_api import CloudAnalyzer

    analyzer = CloudAnalyzer()
    result = analyzer.analyze_image("path/to/image.jpg")
    result = analyzer.analyze_video("path/to/video.mp4")
    print(analyzer.token_usage())
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Optional

# ─── Load .env file if present (local dev convenience, NEVER commit .env) ──
try:
    from dotenv import load_dotenv
    load_dotenv()
    _dotenv_loaded = True
except ImportError:
    _dotenv_loaded = False

logger = logging.getLogger("MediaIndexerPro.CloudAPI")

# ═══════════════════════════════════════════════════════════════════════════════
#  🔒 Configuration — ALL from environment, NO hardcoded secrets
# ═══════════════════════════════════════════════════════════════════════════════

# ─── DashScope (Alibaba Cloud) ──────────────────────────────────────────
DASHSCOPE_API_KEY = os.environ.get("DASHSCOPE_API_KEY", "")
DASHSCOPE_API_BASE = os.environ.get("DASHSCOPE_API_BASE", "")

# ─── Generic OpenAI-compatible fallback ─────────────────────────────────
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_ENDPOINT = os.environ.get("OPENAI_ENDPOINT", "https://api.openai.com/v1")

# ─── Vision model ───────────────────────────────────────────────────────
DEFAULT_VISION_MODEL = os.environ.get("MIP_VISION_MODEL", "qwen-vl-plus")

# ─── HTTP timeout ───────────────────────────────────────────────────────
DEFAULT_TIMEOUT = int(os.environ.get("MIP_CLOUD_TIMEOUT", "60"))

# ─── Hardened Humor-Profiling Prompt ────────────────────────────────────
# Forces strict JSON output with humor_type and visual_hook fields.
# No markdown code blocks — pure JSON only.
HUMOR_PROMPT = (
    'You are a short-form comedy indexer. Analyze this image and return '
    'STRICT JSON ONLY (no markdown, no code blocks). Use exactly this schema:\n'
    '{\n'
    '  "humor": "One concise sentence describing humor/contrast/absurdity (max 15 words)",\n'
    '  "scene": "Scene type (e.g. outdoor_farm, indoor_kitchen, urban_street)",\n'
    '  "emotions": ["emotion1", "emotion2"],\n'
    '  "humor_type": "situational | absurd | contrast | cute | judgmental | wordless",\n'
    '  "visual_hook": "The single most eye-catching element (e.g. chicken staring at camera)",\n'
    '  "objects": ["object1", "object2", "object3"]\n'
    '}\n'
    'If no humor detected, set humor_type to "literal" and describe plainly.'
)

# ─── Optional Dependencies ──────────────────────────────────────────────

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    logger.warning("requests not installed. HTTP cloud API unavailable.")

try:
    from PIL import Image as PILImage
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

try:
    import numpy as np
    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

# DashScope SDK (for public endpoint mode)
try:
    import dashscope
    HAS_DASHSCOPE = True
    _dashscope_version = getattr(dashscope, "version", "unknown")
except ImportError:
    HAS_DASHSCOPE = False


# ═══════════════════════════════════════════════════════════════════════════════
#  CloudAnalyzer — Production Vision Client
# ═══════════════════════════════════════════════════════════════════════════════

class CloudAnalyzer:
    """
    Production cloud vision client with zero hardcoded credentials.

    Backend auto-selection:
      ``dashscope_custom`` → DASHSCOPE_API_BASE + DASHSCOPE_API_KEY (OpenAI-compatible HTTP)
      ``dashscope``        → DASHSCOPE_API_KEY only (DashScope SDK)
      ``openai``           → OPENAI_API_KEY only
      ``fallback``         → no keys found (CPU Pillow + NumPy)
    """

    def __init__(
        self,
        dashscope_api_key: str = DASHSCOPE_API_KEY,
        dashscope_api_base: str = DASHSCOPE_API_BASE,
        openai_api_key: str = OPENAI_API_KEY,
        openai_endpoint: str = OPENAI_ENDPOINT,
        model: str = DEFAULT_VISION_MODEL,
        timeout: int = DEFAULT_TIMEOUT,
    ):
        # ── Credentials (all from env, never hardcoded) ──
        self.dashscope_api_key = dashscope_api_key
        self.dashscope_api_base = dashscope_api_base.rstrip("/")
        self.openai_api_key = openai_api_key
        self.openai_endpoint = openai_endpoint.rstrip("/")
        self.model = model
        self.timeout = timeout
        self._session: Optional[Any] = None

        # Token usage tracking
        self.total_prompt_tokens: int = 0
        self.total_completion_tokens: int = 0
        self.total_api_calls: int = 0

        # ── Auto-select backend ──
        if self.dashscope_api_base and self.dashscope_api_key:
            self.backend = "dashscope_custom"
            logger.info(
                f"Backend: dashscope_custom | "
                f"base={self.dashscope_api_base} | model={self.model}"
            )
        elif HAS_DASHSCOPE and self.dashscope_api_key:
            self.backend = "dashscope"
            dashscope.api_key = self.dashscope_api_key
            logger.info(
                f"Backend: dashscope (SDK) | "
                f"model={self.model}"
            )
        elif HAS_REQUESTS and self.openai_api_key:
            self.backend = "openai"
            logger.info(
                f"Backend: openai | "
                f"endpoint={self.openai_endpoint} | model={self.model}"
            )
        else:
            self.backend = "fallback"
            logger.info(
                f"Backend: fallback (CPU) | "
                f"No API keys found — using Pillow + NumPy"
            )

    @property
    def _http(self) -> Any:
        """Lazy-initialized requests session."""
        if self._session is None and HAS_REQUESTS:
            import requests
            self._session = requests.Session()
            self._session.timeout = self.timeout
        return self._session

    def token_usage(self) -> dict[str, int]:
        """Return accumulated token usage stats."""
        return {
            "total_api_calls": self.total_api_calls,
            "total_prompt_tokens": self.total_prompt_tokens,
            "total_completion_tokens": self.total_completion_tokens,
            "total_tokens": self.total_prompt_tokens + self.total_completion_tokens,
        }

    # ─── Public API ─────────────────────────────────────────────────────

    def analyze_image(self, path: str) -> dict[str, Any]:
        """Analyze an image via cloud API (or CPU fallback)."""
        if not os.path.isfile(path):
            logger.error(f"Image not found: {path}")
            return {"error": "file not found"}

        logger.info(f"Analyze image [{self.backend}]: {Path(path).name}")

        result = None
        if self.backend == "dashscope_custom":
            result = self._call_openai_like_image(path)
        elif self.backend == "dashscope":
            result = self._call_dashscope_image(path)
        elif self.backend == "openai":
            result = self._call_openai_like_image(path)

        if result and "error" not in result:
            return result

        logger.info("Falling back to local CPU analysis")
        return self._analyze_image_fallback(path)

    def analyze_video(self, path: str) -> dict[str, Any]:
        """Analyze a video via cloud API (or CPU fallback)."""
        if not os.path.isfile(path):
            logger.error(f"Video not found: {path}")
            return {"error": "file not found"}

        logger.info(f"Analyze video [{self.backend}]: {Path(path).name}")
        duration = self._get_duration(path)

        result = None
        if self.backend in ("dashscope_custom", "openai"):
            result = self._call_cloud_video_openai(path)
        elif self.backend == "dashscope":
            result = self._call_cloud_video_dashscope(path)

        if result and "error" not in result:
            result["duration"] = duration
            return result

        logger.info("Falling back to local video analysis")
        return self._analyze_video_fallback(path, duration)

    # ══════════════════════════════════════════════════════════════════════
    #  Backend 1: OpenAI-Compatible HTTP Bridge (used by dashscope_custom
    #             and openai modes)
    # ══════════════════════════════════════════════════════════════════════

    def _get_openai_headers(self) -> dict[str, str]:
        """Build auth headers for the active backend."""
        if self.backend == "dashscope_custom":
            api_key = self.dashscope_api_key
        else:
            api_key = self.openai_api_key
        return {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def _get_openai_base(self) -> str:
        """Get the OpenAI-compatible base URL."""
        if self.backend == "dashscope_custom":
            return self.dashscope_api_base
        return self.openai_endpoint

    @staticmethod
    def _downscale_image(path: str, max_pixels: int = 512) -> Optional[str]:
        """
        CPU pre-processing: downscale image to max_pixels on the longest edge
        before uploading to cloud API. Saves tokens by reducing image size.

        Args:
            path: Path to source image.
            max_pixels: Maximum width or height in pixels.

        Returns:
            Path to downscaled image (same as input if already small enough),
            or None on failure.
        """
        if not HAS_PIL:
            return path

        try:
            img = PILImage.open(path)
            w, h = img.size

            # Only downscale if larger than threshold
            if max(w, h) <= max_pixels:
                return path  # Already small enough

            # Calculate new size maintaining aspect ratio
            if w > h:
                new_w = max_pixels
                new_h = int(h * max_pixels / w)
            else:
                new_h = max_pixels
                new_w = int(w * max_pixels / h)

            # Downscale with LANCZOS for quality
            img = img.resize((new_w, new_h), PILImage.LANCZOS)

            # Save to temp file
            import tempfile
            tmp_fd, tmp_path = tempfile.mkstemp(suffix=".jpg", prefix="mip_ds_")
            os.close(tmp_fd)
            img.save(tmp_path, "JPEG", quality=85)

            original_kb = os.path.getsize(path) // 1024
            new_kb = os.path.getsize(tmp_path) // 1024
            logger.info(
                f"  Downscale: {w}x{h} → {new_w}x{new_h} "
                f"({original_kb}KB → {new_kb}KB)"
            )
            return tmp_path

        except Exception as e:
            logger.debug(f"  Downscale failed: {e}")
            return path

    def _call_openai_like_image(self, path: str) -> Optional[dict[str, Any]]:
        """
        Send image to an OpenAI-compatible vision API endpoint.

        Works with:
          - Custom DashScope Model Studio (PAI) endpoints
          - Standard OpenAI API
          - Any OpenAI-compatible proxy (vLLM, TGI, etc.)

        Pre-processes: CPU downscale to max 512px → saves tokens.
        """
        if not self._http:
            return None

        try:
            # CPU downscale before upload
            processed_path = self._downscale_image(path)

            with open(processed_path, "rb") as f:
                encoded = base64.b64encode(f.read()).decode("utf-8")

            # Clean up temp downscaled file if different from original
            if processed_path != path:
                try:
                    os.remove(processed_path)
                except Exception:
                    pass

            ext = Path(path).suffix.lower().lstrip(".") or "jpeg"
            if ext == "jpg":
                ext = "jpeg"
            data_url = f"data:image/{ext};base64,{encoded}"

            payload = {
                "model": self.model,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": data_url}},
                            {"type": "text", "text": HUMOR_PROMPT},
                        ],
                    }
                ],
                "max_tokens": 256,
            }

            base = self._get_openai_base()
            url = f"{base}/chat/completions"

            start = time.time()
            resp = self._http.post(
                url,
                json=payload,
                headers=self._get_openai_headers(),
                timeout=self.timeout,
            )
            elapsed = time.time() - start
            resp.raise_for_status()

            self.total_api_calls += 1
            data = resp.json()

            usage = data.get("usage", {})
            self.total_prompt_tokens += usage.get("prompt_tokens", 0)
            self.total_completion_tokens += usage.get("completion_tokens", 0)

            text = (
                data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )

            parsed = self._parse_humor_json(text)
            if parsed:
                logger.info(
                    f"  OK ({self.backend}) | {elapsed:.1f}s | "
                    f"tokens={usage.get('prompt_tokens',0)}in/"
                    f"{usage.get('completion_tokens',0)}out | "
                    f"humor='{parsed.get('humor','')[:40]}...'"
                )
                return parsed

            return {
                "description": text[:300],
                "humor": text[:200],
                "scene": "unknown",
                "objects": [],
                "emotions": [],
                "colors": [],
            }

        except Exception as e:
            logger.warning(f"  API error ({self.backend}): {e}")
            return None

    # ══════════════════════════════════════════════════════════════════════
    #  Backend 2: DashScope SDK (public Alibaba Cloud API)
    # ══════════════════════════════════════════════════════════════════════

    def _call_dashscope_image(self, path: str) -> Optional[dict[str, Any]]:
        """Analyze image via DashScope MultiModalConversation SDK."""
        if not HAS_DASHSCOPE:
            return None

        try:
            with open(path, "rb") as f:
                image_data = base64.b64encode(f.read()).decode("utf-8")

            image_url = f"data:image/jpeg;base64,{image_data}"

            messages = [
                {
                    "role": "user",
                    "content": [
                        {"image": image_url},
                        {"text": HUMOR_PROMPT},
                    ],
                }
            ]

            start = time.time()
            response = dashscope.MultiModalConversation.call(
                model=self.model,
                messages=messages,
                timeout=self.timeout,
            )
            elapsed = time.time() - start

            self.total_api_calls += 1

            if response.status_code == 200:
                output = response.output
                usage = response.get("usage", {})
                self.total_prompt_tokens += usage.get("input_tokens", 0)
                self.total_completion_tokens += usage.get("output_tokens", 0)

                choices = output.get("choices", [])
                if choices:
                    text = choices[0].get("message", {}).get("content", "")
                    if isinstance(text, list):
                        text = " ".join(
                            t.get("text", "") for t in text if t.get("text")
                        )

                    parsed = self._parse_humor_json(text)
                    if parsed:
                        logger.info(
                            f"  OK (dashscope) | {elapsed:.1f}s | "
                            f"tokens={usage.get('input_tokens',0)}in/"
                            f"{usage.get('output_tokens',0)}out | "
                            f"humor='{parsed.get('humor','')[:40]}...'"
                        )
                        return parsed

                return {
                    "description": text if choices else str(output)[:300],
                    "humor": "",
                    "scene": "unknown",
                    "objects": [],
                    "emotions": [],
                    "colors": [],
                }
            else:
                logger.warning(
                    f"  DashScope error [{response.status_code}]: "
                    f"{response.message}"
                )
                return {"error": f"DashScope API error: {response.message}"}

        except Exception as e:
            logger.warning(f"  DashScope call failed: {e}")
            return None

    # ══════════════════════════════════════════════════════════════════════
    #  Video Analysis — Keyframe extraction + API dispatch
    # ══════════════════════════════════════════════════════════════════════

    def _call_cloud_video_openai(self, path: str) -> Optional[dict[str, Any]]:
        """Extract keyframe, send to OpenAI-compatible vision API."""
        keyframe_path = self._extract_single_keyframe(path)
        if not keyframe_path:
            logger.warning("  Could not extract keyframe")
            return None
        try:
            return self._call_openai_like_image(keyframe_path)
        finally:
            self._cleanup_keyframe(keyframe_path)

    def _call_cloud_video_dashscope(self, path: str) -> Optional[dict[str, Any]]:
        """Extract keyframe, send to DashScope vision API."""
        keyframe_path = self._extract_single_keyframe(path)
        if not keyframe_path:
            logger.warning("  Could not extract keyframe")
            return None
        try:
            return self._call_dashscope_image(keyframe_path)
        finally:
            self._cleanup_keyframe(keyframe_path)

    @staticmethod
    def _cleanup_keyframe(path: str) -> None:
        """Remove temporary keyframe file and its parent directory."""
        try:
            if os.path.isfile(path):
                os.remove(path)
            parent = os.path.dirname(path)
            if os.path.isdir(parent):
                os.rmdir(parent)
        except Exception:
            pass

    # ══════════════════════════════════════════════════════════════════════
    #  Response Parser
    # ══════════════════════════════════════════════════════════════════════

    @staticmethod
    def _parse_humor_json(text: str) -> Optional[dict[str, Any]]:
        """
        Extract structured JSON from model response.

        Expected: {"humor": "...", "scene": "...", "objects": [...], "emotions": [...]}
        """
        import re

        patterns = [
            r"```(?:json)?\s*(\{.*?\})\s*```",
            r'(\{[\s\S]*"humor"[\s\S]*\})',
            r'(\{[\s\S]*"scene"[\s\S]*\})',
            r"(\{.*\})",
        ]

        for pattern in patterns:
            match = re.search(pattern, text, re.DOTALL)
            if match:
                candidate = match.group(1)
                try:
                    data = json.loads(candidate)
                    return {
                        "description": data.get("humor", data.get("description", text[:200])),
                        "humor": data.get("humor", ""),
                        "scene": data.get("scene", "unknown"),
                        "objects": data.get("objects", []),
                        "emotions": data.get("emotions", []),
                        "colors": [],
                    }
                except json.JSONDecodeError:
                    continue

        return {
            "description": text[:300],
            "humor": text[:200],
            "scene": "unknown",
            "objects": [],
            "emotions": [],
            "colors": [],
        }

    # ══════════════════════════════════════════════════════════════════════
    #  CPU Fallback — Pillow + NumPy (no API key needed)
    # ══════════════════════════════════════════════════════════════════════

    @staticmethod
    def _analyze_image_fallback(path: str) -> dict[str, Any]:
        """CPU-only image analysis using Pillow statistics."""
        if not HAS_PIL:
            return {
                "description": "Image file (no analysis available)",
                "humor": "",
                "objects": ["image"],
                "emotions": ["neutral"],
                "scene": "unknown",
                "colors": ["#808080"],
            }
        try:
            img = PILImage.open(path).convert("RGB")
            width, height = img.size
            colors = CloudAnalyzer._extract_colors(path)

            if HAS_NUMPY:
                img_array = np.array(img)
                brightness = float(np.mean(img_array))
                std_dev = float(np.std(img_array))

                if brightness > 200:
                    scene = "outdoor_bright"
                    emotion = "bright"
                elif brightness > 150:
                    scene = "outdoor"
                    emotion = "neutral"
                elif brightness > 80:
                    scene = "indoor"
                    emotion = "dim"
                else:
                    scene = "indoor_dark"
                    emotion = "dark"

                if std_dev < 30:
                    scene = "solid_color"

                description = (
                    f"A {width}x{height} image, "
                    f"{'bright' if brightness > 150 else 'dim'} tone, "
                    f"{'high' if std_dev > 60 else 'low'} contrast"
                )
            else:
                scene = "unknown"
                emotion = "neutral"
                description = f"A {width}x{height} image"

            return {
                "description": description,
                "humor": "",
                "objects": ["image"],
                "emotions": [emotion],
                "scene": scene,
                "colors": colors,
            }
        except Exception as e:
            logger.warning(f"Fallback image analysis failed: {e}")
            return {
                "description": "Unable to analyze image",
                "humor": "",
                "objects": ["image"],
                "emotions": ["neutral"],
                "scene": "unknown",
                "colors": ["#808080"],
            }

    @staticmethod
    def _analyze_video_fallback(path: str, duration: Optional[float]) -> dict[str, Any]:
        """CPU-only video analysis — basic metadata."""
        return {
            "description": f"Video file ({Path(path).name})",
            "humor": "",
            "objects": [],
            "actions": [],
            "emotions": ["neutral"],
            "scenes": ["unknown"],
            "duration": duration,
        }

    # ══════════════════════════════════════════════════════════════════════
    #  Utilities
    # ══════════════════════════════════════════════════════════════════════

    @staticmethod
    def _get_duration(path: str) -> Optional[float]:
        """Get video duration via ffprobe."""
        import subprocess
        try:
            result = subprocess.run(
                ["ffprobe", "-v", "error",
                 "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", path],
                capture_output=True, text=True, timeout=15,
            )
            if result.returncode == 0 and result.stdout.strip():
                return float(result.stdout.strip())
        except Exception as e:
            logger.debug(f"ffprobe duration failed: {e}")
        return None

    @staticmethod
    def _extract_single_keyframe(path: str) -> Optional[str]:
        """Extract a single keyframe via ffmpeg (lightweight, no OpenCV)."""
        import subprocess
        import tempfile

        tmp_dir = tempfile.mkdtemp(prefix="mip_kf_")
        out_path = os.path.join(tmp_dir, "keyframe.jpg")

        try:
            subprocess.run(
                ["ffmpeg", "-y", "-ss", "1", "-i", path,
                 "-vframes", "1", "-q:v", "2", out_path],
                capture_output=True, timeout=30,
            )
            if os.path.isfile(out_path) and os.path.getsize(out_path) > 0:
                return out_path
            try:
                os.rmdir(tmp_dir)
            except Exception:
                pass
            return None
        except Exception as e:
            logger.debug(f"Keyframe extraction failed: {e}")
            try:
                os.rmdir(tmp_dir)
            except Exception:
                pass
            return None

    @staticmethod
    def _extract_colors(path: str, count: int = 5) -> list[str]:
        """Extract dominant colors using Pillow (CPU only)."""
        if not HAS_PIL or not HAS_NUMPY:
            return ["#808080"]
        try:
            img = PILImage.open(path).convert("RGB")
            img_array = np.array(img)
            h, w, _ = img_array.shape
            cells_h = max(1, int(np.sqrt(count)))
            cells_w = max(1, count // cells_h)
            colors: list[str] = []
            for i in range(cells_h):
                for j in range(cells_w):
                    y_start = int(i * h / cells_h)
                    y_end = int((i + 1) * h / cells_h)
                    x_start = int(j * w / cells_w)
                    x_end = int((j + 1) * w / cells_w)
                    region = img_array[y_start:y_end, x_start:x_end, :]
                    avg_color = region.mean(axis=(0, 1)).astype(int)
                    colors.append(f"#{avg_color[0]:02X}{avg_color[1]:02X}{avg_color[2]:02X}")
            return colors[:count]
        except Exception as e:
            logger.debug(f"Color extraction failed: {e}")
            return ["#808080"]
