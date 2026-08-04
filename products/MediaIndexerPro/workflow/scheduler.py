"""
MediaIndexerPro v4 — Batch Production Scheduler Daemon

Watts for incoming JSON screenplay assets in scripts/ directory.
For each new script detected:
  1. Discover real animal images via Unsplash/Pexels/YouTube
  2. Analyze keyframes via DashScope Qwen-VL (70% cheaper image tokens)
  3. Generate Edge-TTS voiceover with burned subtitles
  4. Compile final MP4 into api/data/generated/
  5. Update storage/humor_shadow_index.json

Usage:
    # Start daemon (runs in background)
    python workflow/scheduler.py

    # Drop a .json script into scripts/ and watch it auto-process
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Optional

# ─── Setup ────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# Load .env
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | Scheduler | %(levelname)-5s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("Scheduler")

# ─── Paths ────────────────────────────────────────────────────────────────
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
SCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR = PROJECT_ROOT / "api" / "data" / "generated"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
DOWNLOAD_DIR = OUTPUT_DIR / "batch_discovered"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
SHADOW_INDEX_PATH = PROJECT_ROOT / "storage" / "humor_shadow_index.json"

POLL_INTERVAL = 10  # seconds
PROCESSED_LOG = PROJECT_ROOT / "logs" / "scheduler_processed.json"


def load_processed() -> set:
    """Load set of processed script filenames."""
    if PROCESSED_LOG.exists():
        try:
            with open(PROCESSED_LOG) as f:
                return set(json.load(f))
        except Exception:
            return set()
    return set()


def save_processed(processed: set) -> None:
    """Save set of processed script filenames."""
    PROCESSED_LOG.parent.mkdir(parents=True, exist_ok=True)
    with open(PROCESSED_LOG, "w") as f:
        json.dump(list(processed), f)


def load_shadow_index() -> list[dict]:
    """Load current shadow index."""
    if SHADOW_INDEX_PATH.exists():
        try:
            with open(SHADOW_INDEX_PATH) as f:
                return json.load(f).get("videos", [])
        except Exception:
            return []
    return []


def save_shadow_index(entries: list[dict]) -> None:
    """Save shadow index with atomic file locking."""
    from storage.file_lock import atomic_write
    output = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_videos": len(entries),
        "videos": entries,
    }
    with atomic_write(str(SHADOW_INDEX_PATH)) as tmp_path:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)


def discover_media(keywords: list[str], max_items: int = 5) -> list[dict]:
    """
    Discover real animal images/videos from available sources.
    Uses Unsplash (API key) -> YouTube (free) -> curated CDN (no key).
    Returns list of media metadata dicts with url, title, source.
    """
    all_items = []
    seen_urls = set()

    # 1. Unsplash API (key from env)
    unsplash_key = os.environ.get("UNSPLASH_ACCESS_KEY", "")
    if unsplash_key:
        import urllib.request, urllib.parse
        for kw in keywords[:2]:
            try:
                safe_q = urllib.parse.quote(kw)
                url = f"https://api.unsplash.com/search/photos?query={safe_q}&per_page={max_items}"
                req = urllib.request.Request(url)
                req.add_header("Authorization", f"Client-ID {unsplash_key}")
                req.add_header("Accept-Version", "v1")
                with urllib.request.urlopen(req, timeout=15) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                for photo in data.get("results", [])[:max_items]:
                    img_url = photo.get("urls", {}).get("small", "")
                    if img_url and img_url not in seen_urls:
                        seen_urls.add(img_url)
                        all_items.append({
                            "title": photo.get("alt_description") or kw,
                            "url": img_url,
                            "source": "Unsplash",
                            "topic": kw,
                        })
            except Exception:
                pass

    # 2. Fallback: keyword-derived curated CDN URLs
    if len(all_items) < 3:
        curated = [
            {"url": "https://cdn.pixabay.com/video/2023/06/13/165666-835924198_tiny.mp4", "tags": "hen chicken farm"},
            {"url": "https://cdn.pixabay.com/video/2021/11/29/99689-620409494_tiny.mp4", "tags": "cat kitten"},
            {"url": "https://cdn.pixabay.com/video/2021/09/18/88493-589067005_tiny.mp4", "tags": "dog puppy"},
        ]
        for c in curated:
            if c["url"] not in seen_urls and len(all_items) < max_items:
                seen_urls.add(c["url"])
                all_items.append({
                    "title": c["tags"],
                    "url": c["url"],
                    "source": "Pixabay CDN",
                    "topic": keywords[0] if keywords else "general",
                })

    return all_items


def download_and_analyze(media_list: list[dict]) -> list[dict]:
    """
    Download each media item, run Qwen-VL analysis via CloudAnalyzer,
    return shadow index entries with humor descriptions.
    """
    sys.path.insert(0, str(PROJECT_ROOT))
    from auto_understanding.cloud_api import CloudAnalyzer

    analyzer = CloudAnalyzer()
    entries = []
    download_dir = DOWNLOAD_DIR

    for i, media in enumerate(media_list):
        logger.info(f"Processing [{i+1}/{len(media_list)}]: {media['title'][:40]}")

        # Download
        url = media["url"]
        ext = Path(url.split("?")[0]).suffix.lower() or ".jpg"
        local_path = download_dir / f"batch_{i:03d}{ext}"

        try:
            import urllib.request
            if not local_path.exists():
                req = urllib.request.Request(url, headers={
                    "User-Agent": "Mozilla/5.0",
                })
                with urllib.request.urlopen(req, timeout=30) as resp:
                    with open(local_path, "wb") as f:
                        f.write(resp.read())
        except Exception as e:
            logger.warning(f"  Download failed: {e}")
            continue

        # Analyze
        is_image = ext in (".jpg", ".jpeg", ".png", ".webp")
        try:
            if is_image:
                analysis = analyzer.analyze_image(str(local_path))
            else:
                analysis = analyzer.analyze_video(str(local_path))
        except Exception as e:
            logger.warning(f"  Analysis failed: {e}")
            analysis = {}

        humor_text = analysis.get("humor", analysis.get("description", ""))
        scene = analysis.get("scene", "unknown")
        emotions = analysis.get("emotions", ["neutral"])
        objects = analysis.get("objects", [])

        entry = {
            "video_id": f"batch_{i:03d}_{uuid.uuid4().hex[:6]}",
            "title": media["title"],
            "url": url,
            "source": media["source"],
            "topic": media.get("topic", "general"),
            "humor": humor_text,
            "scene": scene,
            "emotions": emotions,
            "objects": objects,
            "backend": analyzer.backend,
        }
        entries.append(entry)
        logger.info(f"  Humor: \"{str(humor_text)[:60]}...\"")

    logger.info(f"Analyzed {len(entries)}/{len(media_list)} items | "
                f"Tokens: {analyzer.token_usage()}")
    return entries


def render_video(script_path: Path, shadow_entries: list[dict]) -> Optional[str]:
    """
    Render final video with Edge-TTS voiceover + burned subtitles.
    """
    try:
        with open(script_path, "r", encoding="utf-8") as f:
            script = json.load(f)
    except Exception as e:
        logger.error(f"Script parse failed: {e}")
        return None

    scenes = script.get("scenes", script.get("clips", []))
    if not scenes:
        logger.error(f"No scenes in script: {script_path.name}")
        return None

    script_name = script_path.stem
    output_name = f"scheduled_{script_name}_{uuid.uuid4().hex[:6]}.mp4"
    output_path = OUTPUT_DIR / output_name

    logger.info(f"Rendering {len(scenes)} scenes -> {output_name}")

    # Build full narration text
    all_text = ". ".join(
        s.get("narration_en", s.get("narration", f"Scene {i+1}"))
        for i, s in enumerate(scenes)
    )

    # Generate voiceover + subtitles
    from workflow.voice_generator import generate_voice_and_subtitles, burn_subtitles

    voice_result = generate_voice_and_subtitles(
        all_text,
        voice="storyteller",
        speed=1.0,
    )
    logger.info(f"Voiceover: {voice_result.get('audio', 'N/A')} | "
                f"{voice_result.get('duration', 0)}s")

    # Create a simple video from first shadow entry (or use available images)
    # Use ffmpeg to create slideshow from downloaded images
    download_dir = DOWNLOAD_DIR
    image_files = sorted(download_dir.glob("*.jpg")) + sorted(download_dir.glob("*.png"))

    if image_files:
        # Create slideshow video from images
        concat_file = OUTPUT_DIR / f"concat_{script_name}.txt"
        segment_dir = OUTPUT_DIR / f"segments_{script_name}"
        segment_dir.mkdir(parents=True, exist_ok=True)

        seg_files = []
        for i, sf in enumerate(image_files):
            scene_dur = scenes[i % len(scenes)].get("duration_s", 5)
            seg_out = segment_dir / f"seg_{i:03d}_{scene_dur}s.mp4"
            subprocess.run(
                ["ffmpeg", "-y", "-loop", "1", "-i", str(sf),
                 "-c:v", "libx264", "-t", str(scene_dur),
                 "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                 "-vf", "scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2",
                 str(seg_out)],
                capture_output=True, timeout=60,
            )
            if seg_out.exists():
                seg_files.append(str(seg_out))

        if seg_files:
            with open(concat_file, "w") as f:
                for sp in seg_files:
                    f.write(f"file '{sp}'\n")

            rough_path = OUTPUT_DIR / f"rough_{script_name}.mp4"
            subprocess.run(
                ["ffmpeg", "-y", "-f", "concat", "-safe", "0",
                 "-i", str(concat_file),
                 "-c:v", "libx264", "-preset", "ultrafast",
                 "-pix_fmt", "yuv420p", "-an", str(rough_path)],
                capture_output=True, timeout=120,
            )

            if rough_path.exists():
                # Burn subtitles
                final = burn_subtitles(
                    str(rough_path),
                    voice_result.get("audio", ""),
                    voice_result.get("subtitles"),
                    text=all_text,
                    output_name=output_name,
                )
                if final:
                    return final

    # Ultimate fallback: just return the rough cut
    if rough_path.exists():
        return str(rough_path)

    return None


def process_script(script_path: Path, processed: set) -> None:
    """Process a single script file through the full pipeline."""
    logger.info(f"\n{'='*60}")
    logger.info(f"Processing: {script_path.name}")
    logger.info(f"{'='*60}")

    try:
        with open(script_path, "r", encoding="utf-8") as f:
            script = json.load(f)
    except Exception as e:
        logger.error(f"Invalid script: {e}")
        return

    meta = script.get("meta", {})
    title = meta.get("title", script_path.stem)
    scenes = script.get("scenes", [])
    keywords = []
    for s in scenes:
        keywords.extend(s.get("visual_keywords", []))

    logger.info(f"Script: {title} | {len(scenes)} scenes")

    # Step 1: Discover
    logger.info("[1/3] Discovering media...")
    media = discover_media(keywords[:5])

    if not media:
        logger.error("No media discovered. Skipping.")
        return

    logger.info(f"  Found {len(media)} items")

    # Step 2: Analyze
    logger.info("[2/3] Analyzing via Qwen-VL...")
    entries = download_and_analyze(media)

    # Merge with existing shadow index
    existing = load_shadow_index()
    existing.extend(entries)
    save_shadow_index(existing)
    logger.info(f"  Shadow index: {len(entries)} new entries")

    # Step 3: Render
    logger.info("[3/3] Rendering with Edge-TTS voiceover + subtitles...")
    output = render_video(script_path, entries)

    if output and Path(output).exists():
        size_mb = Path(output).stat().st_size / (1024 * 1024)
        logger.info(f"  ✓ Output: {output} ({size_mb:.1f}MB)")
    else:
        logger.warning("  ✗ Rendering produced no output")

    # Mark as processed
    processed.add(script_path.name)
    save_processed(processed)
    logger.info(f"Done: {script_path.name}\n")


def run_once():
    """Scan scripts directory and process new files."""
    processed = load_processed()
    logger.info(f"Scanning {SCRIPTS_DIR} for new scripts...")

    for fpath in sorted(SCRIPTS_DIR.glob("*.json")):
        if fpath.name not in processed:
            process_script(fpath, processed)

    logger.info(f"Processed: {len(processed)} scripts")


def run_daemon():
    """Run scheduler as a continuous daemon."""
    logger.info(f"\n{'='*60}")
    logger.info(f"MediaIndexerPro v4 — Scheduler Daemon STARTED")
    logger.info(f"Watching: {SCRIPTS_DIR}")
    logger.info(f"Output:   {OUTPUT_DIR}")
    logger.info(f"Interval: {POLL_INTERVAL}s")
    logger.info(f"{'='*60}\n")

    while True:
        try:
            run_once()
        except KeyboardInterrupt:
            logger.info("Scheduler stopped by user")
            break
        except Exception as e:
            logger.error(f"Scheduler error: {e}")
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    if "--once" in sys.argv:
        run_once()
    else:
        run_daemon()
