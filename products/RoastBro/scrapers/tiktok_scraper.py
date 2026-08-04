"""
TikTok Scraper
==============
TikTok 视频爬取模块 —— 基于 yt-dlp 的真实下载引擎。
⚠️ 强制无状态模式：不加载任何 cookies / 不携带任何登录凭据。

功能：
    - 通过 yt-dlp 从 TikTok URL 直接下载 mp4 原片
    - 提取视频元数据（标题、作者、描述等）
    - 自动缓存管理（24–72 小时后清理）
    - 支持 Playwright 浏览器自动化抓取（搜索/热榜）

架构：
    download_video() 使用 yt-dlp 命令行工具实现底层下载，
    search_hashtag() / get_trending() 使用 Playwright 浏览器自动化。

安全红线：
    - 严禁在 yt-dlp 参数中传入 --cookies-from-browser 或 --cookies
    - 遇到登录弹窗/封禁时直接跳过并记入 error_log.json，绝不重试攻破
"""

import asyncio
import json
import hashlib
import logging
import subprocess
import sys
import time
import re
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta

from pydantic import BaseModel, Field

from .error_log import is_login_blocked, log_blocked


class VideoMeta(BaseModel):
    """视频元数据模型"""
    platform: str = "tiktok"
    video_id: str
    url: str
    title: str
    description: str = ""
    author: str = ""
    author_id: str = ""
    tags: List[str] = []
    likes: int = 0
    comments: int = 0
    shares: int = 0
    duration: int = 0
    created_at: Optional[str] = None
    captured_at: str = Field(default_factory=lambda: datetime.now().isoformat())


class TikTokScraper:
    """
    TikTok 视频爬取器。

    使用 Playwright 进行浏览器自动化操作，
    数据暂存于 data/cache/ 目录，超期自动清理。

    Usage:
        scraper = TikTokScraper(cache_dir="data/cache")
        videos = await scraper.search_hashtag("funny")
        await scraper.download_video(videos[0].url)
    """

    def __init__(
        self,
        cache_dir: str = "data/cache",
        ttl_hours: int = 72,
        headless: bool = True,
    ):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.ttl_hours = ttl_hours
        self.headless = headless
        self._browser = None
        self._context = None

    async def _ensure_browser(self):
        """
        确保 Playwright 浏览器实例已初始化。
        🛡️ 强制无状态模式：
            - 不加载任何持久化存储（cookies、localStorage）
            - 不携带任何浏览器缓存/配置文件
            - 每次创建全新匿名会话
        """
        if self._browser is None:
            from playwright.async_api import async_playwright
            self._playwright = await async_playwright().start()
            self._browser = await self._playwright.chromium.launch(
                headless=self.headless,
                args=[
                    "--no-sandbox",
                    "--disable-blink-features=AutomationControlled",
                    "--incognito",                      # 🛡️ 隐身模式
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-sync",                   # 🛡️ 禁止同步任何数据
                    "--disable-default-apps",
                ]
            )
            # 🛡️ 创建全新匿名上下文 — 不携带任何存储/cookies
            self._context = await self._browser.new_context(
                viewport={"width": 1280, "height": 720},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                no_viewport=False,
                # 🛡️ 禁用所有持久化存储
                storage_state=None,                     # 不加载任何存储状态
                accept_downloads=False,                 # 禁止自动下载（防追踪）
                bypass_csp=True,                        # 绕过内容安全策略
                # 🛡️ 禁止地理位置权限
                permissions=[],
                # 🛡️ 不加载任何 cookie 文件
                locale="en-US",
                timezone_id="America/New_York",
            )

    async def search_hashtag(
        self,
        hashtag: str,
        max_videos: int = 20,
    ) -> List[VideoMeta]:
        """
        按标签搜索视频。

        Args:
            hashtag: 标签名称（无需 # 前缀）
            max_videos: 最大视频数

        Returns:
            List[VideoMeta]: 视频元数据列表
        """
        await self._ensure_browser()
        # TODO: 实现 Playwright 驱动的 TikTok 搜索
        # 当前为桩代码，返回示例结构
        return []

    async def get_trending(self, count: int = 20) -> List[VideoMeta]:
        """
        获取 TikTok 热榜视频。

        Args:
            count: 视频数量

        Returns:
            List[VideoMeta]: 热榜视频列表
        """
        await self._ensure_browser()
        # TODO: 实现热榜抓取
        return []

    async def download_video(self, url: str, video_id: str = "") -> Optional[Path]:
        """
        使用 yt-dlp 从 TikTok URL 下载视频文件到缓存目录。
        ⚠️ 强制无状态模式：不加载任何 cookies / 不携带任何登录凭据。

        流程：
            1. 用 yt-dlp 提取视频元数据（标题、作者等）
            2. 检测登录阻断信号 — 遇到则跳过并记入 error_log.json
            3. 下载最佳质量 mp4 到 cache_dir
            4. 保存元数据 JSON 文件
            5. 返回下载文件路径

        Args:
            url: TikTok 视频 URL
            video_id: 视频 ID（用于命名文件，为空则自动提取）

        Returns:
            Optional[Path]: 下载文件路径，失败返回 None
        """
        logger = logging.getLogger(__name__)

        # Step 1: 提取视频 ID（如果未提供）
        if not video_id:
            # 尝试从 URL 中提取 video_id
            id_match = re.search(
                r'(?:video|v)/(\d+)',
                url
            )
            if id_match:
                video_id = id_match.group(1)
            else:
                # 用 URL 哈希作为 fallback
                video_id = hashlib.sha256(url.encode()).hexdigest()[:12]

        output_path = self._generate_cache_path(video_id)
        # 确保输出目录存在
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Step 2: 用 yt-dlp 提取元数据（强制无状态）
        meta_path = output_path.with_suffix(".json")
        meta: Dict[str, Any] = {}

        try:
            # 先尝试提取 JSON 元数据 — 使用 --no-cookies 确保无状态
            meta_cmd = [
                sys.executable, "-m", "yt_dlp",
                "--dump-json",
                "--no-download",
                "--ignore-errors",
                "--no-cookies",              # 🛡️ 禁止加载任何 cookies
                "--no-cookies-from-browser", # 🛡️ 禁止从浏览器提取 cookies
                url,
            ]
            result = subprocess.run(
                meta_cmd,
                capture_output=True,
                text=True,
                timeout=30,
            )

            # 🛡️ 检测登录阻断信号 → 降级为 metadata_only 模式
            stderr_text = (result.stderr or "") + (result.stdout or "")
            if result.returncode != 0 and is_login_blocked(stderr_text):
                logger.warning(f"  ⛔ Login required / blocked for {url[:80]}... — 降级为 metadata_only")
                log_blocked(url, reason="login_required", platform="tiktok")
                metadata_path = self._fetch_metadata_only(url, video_id)
                if metadata_path:
                    logger.info(f"  ✅ Metadata-only fallback succeeded: {metadata_path.name}")
                    return metadata_path  # 返回 .json 路径，调用方据此判定 metadata_only
                return None

            if result.returncode == 0 and result.stdout.strip():
                meta = json.loads(result.stdout.strip().splitlines()[0])
                if not video_id:
                    video_id = meta.get("id", video_id)
                logger.info(f"  → Extracted metadata: {meta.get('title', 'N/A')[:60]}")
            else:
                logger.warning(f"  → Metadata extraction failed: {result.stderr[:200]}")
                meta = {}
        except (subprocess.TimeoutExpired, json.JSONDecodeError, Exception) as e:
            logger.warning(f"  → Metadata extraction warning: {e}")
            meta = {}

        # Step 3: 下载视频（强制无状态）
        download_path = output_path  # yt-dlp 输出模板
        yt_dlp_base = [sys.executable, "-m", "yt_dlp"]
        dl_cmd = yt_dlp_base + [
            "--no-playlist",
            "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "-o", str(download_path),
            "--no-overwrites",           # 已存在则跳过
            "--ignore-errors",
            "--no-warnings",
            "--no-cookies",              # 🛡️ 禁止加载任何 cookies
            "--no-cookies-from-browser", # 🛡️ 禁止从浏览器提取 cookies
            url,
        ]

        try:
            logger.info(f"  → Downloading video from {url}")
            dl_result = subprocess.run(
                dl_cmd,
                capture_output=True,
                text=True,
                timeout=300,  # 5 分钟超时
            )

            # 🛡️ 检测登录阻断信号（下载阶段）→ 降级为 metadata_only
            dl_stderr = dl_result.stderr or ""
            if dl_result.returncode != 0 and is_login_blocked(dl_stderr):
                logger.warning(f"  ⛔ Login required during download for {url[:80]}... — 降级为 metadata_only")
                log_blocked(url, reason="login_required_download", platform="tiktok")
                metadata_path = self._fetch_metadata_only(url, video_id)
                if metadata_path:
                    logger.info(f"  ✅ Metadata-only fallback succeeded: {metadata_path.name}")
                    return metadata_path
                return None

            if dl_result.returncode != 0:
                logger.error(f"  → yt-dlp download failed (rc={dl_result.returncode}): "
                             f"{dl_stderr[:300]}")
                # 尝试 fallback 格式
                fallback_cmd = yt_dlp_base + [
                    "--no-playlist",
                    "-f", "best",
                    "-o", str(download_path),
                    "--no-overwrites",
                    "--ignore-errors",
                    "--no-cookies",              # 🛡️
                    "--no-cookies-from-browser", # 🛡️
                    url,
                ]
                logger.info("  → Retrying with fallback format 'best'...")
                dl_result = subprocess.run(
                    fallback_cmd,
                    capture_output=True,
                    text=True,
                    timeout=300,
                )

                # 🛡️ 再次检测登录阻断信号 → 降级为 metadata_only
                if dl_result.returncode != 0 and is_login_blocked(dl_result.stderr or ""):
                    logger.warning(f"  ⛔ Login required during fallback for {url[:80]}... — 降级为 metadata_only")
                    log_blocked(url, reason="login_required_fallback", platform="tiktok")
                    metadata_path = self._fetch_metadata_only(url, video_id)
                    if metadata_path:
                        logger.info(f"  ✅ Metadata-only fallback succeeded: {metadata_path.name}")
                        return metadata_path
                    return None

                if dl_result.returncode != 0:
                    logger.error(f"  → Fallback also failed: {dl_result.stderr[:300]}")
                    return None

            # Step 4: 查找实际下载的文件（yt-dlp 可能追加了扩展名）
            actual_files = list(output_path.parent.glob(f"{output_path.stem}*"))
            actual_video = None
            for f in actual_files:
                if f.suffix.lower() in (".mp4", ".webm", ".mkv"):
                    actual_video = f
                    break

            if not actual_video:
                # 尝试找最近下载的文件
                all_mp4 = sorted(
                    output_path.parent.glob("*.mp4"),
                    key=lambda p: p.stat().st_mtime,
                    reverse=True,
                )
                if all_mp4:
                    actual_video = all_mp4[0]

            if not actual_video or not actual_video.exists():
                logger.error("  → Downloaded file not found")
                return None

            # 如果文件名与期望不符，重命名为标准格式
            if actual_video.name != output_path.name:
                std_name = output_path.with_suffix(actual_video.suffix)
                if std_name.exists():
                    std_name.unlink()
                actual_video.rename(std_name)
                actual_video = std_name

            logger.info(f"  ✅ Video downloaded: {actual_video.name} "
                        f"({actual_video.stat().st_size / 1024 / 1024:.1f} MB)")

            # Step 5: 保存元数据
            if meta:
                meta["downloaded_at"] = datetime.now().isoformat()
                meta["local_path"] = str(actual_video)
                meta_path.write_text(
                    json.dumps(meta, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )

            return actual_video

        except subprocess.TimeoutExpired:
            logger.error(f"  → Download timed out after 300s for {url}")
            return None
        except Exception as e:
            logger.error(f"  → Download error: {e}")
            return None

    # ── Metadata-Only 降级抓取 ────────────────────────────────────

    def _fetch_metadata_only(self, url: str, video_id: str) -> Optional[Path]:
        """
        登录阻断时降级为 metadata_only 模式：
        利用 ``--skip-download --write-thumbnail`` 仅抓取 JSON 元数据和封面图。

        存储路径：
            - 元数据: ``data/metadata/{video_id}.json``（含 title, uploader, thumbnail_url, view_count, url）
            - 封面图: ``data/metadata/{video_id}.jpg``（由 yt-dlp 自动下载）

        Args:
            url: 视频 URL
            video_id: 视频 ID

        Returns:
            Optional[Path]: 元数据 JSON 文件路径，失败返回 None
        """
        logger = logging.getLogger(__name__)
        metadata_dir = self.cache_dir.parent / "metadata"
        metadata_dir.mkdir(parents=True, exist_ok=True)

        meta_path = metadata_dir / f"{video_id}.json"

        cmd = [
            sys.executable, "-m", "yt_dlp",
            "--skip-download",
            "--write-thumbnail",
            "--convert-thumbnails", "jpg",
            "--dump-json",
            "--ignore-errors",
            "--no-cookies",
            "--no-cookies-from-browser",
            "--no-playlist",
            "-o", str(metadata_dir / video_id),
            url,
        ]

        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)

            # 解析 stdout 中的 JSON
            meta: Dict[str, Any] = {}
            if result.stdout.strip():
                try:
                    meta = json.loads(result.stdout.strip().splitlines()[0])
                except json.JSONDecodeError:
                    pass

            # 标准化为统一字段
            normalized = {
                "title": meta.get("title", ""),
                "uploader": meta.get("uploader", "") or meta.get("channel", "") or "",
                "thumbnail_url": meta.get("thumbnail", ""),
                "view_count": meta.get("view_count", 0),
                "url": url,
                "video_id": video_id,
                "platform": "tiktok",
                "metadata_only": True,
                "captured_at": datetime.now().isoformat(),
            }

            meta_path.write_text(
                json.dumps(normalized, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            # 查找 yt-dlp 实际下载的缩略图文件
            thumb_candidates = list(metadata_dir.glob(f"{video_id}.*"))
            thumb_file = None
            for f in thumb_candidates:
                if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
                    thumb_file = f
                    break

            if thumb_file:
                logger.info(f"  ✅ Metadata + thumbnail saved: {meta_path.name}, {thumb_file.name}")
            else:
                logger.info(f"  ✅ Metadata saved (no thumbnail): {meta_path.name}")

            # 返回元数据 JSON 路径 — 调用方通过 .suffix == '.json' 判定为 metadata_only
            return meta_path

        except subprocess.TimeoutExpired:
            logger.warning(f"  → metadata_only timed out for {url[:80]}...")
            return None
        except Exception as e:
            logger.warning(f"  → metadata_only error: {e}")
            return None

    def _generate_cache_path(self, video_id: str) -> Path:
        """生成缓存文件路径"""
        video_hash = hashlib.sha256(video_id.encode()).hexdigest()[:16]
        return self.cache_dir / f"tiktok_{video_id}_{video_hash}.mp4"

    def cleanup_expired(self):
        """清理过期缓存文件（超过 TTL 时长的文件）"""
        now = time.time()
        cutoff = now - (self.ttl_hours * 3600)

        for f in self.cache_dir.glob("tiktok_*.mp4"):
            if f.stat().st_mtime < cutoff:
                f.unlink(missing_ok=True)

        # 清理过期元数据
        for f in self.cache_dir.glob("tiktok_*.json"):
            if f.stat().st_mtime < cutoff:
                f.unlink(missing_ok=True)

    async def close(self):
        """关闭浏览器实例"""
        if self._browser:
            await self._browser.close()
        if hasattr(self, "_playwright"):
            await self._playwright.stop()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()
