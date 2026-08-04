"""Background video generation task queue.

Uses threading to run OpenMontage pipelines without blocking the API.
Frontend polls /api/video/status/{job_id} for progress.
"""

from __future__ import annotations

import threading
import time
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from backend.services.openmontage import run_pipeline


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    RENDERING = "rendering"
    COMPLETED = "completed"
    FAILED = "failed"


class VideoTaskManager:
    """In-memory task manager for video generation jobs.

    In production, replace with Redis + Celery / RQ for persistence
    and cross-process coordination.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}

    def create_job(self, pipeline: str, prompt: str) -> str:
        """Create a new video generation job and return its ID."""
        job_id = uuid.uuid4().hex[:12]
        with self._lock:
            self._jobs[job_id] = {
                "job_id": job_id,
                "pipeline": pipeline,
                "prompt": prompt,
                "status": JobStatus.QUEUED,
                "progress": 0,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "completed_at": None,
                "video_path": None,
                "error": None,
            }

        # Start background execution
        thread = threading.Thread(
            target=self._execute_job,
            args=(job_id, pipeline, prompt),
            daemon=True,
        )
        thread.start()

        return job_id

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        """Get job status and metadata."""
        with self._lock:
            return self._jobs.get(job_id)

    def _execute_job(self, job_id: str, pipeline: str, prompt: str) -> None:
        """Execute the pipeline in a background thread."""
        try:
            # Update status to running
            with self._lock:
                self._jobs[job_id]["status"] = JobStatus.RUNNING
                self._jobs[job_id]["progress"] = 10

            time.sleep(1)  # Brief pause to let the status propagate

            # Update to rendering
            with self._lock:
                self._jobs[job_id]["status"] = JobStatus.RENDERING
                self._jobs[job_id]["progress"] = 30

            # Run the actual pipeline
            from pathlib import Path
            storage_dir = Path(__file__).resolve().parent.parent.parent / "storage" / "videos"
            storage_dir.mkdir(parents=True, exist_ok=True)
            output_path = str(storage_dir / f"{job_id}.mp4")

            result = run_pipeline(pipeline, prompt, output_path=output_path)

            with self._lock:
                job = self._jobs[job_id]
                if result.get("success"):
                    job["status"] = JobStatus.COMPLETED
                    job["progress"] = 100
                    job["video_path"] = result.get("video_path", output_path)
                    job["completed_at"] = datetime.now(timezone.utc).isoformat()
                else:
                    job["status"] = JobStatus.FAILED
                    job["error"] = result.get("error", "Unknown error")
                    job["progress"] = 0

        except Exception as e:
            with self._lock:
                self._jobs[job_id]["status"] = JobStatus.FAILED
                self._jobs[job_id]["error"] = str(e)
                self._jobs[job_id]["progress"] = 0


# Singleton instance
task_manager = VideoTaskManager()
