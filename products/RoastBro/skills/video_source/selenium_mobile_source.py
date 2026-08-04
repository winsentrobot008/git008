"""
SeleniumMobileSource — Selenium + Mobile UA 抓取
=================================================
Uses Selenium with an iPhone/Android user-agent to open TikTok pages,
extract the real mp4/m3u8 video URL, and download it.

⚠️ 强制无状态模式：
    - 不加载任何持久化存储（cookies、localStorage）
    - 不携带任何浏览器缓存/配置文件
    - 遇到登录弹窗时跳过并记入 error_log.json

Requirements:
    pip install selenium
    # chromedriver should be on PATH or auto-managed by webdriver-manager

Output: pipeline/temp/input_video_hd.mp4
"""

import os, re, json, time, logging
from pathlib import Path

logger = logging.getLogger("roastbro.source.selenium_mobile")

# ── Paths ──────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent.parent
TEMP = ROOT / "pipeline" / "temp"
OUTPUT = TEMP / "input_video_hd.mp4"
MIN_SIZE = 3 * 1024 * 1024  # 3MB

# ── Mobile User Agents ──────────────────────────────────
MOBILE_UAS = [
    # iPhone 15 Pro
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
    # Samsung Galaxy S23
    "Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36",
]


def _extract_video_url(driver) -> str:
    """Extract video URL from TikTok mobile page via Selenium."""
    try:
        # Method 1: Look for video element src
        video = driver.find_element("tag name", "video")
        src = video.get_attribute("src")
        if src and not src.startswith("blob:"):
            return src
    except Exception:
        pass

    try:
        # Method 2: Parse page source for video URLs
        page_source = driver.page_source
        # Look for mp4 URLs
        mp4_matches = re.findall(r'https?://[^"\']+\.mp4[^"\'\\]*', page_source)
        if mp4_matches:
            return mp4_matches[0]
        # Look for playAddr / downloadAddr
        addr_match = re.search(r'"(?:playAddr|downloadAddr)":"([^"]+)"', page_source)
        if addr_match:
            url = addr_match.group(1).replace("\\u002F", "/").replace("\\/", "/")
            if not url.startswith("blob:"):
                return url
    except Exception:
        pass

    return ""


def generate_hd_source(config: dict) -> str:
    """
    Generate HD source video using Selenium + Mobile UA.

    Args:
        config: {
            "video_url": str  — TikTok URL
        }

    Returns:
        str — Path to generated input_video_hd.mp4
    """
    print("\n  ┌──────────────────────────────────────────────┐")
    print("  │  3. SeleniumMobileSource — Mobile UA 抓取     │")
    print("  └──────────────────────────────────────────────┘")

    video_url = config.get("video_url", "https://www.tiktok.com/@tiktok/video/7104163823139876142")
    TEMP.mkdir(parents=True, exist_ok=True)

    try:
        from selenium import webdriver
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support.ui import WebDriverWait
        from selenium.webdriver.support import expected_conditions as EC
    except ImportError:
        print("  [WARN] selenium not installed. Run: pip install selenium")
        return {"status": "error", "message": "selenium not installed"}

    import requests

    success = False
    for idx, ua in enumerate(MOBILE_UAS):
        print(f"  Trying UA #{idx + 1}...")
        try:
            options = Options()
            options.add_argument("--headless=new")
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument(f"--user-agent={ua}")
            options.add_argument("--window-size=390,844")  # iPhone 15 Pro
            options.add_argument("--incognito")                    # 🛡️ 隐身模式
            options.add_argument("--disable-sync")                 # 🛡️ 禁止同步
            options.add_experimental_option("excludeSwitches", ["enable-automation"])
            options.add_experimental_option("useAutomationExtension", False)
            # 🛡️ 禁用 cookie 和存储
            options.add_argument("--disable-default-apps")
            options.add_argument("--no-first-run")

            driver = webdriver.Chrome(options=options)
            driver.get(video_url)
            time.sleep(5)

            # 🛡️ 检测登录弹窗
            page_text = driver.page_source.lower()
            login_keywords = ["log in", "sign in", "sign up", "login", "verify",
                              "please log", "need to log"]
            if any(kw in page_text for kw in login_keywords):
                print(f"  ⛔ Login required — skipping {video_url[:80]}...")
                driver.quit()
                from scrapers.error_log import log_blocked
                log_blocked(video_url, reason="login_prompt_detected_selenium", platform="tiktok")
                continue

            video_url_found = _extract_video_url(driver)
            driver.quit()

            if video_url_found:
                print(f"  Found video URL: {video_url_found[:80]}...")
                headers = {
                    "User-Agent": ua,
                    "Referer": "https://www.tiktok.com/",
                }
                resp = requests.get(video_url_found, headers=headers, stream=True, timeout=60)
                if resp.status_code == 200:
                    with open(OUTPUT, "wb") as f:
                        for chunk in resp.iter_content(chunk_size=32768):
                            f.write(chunk)

                    size_mb = os.path.getsize(OUTPUT) / (1024 * 1024)
                    print(f"  Downloaded: {size_mb:.2f} MB")
                    if size_mb >= 3:
                        success = True
                        break
                    else:
                        print(f"  Too small, trying next UA...")
                else:
                    print(f"  HTTP {resp.status_code}")
            else:
                print(f"  No video URL found with UA #{idx + 1}")

        except Exception as e:
            print(f"  Error with UA #{idx + 1}: {type(e).__name__}")
            try:
                driver.quit()
            except Exception:
                pass

    if success and OUTPUT.exists():
        print(f"  [OK] SeleniumMobileSource: {OUTPUT.name} ({os.path.getsize(OUTPUT) / (1024 * 1024):.2f} MB)")
        return {"status": "success", "path": str(OUTPUT), "strategy": "SeleniumMobileSource"}
    else:
        print(f"  [WARN] SeleniumMobileSource failed")
        return {"status": "error", "message": "SeleniumMobileSource failed to generate output"}
