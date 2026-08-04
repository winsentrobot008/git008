"""
PlaywrightSource — 现有 Playwright 抓取（保留备选）
====================================================
Wraps the existing tiktok_downloadaddr.py logic into a standard skill module.
Uses Playwright to parse TikTok page JSON and extract downloadAddr.

⚠️ 强制无状态模式：
    - 不加载任何持久化存储（cookies、localStorage）
    - 不携带任何浏览器缓存/配置文件
    - 遇到登录弹窗时跳过并记入 error_log.json

Requirements:
    pip install playwright
    playwright install chromium

Output: pipeline/temp/input_video_hd.mp4
"""

import os, sys, asyncio, re, json, logging
from pathlib import Path

logger = logging.getLogger("roastbro.source.playwright")

# ── Paths ──────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent.parent
TEMP = ROOT / "pipeline" / "temp"
OUTPUT = TEMP / "input_video_hd.mp4"
MIN_SIZE = 3 * 1024 * 1024  # 3MB
MAX_RETRIES = 3


async def _extract_download_addr(page) -> str:
    """Extract itemStruct.video.downloadAddr from TikTok JSON."""
    try:
        scripts = await page.eval_on_selector_all(
            "script[type='application/json']",
            "els => els.map(el => el.textContent)"
        ) if await page.query_selector("script[type='application/json']") else []

        if not scripts:
            scripts = await page.eval_on_selector_all(
                "script",
                "els => els.map(el => el.textContent)"
            )

        for script in scripts:
            if not script:
                continue
            try:
                if 'downloadAddr' in script:
                    matches = re.findall(r'"downloadAddr":"([^"]+)"', script)
                    if matches:
                        url = matches[0].replace('\\u002F', '/').replace('\\/', '/')
                        if not url.startswith('blob:'):
                            return url

                data = json.loads(script)
                if isinstance(data, dict):
                    for path in [
                        ["itemStruct", "video", "downloadAddr"],
                        ["ItemModule", None, "video", "downloadAddr"],
                        ["video", "downloadAddr"],
                    ]:
                        try:
                            val = data
                            for key in path:
                                if key is None:
                                    if isinstance(val, dict) and val:
                                        key = list(val.keys())[0]
                                    else:
                                        break
                                val = val[key]
                            if isinstance(val, str) and not val.startswith('blob:'):
                                return val.replace('\\u002F', '/').replace('\\/', '/')
                        except (KeyError, IndexError, TypeError):
                            continue
            except (json.JSONDecodeError, Exception):
                continue
    except Exception as e:
        logger.debug(f"Extract error: {e}")

    return ""


async def _scrape_with_playwright(video_url: str) -> bool:
    """
    Use Playwright to scrape downloadAddr and download the video.
    🛡️ 强制无状态模式：不加载任何 cookies / 持久化存储。
    """
    for attempt in range(1, MAX_RETRIES + 1):
        print(f"  Attempt {attempt}/{MAX_RETRIES}...")
        try:
            from playwright.async_api import async_playwright

            async with async_playwright() as p:
                # 🛡️ 使用 --incognito 确保无痕模式
                browser = await p.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-blink-features=AutomationControlled",
                        "--incognito",
                        "--no-first-run",
                        "--no-default-browser-check",
                        "--disable-sync",
                        "--disable-default-apps",
                    ]
                )
                # 🛡️ 创建完全匿名的上下文 — 无 storage_state / 无 cookies
                ctx = await browser.new_context(
                    viewport={"width": 1920, "height": 1080},
                    user_agent=(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    ),
                    storage_state=None,    # 🛡️ 不加载任何存储状态
                    accept_downloads=False,
                    bypass_csp=True,
                    permissions=[],
                    locale="en-US",
                    timezone_id="America/New_York",
                )
                page = await ctx.new_page()
                await page.goto(video_url, timeout=30000, wait_until="networkidle")
                await page.wait_for_timeout(3000)

                # 🛡️ 检测登录弹窗 — 如果页面包含登录表单、sign-in 等关键词则跳过
                page_text = await page.inner_text("body") if await page.query_selector("body") else ""
                login_keywords = ["log in", "sign in", "sign up", "login", "verify"]
                if any(kw in page_text.lower() for kw in login_keywords):
                    print(f"  ⛔ Login required — skipping {video_url[:80]}...")
                    from scrapers.error_log import log_blocked
                    log_blocked(video_url, reason="login_prompt_detected", platform="tiktok")
                    await browser.close()
                    return False

                download_url = await _extract_download_addr(page)
                await browser.close()

                if download_url:
                    print(f"  Found downloadAddr")
                    import requests
                    headers = {"User-Agent": "Mozilla/5.0 Windows"}
                    resp = requests.get(download_url, headers=headers, stream=True, timeout=60)

                    if resp.status_code == 200:
                        TEMP.mkdir(parents=True, exist_ok=True)
                        with open(OUTPUT, "wb") as f:
                            for chunk in resp.iter_content(chunk_size=32768):
                                f.write(chunk)

                        size_mb = os.path.getsize(OUTPUT) / (1024 * 1024)
                        print(f"  Size: {size_mb:.2f} MB")
                        if size_mb >= 3:
                            return True
                        print(f"  Too small, retrying...")
                else:
                    print(f"  No downloadAddr found")

        except Exception as e:
            print(f"  Error: {type(e).__name__}")

    return False


def generate_hd_source(config: dict) -> str:
    """
    Generate HD source video using Playwright (existing tiktok_downloadaddr logic).

    Args:
        config: {
            "video_url": str  — TikTok video URL
        }

    Returns:
        str — Path to generated input_video_hd.mp4
    """
    print("\n  ┌──────────────────────────────────────────────┐")
    print("  │  5. PlaywrightSource — 现有 Playwright 抓取   │")
    print("  └──────────────────────────────────────────────┘")

    video_url = config.get("video_url", "https://www.tiktok.com/@tiktok/video/7104163823139876142")

    if asyncio.run(_scrape_with_playwright(video_url)) and OUTPUT.exists():
        size_mb = os.path.getsize(OUTPUT) / (1024 * 1024)
        print(f"  [OK] PlaywrightSource: {OUTPUT.name} ({size_mb:.2f} MB)")
        return {"status": "success", "path": str(OUTPUT), "strategy": "PlaywrightSource"}
    else:
        print(f"  [WARN] PlaywrightSource failed")
        return {"status": "error", "message": "PlaywrightSource failed to generate output"}
