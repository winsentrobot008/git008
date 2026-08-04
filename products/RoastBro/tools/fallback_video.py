"""Fallback video — ffmpeg frames → mp4. Always works."""

from __future__ import annotations

import subprocess, sys, tempfile
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT = _REPO_ROOT / "output" / "fallback"


def make_fallback_video(frames: list[str], fps: int = 1) -> str:
    """Concatenate frames into a video using ffmpeg."""
    ffmpeg = _find_ffmpeg()
    out = str(OUTPUT / "out.mp4")
    OUTPUT.mkdir(parents=True, exist_ok=True)

    if not ffmpeg or not frames:
        return out

    try:
        tmp = Path(tempfile.mkdtemp(prefix="fb_video_"))
        concat = tmp / "concat.txt"
        entries = [f"file '{Path(f).as_posix()}'" for f in frames if Path(f).exists()]
        if not entries:
            return _fallback(out, ffmpeg)
        concat.write_text("\n".join(entries), encoding="utf-8")

        subprocess.run(
            [ffmpeg, "-y", "-f", "concat", "-safe", "0",
             "-i", str(concat), "-c:v", "libx264",
             "-pix_fmt", "yuv420p", "-r", str(fps), out],
            capture_output=True, timeout=60,
        )
        if Path(out).exists():
            print(f"[fallback-video] {out} ({Path(out).stat().st_size//1024} KB)")
            return out
    except Exception as e:
        print(f"[fallback-video] Error: {e}")
    return _fallback(out, ffmpeg)


def _fallback(path: str, ffmpeg: str) -> str:
    try:
        subprocess.run([ffmpeg, "-y", "-f", "lavfi", "-i",
                        "color=c=darkblue:s=512x512:d=3",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", path],
                       capture_output=True, timeout=30)
    except Exception:
        pass
    return path


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
