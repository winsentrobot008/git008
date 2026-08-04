"""
worker_daemon.py — Auto-polling worker daemon

Runs in background, checks for pending jobs every 3 seconds.
Spawns workflow.worker --once for each pending job.

Can be launched by server.py on startup.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

LOG_DIR = os.path.join(PROJECT_ROOT, "api", "data", "logs")
os.makedirs(LOG_DIR, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)-24s | %(levelname)-5s | %(message)s",
    handlers=[
        logging.FileHandler(os.path.join(LOG_DIR, "worker_daemon.log"), encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("ZOO.WorkerDaemon")

POLL_INTERVAL = 3  # seconds

# Path to the worker module
WORKER_CMD = [sys.executable, "-m", "workflow.worker", "--once"]
WORKER_LOG_PATH = os.path.join(LOG_DIR, "worker.log")


def has_pending_jobs() -> bool:
    """Quick check if any job files have pending/queued status."""
    jobs_dir = os.path.join(PROJECT_ROOT, "api", "data", "jobs")
    if not os.path.exists(jobs_dir):
        return False
    try:
        for fname in os.listdir(jobs_dir):
            if not fname.endswith(".json"):
                continue
            path = os.path.join(jobs_dir, fname)
            with open(path, "r", encoding="utf-8") as f:
                import json
                job = json.load(f)
            if job.get("status") in ("queued", "pending"):
                return True
    except Exception:
        pass
    return False


def spawn_worker() -> bool:
    """Spawn one worker --once subprocess.
    
    Returns True if spawned successfully.
    """
    try:
        log_file = open(WORKER_LOG_PATH, "a", encoding="utf-8")
        proc = subprocess.Popen(
            WORKER_CMD,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            cwd=str(PROJECT_ROOT),
            close_fds=True,
        )
        logger.info(f"Spawned worker PID {proc.pid}")
        return True
    except Exception as e:
        logger.error(f"Failed to spawn worker: {e}")
        return False


def run_daemon():
    logger.info("Worker daemon started (polling every %ss)", POLL_INTERVAL)
    while True:
        try:
            if has_pending_jobs():
                logger.info("Pending jobs detected, spawning worker")
                spawn_worker()
            time.sleep(POLL_INTERVAL)
        except KeyboardInterrupt:
            logger.info("Daemon stopped by user")
            break
        except Exception as e:
            logger.error(f"Daemon error: {e}")
            time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run_daemon()
