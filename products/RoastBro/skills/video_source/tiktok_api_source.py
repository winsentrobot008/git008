"""
TikTokApiSource — TikTokApi.video().bytes() 高清抓取
=====================================================
Uses the unofficial TikTokApi library to download real HD video
directly via TikTok's internal API.

Requirements:
    pip install TikTokApi playwright
    playwright install chromium

Output: pipeline/temp/input_video_hd.mp4
"""

import os, sys, asyncio, logging
from pathlib import Path

logger = logging.getLogger("roastbro.source.tiktok_api")

# ── Paths ──────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent.parent
TEMP = ROOT / "pipeline" / "temp"
OUTPUT = TEMP / "input_video_hd.mp4"
MIN_SIZE = 3 * 1024 * 1024  # 3MB


async def _download_with_tiktokapi(video_url: str) -> bool:
    """
    Download video using TikTokApi.
    Falls back gracefully if the API key is missing or rate-limited.
    """
    try:
        from TikTokApi import TikTokApi

        # NOTE: TikTokApi requires ms_token for authenticated access.
        # Provide via config or env var TIKTOK_MS_TOKEN.
        ms_token = os.environ.get("TIKTOK_MS_TOKEN", "")

        async with TikTokApi() as api:
            await api.create_sessions(ms_tokens=[ms_token], num_sessions=1, sleep_after=3)

            # Extract video_id from URL
            video_id = None
            if "/video/" in video_url:
                video_id = video_url.split("/video/")[-1].split("?")[0]
            elif len(video_url) == 19 and video_url.isdigit():
                video_id = video_url

            if not video_id:
                logger.warning("Could not extract video_id from URL")
                return False

            logger.info(f"Fetching video info for {video_id}...")
            video = api.video(data={"video_id": video_id})

            # Get video bytes
            video_bytes = await video.bytes()
            if not video_bytes or len(video_bytes) < MIN_SIZE:
                logger.warning(f"Video too small: {len(video_bytes) if video_bytes else 0} bytes")
                return False

            TEMP.mkdir(parents=True, exist_ok=True)
            with open(OUTPUT, "wb") as f:
                f.write(video_bytes)

            size_mb = os.path.getsize(OUTPUT) / (1024 * 1024)
            logger.info(f"Downloaded {size_mb:.2f} MB via TikTokApi")
            return size_mb >= 3

    except ImportError:
        logger.error("TikTokApi not installed. Run: pip install TikTokApi")
    except Exception as e:
        logger.error(f"TikTokApi error: {e}")

    return False


def generate_hd_source(config: dict) -> str:
    """
    Generate HD source video using TikTokApi.

    Args:
        config: {
            "video_url": str  — TikTok video URL or ID (optional, uses default if missing)
        }

    Returns:
        str — Path to generated input_video_hd.mp4
    """
    print("\n  ┌──────────────────────────────────────────────┐")
    print("  │  1. TikTokApiSource — 高清 API 抓取           │")
    print("  └──────────────────────────────────────────────┘")

    video_url = config.get("video_url", "https://www.tiktok.com/@tiktok/video/7104163823139876142")

    success = asyncio.run(_download_with_tiktokapi(video_url))

    if success and OUTPUT.exists():
        size_mb = os.path.getsize(OUTPUT) / (1024 * 1024)
        print(f"  [OK] TikTokApiSource: {OUTPUT.name} ({size_mb:.2f} MB)")
        return {"status": "success", "path": str(OUTPUT), "strategy": "TikTokApiSource"}
    else:
        print(f"  [WARN] TikTokApiSource failed")
        return {"status": "error", "message": "TikTokApiSource failed to generate output"}
