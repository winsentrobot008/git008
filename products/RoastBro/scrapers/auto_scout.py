"""
AutoScout — 全天候 AI 侦察兵 (24/7 Auto-Scout)
================================================
自动检索 TikTok 爆款槽点并存入候选池，无需人工干预。
⚠️ 强制无状态模式：不加载任何 cookies / 不携带任何登录凭据。

核心流程:
    scout_hashtag()  →  yt-dlp playlist 抓取标签下最新视频
    is_trending()    →  只保留互动率 Top 10% 的视频
    scout_all()      →  多标签并行扫描 + 过滤

安全红线:
    - 所有 yt-dlp 调用强制使用 --no-cookies / --no-cookies-from-browser
    - 遇到登录弹窗/封禁时直接跳过并记入 error_log.json

Usage:
    scout = AutoScout()
    trending = await scout.scout_all(tags=["fail", "cringe"], limit=10)
"""

from __future__ import annotations

import asyncio
import json
import logging
import subprocess
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Optional, Dict, Any

from .error_log import is_login_blocked, log_blocked

logger = logging.getLogger(__name__)


# ── Data Model ────────────────────────────────────────────────

@dataclass
class ScoutedVideo:
    """自动侦察兵扫描到的视频情报"""
    url: str
    title: str = ""
    video_id: str = ""
    author: str = ""
    platform: str = "tiktok"
    tags: List[str] = field(default_factory=list)

    # 互动数据 (来自 yt-dlp metadata)
    likes: int = 0
    comments: int = 0
    shares: int = 0
    views: int = 0

    # 趋势过滤结果
    engagement_rate: float = 0.0     # (likes+comments+shares) / views
    is_trending: bool = False        # True if in top 10% engagement

    # 槽点预筛结果
    roast_potential: float = 0.0     # 0-100 吐槽潜力分
    high_potential: bool = False     # True if density high

    scouted_at: str = field(default_factory=lambda: datetime.now().isoformat())

    @property
    def engagement_total(self) -> int:
        return self.likes + self.comments + self.shares


# ── AutoScout ─────────────────────────────────────────────────

class AutoScout:
    """
    全天候 AI 侦察兵。

    职责链:
        1. scout_hashtag  →  yt-dlp 抓取标签下最新视频列表
        2. is_trending    →  按互动率过滤，只保留 Top 10%
        3. scout_all      →  多标签并行扫描 → 汇总 → 排序

    用法:
        scout = AutoScout()
        results = await scout.scout_all(tags=["fail", "cringe", "wtf"])
        trending = [v for v in results if v.is_trending]
    """

    def __init__(
        self,
        cache_dir: str = "data/autoscout",
        engagement_top_pct: float = 0.10,  # 保留互动率 Top 10%
    ):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.engagement_top_pct = engagement_top_pct
        self._scout_log: List[ScoutedVideo] = []

    # ── Public API ────────────────────────────────────────────

    async def scout_hashtag(
        self,
        tag: str,
        limit: int = 15,
    ) -> List[ScoutedVideo]:
        """
        使用 yt-dlp playlist 抓取指定标签下的最新视频列表。

        Args:
            tag: TikTok 标签 (如 "fail", "cringe")
            limit: 最大返回数量

        Returns:
            List[ScoutedVideo]: 含元数据的视频列表
        """
        logger.info("AutoScout scouting tag=%s limit=%d", tag, limit)
        search_url = f"https://www.tiktok.com/tag/{tag}"

        try:
            raw_entries = await asyncio.get_event_loop().run_in_executor(
                None,
                self._run_ytdlp_extract,
                search_url,
                limit,
            )
        except Exception as e:
            logger.warning("yt-dlp extract failed for tag '%s': %s — 不再回退到 mock 数据", tag, e)
            raw_entries = []

        videos: List[ScoutedVideo] = []
        for entry in raw_entries:
            video = ScoutedVideo(
                url=entry.get("url", ""),
                title=entry.get("title", ""),
                video_id=entry.get("id", ""),
                author=entry.get("author", ""),
                platform="tiktok",
                tags=[tag],
                likes=entry.get("like_count", 0) or 0,
                comments=entry.get("comment_count", 0) or 0,
                shares=entry.get("share_count", 0) or 0,
                views=entry.get("view_count", 0) or 0,
            )
            # 计算互动率
            total_interactions = video.likes + video.comments + video.shares
            video.engagement_rate = (
                total_interactions / video.views
                if video.views > 0 else 0.0
            )
            videos.append(video)

        logger.info(
            "  Tag '%s': got %d videos, applying trending filter...",
            tag, len(videos),
        )
        return videos

    async def scout_all(
        self,
        tags: Optional[List[str]] = None,
        per_tag_limit: int = 15,
        pool_size: int = 3,
    ) -> List[ScoutedVideo]:
        """
        多标签并行侦察 → 互动率排序 → 标记 Top 10% 为 trending。

        Args:
            tags: 要扫描的标签列表
            per_tag_limit: 每个标签最多抓取数量
            pool_size: 并行扫描的标签数

        Returns:
            List[ScoutedVideo]: 所有扫描到的视频（已标记是否 trending）
        """
        if tags is None:
            tags = ["fail", "cringe", "wtf", "funny", "gonewrong"]

        all_videos: List[ScoutedVideo] = []
        seen_urls: set[str] = set()

        # Step 1: 并行扫描所有标签
        sem = asyncio.Semaphore(pool_size)

        async def _scout_one(tag: str) -> List[ScoutedVideo]:
            async with sem:
                return await self.scout_hashtag(tag, limit=per_tag_limit)

        tasks = [_scout_one(tag) for tag in tags]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for tag, result in zip(tags, results):
            if isinstance(result, Exception):
                logger.error("  Scout tag '%s' failed: %s", tag, result)
                continue
            # 去重
            for v in result:
                if v.url and v.url not in seen_urls:
                    all_videos.append(v)
                    seen_urls.add(v.url)

        if not all_videos:
            logger.warning("AutoScout: no videos found from any tag")
            return []

        # Step 2: 按互动率降序排列 → 标记 Top 10%
        all_videos.sort(key=lambda v: v.engagement_rate, reverse=True)
        top_n = max(1, int(len(all_videos) * self.engagement_top_pct))

        for i, v in enumerate(all_videos):
            v.is_trending = i < top_n

        logger.info(
            "AutoScout: scanned %d tags, got %d unique videos, %d trending",
            len(tags), len(all_videos), sum(1 for v in all_videos if v.is_trending),
        )

        self._scout_log = all_videos
        return all_videos

    # ── 内部方法 ──────────────────────────────────────────────

    def _run_ytdlp_extract(
        self,
        url: str,
        limit: int,
    ) -> List[Dict[str, Any]]:
        """同步执行 yt-dlp 提取器（在 executor 中运行，强制无状态）"""
        cmd = [
            "yt-dlp",
            "--flat-playlist",
            "--dump-json",
            "--no-download",
            "--playlist-end", str(limit),
            "--no-cookies",              # 🛡️ 禁止加载任何 cookies
            "--no-cookies-from-browser", # 🛡️ 禁止从浏览器提取 cookies
            url,
        ]
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
        )

        # 🛡️ 检测登录阻断信号
        stderr_text = (proc.stderr or "") + (proc.stdout or "")
        if proc.returncode != 0 and is_login_blocked(stderr_text):
            log_blocked(url, reason="login_required_scout", platform="tiktok")
            raise RuntimeError(f"yt-dlp login blocked: {proc.stderr.strip()[:200]}")

        if proc.returncode != 0:
            raise RuntimeError(f"yt-dlp failed: {proc.stderr.strip()}")

        entries = []
        for line in proc.stdout.strip().splitlines():
            if not line:
                continue
            data = json.loads(line)
            entries.append({
                "url": data.get("webpage_url") or data.get("url", ""),
                "title": data.get("title", ""),
                "id": data.get("id", ""),
                "author": data.get("uploader", ""),
                "like_count": data.get("like_count", 0),
                "comment_count": data.get("comment_count", 0),
                "share_count": data.get("share_count", 0),
                "view_count": data.get("view_count", 0),
            })
        return entries[:limit]

    def _mock_entries(
        self,
        tag: str,
        limit: int,
    ) -> List[Dict[str, Any]]:
        """回退方案：当 yt-dlp 不可用时生成模拟数据"""
        import random
        mock_titles = {
            "fail": [
                "Epic group fail 🤣", "Stunt gone wrong",
                "This went horribly wrong...", "Most embarrassing fail",
            ],
            "cringe": [
                "Secondhand embarrassment", "Cringiest dance ever",
                "Watch till the end 😱", "I can't believe this happened",
            ],
            "funny": [
                "Funny animal fails", "Comedy gold",
                "When plans backfire spectacularly", "The worst tutorial ever",
            ],
            "wtf": [
                "What did I just watch", "Brain.exe stopped",
                "Absolute chaos in 60 seconds", "Prank gone wrong",
            ],
        }
        authors = ["user1", "viral_star", "content_king", "trending_now"]
        titles = mock_titles.get(tag.lower(), ["Trending video #{i}"])
        entries = []
        for i in range(limit):
            view_base = random.randint(10000, 500000)
            entries.append({
                "url": f"https://www.tiktok.com/@{authors[i % len(authors)]}/video/{i}",
                "title": titles[i % len(titles)] if i < len(titles) else f"Trending #{i}",
                "id": str(100000 + i),
                "author": authors[i % len(authors)],
                "like_count": int(view_base * random.uniform(0.01, 0.08)),
                "comment_count": int(view_base * random.uniform(0.001, 0.01)),
                "share_count": int(view_base * random.uniform(0.0005, 0.005)),
                "view_count": view_base,
            })
        return entries

    # ── 状态查询 ──────────────────────────────────────────────

    @property
    def last_scout(self) -> Optional[List[ScoutedVideo]]:
        """上次侦察结果"""
        return self._scout_log if self._scout_log else None

    def get_trending_videos(self) -> List[ScoutedVideo]:
        """获取最新标记为 trending 的视频"""
        return [v for v in self._scout_log if v.is_trending]

    def get_high_potential_videos(self) -> List[ScoutedVideo]:
        """获取标记为 High_Potential 的视频"""
        return [v for v in self._scout_log if v.high_potential]


# ── Convenience ────────────────────────────────────────────────

scout = AutoScout()
"""全局单例，方便快速引用"""
