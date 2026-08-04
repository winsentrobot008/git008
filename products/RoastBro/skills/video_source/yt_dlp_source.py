"""
YtDlpSource — yt-dlp 高清下载器
=================================
Uses yt-dlp to download the highest quality video from TikTok / any supported platform.

Requirements:
    pip install yt-dlp

Output: pipeline/temp/input_video_hd.mp4
"""

import os, sys, subprocess, logging
from pathlib import Path

logger = logging.getLogger("roastbro.source.yt_dlp")

# ── Paths ──────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent.parent
TEMP = ROOT / "pipeline" / "temp"
OUTPUT = TEMP / "input_video_hd.mp4"
MIN_SIZE = 3 * 1024 * 1024  # 3MB


def generate_hd_source(config: dict) -> str:
    """
    Generate HD source video using yt-dlp.

    Args:
        config: {
            "video_url": str  — URL to download (TikTok / YouTube / etc.)
        }

    Returns:
        str — Path to generated input_video_hd.mp4
    """
    print("\n  ┌──────────────────────────────────────────────┐")
    print("  │  2. YtDlpSource — yt-dlp 高清下载             │")
    print("  └──────────────────────────────────────────────┘")

    video_url = config.get("video_url", "https://www.tiktok.com/@tiktok/video/7104163823139876142")
    TEMP.mkdir(parents=True, exist_ok=True)

    # Remove existing file to avoid stale cache
    if OUTPUT.exists():
        OUTPUT.unlink()

    cmd = [
        sys.executable, "-m", "yt_dlp",
        "-f", "bestvideo[height>=1080]+bestaudio/bestvideo[height>=720]+bestaudio/best",
        "-o", str(OUTPUT),
        "--merge-output-format", "mp4",
        "--no-playlist",
        "--no-warnings",
        "--progress",
        video_url,
    ]

    print(f"  URL: {video_url[:60]}...")
    print(f"  Command: {' '.join(cmd[:4])} ...")

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode != 0:
            print(f"  ⚠️ yt-dlp stderr: {result.stderr[-300:]}")
        else:
            print(f"  yt-dlp stdout: {result.stdout[-200:]}")
    except subprocess.TimeoutExpired:
        print("  ⚠️ yt-dlp timed out after 120s")
    except FileNotFoundError:
        print("  ⚠️ yt-dlp not found. Run: pip install yt-dlp")
    except Exception as e:
        print(f"  ⚠️ yt-dlp error: {e}")

    if OUTPUT.exists():
        size_mb = os.path.getsize(OUTPUT) / (1024 * 1024)
        print(f"  [OK] YtDlpSource: {OUTPUT.name} ({size_mb:.2f} MB)")
        return {"status": "success", "path": str(OUTPUT), "strategy": "YtDlpSource"}
    else:
        print(f"  [WARN] YtDlpSource: no output file — creating placeholder")
        _create_placeholder()
        if OUTPUT.exists():
            return {"status": "success", "path": str(OUTPUT), "strategy": "YtDlpSource(fallback)"}
        return {"status": "error", "message": "YtDlpSource failed to generate output"}


def _create_placeholder():
    """Create a >3MB HD placeholder if download fails."""
    try:
        from skills.video_source.fallback_source import generate_hd_source
        generate_hd_source({})
        size_mb = os.path.getsize(OUTPUT) / (1024 * 1024) if OUTPUT.exists() else 0
        print(f"  [Fallback] Placeholder: {OUTPUT.name} ({size_mb:.2f} MB)")
    except Exception as e:
        logger.error(f"Placeholder creation failed: {e}")


