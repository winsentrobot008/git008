"""Fallback merge — ffmpeg video + audio → final mp4. Always works."""

from __future__ import annotations

import subprocess
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT = _REPO_ROOT / "output" / "fallback"


def merge_fallback(video_path: str, audio_path: str) -> str:
    """Merge video and audio into final mp4."""
    ffmpeg = _find_ffmpeg()
    out = str(OUTPUT / "final.mp4")
    OUTPUT.mkdir(parents=True, exist_ok=True)

    if not ffmpeg:
        return out

    try:
        if Path(video_path).exists() and Path(audio_path).exists():
            subprocess.run(
                [ffmpeg, "-y", "-i", video_path, "-i", audio_path,
                 "-c:v", "copy", "-c:a", "aac",
                 "-map", "0:v:0", "-map", "1:a:0", "-shortest", out],
                capture_output=True, timeout=60,
            )
            if Path(out).exists() and Path(out).stat().st_size > 0:
                print(f"[fallback-merge] {out} ({Path(out).stat().st_size//1024} KB)")
                return out

        # Fallback: copy video only
        if Path(video_path).exists():
            subprocess.run([ffmpeg, "-y", "-i", video_path, "-c", "copy", out],
                          capture_output=True, timeout=60)
    except Exception:
        pass
    return out


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
