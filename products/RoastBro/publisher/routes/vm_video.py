"""Video generation API routes.

POST /api/video/start   — Start a new video generation job
GET  /api/video/status/:jobId — Poll job status
GET  /api/video/result/:jobId — Get video file URL
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from backend.queue.video_tasks import task_manager
from backend.services.openmontage import list_pipelines


router = APIRouter()

# Directory where generated videos are stored
STORAGE_DIR = Path(__file__).resolve().parent.parent.parent / "storage" / "videos"


@router.post("/start")
async def start_video_job(body: dict):
    """Start a new video generation job.

    Request body:
        prompt (str): User's video idea / description
        pipeline (str): Pipeline name (e.g., "cinematic", "documentary-montage")
    """
    prompt = body.get("prompt", "").strip()
    pipeline = body.get("pipeline", "").strip()

    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")
    if len(prompt) > 2000:
        raise HTTPException(status_code=400, detail="Prompt too long (max 2000 characters)")
    if not pipeline:
        raise HTTPException(status_code=400, detail="Pipeline is required")

    # Validate pipeline name
    available = list_pipelines()
    if pipeline not in available:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown pipeline '{pipeline}'. Available: {', '.join(available.keys())}",
        )

    # Create and start the job
    job_id = task_manager.create_job(pipeline, prompt)

    return {
        "job_id": job_id,
        "status": "queued",
        "message": "Video generation job created",
        "poll_url": f"/api/video/status/{job_id}",
    }


@router.get("/status/{job_id}")
async def get_job_status(job_id: str):
    """Get the status of a video generation job."""
    job = task_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")

    return {
        "job_id": job["job_id"],
        "status": job["status"],
        "progress": job["progress"],
        "created_at": job["created_at"],
        "completed_at": job["completed_at"],
        "error": job.get("error"),
    }


@router.get("/result/{job_id}")
async def get_video_result(job_id: str):
    """Get the generated video file."""
    job = task_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    if job["status"] != "completed":
        raise HTTPException(status_code=400, detail=f"Job is {job['status']}, not completed yet")
    if not job.get("video_path"):
        raise HTTPException(status_code=500, detail="Video path not found")

    video_path = Path(job["video_path"])
    if not video_path.exists():
        # Try the storage directory
        alt_path = STORAGE_DIR / f"{job_id}.mp4"
        if alt_path.exists():
            video_path = alt_path
        else:
            raise HTTPException(status_code=404, detail="Video file not found on disk")

    return FileResponse(
        path=str(video_path),
        media_type="video/mp4",
        filename=f"{job_id}.mp4",
    )


@router.get("/pipelines")
async def get_available_pipelines():
    """List available video generation pipelines."""
    return list_pipelines()
