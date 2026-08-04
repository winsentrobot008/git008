"""
pipeline_orchestrator.py — Pipeline Orchestrator

Coordinates the full video generation pipeline by delegating to:
  1. emotion_engine   — analyze script emotion
  2. scene_planner    — plan scenes from emotion curve
  3. asset_selector   — select assets per scene
  4. render_engine    — build timeline + generate video

This module does NOT do any business logic itself.
It only calls the specialized modules in order.

Input:  script (str), ratio (str), voice (str), speed (float)
Output: dict with status, final_video, timeline, scenes, emotion
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("ZOO.PipelineOrchestrator")

# ─── Paths ─────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
JOBS_DIR = PROJECT_ROOT / "api" / "data" / "jobs"
GENERATED_DIR = PROJECT_ROOT / "api" / "data" / "generated"


@dataclass
class PipelineConfig:
    """Configuration for a single pipeline run."""
    script: str
    ratio: str = "1:1"
    voice: str = "default"
    speed: float = 1.0
    use_emotion: bool = True
    max_scenes: int = 8


@dataclass
class PipelineResult:
    """Result of a pipeline execution."""
    status: str                      # "ok" | "partial" | "failed"
    job_id: str
    final_video: Optional[str] = None
    timeline: Optional[dict] = None
    scenes: list = field(default_factory=list)
    emotion: Optional[dict] = None
    error: Optional[str] = None


def create_job(script: str, ratio: str = "1:1", voice: str = "default",
               speed: float = 1.0) -> str:
    """Create a job record and return job_id.
    
    The job is saved to data/jobs/{job_id}.json with status "pending".
    """
    job_id = f"job-{time.strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    job = {
        "job_id": job_id,
        "status": "pending",
        "script": script,
        "ratio": ratio,
        "voice": voice,
        "speed": speed,
        "created_at": time.time(),
        "updated_at": time.time(),
        "result": None,
    }
    JOBS_DIR.mkdir(parents=True, exist_ok=True)
    with open(JOBS_DIR / f"{job_id}.json", "w", encoding="utf-8") as f:
        json.dump(job, f, indent=2, ensure_ascii=False)
    logger.info(f"create_job: {job_id} (script_len={len(script)})")
    return job_id


def update_job_status(job_id: str, status: str, result: dict = None,
                       error: str = None) -> None:
    """Update a job's status and optional result.
    
    Status values: pending → queued → running → done/failed
    """
    path = JOBS_DIR / f"{job_id}.json"
    if not path.exists():
        logger.warning(f"update_job_status: job not found {job_id}")
        return
    with open(path, "r", encoding="utf-8") as f:
        job = json.load(f)
    job["status"] = status
    job["updated_at"] = time.time()
    if result:
        job["result"] = result
    if error:
        job["error"] = error
    with open(path, "w", encoding="utf-8") as f:
        json.dump(job, f, indent=2, ensure_ascii=False)
    logger.info(f"update_job_status: {job_id} → {status}")


def get_job(job_id: str) -> Optional[dict]:
    """Load a job record by ID."""
    path = JOBS_DIR / f"{job_id}.json"
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def list_recent_jobs(n: int = 20) -> list[dict]:
    """Return the N most recent job records."""
    if not JOBS_DIR.exists():
        return []
    jobs = []
    for f in sorted(JOBS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if f.suffix == ".json":
            try:
                with open(f, "r", encoding="utf-8") as fp:
                    jobs.append(json.load(fp))
            except Exception:
                pass
        if len(jobs) >= n:
            break
    return jobs


def run_pipeline(config: PipelineConfig) -> PipelineResult:
    """Execute the full pipeline: emotion → scenes → assets → render.
    
    This function can be called synchronously (from worker.py)
    or directly (for backward compatibility).
    """
    job_id = create_job(config.script, config.ratio, config.voice, config.speed)
    update_job_status(job_id, "running")

    try:
        # Step 1: Emotion Analysis
        logger.info(f"[{job_id}] Step 1/4: Emotion analysis")
        from workflow.emotion_engine import analyze_script
        emotion = analyze_script(config.script, max_phases=config.max_scenes)
        update_job_status(job_id, "running", {"emotion": {
            "dominant": emotion.dominant_emotion,
            "summary": emotion.summary,
            "phases": len(emotion.curve),
        }})

        # Step 2: Scene Planning
        logger.info(f"[{job_id}] Step 2/4: Scene planning")
        from workflow.scene_planner import plan_scenes
        scenes = plan_scenes(config.script, emotion, config.ratio)
        if not scenes:
            raise RuntimeError("Scene planning returned no scenes")

        # Step 3: Asset Selection
        logger.info(f"[{job_id}] Step 3/4: Asset selection")
        from workflow.asset_selector import select_assets
        enriched_scenes = select_assets(scenes)

        # Step 4: Render (real ffmpeg video, not placeholder)
        logger.info(f"[{job_id}] Step 4/4: Rendering with ffmpeg")
        from workflow.render_engine import build_timeline_from_scenes, generate_video_via_ffmpeg

        timeline = build_timeline_from_scenes(
            enriched_scenes, ratio=config.ratio
        )
        tl_id = timeline["timeline_id"]

        output_path = str(GENERATED_DIR / f"{tl_id}.mp4")
        generate_video_via_ffmpeg(enriched_scenes, output_path, config.ratio)

        result = PipelineResult(
            status="ok",
            job_id=job_id,
            final_video=output_path,
            timeline=timeline,
            scenes=enriched_scenes,
            emotion={
                "dominant": emotion.dominant_emotion,
                "summary": emotion.summary,
                "curve": [
                    {"label": p.label, "intensity": p.intensity}
                    for p in emotion.curve
                ],
            },
        )

        update_job_status(job_id, "done", {
            "status": "ok",
            "final_video": output_path,
            "timeline_id": tl_id,
            "scenes_count": len(scenes),
            "emotion_summary": emotion.summary,
        })

        logger.info(f"[{job_id}] Pipeline OK: {output_path}")
        return result

    except Exception as e:
        logger.error(f"[{job_id}] Pipeline FAILED: {e}")
        update_job_status(job_id, "failed", error=str(e))
        return PipelineResult(
            status="failed",
            job_id=job_id,
            error=str(e),
        )
