"""
FfmpegM3u8Source — FFmpeg m3u8 分片合并
=========================================
Uses FFmpeg to download and merge m3u8 HLS segments into a single mp4 file.

Requirements:
    ffmpeg installed on system PATH

Output: pipeline/temp/input_video_hd.mp4
"""

import os, subprocess, logging
from pathlib import Path

logger = logging.getLogger("roastbro.source.ffmpeg_m3u8")

# ── Paths ──────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent.parent
TEMP = ROOT / "pipeline" / "temp"
OUTPUT = TEMP / "input_video_hd.mp4"
MIN_SIZE = 3 * 1024 * 1024  # 3MB


def _check_ffmpeg() -> bool:
    """Check if ffmpeg is available on the system."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True, text=True, timeout=10
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def generate_hd_source(config: dict) -> str:
    """
    Generate HD source video by merging m3u8 segments with FFmpeg.

    Args:
        config: {
            "m3u8_url": str  — URL to the m3u8 playlist
        }

    Returns:
        str — Path to generated input_video_hd.mp4
    """
    print("\n  ┌──────────────────────────────────────────────┐")
    print("  │  4. FfmpegM3u8Source — m3u8 分片合并         │")
    print("  └──────────────────────────────────────────────┘")

    m3u8_url = config.get("m3u8_url", "")
    if not m3u8_url:
        print("  [WARN] No m3u8_url provided in config. Skipping.")
        return {"status": "error", "message": "No m3u8_url provided"}

    if not _check_ffmpeg():
        print("  [WARN] FFmpeg not found. Please install FFmpeg:")
        print("     https://ffmpeg.org/download.html")
        return {"status": "error", "message": "FFmpeg not found"}

    TEMP.mkdir(parents=True, exist_ok=True)
    if OUTPUT.exists():
        OUTPUT.unlink()

    cmd = [
        "ffmpeg",
        "-i", m3u8_url,
        "-c", "copy",
        "-bsf:a", "aac_adtstoasc",
        "-movflags", "+faststart",
        "-y",
        str(OUTPUT),
    ]

    print(f"  m3u8 URL: {m3u8_url[:80]}...")
    print(f"  Running ffmpeg...")

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=300
        )
        if result.returncode != 0:
            print(f"  ⚠️ ffmpeg stderr: {result.stderr[-300:]}")
        else:
            print(f"  ffmpeg completed")
    except subprocess.TimeoutExpired:
        print("  ⚠️ ffmpeg timed out after 300s")
    except Exception as e:
        print(f"  ⚠️ ffmpeg error: {e}")

    if OUTPUT.exists():
        size_mb = os.path.getsize(OUTPUT) / (1024 * 1024)
        print(f"  [OK] FfmpegM3u8Source: {OUTPUT.name} ({size_mb:.2f} MB)")
        return {"status": "success", "path": str(OUTPUT), "strategy": "FfmpegM3u8Source"}
    else:
        print(f"  [WARN] FfmpegM3u8Source failed")
        return {"status": "error", "message": "FfmpegM3u8Source failed to generate output"}
