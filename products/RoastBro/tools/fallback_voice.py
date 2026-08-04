"""Fallback voice — Piper TTS. Always works (model pre-downloaded)."""

from __future__ import annotations

import subprocess, sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT = _REPO_ROOT / "output" / "fallback"
PIPER_MODEL = _REPO_ROOT / "models" / "piper" / "en_US-lessac-medium.onnx"


def make_fallback_voice(text: str = "Hello from ViralMint fallback mode") -> str:
    """Generate voice using Piper TTS (or silent fallback)."""
    out = str(OUTPUT / "voice.wav")
    OUTPUT.mkdir(parents=True, exist_ok=True)

    if not PIPER_MODEL.exists():
        _silence(out)
        return out

    try:
        subprocess.run(
            [sys.executable, "-m", "piper", "--model", str(PIPER_MODEL), "--output_file", out],
            input=text, capture_output=True, text=True, timeout=60,
        )
        if Path(out).exists() and Path(out).stat().st_size > 1000:
            print(f"[fallback-voice] {out} ({Path(out).stat().st_size//1024} KB)")
            return out
    except Exception as e:
        print(f"[fallback-voice] Error: {e}")
    _silence(out)
    return out


def _silence(path: str) -> None:
    ffmpeg = _find_ffmpeg()
    if ffmpeg:
        try:
            subprocess.run([ffmpeg, "-y", "-f", "lavfi", "-i",
                           "anullsrc=r=44100:cl=mono", "-t", "2",
                           "-acodec", "pcm_s16le", path],
                          capture_output=True, timeout=30)
        except Exception:
            pass


def _find_ffmpeg() -> str | None:
    import shutil
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    for c in [r"C:\ffmpeg\bin\ffmpeg.exe",
              r"C:\ffmpeg\ffmpeg-master-latest-win64-gpl\bin\ffmpeg.exe"]:
        if Path(c).exists():
            return c
    return None
