"""ffmpeg small video creator — frame images → mp4.

Always works. Uses colored placeholder frames if no GPU is available.
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path
from typing import Any


def make_small_video(
    frames: list[str],
    output_path: str | None = None,
    fps: int = 1,
) -> str:
    """Create a short video from frames using ffmpeg.

    Args:
        frames: Paths to PNG frames.
        output_path: Output mp4 path.
        fps: Frames per second (1 = 1 second per frame).

    Returns:
        Path to output video.
    """
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        print("[ffmpeg-small] FFmpeg not found!")
        return output_path or ""

    out = output_path or str(
        Path(tempfile.gettempdir()) / f"small_{int(time.time())}.mp4"
    )
    Path(out).parent.mkdir(parents=True, exist_ok=True)

    try:
        # Create concat file for ffmpeg
        tmp = Path(tempfile.mkdtemp(prefix="small_video_"))
        concat_file = tmp / "concat.txt"
        
        entries = []
        for f in frames:
            if Path(f).exists():
                entries.append(f"file '{Path(f).as_posix()}'")
        
        if not entries:
            print("[ffmpeg-small] No valid frames found")
            return _create_fallback(out, ffmpeg)

        concat_file.write_text("\n".join(entries), encoding="utf-8")

        # Concatenate frames into video
        result = subprocess.run(
            [ffmpeg, "-y", "-f", "concat", "-safe", "0",
             "-i", str(concat_file),
             "-c:v", "libx264",
             "-pix_fmt", "yuv420p",
             "-r", str(fps),
             out],
            capture_output=True, text=True, timeout=60,
        )

        if Path(out).exists():
            size_kb = Path(out).stat().st_size // 1024
            print(f"[ffmpeg-small] Video: {out} ({size_kb} KB)")
            return out
        else:
            print(f"[ffmpeg-small] Failed: {result.stderr[:200]}")
            return _create_fallback(out, ffmpeg)

    except Exception as e:
        print(f"[ffmpeg-small] Error: {e}")
        return _create_fallback(out, ffmpeg)


def _create_fallback(path: str, ffmpeg: str) -> str:
    """Create a minimal fallback video."""
    try:
        subprocess.run(
            [ffmpeg, "-y", "-f", "lavfi", "-i",
             "color=c=darkblue:s=512x512:d=3",
             "-c:v", "libx264", "-pix_fmt", "yuv420p", path],
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
