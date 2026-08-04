"""RoastBro — Scheduled Tasks

后台定时任务模块。

模块职责：
1. daily_task — 每日 0 点自动执行 AutoHunter 全流程
2. scheduler_service — 每 4 小时自动执行 Scout → Analyze → Queue 链路
"""

from .daily_task import AutoHuntScheduler, start_scheduler
from .scheduler_service import (
    ScoutScheduler,
    ScoutCycleReport,
    start_scout_scheduler,
    get_scout_scheduler,
    get_candidate_pool,
    run_scout_cycle,
)

__all__ = [
    "AutoHuntScheduler", "start_scheduler",
    "ScoutScheduler", "ScoutCycleReport",
    "start_scout_scheduler", "get_scout_scheduler",
    "get_candidate_pool", "run_scout_cycle",
]
