"""
cleanup.py — File Cleanup Utility

Enforces TTL (time-to-live) on generated files and log rotation.

Configurable via environment variables or defaults:
  GENERATED_TTL_DAYS: 7    — Delete generated videos older than N days
  LOG_MAX_MB: 50           — Truncate log files larger than N MB

Usage:
    python scripts/cleanup.py          # Run cleanup once
    python scripts/cleanup.py --daemon # Run every hour
"""

from __future__ import annotations

import argparse
import logging
import os
import time
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(message)s")
logger = logging.getLogger("ZOO.Cleanup")

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Default TTLs (in days)
GENERATED_TTL_DAYS = int(os.environ.get("GENERATED_TTL_DAYS", "7"))
LOG_MAX_MB = int(os.environ.get("LOG_MAX_MB", "50"))


def clean_generated_files() -> int:
    """Delete generated video files older than TTL."""
    dirs = [
        PROJECT_ROOT / "api" / "data" / "generated",
        PROJECT_ROOT / "data" / "nightly_output",
    ]
    total = 0
    cutoff = time.time() - (GENERATED_TTL_DAYS * 86400)

    for d in dirs:
        if not d.exists():
            continue
        for f in d.iterdir():
            if f.is_file() and f.stat().st_mtime < cutoff:
                try:
                    f.unlink()
                    total += 1
                    logger.info(f"Deleted old file: {f.name}")
                except Exception as e:
                    logger.warning(f"Failed to delete {f.name}: {e}")

    if total:
        logger.info(f"Cleaned {total} expired files (>{GENERATED_TTL_DAYS}d old)")
    else:
        logger.info("No expired files found")
    return total


def rotate_log_files() -> int:
    """Truncate log files exceeding size limit."""
    log_files = [
        PROJECT_ROOT / "api" / "data" / "logs" / "events_received.log",
    ]
    total = 0
    max_bytes = LOG_MAX_MB * 1024 * 1024

    for path in log_files:
        if not path.exists():
            continue
        size = path.stat().st_size
        if size > max_bytes:
            # Keep last 10MB
            keep_bytes = 10 * 1024 * 1024
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            # Keep last keep_bytes of content
            if len(content) > keep_bytes:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(content[-keep_bytes:])
                total += 1
                logger.info(f"Rotated {path.name}: {size // 1024 // 1024}MB → ~10MB")

    return total


def run_cleanup() -> None:
    """Run all cleanup tasks."""
    logger.info("=== Cleanup Start ===")
    clean_generated_files()
    rotate_log_files()
    logger.info("=== Cleanup Complete ===")


def run_daemon() -> None:
    """Run cleanup every hour."""
    logger.info("Cleanup daemon started (running every hour)")
    while True:
        run_cleanup()
        time.sleep(3600)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MediaIndexerPro Cleanup")
    parser.add_argument("--daemon", action="store_true", help="Run continuously")
    args = parser.parse_args()

    if args.daemon:
        run_daemon()
    else:
        run_cleanup()
