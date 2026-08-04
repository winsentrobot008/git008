"""Upgraded MVP video generation API.

POST /api/mvp-video
    Body: { "prompt": "...", "pipeline": "cinematic" }
    Calls OpenMontage VideoAgent synchronously — generates script, visuals,
    audio narration, subtitles, and composes everything into a video.

Architecture:
    prompt -> VideoAgent.generate_script()
          -> VideoAgent.generate_visuals()
          -> VideoAgent.generate_audio()
          -> VideoAgent.generate_subtitles()
          -> VideoAgent.compose_video()
          -> ViralMint/storage/mvp/{job_id}.mp4
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

# Ensure ViralMint root is on path
_VM_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_VM_ROOT) not in sys.path:
    sys.path.insert(0, str(_VM_ROOT))

# Add OpenMontage root to path for VideoAgent import
_OM_ROOT = Path(r"C:\Users\aoogoost\Desktop\Projekt\git008\OpenMontage")
if str(_OM_ROOT) not in sys.path:
    sys.path.insert(0, str(_OM_ROOT))

router = APIRouter()

# Storage for MVP-generated videos
MVP_DIR = _VM_ROOT / "storage" / "mvp"


@router.post("/mvp-video")
async def generate_mvp_video(body: dict):
    """Generate a video from a prompt using OpenMontage VideoAgent.

    The agent intelligently orchestrates:
    1. Script generation from prompt
    2. Visual asset generation/retrieval
    3. Audio narration (TTS)
    4. Subtitle generation
    5. Final video composition

    Request:
        prompt (str): The video idea/description
        pipeline (str): Pipeline name (cinematic, documentary-montage, animated-explainer)

    Response:
        success (bool): Whether generation succeeded
        video_url (str): URL to access the video (relative path)
        video_path (str): Absolute filesystem path
        job_id (str): Unique job identifier
        elapsed_seconds (float): Time taken
        stats (dict): Generation statistics
        logs (list): Detailed generation log
        error (str, optional): Error message if failed
    """
    prompt = (body.get("prompt") or "").strip()
    pipeline = (body.get("pipeline") or "cinematic").strip()

    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")
    if len(prompt) > 2000:
        raise HTTPException(status_code=400, detail="Prompt too long (max 2000 chars)")

    # Create output path with timestamp
    MVP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    job_id = f"mvp_{timestamp}"
    output_path = str(MVP_DIR / f"{job_id}.mp4")

    start_time = time.time()
    print(f"[MVP] Starting VideoAgent: pipeline={pipeline}, prompt='{prompt[:80]}...'")

    try:
        # Use the OpenMontage VideoAgent for intelligent pipeline execution
        from agents import VideoAgent

        agent = VideoAgent(pipeline=pipeline)
        result = agent.run(prompt, output_path=output_path)
        elapsed = time.time() - start_time

        # Print detailed logs
        for log_line in result.get("logs", []):
            print(f"[MVP-Agent] {log_line}")

        if result.get("success"):
            video_path = result.get("video_path", output_path)
            if Path(video_path).exists():
                size_mb = Path(video_path).stat().st_size / (1024 * 1024)
                stats = result.get("stats", {})
                print(f"[MVP] SUCCESS: video={video_path} ({size_mb:.1f}MB) in {elapsed:.1f}s")
                print(f"[MVP] Stats: {json.dumps(stats)}")
                return {
                    "success": True,
                    "video_url": f"/api/mvp-video/result/{job_id}",
                    "video_path": video_path,
                    "job_id": job_id,
                    "size_mb": round(size_mb, 1),
                    "elapsed_seconds": round(elapsed, 1),
                    "stats": stats,
                    "logs": result.get("logs", []),
                }
            else:
                error_msg = f"Agent reported success but video file not found at {video_path}"
                print(f"[MVP] FAIL: {error_msg}")
                return {
                    "success": False,
                    "error": error_msg,
                    "job_id": job_id,
                    "elapsed_seconds": round(elapsed, 1),
                    "logs": result.get("logs", []),
                }
        else:
            error_msg = result.get("error", "Unknown error")
            print(f"[MVP] FAIL: {error_msg}")
            return {
                "success": False,
                "error": error_msg,
                "job_id": job_id,
                "elapsed_seconds": round(elapsed, 1),
                "logs": result.get("logs", []),
            }

    except ImportError as e:
        # Fallback: use subprocess-based OpenMontage runner
        elapsed = time.time() - start_time
        print(f"[MVP] VideoAgent import failed ({e}), falling back to subprocess runner")
        print(f"[MVP] Adding OpenMontage path: {_OM_ROOT}")
        sys.path.insert(0, str(_OM_ROOT))
        try:
            from agents import VideoAgent
            agent = VideoAgent(pipeline=pipeline)
            result = agent.run(prompt, output_path=output_path)
            if result.get("success") and Path(result.get("video_path", "")).exists():
                vp = result["video_path"]
                size_mb = Path(vp).stat().st_size / (1024 * 1024)
                return {
                    "success": True,
                    "video_url": f"/api/mvp-video/result/{job_id}",
                    "video_path": vp,
                    "job_id": job_id,
                    "size_mb": round(size_mb, 1),
                    "elapsed_seconds": round(elapsed, 1),
                    "logs": result.get("logs", []),
                }
        except Exception:
            pass

        from backend.services.openmontage import run_pipeline
        sub_result = run_pipeline(pipeline, prompt, output_path=output_path)
        if sub_result.get("success") and Path(sub_result.get("video_path", "")).exists():
            vp = sub_result["video_path"]
            size_mb = Path(vp).stat().st_size / (1024 * 1024)
            return {
                "success": True,
                "video_url": f"/api/mvp-video/result/{job_id}",
                "video_path": vp,
                "job_id": job_id,
                "size_mb": round(size_mb, 1),
                "elapsed_seconds": round(elapsed, 1),
            }
        else:
            return {
                "success": False,
                "error": sub_result.get("error", str(e)),
                "job_id": job_id,
                "elapsed_seconds": round(elapsed, 1),
            }

    except Exception as e:
        elapsed = time.time() - start_time
        print(f"[MVP] ERROR: {e}")
        return {
            "success": False,
            "error": str(e),
            "job_id": job_id,
            "elapsed_seconds": round(elapsed, 1),
        }


@router.get("/mvp-video/result/{job_id}")
async def get_mvp_video_result(job_id: str):
    """Serve a previously generated MVP video file."""
    video_path = MVP_DIR / f"{job_id}.mp4"
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video not found")
    return FileResponse(
        path=str(video_path),
        media_type="video/mp4",
        filename=f"{job_id}.mp4",
    )


@router.get("/mvp-video/status/{job_id}")
async def get_mvp_job_status(job_id: str):
    """Check if an MVP-generated video exists and return its status."""
    # Strip 'mvp_' prefix if present for lookup
    lookup_name = job_id if job_id.startswith("mvp_") else f"mvp_{job_id}"
    video_path = MVP_DIR / f"{lookup_name}.mp4"

    if video_path.exists():
        size_mb = round(video_path.stat().st_size / (1024 * 1024), 2)
        return {
            "success": True,
            "status": "completed",
            "job_id": lookup_name,
            "size_mb": size_mb,
            "video_path": str(video_path),
            "video_url": f"/api/mvp-video/result/{lookup_name}",
        }
    else:
        # Also check without mvp_ prefix
        video_path2 = MVP_DIR / f"{job_id}.mp4"
        if video_path2.exists():
            size_mb = round(video_path2.stat().st_size / (1024 * 1024), 2)
            return {
                "success": True,
                "status": "completed",
                "job_id": job_id,
                "size_mb": size_mb,
                "video_path": str(video_path2),
                "video_url": f"/api/mvp-video/result/{job_id}",
            }
        return {
            "success": True,
            "status": "pending",
            "job_id": job_id,
        }
