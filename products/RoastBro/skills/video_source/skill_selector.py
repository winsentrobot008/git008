"""
Skill Selector — 高清素材来源策略选择器
========================================
Console-based menu for selecting which HD source strategy to use.
Supports ZOO default strategy override via config file.

Available strategies:
    1. TikTokApiSource     — TikTokApi.video().bytes()
    2. YtDlpSource         — yt-dlp high-quality downloader
    3. SeleniumMobileSource — Selenium + Mobile UA
    4. FfmpegM3u8Source    — FFmpeg m3u8 merge
    5. PlaywrightSource    — Existing Playwright scraper
    6. FallbackSource      — moviepy placeholder (last resort)
"""

import os, sys, json, logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger("roastbro.skill_selector")

# ── Paths ──────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent.parent
TEMP = ROOT / "pipeline" / "temp"
ZOO_CONFIG_PATH = ROOT / "configs" / "zoo_source_strategy.json"
META_DIR = ROOT / "pipeline" / "temp"
os.makedirs(TEMP, exist_ok=True)
os.makedirs(ROOT / "configs", exist_ok=True)

# ── Strategy Registry ──────────────────────────────────
STRATEGIES = [
    {
        "id": "tiktok_api",
        "name": "TikTokApi 高清抓取",
        "module": "skills.video_source.tiktok_api_source",
        "description": "使用 TikTokApi 库直接下载真实高清视频",
        "pros": "真实高清源，API 直连",
        "cons": "需要 ms_token，有速率限制",
    },
    {
        "id": "yt_dlp",
        "name": "yt-dlp 高清下载",
        "module": "skills.video_source.yt_dlp_source",
        "description": "使用 yt-dlp 下载最高质量视频",
        "pros": "支持多平台，质量最高",
        "cons": "依赖外部工具，可能被反爬",
    },
    {
        "id": "selenium_mobile",
        "name": "Selenium + Mobile UA 抓取",
        "module": "skills.video_source.selenium_mobile_source",
        "description": "使用 Selenium + 手机 UA 抓取真实视频链接",
        "pros": "模拟手机端，兼容性好",
        "cons": "速度较慢，需要 ChromeDriver",
    },
    {
        "id": "ffmpeg_m3u8",
        "name": "FFmpeg m3u8 分片合并",
        "module": "skills.video_source.ffmpeg_m3u8_source",
        "description": "使用 FFmpeg 合并 m3u8 分片为完整视频",
        "pros": "适合流媒体视频",
        "cons": "需要 m3u8 链接，依赖 FFmpeg",
    },
    {
        "id": "playwright",
        "name": "Playwright 抓取（现有）",
        "module": "skills.video_source.playwright_source",
        "description": "使用 Playwright 解析页面 JSON 提取 downloadAddr",
        "pros": "现有逻辑，稳定可靠",
        "cons": "速度较慢，依赖 Playwright",
    },
    {
        "id": "fallback",
        "name": "moviepy 高清占位源（Fallback）",
        "module": "skills.video_source.fallback_source",
        "description": "使用 moviepy 生成 1080p 占位视频（最终保底）",
        "pros": "零依赖网络，保证可用",
        "cons": "非真实视频内容",
    },
]


def get_zoo_default_strategy() -> Optional[str]:
    """
    Check if ZOO has set a default strategy in configs/zoo_source_strategy.json.
    Returns strategy ID or None.
    """
    try:
        if ZOO_CONFIG_PATH.exists():
            with open(ZOO_CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                strategy = data.get("default_strategy", "")
                if strategy and any(s["id"] == strategy for s in STRATEGIES):
                    return strategy
    except Exception as e:
        logger.debug(f"Failed to read ZOO config: {e}")
    return None


def set_zoo_default_strategy(strategy_id: str):
    """Set the default strategy in ZOO config file."""
    try:
        ZOO_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(ZOO_CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump({"default_strategy": strategy_id}, f, indent=2, ensure_ascii=False)
        print(f"  ✅ ZOO default strategy set to: {strategy_id}")
    except Exception as e:
        print(f"  ⚠️ Failed to save ZOO config: {e}")


def show_console_menu() -> int:
    """
    Display the interactive console menu and return the user's choice (1-6).
    """
    print()
    print("=" * 60)
    print("  [RoastBro HD Source Selector]")
    print("  请选择高清素材来源（输入数字）：")
    print("=" * 60)
    for i, s in enumerate(STRATEGIES, 1):
        print(f"  {i}. {s['name']}")
    print("=" * 60)

    while True:
        try:
            choice = input("  请输入选项 [1-6]：").strip()
            num = int(choice)
            if 1 <= num <= len(STRATEGIES):
                return num
            print(f"  ⚠️ 请输入 1-{len(STRATEGIES)} 之间的数字")
        except (ValueError, EOFError):
            print(f"  ⚠️ 请输入有效的数字 (1-{len(STRATEGIES)})")


def select_and_execute(config: dict) -> str:
    """
    Main entry point: select strategy and execute it.

    Priority:
        1. ZOO default strategy (if set in configs/zoo_source_strategy.json)
        2. Console interactive menu

    Args:
        config: {
            "video_url": str  — optional video URL override
            "m3u8_url": str   — optional m3u8 URL for ffmpeg strategy
        }

    Returns:
        str — Path to generated input_video_hd.mp4
    """
    # ── Check ZOO default ──────────────────────────────
    zoo_default = get_zoo_default_strategy()
    choice = None
    strategy_id = None

    if zoo_default:
        strategy_id = zoo_default
        # Find index for display
        for i, s in enumerate(STRATEGIES, 1):
            if s["id"] == zoo_default:
                choice = i
                break
        print(f"\n  [ZOO Default] Using strategy: {STRATEGIES[choice - 1]['name']}")

    # ── Interactive menu (if no ZOO default) ──────────
    if choice is None:
        choice = show_console_menu()
        strategy_id = STRATEGIES[choice - 1]["id"]

    strategy = STRATEGIES[choice - 1]
    print(f"\n  ▶ Executing: {strategy['name']}")

    # ── Log strategy to metadata ──────────────────────
    _log_source_strategy(strategy_id, strategy["name"])

    # ── Import and run the module ─────────────────────
    try:
        mod = __import__(strategy["module"], fromlist=["generate_hd_source"])
        output_path = mod.generate_hd_source(config)
        print(f"\n  ✅ Source strategy completed: {strategy['name']}")
        return output_path
    except ImportError as e:
        print(f"  ❌ Failed to import {strategy['module']}: {e}")
        print(f"  Falling back to FallbackSource...")
        return _run_fallback(config)
    except Exception as e:
        print(f"  ❌ {strategy['name']} failed: {e}")
        print(f"  Falling back to FallbackSource...")
        return _run_fallback(config)


def _log_source_strategy(strategy_id: str, strategy_name: str):
    """Log the selected source strategy to metadata file."""
    try:
        ts_path = META_DIR / "source_strategy.json"
        data = {
            "source_strategy": strategy_id,
            "source_strategy_name": strategy_name,
            "timestamp": __import__("datetime").datetime.now().isoformat(),
        }
        with open(ts_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        logger.info(f"Source strategy: {strategy_id} ({strategy_name})")
    except Exception as e:
        logger.debug(f"Failed to log source strategy: {e}")


def _run_fallback(config: dict) -> str:
    """Run the fallback source as last resort."""
    try:
        from skills.video_source.fallback_source import generate_hd_source
        return generate_hd_source(config)
    except Exception as e:
        print(f"  ❌ Fallback also failed: {e}")
        return str(TEMP / "input_video_hd.mp4")


def get_strategies() -> list:
    """Return the list of available strategies (for Dashboard/ZOO integration)."""
    return STRATEGIES
