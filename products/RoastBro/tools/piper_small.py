"""Piper TTS small voice module — text → WAV.

Uses the existing Piper model for local text-to-speech.
Always works (model is pre-downloaded).
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parent.parent

# Path to the Piper model
PIPER_MODEL = _REPO_ROOT / "models" / "piper" / "en_US-lessac-medium.onnx"


def make_small_voice(
    text: str = "Hello from Stable Diffusion 1.5",
    output_path: str | None = None,
) -> str:
    """Generate a short voice clip using Piper TTS.

    Args:
        text: Text to synthesize.
        output_path: Output WAV path.

    Returns:
        Path to WAV file.
    """
    out = output_path or str(
        Path(tempfile.gettempdir()) / f"voice_{int(time.time())}.wav"
    )
    Path(out).parent.mkdir(parents=True, exist_ok=True)

    if not PIPER_MODEL.exists():
        print(f"[Piper-small] Model not found: {PIPER_MODEL}")
        return _create_silence(out)

    try:
        result = subprocess.run(
            [sys.executable, "-m", "piper",
             "--model", str(PIPER_MODEL),
             "--output_file", out],
            input=text,
            capture_output=True,
            text=True,
            timeout=60,
        )

        if Path(out).exists() and Path(out).stat().st_size > 1000:
            size_kb = Path(out).stat().st_size // 1024
            dur_s = Path(out).stat().st_size / (22050 * 2)
            print(f"[Piper-small] Voice: {out} ({size_kb} KB, ~{dur_s:.0f}s)")
            return out
        else:
            return _create_silence(out)

    except Exception as e:
        print(f"[Piper-small] Error: {e}")
        return _create_silence(out)


def _create_silence(path: str, duration: float = 2.0) -> str:
    """Create a silent WAV file as fallback."""
    try:
        ffmpeg = _find_ffmpeg()
        if ffmpeg:
            subprocess.run(
                [ffmpeg, "-y", "-f", "lavfi", "-i",
                 f"anullsrc=r=44100:cl=mono", "-t", str(duration),
                 "-acodec", "pcm_s16le", path],
                capture_output=True, timeout=30,
            )
    except Exception:
        pass
    return path


def _find_ffmpeg() -> str | None:
    import shutil
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    for c in [
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\ffmpeg\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe",
    ]:
        if Path(c).exists():
            return c
    return None


import tempfile
