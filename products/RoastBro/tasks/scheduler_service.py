"""
ScoutScheduler — 全天候巡航调度服务 (24/7 Auto-Scout Scheduler)
================================================================
使用 APScheduler 每 4 小时自动触发 Scout → Analyze → Queue 链路。

链路流程:
    AutoScout.scout_all()      →  TikTok 多标签视频抓取 + 趋势过滤
    ScoutAnalyzer.evaluate()   →  轻量级槽点潜力评估
    AutoHunter.push_to_queue() →  将 High_Potential 视频推入生产队列

Usage:
    # 单独启动调度器
    python -m tasks.scheduler_service

    # 在应用中集成
    from tasks.scheduler_service import start_scout_scheduler
    scheduler = start_scout_scheduler()
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

# ── 尝试导入 APScheduler ───────────────────────────────────────
try:
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.interval import IntervalTrigger
    HAS_APSCHEDULER = True
except ImportError:
    HAS_APSCHEDULER = False
    logger.warning("APScheduler not installed. Scheduler will use threading fallback.")

# ── 尝试导入依赖模块 ────────────────────────────────────────────
try:
    from scrapers.auto_scout import AutoScout, ScoutedVideo
    HAS_SCOUT = True
except ImportError:
    HAS_SCOUT = False
    logger.warning("AutoScout not available.")

try:
    from analyzer.scout_analyzer import ScoutAnalyzer, ScoutAnalysisResult
    HAS_ANALYZER = True
except ImportError:
    HAS_ANALYZER = False
    logger.warning("ScoutAnalyzer not available.")

try:
    from scrapers.auto_hunter import AutoHunter
    HAS_HUNTER = True
except ImportError:
    HAS_HUNTER = False
    logger.warning("AutoHunter not available.")


# ── 默认配置 ────────────────────────────────────────────────────

DEFAULT_TAGS = ["fail", "cringe", "wtf", "funny", "gonewrong"]
PER_TAG_LIMIT = 15
SCORE_FLOOR = 50.0
QUEUE_PATH = Path("data/autoscout/candidate_pool.json")


@dataclass
class ScoutCycleReport:
    """单次巡航周期报告"""
    cycle_id: str = ""
    tags_scanned: List[str] = field(default_factory=list)
    total_videos: int = 0
    trending_count: int = 0
    high_potential_count: int = 0
    pushed_count: int = 0
    top_score: float = 0.0
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    errors: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "cycle_id": self.cycle_id,
            "tags_scanned": self.tags_scanned,
            "total_videos": self.total_videos,
            "trending_count": self.trending_count,
            "high_potential_count": self.high_potential_count,
            "pushed_count": self.pushed_count,
            "top_score": round(self.top_score, 1),
            "timestamp": self.timestamp,
            "errors": self.errors,
        }


# ── 核心链路函数 ────────────────────────────────────────────────

def run_scout_cycle(
    tags: Optional[List[str]] = None,
    per_tag_limit: int = PER_TAG_LIMIT,
    score_floor: float = SCORE_FLOOR,
) -> ScoutCycleReport:
    """
    执行一次完整的 Scout → Analyze → Queue 链路。

    流程:
        1. AutoScout.scout_all()        → 多标签并行抓取 + 趋势过滤
        2. ScoutAnalyzer.evaluate_batch() → 轻量级槽点评估
        3. 标记 High_Potential 的视频
        4. AutoHunter.push_to_queue()   → 推入生产队列
        5. 候选池同步

    Returns:
        ScoutCycleReport: 本次巡航报告
    """
    report = ScoutCycleReport(
        cycle_id=datetime.now().strftime("cycle_%Y%m%d_%H%M%S"),
        tags_scanned=tags or DEFAULT_TAGS,
    )

    if not HAS_SCOUT or not HAS_ANALYZER:
        report.errors.append("Dependencies missing: AutoScout or ScoutAnalyzer")
        logger.error("Scout cycle aborted: missing dependencies")
        return report

    # ── Step 1: Scout — 多标签侦察 ──
    logger.info("=== Scout Cycle %s started ===", report.cycle_id)
    scout = AutoScout()
    all_videos: List[ScoutedVideo] = []

    try:
        all_videos = asyncio.run(
            scout.scout_all(
                tags=tags or DEFAULT_TAGS,
                per_tag_limit=per_tag_limit,
            )
        )
        report.total_videos = len(all_videos)
        report.trending_count = sum(1 for v in all_videos if v.is_trending)
        logger.info("  Scout: %d videos, %d trending", report.total_videos, report.trending_count)
    except Exception as e:
        logger.error("  Scout failed: %s", e)
        report.errors.append(f"Scout failed: {e}")

    if not all_videos:
        logger.warning("  No videos found, aborting cycle")
        report.errors.append("No videos found")
        return report

    # ── Step 2: Analyze — 槽点潜力评估 ──
    analyzer = ScoutAnalyzer()
    analysis_results: List[ScoutAnalysisResult] = []

    try:
        analysis_results = analyzer.evaluate_batch(all_videos)
        # 将分析结果回填到 ScoutedVideo
        result_map = {r.url: r for r in analysis_results}
        for v in all_videos:
            if v.url in result_map:
                r = result_map[v.url]
                v.roast_potential = r.roast_potential_score
                v.high_potential = r.high_potential

        report.high_potential_count = sum(1 for v in all_videos if v.high_potential)
        report.top_score = max((v.roast_potential for v in all_videos), default=0.0)
        logger.info(
            "  Analyze: %d analyzed, %d high_potential, top_score=%.1f",
            len(analysis_results), report.high_potential_count, report.top_score,
        )
    except Exception as e:
        logger.error("  Analyze failed: %s", e)
        report.errors.append(f"Analyze failed: {e}")

    # ── Step 3: 候选池同步 (candidate_pool.json) ──
    try:
        _sync_candidate_pool(all_videos, analysis_results)
    except Exception as e:
        logger.error("  Candidate pool sync failed: %s", e)
        report.errors.append(f"Candidate pool sync failed: {e}")

    # ── Step 4: Queue — 推入生产队列 ──
    if HAS_HUNTER:
        try:
            high_potential_videos = [
                v for v in all_videos
                if v.high_potential and v.roast_potential >= score_floor
            ]
            if high_potential_videos:
                hunter = AutoHunter()
                # 转换为 HuntedVideo 格式
                from scrapers.auto_hunter import HuntedVideo
                queue_items = [
                    HuntedVideo(
                        url=v.url,
                        title=v.title,
                        video_id=v.video_id,
                        author=v.author,
                        platform=v.platform,
                        roast_score=v.roast_potential,
                        hunted_at=v.scouted_at,
                    )
                    for v in high_potential_videos
                ]
                pushed = asyncio.run(hunter.push_to_queue(queue_items))
                report.pushed_count = pushed
                logger.info("  Queue: pushed %d high-potential videos", pushed)
            else:
                logger.info("  Queue: no high-potential videos to push")
        except Exception as e:
            logger.error("  Queue push failed: %s", e)
            report.errors.append(f"Queue push failed: {e}")
    else:
        logger.warning("  AutoHunter not available, skipping queue push")

    logger.info("=== Scout Cycle %s done: %s ===", report.cycle_id, report.to_dict())
    return report


def _sync_candidate_pool(
    videos: List[ScoutedVideo],
    analysis: List[ScoutAnalysisResult],
) -> None:
    """将侦察结果同步到候选池 (candidate_pool.json)"""
    QUEUE_PATH.parent.mkdir(parents=True, exist_ok=True)

    # 读取已有候选池
    existing = []
    if QUEUE_PATH.exists():
        try:
            existing = json.loads(QUEUE_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, Exception):
            existing = []

    existing_urls = {e.get("url") for e in existing}

    # 构建分析结果映射
    analysis_map = {r.url: r for r in analysis}

    new_entries = []
    for v in videos:
        if v.url in existing_urls:
            continue
        a = analysis_map.get(v.url)
        entry = {
            "url": v.url,
            "title": v.title,
            "video_id": v.video_id,
            "author": v.author,
            "platform": v.platform,
            "tags": v.tags,
            "likes": v.likes,
            "comments": v.comments,
            "shares": v.shares,
            "views": v.views,
            "engagement_rate": round(v.engagement_rate, 6),
            "is_trending": v.is_trending,
            "roast_potential": round(v.roast_potential, 1),
            "high_potential": v.high_potential,
            "scouted_at": v.scouted_at,
        }
        if a:
            entry["signal_count"] = a.signal_count
            entry["signal_density"] = round(a.signal_density, 4)
            entry["signal_matches"] = a.signal_matches
        new_entries.append(entry)

    if new_entries:
        existing.extend(new_entries)
        # 保留最近 500 条
        existing = existing[-500:]
        QUEUE_PATH.write_text(
            json.dumps(existing, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        logger.info("  Candidate pool: added %d new entries (total %d)", len(new_entries), len(existing))
    else:
        logger.info("  Candidate pool: no new entries")


def get_candidate_pool() -> List[Dict[str, Any]]:
    """读取候选池"""
    if not QUEUE_PATH.exists():
        return []
    try:
        return json.loads(QUEUE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []


# ── APScheduler Wrapper ────────────────────────────────────────

class ScoutScheduler:
    """
    全天候巡航调度器。

    每 4 小时自动执行一次:
        Scout → Analyze → Candidate Pool Sync → Queue

    用法:
        scheduler = ScoutScheduler()
        scheduler.start()
        # ...
        scheduler.stop()
    """

    def __init__(self, interval_hours: int = 4):
        self.interval_hours = interval_hours
        self._scheduler: Optional[BackgroundScheduler] = None
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._last_report: Optional[ScoutCycleReport] = None
        self._cycle_count: int = 0

    def start(self):
        """启动调度器（自动判断 APScheduler 可用性）"""
        if self._running:
            logger.warning("ScoutScheduler already running")
            return

        if HAS_APSCHEDULER:
            self._start_apscheduler()
        else:
            self._start_thread_fallback()

        self._running = True
        logger.info("ScoutScheduler started (interval=%dh)", self.interval_hours)

    def _start_apscheduler(self):
        """使用 APScheduler 启动"""
        self._scheduler = BackgroundScheduler(daemon=True)
        self._scheduler.add_job(
            self._execute_cycle,
            IntervalTrigger(hours=self.interval_hours),
            id="scout_cycle",
            name=f"Auto-Scout every {self.interval_hours}h",
            replace_existing=True,
        )
        # 启动后立即执行一次
        self._scheduler.add_job(
            self._execute_cycle,
            trigger="date",
            id="scout_cycle_initial",
            name="Initial scout cycle",
            replace_existing=True,
        )
        self._scheduler.start()
        logger.info("APScheduler scout job registered (every %dh + initial run)", self.interval_hours)

    def _start_thread_fallback(self):
        """
        回退方案：无 APScheduler 时使用 threading.Timer。
        每 60 秒检查一次是否到达执行时间。
        """
        import time

        def _loop():
            last_run = 0
            while self._running:
                now = time.time()
                # 首次立即运行，之后每 interval_hours 小时运行
                if last_run == 0 or (now - last_run) >= self.interval_hours * 3600:
                    logger.info("Thread fallback: timer trigger")
                    self._execute_cycle()
                    last_run = now
                time.sleep(60)  # 每分钟检查一次

        self._thread = threading.Thread(target=_loop, daemon=True)
        self._thread.start()
        logger.info("Thread fallback scheduler started (poll every 60s)")

    def _execute_cycle(self):
        """执行一次巡航周期"""
        self._cycle_count += 1
        report = run_scout_cycle()
        self._last_report = report
        logger.info(
            "Cycle #%d done: pushed=%d high_potential=%d errors=%d",
            self._cycle_count,
            report.pushed_count,
            report.high_potential_count,
            len(report.errors),
        )

    def stop(self):
        """停止调度器"""
        self._running = False
        if self._scheduler:
            self._scheduler.shutdown(wait=False)
            self._scheduler = None
        logger.info("ScoutScheduler stopped (cycles=%d)", self._cycle_count)

    @property
    def last_report(self) -> Optional[ScoutCycleReport]:
        return self._last_report

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def cycle_count(self) -> int:
        return self._cycle_count


# ── 全局单例 ────────────────────────────────────────────────────

_scheduler_instance: Optional[ScoutScheduler] = None


def start_scout_scheduler(interval_hours: int = 4) -> ScoutScheduler:
    """获取/启动全局调度器单例"""
    global _scheduler_instance
    if _scheduler_instance is None:
        _scheduler_instance = ScoutScheduler(interval_hours=interval_hours)
        _scheduler_instance.start()
    elif not _scheduler_instance.is_running:
        _scheduler_instance.start()
    return _scheduler_instance


def get_scout_scheduler() -> Optional[ScoutScheduler]:
    """获取当前调度器实例（可能为 None）"""
    return _scheduler_instance


# ── CLI Entry ──────────────────────────────────────────────────

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    print("🔥 Starting Auto-Scout Scheduler (24/7)...")
    sched = start_scout_scheduler(interval_hours=4)
    print(f"✅ Scheduler running (interval={sched.interval_hours}h). Press Ctrl+C to stop.")
    try:
        import time
        while True:
            time.sleep(10)
    except KeyboardInterrupt:
        sched.stop()
        print("Scheduler stopped.")
