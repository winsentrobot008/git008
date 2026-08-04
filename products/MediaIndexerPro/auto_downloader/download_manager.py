"""
MediaIndexerPro v3 — Auto Downloader (P1)

Downloads media assets from index results to local categorized storage.
Supports video (yt-dlp) and image (requests) downloads with retry logic,
filename conflict resolution, and automatic topic-based classification.

Usage:
    from auto_downloader.download_manager import (
        download_video, download_image, auto_download_from_index
    )

    # Single download
    path = download_video("https://youtube.com/watch?v=xxx", "local_assets/emotion")
    path = download_image("https://example.com/photo.jpg", "local_assets/motivation")

    # Batch download from index
    report = auto_download_from_index("AI 未来")
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Optional

import requests

# Ensure project root is in path for yt-dlp import
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# yt-dlp is optional — download_video gracefully degrades if missing
try:
    import yt_dlp
    HAS_YT_DLP = True
except ImportError:
    HAS_YT_DLP = False

logger = logging.getLogger("MediaIndexerPro.AutoDownloader")

# ─── Constants ───────────────────────────────────────────────────────────────

# Category keywords for auto-classification
CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "emotion": [
        "emotion", "emotional", "feelings", "joy", "sad", "happy", "anger",
        "fear", "love", "hate", "cry", "laugh", "smile", "anxiety", "stress",
        "depression", "mood", "sentiment", "affection", "passion",
        "感动", "情感", "情绪", "喜悦", "悲伤", "愤怒", "恐惧", "爱",
    ],
    "psychology": [
        "psychology", "psychological", "mental", "mind", "brain", "cognitive",
        "behavior", "personality", "trauma", "therapy", "consciousness",
        "perception", "memory", "learning", "habit", "addiction",
        "心理", "心理学", "认知", "人格", "行为", "大脑", "思维",
    ],
    "relationship": [
        "relationship", "relation", "friendship", "family", "parenting",
        "marriage", "dating", "social", "communication", "trust", "bond",
        "community", "teamwork", "together", "connection",
        "关系", "人际", "友谊", "家庭", "亲子", "社交", "沟通", "信任",
    ],
    "motivation": [
        "motivation", "motivational", "inspire", "inspiration", "success",
        "goal", "achievement", "dream", "ambition", "determination",
        "perseverance", "courage", "confidence", "growth", "improvement",
        "励志", "激励", "成功", "梦想", "目标", "坚持", "勇气", "成长",
    ],
}

# Default category when classification fails
DEFAULT_CATEGORY = "motivation"

# Retry configuration
MAX_RETRIES = 3
RETRY_DELAY_SECONDS = 2

# Allowed video extensions for format selection
VIDEO_EXTENSIONS = (".mp4", ".webm", ".mkv", ".avi", ".mov")

IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp")


# ─── Utility Functions ───────────────────────────────────────────────────────

def _sanitize_filename(name: str, max_length: int = 100) -> str:
    """
    Sanitize a string for use as a filename.

    Replaces unsafe characters with underscores and truncates to max_length.
    """
    # Remove or replace characters unsafe for filenames
    safe = re.sub(r'[<>:"/\\|?*]', "_", name)
    safe = re.sub(r"\s+", "_", safe.strip())
    # Remove leading/trailing dots and spaces
    safe = safe.strip(". ")
    if not safe:
        safe = "untitled"
    return safe[:max_length]


def _resolve_path(target_folder: str, filename: str) -> Path:
    """
    Resolve a unique file path, auto-renaming on conflict.

    If a file already exists at the target path, appends a numeric suffix
    (e.g. ``_01``, ``_02``) before the extension until the path is unique.
    """
    folder = Path(target_folder)
    folder.mkdir(parents=True, exist_ok=True)

    stem, ext = os.path.splitext(filename)
    if not ext:
        ext = ".mp4"  # default fallback

    candidate = folder / f"{stem}{ext}"
    if not candidate.exists():
        return candidate

    counter = 1
    while True:
        candidate = folder / f"{stem}_{counter:02d}{ext}"
        if not candidate.exists():
            return candidate
        counter += 1


def _classify_by_keywords(keywords: list[str], title: str = "") -> str:
    """
    Classify a media item into a local_assets category based on keywords and title.

    Scores each category by counting how many of its keywords appear in the
    item's keywords list and title. Returns the highest-scoring category.
    """
    combined_text = " ".join(keywords).lower() + " " + title.lower()
    scores: dict[str, int] = {}

    for category, cat_keywords in CATEGORY_KEYWORDS.items():
        score = sum(1 for kw in cat_keywords if kw.lower() in combined_text)
        scores[category] = score

    best = max(scores, key=scores.get)  # type: ignore[arg-type]
    if scores[best] == 0:
        return DEFAULT_CATEGORY
    return best


def _extract_extension_from_url(url: str) -> str:
    """Extract file extension from a URL's path segment."""
    path_part = url.split("?")[0].split("#")[0]
    _, ext = os.path.splitext(path_part)
    if ext and len(ext) <= 6:
        return ext.lower()
    return ""


def _short_uuid() -> str:
    """Generate a short unique identifier (first 8 hex chars)."""
    return uuid.uuid4().hex[:8]


# ─── Core Download Functions ─────────────────────────────────────────────────

def download_video(url: str, target_folder: str) -> Optional[str]:
    """
    Download a video using yt-dlp.

    Args:
        url: The video URL (YouTube, Vimeo, etc.).
        target_folder: Destination directory path.

    Returns:
        Absolute path to the downloaded file, or ``None`` on failure.

    The download will retry up to MAX_RETRIES times on network errors.
    If yt-dlp is not installed, logs a warning and returns ``None``.
    """
    if not HAS_YT_DLP:
        logger.warning(
            "yt-dlp is not installed. Install it with: pip install yt-dlp"
        )
        return None

    folder = Path(target_folder)
    folder.mkdir(parents=True, exist_ok=True)

    # yt-dlp output template: use a sanitized title or fallback to a UUID
    outtmpl = str(folder / "%(title).100s_%(id)s.%(ext)s")

    ydl_opts: dict[str, Any] = {
        "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
        "outtmpl": outtmpl,
        "quiet": True,
        "no_warnings": True,
        "ignoreerrors": True,
        "extract_flat": False,
        "noprogress": True,
    }

    last_error: Optional[Exception] = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.info(
                f"Downloading video [attempt {attempt}/{MAX_RETRIES}]: {url}"
            )
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                if info is None:
                    raise RuntimeError("yt-dlp returned no info")

                # Determine the actual output file path
                filepath_str = ydl.prepare_filename(info)
                # If format selection changed extension, fix it
                if not any(filepath_str.endswith(ext) for ext in VIDEO_EXTENSIONS):
                    filepath_str = str(Path(filepath_str).with_suffix(".mp4"))

                # If multiple formats were merged, yt-dlp may have added extra info
                # Try to find the actual file
                downloaded = Path(filepath_str)
                if not downloaded.exists():
                    # Search for any video file in the output directory that matches
                    matches = list(folder.glob(f"{downloaded.stem}.*"))
                    if matches:
                        downloaded = matches[0]

                if downloaded.exists():
                    abs_path = str(downloaded.resolve())
                    logger.info(f"Video downloaded: {abs_path}")
                    return abs_path
                else:
                    raise FileNotFoundError(
                        f"Expected output file not found: {downloaded}"
                    )

        except Exception as e:
            last_error = e
            logger.warning(
                f"Download attempt {attempt}/{MAX_RETRIES} failed"
                f" for {url}: {e}"
            )
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY_SECONDS)

    logger.error(
        f"All {MAX_RETRIES} attempts failed for video {url}: {last_error}"
    )
    return None


def download_image(
    url: str,
    target_folder: str,
    filename_hint: Optional[str] = None,
) -> Optional[str]:
    """
    Download an image using requests.

    Args:
        url: The image URL.
        target_folder: Destination directory path.
        filename_hint: Optional suggested filename (without extension).
                       If omitted, derived from URL or a UUID.

    Returns:
        Absolute path to the downloaded file, or ``None`` on failure.

    The download will retry up to MAX_RETRIES times on network errors.
    """
    folder = Path(target_folder)
    folder.mkdir(parents=True, exist_ok=True)

    last_error: Optional[Exception] = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.info(
                f"Downloading image [attempt {attempt}/{MAX_RETRIES}]: {url}"
            )

            resp = requests.get(
                url,
                timeout=30,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36"
                    )
                },
                stream=True,
            )
            resp.raise_for_status()

            # Determine file extension
            content_type = resp.headers.get("content-type", "")
            ext = _extension_from_content_type(content_type)

            # Determine filename
            if filename_hint:
                safe_name = _sanitize_filename(filename_hint)
            else:
                url_ext = _extract_extension_from_url(url)
                if url_ext in IMAGE_EXTENSIONS:
                    ext = url_ext
                safe_name = _short_uuid()

            filename = f"{safe_name}{ext}"
            filepath = _resolve_path(target_folder, filename)

            # Write to disk
            with open(filepath, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)

            abs_path = str(filepath.resolve())
            logger.info(f"Image downloaded: {abs_path}")
            return abs_path

        except requests.RequestException as e:
            last_error = e
            logger.warning(
                f"Download attempt {attempt}/{MAX_RETRIES} failed"
                f" for {url}: {e}"
            )
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY_SECONDS)

    logger.error(
        f"All {MAX_RETRIES} attempts failed for image {url}: {last_error}"
    )
    return None


def _extension_from_content_type(content_type: str) -> str:
    """Map an HTTP Content-Type to a file extension."""
    mapping = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/bmp": ".bmp",
        "image/svg+xml": ".svg",
    }
    # Handle charset suffixes like "image/jpeg; charset=utf-8"
    base_type = content_type.split(";")[0].strip().lower()
    return mapping.get(base_type, ".jpg")


# ─── Batch Download from Index ───────────────────────────────────────────────

def auto_download_from_index(topic: str) -> dict[str, Any]:
    """
    Read an index JSON file and download all media items to categorized folders.

    Pipeline:
        1. Load ``assets/index/<topic>/index.json``
        2. Flatten all items across all sources
        3. For each item:
           a. Classify into a category (emotion/psychology/relationship/motivation)
              based on keywords and title.
           b. Download video items via ``download_video()``.
           c. Download image items via ``download_image()``.
           d. Skip ``page`` type items (no downloadable media file).
           e. Log failures but never raise — non-blocking.
        4. Return a download report JSON.

    Args:
        topic: The topic directory name under ``assets/index/``.

    Returns:
        A dict with the download report::

            {
                "topic": str,
                "total_items": int,
                "attempted": int,
                "succeeded": int,
                "failed": int,
                "skipped": int,
                "results": [
                    {
                        "title": str,
                        "url": str,
                        "type": str,
                        "category": str,
                        "status": "downloaded" | "skipped" | "failed",
                        "local_path": str | null,
                        "error": str | null,
                    },
                    ...
                ],
                "categories": {
                    "emotion": {"succeeded": int, "failed": int},
                    "psychology": {"succeeded": int, "failed": int},
                    "relationship": {"succeeded": int, "failed": int},
                    "motivation": {"succeeded": int, "failed": int},
                },
            }
    """
    # Path to index JSON
    index_path = PROJECT_ROOT / "assets" / "index" / topic / "index.json"
    if not index_path.exists():
        error_msg = f"Index file not found: {index_path}"
        logger.error(error_msg)
        return {"error": error_msg, "topic": topic}

    # Load index data
    with open(index_path, "r", encoding="utf-8") as f:
        index_data: dict[str, Any] = json.load(f)

    # Flatten all items from all sources
    all_items: list[dict[str, Any]] = []
    by_source = index_data.get("by_source", {})
    for source_name, items in by_source.items():
        for item in items:
            item["_source_label"] = source_name
            all_items.append(item)

    total = len(all_items)
    logger.info(
        f"Auto-download from index '{topic}': {total} items found"
    )

    # Category counters
    category_stats: dict[str, dict[str, int]] = {
        cat: {"succeeded": 0, "failed": 0}
        for cat in CATEGORY_KEYWORDS
    }

    results: list[dict[str, Any]] = []
    attempted = 0
    succeeded = 0
    failed = 0
    skipped = 0

    for item in all_items:
        title = item.get("title", "untitled")
        url = item.get("url", "")
        item_type = item.get("type", "image")
        keywords = item.get("keywords", [])

        # Classify into category
        category = _classify_by_keywords(keywords, title)
        target_folder = str(PROJECT_ROOT / "local_assets" / category)

        # Initialize category stats if not present (shouldn't happen, but safe)
        if category not in category_stats:
            category_stats[category] = {"succeeded": 0, "failed": 0}

        result_entry: dict[str, Any] = {
            "title": title,
            "url": url,
            "type": item_type,
            "category": category,
            "status": "skipped",
            "local_path": None,
            "error": None,
        }

        try:
            if item_type == "video":
                attempted += 1
                local_path = download_video(url, target_folder)
                if local_path:
                    result_entry["status"] = "downloaded"
                    result_entry["local_path"] = local_path
                    succeeded += 1
                    category_stats[category]["succeeded"] += 1
                else:
                    result_entry["status"] = "failed"
                    result_entry["error"] = "Download failed after retries"
                    failed += 1
                    category_stats[category]["failed"] += 1

            elif item_type == "image":
                attempted += 1
                # Use sanitized title as filename hint
                filename_hint = _sanitize_filename(title) if title else None
                local_path = download_image(url, target_folder, filename_hint)
                if local_path:
                    result_entry["status"] = "downloaded"
                    result_entry["local_path"] = local_path
                    succeeded += 1
                    category_stats[category]["succeeded"] += 1
                else:
                    result_entry["status"] = "failed"
                    result_entry["error"] = "Download failed after retries"
                    failed += 1
                    category_stats[category]["failed"] += 1

            else:
                # Skip PAGE and unknown types
                skipped += 1
                result_entry["status"] = "skipped"
                result_entry["error"] = (
                    f"Unsupported type '{item_type}' — only video/image supported"
                )

        except Exception as e:
            # Catch-all: never let one bad item crash the batch
            logger.error(f"Unexpected error downloading {url}: {e}")
            result_entry["status"] = "failed"
            result_entry["error"] = str(e)
            failed += 1
            if category in category_stats:
                category_stats[category]["failed"] += 1

        results.append(result_entry)

    # Build report
    report: dict[str, Any] = {
        "topic": topic,
        "index_path": str(index_path),
        "total_items": total,
        "attempted": attempted,
        "succeeded": succeeded,
        "failed": failed,
        "skipped": skipped,
        "categories": category_stats,
        "results": results,
    }

    logger.info(
        f"Auto-download complete for '{topic}': "
        f"{succeeded} succeeded, {failed} failed, {skipped} skipped "
        f"(of {total} total)"
    )

    return report


# ─── CLI Entry Point ─────────────────────────────────────────────────────────

def main():
    """CLI entry point: python -m auto_downloader.download_manager <topic>"""
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-5s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    parser = argparse.ArgumentParser(
        description="MediaIndexerPro v3 — Auto Downloader",
    )
    parser.add_argument(
        "topic",
        type=str,
        help="Topic directory name under assets/index/ (e.g. 'AI 未来')",
    )
    args = parser.parse_args()

    report = auto_download_from_index(args.topic)

    print(f"\n{'='*60}")
    print(f"Download Report for '{args.topic}'")
    print(f"{'='*60}")
    print(f"  Total items:  {report.get('total_items', 0)}")
    print(f"  Attempted:    {report.get('attempted', 0)}")
    print(f"  Succeeded:    {report.get('succeeded', 0)}")
    print(f"  Failed:       {report.get('failed', 0)}")
    print(f"  Skipped:      {report.get('skipped', 0)}")
    print(f"\n  Category breakdown:")
    for cat, stats in report.get("categories", {}).items():
        print(f"    {cat}: {stats['succeeded']} ok, {stats['failed']} fail")
    print(f"{'='*60}")

    # Print failures for visibility
    failures = [
        r for r in report.get("results", []) if r["status"] == "failed"
    ]
    if failures:
        print(f"\n  Failures ({len(failures)}):")
        for f_entry in failures:
            print(f"    - [{f_entry['type']}] {f_entry['title'][:60]}")
            print(f"      {f_entry['error']}")
    print()


if __name__ == "__main__":
    main()
