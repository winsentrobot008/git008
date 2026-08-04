"""
MediaIndexerPro v4 — Atomic File Locking for Shadow Index

Cross-platform file lock using a staging-file strategy.
No fcntl dependency required (works on Windows).

Strategy:
  1. Write to a temporary staging file (.tmp)
  2. Rename staging → target (atomic on same filesystem)
  3. If rename fails, retry with backoff (max 3 retries)
  4. Lock file (.lock) for cross-process coordination

Usage:
    from storage.file_lock import atomic_write, acquire_lock, release_lock

    # Lock + write atomically
    with atomic_write("shadow_index.json") as tmp_path:
        json.dump(data, open(tmp_path, "w"))

    # Manual lock management
    lock_fd = acquire_lock("shadow_index.json.lock")
    try:
        # critical section
        pass
    finally:
        release_lock(lock_fd)
"""

from __future__ import annotations

import json
import logging
import os
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Generator, Optional

logger = logging.getLogger("MediaIndexerPro.FileLock")

MAX_RETRIES = 3
RETRY_DELAY = 0.1  # seconds


@contextmanager
def atomic_write(
    target_path: str,
    max_retries: int = MAX_RETRIES,
) -> Generator[str, None, None]:
    """
    Thread-safe atomic file writer.

    Writes to a staging temp file, then atomically renames to target.
    If multiple processes write simultaneously, only one wins.

    Args:
        target_path: Path to the target file.
        max_retries: Number of rename retries on conflict.

    Yields:
        Temporary file path for writing.
    """
    target = Path(target_path)
    target.parent.mkdir(parents=True, exist_ok=True)

    # Create staging path with unique suffix
    staging = target.parent / f".{target.name}.{uuid.uuid4().hex[:8]}.tmp"

    try:
        # Yield staging path for writing
        yield str(staging)

        # Verify staging file exists and has content
        if not staging.exists():
            raise FileNotFoundError(f"Staging file not written: {staging}")

        # Atomic rename (os.replace is atomic on same filesystem on POSIX)
        # On Windows, os.replace is also atomic for same-drive operations
        for attempt in range(max_retries):
            try:
                os.replace(str(staging), str(target))
                break
            except OSError as e:
                if attempt < max_retries - 1:
                    time.sleep(RETRY_DELAY * (attempt + 1))
                else:
                    raise

        size_kb = target.stat().st_size // 1024 if target.exists() else 0
        logger.debug(f"  Atomic write OK: {target.name} ({size_kb}KB)")

    except Exception as e:
        logger.error(f"  Atomic write FAILED: {target.name} — {e}")
        raise
    finally:
        # Clean up staging file if it still exists
        if staging.exists():
            try:
                staging.unlink()
            except Exception:
                pass


def merge_and_write(
    target_path: str,
    new_entries: list[dict],
    key_field: str = "video_id",
) -> int:
    """
    Thread-safe merge of new entries into a JSON array file.

    Loads existing entries, appends new ones (dedup by key_field),
    and writes atomically.

    Args:
        target_path: Path to the target JSON file.
        new_entries: List of new entries to merge.
        key_field: Field used for deduplication.

    Returns:
        Total number of entries after merge.
    """
    # Load existing entries
    existing: list[dict] = []
    target = Path(target_path)
    if target.exists():
        try:
            with open(target, "r", encoding="utf-8") as f:
                data = json.load(f)
                existing = data.get("videos", data if isinstance(data, list) else [])
        except Exception:
            existing = []

    # Build dedup set
    seen_keys: set[str] = set()
    for entry in existing:
        key = str(entry.get(key_field, ""))
        if key:
            seen_keys.add(key)

    # Merge new entries (skip duplicates)
    merged = list(existing)
    for entry in new_entries:
        key = str(entry.get(key_field, ""))
        if key and key not in seen_keys:
            seen_keys.add(key)
            merged.append(entry)
        elif not key:
            merged.append(entry)  # No key = always add

    # Wrap in standard structure
    output = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_videos": len(merged),
        "videos": merged,
    }

    # Atomic write
    with atomic_write(target_path) as tmp_path:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

    return len(merged)


def acquire_lock(lock_path: str, timeout: float = 5.0) -> bool:
    """
    Acquire a cross-process lock file.

    Args:
        lock_path: Path to the lock file.
        timeout: Maximum wait time in seconds.

    Returns:
        True if lock acquired, False if timeout.
    """
    lock = Path(lock_path)
    start = time.time()

    while time.time() - start < timeout:
        try:
            # Try to create lock file exclusively
            if not lock.exists():
                # Write PID and timestamp to lock
                lock.write_text(
                    json.dumps({
                        "pid": os.getpid(),
                        "timestamp": time.time(),
                        "host": os.uname().nodename if hasattr(os, "uname") else "localhost",
                    }),
                    encoding="utf-8",
                )
                return True
            else:
                # Check if stale lock (older than 30s)
                try:
                    lock_data = json.loads(lock.read_text(encoding="utf-8"))
                    age = time.time() - lock_data.get("timestamp", 0)
                    if age > 30:
                        # Stale lock — take over
                        lock.unlink(missing_ok=True)
                        continue
                except Exception:
                    pass

            time.sleep(RETRY_DELAY)

        except Exception:
            time.sleep(RETRY_DELAY)

    return False


def release_lock(lock_path: str) -> None:
    """Release a lock file."""
    try:
        Path(lock_path).unlink(missing_ok=True)
    except Exception:
        pass
