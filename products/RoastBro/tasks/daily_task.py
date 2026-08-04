"""Daily AutoHunt Task — 每日 0 点自动狩猎

后台启动 APScheduler，每天 0 点准时执行：
    AutoHunter.fetch_trending_urls()
    → rank_potentials()
    → push_to_queue()

用法:
    # 单独启动调度器
    python -m tasks.daily_task

    # 在应用中集成
    from tasks.daily_task import start_scheduler
    start_scheduler()
"""

from __future__ import annotations

import asyncio
import logging
import threading
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

# ── 尝试导入 APScheduler ───────────────────────────────────────
try:
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    HAS_APSCHEDULER = True
except ImportError:
    HAS_APSCHEDULER = False
    logger.warning("APScheduler not installed. Daily task will use threading fallback.")

# ── 尝试导入 AutoHunter ────────────────────────────────────────
try:
    from scrapers.auto_hunter import AutoHunter, HuntedVideo
    HAS_HUNTER = True
except ImportError:
    HAS_HUNTER = False
    logger.warning("AutoHunter not available.")


# ── Tags for daily hunt ────────────────────────────────────────
DEFAULT_TAGS = ["fail", "cringe", "wtf", "funny", "gonewrong"]
MAX_PER_TAG = 5
SCORE_FLOOR = 30.0


def run_daily_hunt() -> dict:
    """
    执行一次完整的自动狩猎流程（同步入口，供 APScheduler 调用）。

    流程:
        1. 对每个 TAG 调用 fetch_trending_urls
        2. 合并去重后 rank_potentials
        3. 过滤低分视频后 push_to_queue

    Returns:
        dict: 狩猎报告 {"hunted": int, "pushed": int, "top_score": float, ...}
    """
    if not HAS_HUNTER:
        return {"error": "AutoHunter not available", "hunted": 0, "pushed": 0}

    logger.info("=== Daily AutoHunt started at %s ===", datetime.now().isoformat())

    hunter = AutoHunter(score_threshold=SCORE_FLOOR)
    all_urls: list[dict] = []
    seen_urls: set[str] = set()

    # ── Step 1: 多标签抓取 ──
    for tag in DEFAULT_TAGS:
        try:
            urls = asyncio.run(hunter.fetch_trending_urls(tag=tag, limit=MAX_PER_TAG))
            for u in urls:
                url = u.get("url", "")
                if url and url not in seen_urls:
                    all_urls.append(u)
                    seen_urls.add(url)
            logger.info("  Tag '%s': got %d URLs", tag, len(urls))
        except Exception as e:
            logger.error("  Tag '%s' failed: %s", tag, e)

    if not all_urls:
        logger.warning("  No URLs found from any tag")
        return {"hunted": 0, "pushed": 0, "error": "no urls"}

    # ── Step 2: 吐槽潜力评分 ──
    try:
        ranked = asyncio.run(hunter.rank_potentials(all_urls))
    except Exception as e:
        logger.error("  rank_potentials failed: %s", e)
        return {"hunted": len(all_urls), "pushed": 0, "error": str(e)}

    # ── Step 3: 过滤高分视频 → 推入队列 ──
    high_score = [v for v in ranked if v.roast_score >= SCORE_FLOOR]
    top_videos = high_score[:5]  # 最多推 5 个

    pushed = 0
    if top_videos:
        try:
            pushed = asyncio.run(hunter.push_to_queue(top_videos))
        except Exception as e:
            logger.error("  push_to_queue failed: %s", e)

    report = {
        "hunted": len(ranked),
        "pushed": pushed,
        "top_score": round(ranked[0].roast_score, 1) if ranked else 0.0,
        "tags_used": DEFAULT_TAGS,
        "timestamp": datetime.now().isoformat(),
    }
    logger.info("=== Daily AutoHunt done: %s ===", report)
    return report


# ── APScheduler Wrapper ────────────────────────────────────────

class AutoHuntScheduler:
    """
    自动狩猎调度器。

    每天 0 点执行一次 AutoHunt 全流程。
    可在 dashboard 后台静默运行。

    用法:
        scheduler = AutoHuntScheduler()
        scheduler.start()
        # ... 应用运行中 ...
        scheduler.stop()
    """

    def __init__(self):
        self._scheduler: Optional[BackgroundScheduler] = None
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._last_report: Optional[dict] = None

    def start(self):
        """启动调度器（自动判断 APScheduler 可用性）"""
        if self._running:
            logger.warning("AutoHuntScheduler already running")
            return

        if HAS_APSCHEDULER:
            self._start_apscheduler()
        else:
            self._start_thread_fallback()

        self._running = True
        logger.info("AutoHuntScheduler started")

    def _start_apscheduler(self):
        """使用 APScheduler 启动"""
        self._scheduler = BackgroundScheduler(daemon=True)
        self._scheduler.add_job(
            self._execute_hunt,
            CronTrigger(hour=0, minute=0),
            id="daily_autohunt",
            name="Daily AutoHunt at midnight",
            replace_existing=True,
        )
        self._scheduler.start()
        logger.info("APScheduler daily job registered (00:00)")

    def _start_thread_fallback(self):
        """
        回退方案：无 APScheduler 时使用 threading.Timer。
        每 60 秒检查一次是否到达 0 点。
        """
        def _loop():
            while self._running:
                now = datetime.now()
                if now.hour == 0 and now.minute == 0:
                    logger.info("Thread fallback: midnight trigger")
                    self._execute_hunt()
                import time
                time.sleep(60)  # 每分钟检查一次

        self._thread = threading.Thread(target=_loop, daemon=True)
        self._thread.start()
        logger.info("Thread fallback scheduler started (poll every 60s)")

    def _execute_hunt(self):
        """执行狩猎并缓存报告"""
        try:
            report = run_daily_hunt()
            self._last_report = report
            logger.info("Daily hunt executed: %s", report)
        except Exception as e:
            logger.error("Daily hunt failed: %s", e)
            self._last_report = {"error": str(e)}

    def stop(self):
        """停止调度器"""
        self._running = False
        if self._scheduler:
            self._scheduler.shutdown(wait=False)
            self._scheduler = None
        logger.info("AutoHuntScheduler stopped")

    @property
    def last_report(self) -> Optional[dict]:
        """上次狩猎执行报告"""
        return self._last_report

    @property
    def is_running(self) -> bool:
        return self._running


# ── 全局单例 ────────────────────────────────────────────────────

_scheduler_instance: Optional[AutoHuntScheduler] = None


def start_scheduler() -> AutoHuntScheduler:
    """获取/启动全局调度器单例"""
    global _scheduler_instance
    if _scheduler_instance is None:
        _scheduler_instance = AutoHuntScheduler()
        _scheduler_instance.start()
    elif not _scheduler_instance.is_running:
        _scheduler_instance.start()
    return _scheduler_instance


def get_scheduler() -> Optional[AutoHuntScheduler]:
    """获取当前调度器实例（可能为 None）"""
    return _scheduler_instance


# ── CLI Entry ──────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    print("Starting AutoHuntScheduler...")
    sched = start_scheduler()
    print("Scheduler running. Press Ctrl+C to stop.")
    try:
        import time
        while True:
            time.sleep(10)
    except KeyboardInterrupt:
        sched.stop()
        print("Scheduler stopped.")
