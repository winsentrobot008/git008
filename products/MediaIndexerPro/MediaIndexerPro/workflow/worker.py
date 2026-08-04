"""
worker.py — Background Task Worker (module version)

Consumes pipeline jobs from data/jobs/ and executes them.
Invoked as: python -m workflow.worker --job <job_id>
Or daemon:  python -m workflow.worker --daemon

Uses os.path.join for all paths (Windows-safe).
Logs to PROJECT_ROOT/api/data/logs/worker.log
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

# ─── Project root ──────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# ─── Paths (Windows-safe) ─────────────────────────────────────────────────
JOBS_DIR = os.path.join(PROJECT_ROOT, "api", "data", "jobs")
LOG_DIR = os.path.join(PROJECT_ROOT, "api", "data", "logs")
WORKER_LOG = os.path.join(LOG_DIR, "worker.log")

# ─── Logging ───────────────────────────────────────────────────────────────
os.makedirs(LOG_DIR, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)-24s | %(levelname)-5s | %(message)s",
    handlers=[
        logging.FileHandler(WORKER_LOG, encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("ZOO.Worker")

# Circuit breaker — max process RSS in MB (0 = disabled)
MAX_PROCESS_MEMORY_MB = 3500


def _job_path(job_id: str) -> str:
    return os.path.join(JOBS_DIR, f"{job_id}.json")


def load_job(job_id: str) -> dict | None:
    path = _job_path(job_id)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_job(job_id: str, status: str, result: dict = None,
             error: str = None) -> None:
    path = _job_path(job_id)
    if not os.path.exists(path):
        logger.error(f"Job file not found: {path}")
        return
    with open(path, "r", encoding="utf-8") as f:
        job = json.load(f)
    job["status"] = status
    job["updated_at"] = time.time()
    if result is not None:
        job["result"] = result
    if error is not None:
        job["error"] = error
    with open(path, "w", encoding="utf-8") as f:
        json.dump(job, f, indent=2, ensure_ascii=False)
    logger.info(f"Job {job_id} → {status}")


def find_next_job() -> str | None:
    """Find the oldest job with status 'queued' or 'pending'."""
    if not os.path.exists(JOBS_DIR):
        return None
    candidates = []
    for fname in os.listdir(JOBS_DIR):
        if not fname.endswith(".json"):
            continue
        path = os.path.join(JOBS_DIR, fname)
        try:
            with open(path, "r", encoding="utf-8") as f:
                job = json.load(f)
            if job.get("status") in ("queued", "pending"):
                candidates.append((os.path.getmtime(path), job["job_id"]))
        except Exception:
            continue
    if not candidates:
        return None
    candidates.sort()
    return candidates[0][1]


def check_memory() -> bool:
    """Return True if process RSS is below threshold."""
    if MAX_PROCESS_MEMORY_MB <= 0:
        return True
    try:
        import psutil
        proc = psutil.Process(os.getpid())
        rss_mb = proc.memory_info().rss // (1024 * 1024)
        if rss_mb > MAX_PROCESS_MEMORY_MB:
            logger.warning(
                f"CIRCUIT BREAKER: process RSS {rss_mb}MB > "
                f"{MAX_PROCESS_MEMORY_MB}MB"
            )
            return False
        return True
    except Exception:
        return True


def process_job(job_id: str) -> None:
    """Load a job and run the pipeline."""
    logger.info(f"Processing job: {job_id}")

    job = load_job(job_id)
    if job is None:
        logger.error(f"Job not found: {job_id}")
        return

    save_job(job_id, "running")

    if not check_memory():
        save_job(job_id, "failed", error="Circuit breaker: memory too high")
        return

    try:
        from workflow.pipeline_orchestrator import run_pipeline, PipelineConfig

        config = PipelineConfig(
            script=job.get("script", ""),
            ratio=job.get("ratio", "1:1"),
            voice=job.get("voice", "default"),
            speed=job.get("speed", 1.0),
        )

        result = run_pipeline(config)

        if result.status == "ok":
            save_job(job_id, "done", result={
                "status": "ok",
                "final_video": result.final_video,
                "timeline_id": result.timeline.get("timeline_id") if result.timeline else None,
                "scenes_count": len(result.scenes) if result.scenes else 0,
                "emotion_summary": result.emotion.get("summary", "") if result.emotion else "",
            })
            logger.info(f"Job {job_id} OK: {result.final_video}")
        else:
            save_job(job_id, "failed", error=result.error or "Unknown error")
            logger.error(f"Job {job_id} FAILED: {result.error}")

    except Exception as e:
        logger.exception(f"Job {job_id} CRASHED: {e}")
        save_job(job_id, "failed", error=str(e))


def main():
    parser = argparse.ArgumentParser(description="MediaIndexerPro Worker")
    parser.add_argument("--job", type=str, default=None,
                        help="Specific job_id to process")
    parser.add_argument("--once", action="store_true",
                        help="Auto-find and process one pending job")
    parser.add_argument("--daemon", action="store_true",
                        help="Run continuously, polling for jobs")
    args = parser.parse_args()

    if args.job:
        process_job(args.job)
    elif args.once:
        jid = find_next_job()
        if jid:
            process_job(jid)
        else:
            logger.info("No pending jobs")
    elif args.daemon:
        logger.info("Worker daemon started (polling every 3s)")
        while True:
            jid = find_next_job()
            if jid and check_memory():
                process_job(jid)
            time.sleep(3)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
