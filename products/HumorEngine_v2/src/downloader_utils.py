"""
HumorEngine_v2 — Video Downloader Utility
==========================================

Downloads viral videos from TikTok, Douyin, YouTube, Bilibili, etc.
using yt-dlp at low resolution for minimal bandwidth usage.

Dependencies:
    pip install yt-dlp

Usage:
    from src.downloader_utils import download_viral_video
    path = download_viral_video("https://www.youtube.com/watch?v=...")
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Optional

logger = logging.getLogger("downloader_utils")

# ---------------------------------------------------------------------------
# Graceful yt-dlp import
# ---------------------------------------------------------------------------

try:
    import yt_dlp
except ImportError:
    yt_dlp = None  # type: ignore
    logger.warning(
        "yt-dlp not installed. Video downloading will be disabled.\n"
        "  Install it with:  pip install yt-dlp"
    )

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Default download directory relative to project root
_project_root = Path(__file__).resolve().parent.parent
DEFAULT_DOWNLOAD_DIR = _project_root / "data"
os.makedirs(DEFAULT_DOWNLOAD_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Download function
# ---------------------------------------------------------------------------


def download_viral_video(
    video_url: str,
    output_path: Optional[str] = None,
    max_resolution: str = "360p",
) -> str:
    """
    Download a video from *video_url* at low resolution and return the
    local file path.

    Parameters
    ----------
    video_url : str
        URL of the video (TikTok, YouTube, Bilibili, Douyin, etc.).
    output_path : str or None
        Full path for the downloaded file. If ``None``, saves to
        ``data/temp_cache_video.mp4``.
    max_resolution : str
        Maximum resolution to request (default ``"360p"``). Helps keep
        bandwidth low and downloads fast.

    Returns
    -------
    str
        Absolute path to the downloaded MP4 file.

    Raises
    ------
    RuntimeError
        If ``yt-dlp`` is not installed or the download fails.
    """
    if yt_dlp is None:
        raise RuntimeError(
            "yt-dlp is not installed. Run: pip install yt-dlp"
        )

    if output_path is None:
        output_path = str(DEFAULT_DOWNLOAD_DIR / "temp_cache_video.mp4")

    # Remove the file if it already exists to avoid stale cache
    if os.path.exists(output_path):
        os.remove(output_path)

    ydl_opts = {
        "format": f"bestvideo[height<={max_resolution.rstrip('p')}]+bestaudio/best[height<={max_resolution.rstrip('p')}]",
        "outtmpl": output_path,
        "merge_output_format": "mp4",
        "quiet": True,
        "no_warnings": True,
        "extract_flat": False,
        "noprogress": True,
        # Bypass some common restrictions
        "nocheckcertificate": True,
        "ignoreerrors": True,
        "no_color": True,
    }

    logger.info("Downloading %s  ->  %s  (max %s)", video_url, output_path, max_resolution)

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([video_url])
    except Exception as e:
        raise RuntimeError(f"yt-dlp download failed: {e}")

    if not os.path.exists(output_path):
        raise RuntimeError(
            f"Download completed but output file not found at {output_path}"
        )

    file_size_mb = os.path.getsize(output_path) / (1024 * 1024)
    logger.info("Downloaded: %s (%.1f MB)", output_path, file_size_mb)

    return os.path.abspath(output_path)
