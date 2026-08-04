"""
RoastBro — Scrapers Module
===========================
视频爬取模块，支持 TikTok / YouTube / B站 数据采集。

⚠️ 强制无状态模式：
    - 所有抓取操作不携带任何 cookies / 登录凭据
    - 遇到登录弹窗/封禁直接跳过并记入 error_log.json

模块职责：
1. TikTok Scraper — 抓取热榜、标签、用户、争议视频
2. YouTube Scraper — YouTube 趋势/搜索数据采集
3. Bilibili Scraper — B站 热榜/分区数据采集
4. AutoHunter — 全自动情报侦察兵
5. AutoScout — 全天候 AI 侦察兵
6. ErrorLog — 登录阻断/抓取失败记录器

输出：
    - 原始视频文件 (data/cache/)
    - 元数据 JSON (标题、标签、描述、评论)
    - 错误日志 (data/error_log.json) — 记录被阻断的 URL
"""

from .tiktok_scraper import TikTokScraper
from .youtube_scraper import YouTubeScraper
from .bilibili_scraper import BilibiliScraper
from .auto_hunter import AutoHunter, HuntedVideo
from .auto_scout import AutoScout, ScoutedVideo
from .error_log import is_login_blocked, log_blocked, get_blocked, count_blocked

__all__ = [
    "TikTokScraper", "YouTubeScraper", "BilibiliScraper",
    "AutoHunter", "HuntedVideo",
    "AutoScout", "ScoutedVideo",
    "is_login_blocked", "log_blocked", "get_blocked", "count_blocked",
]
