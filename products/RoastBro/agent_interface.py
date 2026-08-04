"""
Agent Interface — 轻量智能体接口
===================================
独立版 RoastBro 的任务执行器、日志记录、错误处理。
不依赖 ZOO 主系统。

v2.1 — 新增：
- VideoSourceStrategyTask: 视频源策略选择任务
- ZOO 面板策略配置读写
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Any, Optional, List
import json
import logging
import traceback
from pathlib import Path


ROOT = Path(__file__).resolve().parent
LOG_DIR = ROOT / "logs"
CONFIG_DIR = ROOT / "configs"


@dataclass
class TaskResult:
    """任务执行结果"""
    task_id: str
    status: str  # success / failed / skipped
    duration_ms: float
    output: Any = None
    error: str = ""


class AgentLogger:
    """轻量日志记录器"""

    def __init__(self, name: str = "roastbro"):
        LOG_DIR.mkdir(exist_ok=True)
        self.logger = logging.getLogger(name)
        self.logger.setLevel(logging.INFO)
        fh = logging.FileHandler(LOG_DIR / f"{name}_{datetime.now().strftime('%Y%m%d')}.log", encoding="utf-8")
        fh.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s: %(message)s"))
        self.logger.addHandler(fh)

    def info(self, msg: str): self.logger.info(msg)
    def warn(self, msg: str): self.logger.warning(msg)
    def error(self, msg: str): self.logger.error(msg)


class TaskExecutor:
    """轻量任务执行器"""

    def __init__(self):
        self.logger = AgentLogger()

    def execute(self, task_name: str, fn, *args, **kwargs) -> TaskResult:
        task_id = f"{task_name}_{datetime.now().strftime('%H%M%S')}"
        start = datetime.now()
        try:
            result = fn(*args, **kwargs)
            duration = (datetime.now() - start).total_seconds() * 1000
            self.logger.info(f"{task_id}: success ({duration:.0f}ms)")
            return TaskResult(task_id=task_id, status="success", duration_ms=duration, output=result)
        except Exception as e:
            duration = (datetime.now() - start).total_seconds() * 1000
            self.logger.error(f"{task_id}: failed — {e}\n{traceback.format_exc()}")
            return TaskResult(task_id=task_id, status="failed", duration_ms=duration, error=str(e))


class ErrorHandler:
    """轻量错误处理"""

    @staticmethod
    def safe(fn, default=None):
        try:
            return fn()
        except Exception:
            return default


# ═══════════════════════════════════════════════════════
# VideoSourceStrategyTask — ZOO 视频源策略选择
# ═══════════════════════════════════════════════════════

AVAILABLE_STRATEGIES = [
    {"id": "tiktok_api",     "name": "TikTokApiSource",     "description": "TikTokApi.video().bytes() 高清抓取"},
    {"id": "yt_dlp",         "name": "YtDlpSource",         "description": "yt-dlp 高清下载器"},
    {"id": "selenium_mobile","name": "SeleniumMobileSource","description": "Selenium + Mobile UA 抓取"},
    {"id": "ffmpeg_m3u8",    "name": "FfmpegM3u8Source",    "description": "FFmpeg m3u8 分片合并"},
    {"id": "playwright",     "name": "PlaywrightSource",    "description": "现有 Playwright 抓取（备选）"},
    {"id": "fallback",       "name": "FallbackSource",      "description": "moviepy 高清占位源（最终 Fallback）"},
]

STRATEGY_CONFIG_PATH = CONFIG_DIR / "zoo_source_strategy.json"


def get_available_strategies() -> List[Dict[str, str]]:
    """返回所有可用策略列表（供 ZOO 面板显示）"""
    return AVAILABLE_STRATEGIES


def get_zoo_strategy_config() -> Dict[str, Any]:
    """读取 ZOO 策略配置文件"""
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        if STRATEGY_CONFIG_PATH.exists():
            return json.loads(STRATEGY_CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {"default_strategy": "", "last_updated": ""}


def set_zoo_strategy_config(strategy_id: str) -> bool:
    """
    在 ZOO 面板中设置默认策略。

    Args:
        strategy_id: 策略 ID (tiktok_api / yt_dlp / selenium_mobile / ffmpeg_m3u8 / playwright / fallback)

    Returns:
        bool — 是否设置成功
    """
    if not any(s["id"] == strategy_id for s in AVAILABLE_STRATEGIES):
        return False

    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        config = {
            "default_strategy": strategy_id,
            "last_updated": datetime.now().isoformat(),
        }
        STRATEGY_CONFIG_PATH.write_text(
            json.dumps(config, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )
        return True
    except Exception as e:
        logging.getLogger("roastbro.agent").error(f"Failed to set strategy: {e}")
        return False


class VideoSourceStrategyTask:
    """
    ZOO 任务面板中的「视频源策略选择」任务。

    用法：
        task = VideoSourceStrategyTask()
        task.execute(strategy_id="yt_dlp")
    """

    def __init__(self):
        self.logger = AgentLogger("source_strategy")

    def execute(self, strategy_id: str) -> TaskResult:
        """
        执行策略选择任务。

        Args:
            strategy_id: 策略 ID

        Returns:
            TaskResult
        """
        task_id = f"source_strategy_{datetime.now().strftime('%H%M%S')}"
        start = datetime.now()

        # Validate strategy
        valid_ids = [s["id"] for s in AVAILABLE_STRATEGIES]
        if strategy_id not in valid_ids:
            duration = (datetime.now() - start).total_seconds() * 1000
            return TaskResult(
                task_id=task_id, status="failed",
                duration_ms=duration,
                error=f"Invalid strategy: {strategy_id}. Valid: {valid_ids}"
            )

        # Save to config
        success = set_zoo_strategy_config(strategy_id)
        duration = (datetime.now() - start).total_seconds() * 1000

        if success:
            strategy_name = next(s["name"] for s in AVAILABLE_STRATEGIES if s["id"] == strategy_id)
            self.logger.info(f"Strategy set: {strategy_id} ({strategy_name})")
            return TaskResult(
                task_id=task_id, status="success",
                duration_ms=duration,
                output={
                    "strategy_id": strategy_id,
                    "strategy_name": strategy_name,
                    "message": f"Default HD source strategy set to: {strategy_name}",
                }
            )
        else:
            return TaskResult(
                task_id=task_id, status="failed",
                duration_ms=duration,
                error="Failed to write config"
            )
