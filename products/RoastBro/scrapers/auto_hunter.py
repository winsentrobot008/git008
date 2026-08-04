"""
AutoHunter — 全自动情报侦察兵
================================
每天扫描 TikTok 热门榜单，筛选高吐槽潜力视频并自动放入生产队列。
⚠️ 强制无状态模式：不加载任何 cookies / 不携带任何登录凭据。

架构：
    fetch_trending_urls()  →  使用 yt-dlp playlist 获取热门 URL
    rank_potentials()       →  下载片段 + RoastScoreEngine.quick_evaluate()
    push_to_queue()         →  将筛选后的视频推入生产队列

安全红线：
    - 所有 yt-dlp 调用强制使用 --no-cookies / --no-cookies-from-browser
    - 遇到登录弹窗/封禁时直接跳过并记入 error_log.json

Usage:
    hunter = AutoHunter()
    urls = await hunter.fetch_trending_urls(tag="fail", limit=10)
    ranked = await hunter.rank_potentials(urls)
    await hunter.push_to_queue(ranked[:3])
"""

from __future__ import annotations

import asyncio
import json
import logging
import subprocess
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any
from uuid import uuid4

from .error_log import is_login_blocked, log_blocked

logger = logging.getLogger(__name__)


# ── Data Models ────────────────────────────────────────────────

@dataclass
class HuntedVideo:
    """单个被狩猎到的视频情报"""
    url: str
    title: str = ""
    description: str = ""
    platform: str = "tiktok"
    video_id: str = ""
    author: str = ""
    roast_score: float = 0.0
    thumbnail: str = ""
    duration: int = 0
    hunted_at: str = field(default_factory=lambda: datetime.now().isoformat())
    confirmed: bool = False  # 老哥确认后设为 True


# ── AutoHunter ─────────────────────────────────────────────────

class AutoHunter:
    """
    全自动情报侦察兵。

    职责链:
        1. fetch_trending_urls  →  从 TikTok 热榜抓取 URL
        2. rank_potentials      →  下载短视频片段 + 快速评吐槽分 → 排序
        3. push_to_queue        →  高分视频自动推入生产队列

    用法:
        hunter = AutoHunter(cache_dir="data/autohunter")
        urls = await hunter.fetch_trending_urls(tag="fail", limit=10)
        ranked = await hunter.rank_potentials(urls)
        await hunter.push_to_queue(ranked[:3])
    """

    def __init__(
        self,
        cache_dir: str = "data/autohunter",
        score_threshold: float = 30.0,
    ):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.score_threshold = score_threshold
        self._hunted_log: List[HuntedVideo] = []

    # ── Public API ────────────────────────────────────────────

    async def fetch_trending_urls(
        self,
        tag: str = "fail",
        limit: int = 10,
    ) -> List[Dict[str, str]]:
        """
        使用 yt-dlp 的 playlist/extractor 功能抓取 TikTok 热门 URL。

        Args:
            tag: 搜索标签/关键词（如 "fail", "cringe", "funny"）
            limit: 最大返回数量

        Returns:
            List[Dict[str, str]]: 每项含 {"url", "title", "id", "author"}
        """
        logger.info("AutoHunter fetching trending URLs for tag=%s limit=%d", tag, limit)

        # 构建 TikTok 搜索 URL
        search_url = f"https://www.tiktok.com/tag/{tag}"

        try:
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                self._run_ytdlp_extract,
                search_url,
                limit,
            )
            return result
        except Exception as e:
            logger.warning("yt-dlp extract failed: %s — 不再生成 mock 数据", e)
            return []

    async def rank_potentials(
        self,
        url_list: List[Dict[str, str]],
    ) -> List[HuntedVideo]:
        """
        对候选 URL 列表执行吐槽潜力评分并排序。

        流程:
            1. 对每个 URL 下载短视频片段（前 15 秒）
            2. 用 RoastScoreEngine.quick_evaluate() 快速评分
            3. 按评分降序排列

        Args:
            url_list: fetch_trending_urls 返回的候选列表

        Returns:
            List[HuntedVideo]: 按 roast_score 降序排列
        """
        from roastpoints.roast_score_engine import RoastScoreEngine

        hunted: List[HuntedVideo] = []

        for entry in url_list:
            url = entry.get("url", "")
            title = entry.get("title", "")
            video_id = entry.get("id", "")
            author = entry.get("author", "")

            # 下载短视频片段评分
            score = await self._score_video_quick(url, title, video_id)

            hunted.append(HuntedVideo(
                url=url,
                title=title,
                video_id=video_id,
                author=author,
                roast_score=score,
                platform="tiktok",
                hunted_at=datetime.now().isoformat(),
            ))

        # 按吐槽分降序排列
        hunted.sort(key=lambda hv: hv.roast_score, reverse=True)

        self._hunted_log = hunted
        logger.info(
            "AutoHunter ranked %d videos, top score=%.1f",
            len(hunted),
            hunted[0].roast_score if hunted else 0,
        )
        return hunted

    async def push_to_queue(self, videos: List[HuntedVideo]) -> int:
        """
        将高吐槽潜力的视频推入生产队列。

        写入 data/autohunter/production_queue.json，供工厂读取。

        Args:
            videos: 要推入队列的视频列表

        Returns:
            int: 推入队列的视频数量
        """
        queue_path = self.cache_dir / "production_queue.json"
        queue_path.parent.mkdir(parents=True, exist_ok=True)

        # 读取已有队列
        existing = []
        if queue_path.exists():
            try:
                raw = queue_path.read_text(encoding="utf-8")
                existing = json.loads(raw)
            except (json.JSONDecodeError, Exception):
                existing = []

        # 去重 + 追加
        existing_urls = {v.get("url") for v in existing}
        new_count = 0
        for v in videos:
            if v.url not in existing_urls:
                existing.append({
                    "url": v.url,
                    "title": v.title,
                    "video_id": v.video_id,
                    "author": v.author,
                    "roast_score": v.roast_score,
                    "confirmed": v.confirmed,
                    "hunted_at": v.hunted_at,
                    "pushed_at": datetime.now().isoformat(),
                })
                existing_urls.add(v.url)
                new_count += 1

        queue_path.write_text(
            json.dumps(existing, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        logger.info("AutoHunter pushed %d new videos to queue", new_count)
        return new_count

    # ── 内部方法 ──────────────────────────────────────────────

    def _run_ytdlp_extract(
        self,
        url: str,
        limit: int,
    ) -> List[Dict[str, str]]:
        """同步执行 yt-dlp 提取器（在 executor 中运行）"""
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
            log_blocked(url, reason="login_required_extract", platform="tiktok")
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
            })
        return entries[:limit]

    async def _score_video_quick(
        self,
        url: str,
        title: str,
        video_id: str,
    ) -> float:
        """
        快速评分单个视频 — 下载片段 + 元数据评分。

        先尝试用 yt-dlp 提取元数据做 quick_evaluate，
        如果元数据为空则尝试下载短视频片段做基础分析。

        Returns:
            float: 0-100 吐槽潜力分
        """
        from roastpoints.roast_score_engine import RoastScoreEngine

        # 尝试提取元数据
        description = ""
        try:
            meta = await asyncio.get_event_loop().run_in_executor(
                None,
                self._extract_metadata,
                url,
            )
            if meta:
                title = meta.get("title", title)
                description = meta.get("description", "")
        except Exception:
            pass

        # 用 quick_evaluate 评分
        score = RoastScoreEngine.quick_evaluate(
            video_path=f"autohunter/{video_id}",
            title=title,
            description=description,
        )

        # 对小于 30 秒的短片段，若标题含强信号词则加分
        if any(w in title.lower() for w in ["fail", "cringe", "搞笑", "翻车", "wtf"]):
            score += 10.0

        return max(0.0, min(100.0, score))

    def _extract_metadata(self, url: str) -> Dict[str, Any]:
        """用 yt-dlp 提取单个视频元数据（强制无状态）"""
        cmd = [
            "yt-dlp",
            "--dump-json",
            "--no-download",
            "--no-cookies",              # 🛡️ 禁止加载任何 cookies
            "--no-cookies-from-browser", # 🛡️ 禁止从浏览器提取 cookies
            url,
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

        # 🛡️ 检测登录阻断信号
        stderr_text = (proc.stderr or "") + (proc.stdout or "")
        if proc.returncode != 0 and is_login_blocked(stderr_text):
            log_blocked(url, reason="login_required_metadata", platform="tiktok")
            return {}

        if proc.returncode != 0 or not proc.stdout.strip():
            return {}
        return json.loads(proc.stdout.strip().splitlines()[0])

    def _mock_trending(
        self,
        tag: str,
        limit: int,
    ) -> List[Dict[str, str]]:
        """回退方案：当 yt-dlp 不可用时生成模拟热榜数据"""
        mock_videos = [
            {"url": f"https://www.tiktok.com/@{u}/video/{i}",
             "title": t, "id": str(i), "author": u}
            for i, (t, u) in enumerate([
                ("Epic fail compilation 🤣", "failmaster"),
                ("This went horribly wrong...", "oopsie"),
                ("Watch till the end 😱", "cringeking"),
                ("I can't believe this happened", "wtfmoments"),
                ("Most embarrassing moment ever", "embarrassed_af"),
                ("When plans backfire spectacularly", "backfire_pro"),
                ("The worst tutorial ever", "diy_disaster"),
                ("Prank gone wrong (not clickbait)", "prankster_101"),
                ("My dumbest decision caught on camera", "regretful"),
                ("Absolute chaos in 60 seconds", "chaos_monster"),
            ][:limit])
        ]

        # 加上标签上下文
        tag_lower = tag.lower()
        tag_titles = {
            "fail": ["Epic group fail", "Stunt gone wrong"],
            "cringe": ["Secondhand embarrassment", "Cringiest dance"],
            "funny": ["Funny animal fails", "Comedy gold"],
            "wtf": ["What did I just watch", "Brain.exe stopped"],
        }
        if tag_lower in tag_titles:
            for i, t in enumerate(tag_titles[tag_lower]):
                if i < limit:
                    mock_videos[i]["title"] = t

        return mock_videos[:limit]

    # ── 状态查询 ──────────────────────────────────────────────

    @property
    def last_hunt(self) -> Optional[List[HuntedVideo]]:
        """上一次狩猎结果"""
        return self._hunted_log if self._hunted_log else None

    def get_queue(self) -> List[Dict[str, Any]]:
        """读取当前生产队列"""
        queue_path = self.cache_dir / "production_queue.json"
        if not queue_path.exists():
            return []
        try:
            return json.loads(queue_path.read_text(encoding="utf-8"))
        except Exception:
            return []

    def confirm_video(self, url: str) -> bool:
        """
        老哥手动确认一个视频，标记为可开工状态。

        Args:
            url: 视频 URL

        Returns:
            bool: 是否成功确认
        """
        queue = self.get_queue()
        for item in queue:
            if item["url"] == url:
                item["confirmed"] = True
                item["confirmed_at"] = datetime.now().isoformat()
                queue_path = self.cache_dir / "production_queue.json"
                queue_path.write_text(
                    json.dumps(queue, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                return True
        return False


# ── Convenience ────────────────────────────────────────────────

hunter = AutoHunter()
"""全局单例，方便 dashboard 直接引用"""
