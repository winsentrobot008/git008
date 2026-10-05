"""渲染作业注册表：线程安全的阶段 / 进度 / 日志环形缓冲 + WebSocket 广播。"""

from __future__ import annotations

import queue
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

__all__ = ["Job", "JobRegistry", "REGISTRY", "STAGES", "progress_for_stage"]

# 阶段机（顺序即进度推算依据）
STAGES = (
    "queued",
    "validating",
    "adapting",
    "rendering",
    "inspecting",
    "completed",
)
_TERMINAL = {"completed", "failed"}
_MAX_LOGS = 600


def progress_for_stage(stage: str) -> int:
    """阶段 → 百分比（用于顶栏/进度条）。"""
    if stage == "failed":
        return 100
    weights = {"queued": 2, "validating": 10, "adapting": 24, "rendering": 72, "inspecting": 92, "completed": 100}
    return weights.get(stage, 0)


@dataclass
class Job:
    kind: str
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    state: str = "running"          # running | completed | failed
    stage: str = "queued"
    logs: list[dict] = field(default_factory=list)
    result: Optional[dict] = None
    error: Optional[dict] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    _subscribers: list[queue.Queue] = field(default_factory=list, repr=False)

    @property
    def progress(self) -> int:
        return progress_for_stage(self.stage)

    def snapshot(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "state": self.state,
            "stage": self.stage,
            "progress": self.progress,
            "logs": list(self.logs),
            "result": self.result,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class JobRegistry:
    """内存作业表；单机单进程足够，重启即清空。"""

    def __init__(self, ttl_seconds: float = 6 * 3600.0) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.RLock()
        self._ttl = ttl_seconds

    # -- 生命周期 ---------------------------------------------------------
    def create(self, kind: str = "render") -> Job:
        job = Job(kind=kind)
        with self._lock:
            self._sweep()
            self._jobs[job.id] = job
            self._publish_locked(job, {"type": "stage", "stage": job.stage, "progress": job.progress})
        return job

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def _sweep(self) -> None:
        if not self._jobs:
            return
        cutoff = time.time() - self._ttl
        for jid in [j.id for j in self._jobs.values() if j.updated_at < cutoff]:
            self._jobs.pop(jid, None)

    # -- 事件 -------------------------------------------------------------
    def publish(self, job: Job, event: dict) -> None:
        with self._lock:
            if job.id not in self._jobs:
                return
            if event.get("type") == "log":
                job.logs.append({"t": round(time.time() - job.created_at, 2), "line": event.get("line", "")})
                if len(job.logs) > _MAX_LOGS:
                    del job.logs[: len(job.logs) - _MAX_LOGS]
            job.updated_at = time.time()
            self._publish_locked(job, event)

    def _publish_locked(self, job: Job, event: dict) -> None:
        for sub in list(job._subscribers):
            try:
                sub.put_nowait(event)
            except queue.Full:  # 慢消费者丢弃事件，靠 GET /api/jobs/{id} 补齐
                pass

    def set_stage(self, job: Job, stage: str) -> None:
        if stage == job.stage:
            return
        job.stage = stage
        self.publish(job, {"type": "stage", "stage": stage, "progress": job.progress})

    def finish(self, job: Job, result: dict) -> None:
        job.result = result
        job.state = "completed"
        job.stage = "completed"
        self.publish(job, {"type": "done", "stage": "completed", "progress": 100, "result": result})

    def fail(self, job: Job, code: str, message: str, detail: Any = None) -> None:
        job.error = {"code": code, "message": message, "detail": detail}
        job.state = "failed"
        job.stage = "failed"
        self.publish(job, {"type": "error", "stage": "failed", "progress": 100, "error": job.error})

    # -- 订阅 -------------------------------------------------------------
    def subscribe(self, job: Job) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=1000)
        with self._lock:
            job._subscribers.append(q)
        return q

    def unsubscribe(self, job: Job, q: queue.Queue) -> None:
        with self._lock:
            if q in job._subscribers:
                job._subscribers.remove(q)


REGISTRY = JobRegistry()