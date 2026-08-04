"""
Factory Controller — 内容工厂全局调度控制器
==============================================
暂停/恢复/停止任务、队列管理、状态监控。
"""

from dataclasses import dataclass
from typing import Dict, Any
from enum import Enum
from pathlib import Path
import json
from datetime import datetime


ROOT = Path(__file__).resolve().parent.parent


class FactoryState(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    STOPPING = "stopping"


@dataclass
class FactoryStatus:
    state: FactoryState = FactoryState.IDLE
    current_video_id: str = ""
    current_step: int = 0
    cn_progress: float = 0.0
    en_progress: float = 0.0
    videos_today: int = 0
    drafts_today: int = 0
    published_today: int = 0
    queue_length: int = 0
    errors: list = None

    def to_dict(self) -> Dict:
        return {
            "state": self.state.value,
            "current_video_id": self.current_video_id,
            "current_step": self.current_step,
            "cn_progress": self.cn_progress,
            "en_progress": self.en_progress,
            "videos_today": self.videos_today,
            "drafts_today": self.drafts_today,
            "published_today": self.published_today,
            "queue_length": self.queue_length,
            "errors": self.errors or [],
        }


class FactoryController:
    """工厂控制器 — 全局调度"""

    def __init__(self):
        self._status = FactoryStatus()
        self._config_path = ROOT / "config" / "factory_config.json"
        self._load_config()

    @property
    def status(self) -> FactoryStatus:
        return self._status

    def pause(self) -> bool:
        if self._status.state == FactoryState.RUNNING:
            self._status.state = FactoryState.PAUSED
            return True
        return False

    def resume(self) -> bool:
        if self._status.state == FactoryState.PAUSED:
            self._status.state = FactoryState.RUNNING
            return True
        return False

    def stop_task(self) -> bool:
        if self._status.state in (FactoryState.RUNNING, FactoryState.PAUSED):
            self._status.state = FactoryState.STOPPING
            return True
        return False

    def restart_pipeline(self) -> bool:
        self._status.state = FactoryState.RUNNING
        self._status.current_step = 0
        self._status.current_video_id = ""
        return True

    def clear_queue(self) -> bool:
        self._status.queue_length = 0
        return True

    def get_config(self) -> Dict:
        return self._config

    def update_config(self, updates: Dict) -> bool:
        self._config.update(updates)
        self._save_config()
        return True

    # ── Internal ─────────────────────────────────────────────

    def _load_config(self):
        default = {
            "cn_script_weight": 0.5, "en_script_weight": 0.5,
            "creator_structure_weight": 0.33, "creator_emotion_weight": 0.33,
            "creator_pacing_weight": 0.33, "editing_pacing": "medium",
            "voice_speed": 1.0, "subtitle_density": 0.5,
            "seo_intensity": 0.7, "compliance_strictness": "standard",
            "auto_fetch_interval": 60, "auto_fetch_source": "both",
            "daily_production_limit": 10,
            "content_priority": ["reaction", "meme", "commentary", "challenge"],
        }
        if self._config_path.exists():
            try:
                self._config = json.loads(self._config_path.read_text(encoding="utf-8"))
                for k, v in default.items():
                    self._config.setdefault(k, v)
            except Exception:
                self._config = default
        else:
            self._config = default
        self._save_config()

    def _save_config(self):
        self._config_path.write_text(
            json.dumps(self._config, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
