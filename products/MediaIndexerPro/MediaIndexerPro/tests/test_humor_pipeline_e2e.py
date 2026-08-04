"""
MediaIndexerPro v4 — Humor Pipeline End-to-End Test (Real Media Sources)

Executes the full "Cuckolded Hen" production pipeline:
  Discover: Real web sources (API + free scraper, NO local AI assets)
  Analyze:  Keyframes -> DashScope Qwen-VL -> Humor tags -> Shadow index
  Render:   Match script -> lazy-download -> ffmpeg concat + voice track

Usage:
    set PYTHONIOENCODING=utf-8
    python tests/test_humor_pipeline_e2e.py
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# Load .env credentials
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)-28s | %(levelname)-5s | %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("HumorPipelineE2E")

OUTPUT_DIR = PROJECT_ROOT / "api" / "data" / "generated"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
KEYFRAME_DIR = PROJECT_ROOT / "data" / "screenshots"
KEYFRAME_DIR.mkdir(parents=True, exist_ok=True)
DOWNLOAD_DIR = OUTPUT_DIR / "humor_discovered"
DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
SHADOW_INDEX_PATH = PROJECT_ROOT / "storage" / "humor_shadow_index.json"

SCRIPT_PATH = PROJECT_ROOT / "tests" / "test_humor_script.json"
with open(SCRIPT_PATH, "r", encoding="utf-8") as f:
    HUMOR_SCRIPT = json.load(f)


# ═══════════════════════════════════════════════════════════════════════════
#  Step 1: Discover — Real web sources (Tier 1 API, Tier 2 scraper)
# ═══════════════════════════════════════════════════════════════════════════

SEARCH_TOPICS = [
    "funny hen chicken",
    "cute kittens nest",
    "farm animals",
    "cat and chicken",
    "animal reaction funny",
    "dog reaction farm",
]


def _try_pexels_api(keywords: list[str]) -> list[dict]:
    """Pexels API v1 via direct HTTP. Authorization: <key> header."""
    videos = []
    seen = set()
    api_key = os.environ.get("PEXELS_API_KEY", "")
    if not api_key:
        return videos
    for kw in keywords:
        try:
            url = f"https://api.pexels.com/videos/search?query={urllib.parse.quote(kw)}&per_page=5"
            req = urllib.request.Request(url)
            req.add_header("Authorization", api_key)
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            for video in data.get("videos", []):
                vf = video.get("video_files", [])
                best = None
                for f in vf:
                    if f.get("quality") == "sd" or (f.get("width", 9999) <= 854):
                        best = f; break
                if not best and vf:
                    best = vf[0]
                if best and best.get("link") and best["link"] not in seen:
                    seen.add(best["link"])
                    videos.append({"title": f"Pexels: {video.get('url','')[-30:]}",
                                   "url": best["link"], "thumbnail": video.get("image", ""),
                                   "source": "Pexels", "duration": video.get("duration", 0),
                                   "topic": kw})
        except urllib.error.HTTPError as e:
            if e.code == 403:
                logger.info(f"  Pexels API 403 (key may need scope update)")
            else:
                logger.warning(f"  Pexels HTTP {e.code}")
        except Exception:
            pass
    return videos


def _try_unsplash_api(keywords: list[str]) -> list[dict]:
    """Unsplash API via Client-ID auth header. Returns photo URLs."""
    photos = []
    seen = set()
    api_key = os.environ.get("UNSPLASH_ACCESS_KEY", "")
    if not api_key:
        return photos
    for kw in keywords[:3]:
        try:
            safe_q = urllib.parse.quote(kw)
            url = f"https://api.unsplash.com/search/photos?query={safe_q}&per_page=5"
            req = urllib.request.Request(url)
            req.add_header("Authorization", f"Client-ID {api_key}")
            req.add_header("Accept-Version", "v1")
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            for photo in data.get("results", []):
                urls = photo.get("urls", {})
                img_url = urls.get("small") or urls.get("raw") or ""
                if img_url and img_url not in seen:
                    seen.add(img_url)
                    photos.append({"title": photo.get("alt_description") or kw,
                                   "url": img_url,
                                   "thumbnail": urls.get("thumb", img_url),
                                   "source": "Unsplash",
                                   "duration": 0, "topic": kw})
            logger.info(f"  Unsplash: {len(data.get('results',[]))} photos for '{kw}'")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                logger.warning(f"  Unsplash auth error ({e.code})")
            else:
                logger.warning(f"  Unsplash HTTP {e.code}")
        except Exception:
            pass
    return photos


def _try_free_scraper(keywords: list[str]) -> list[dict]:
    """Free HTML scraper — no API key needed."""
    videos = []
    seen = set()
    try:
        from sources.free_scraper import search_free
        items = search_free(keywords, max_per_query=3)
        for item in items:
            if item.url and item.url not in seen:
                seen.add(item.url)
                videos.append({"title": item.title or item.source,
                               "url": item.url, "thumbnail": item.thumbnail or "",
                               "source": item.source, "duration": 0,
                               "topic": item.keywords[0] if item.keywords else keywords[0]})
    except ImportError:
        logger.warning("  free_scraper not available")
    except Exception as e:
        logger.warning(f"  Free scraper error: {e}")
    return videos


def discover_animal_videos() -> list[dict]:
    """
    Discover real animal videos.
    Tier 1: Pixabay + Pexels APIs (keys from env)
    Tier 2: Free HTML scraper (no key)
    NEVER falls back to local AI assets.
    """
    all_videos = []
    seen_urls = set()

    # Tier 1: Official API sources (Pexels + Unsplash)
    logger.info("[Discover] Tier 1: API search...")
    for v in _try_pexels_api(SEARCH_TOPICS):
        if v["url"] not in seen_urls:
            seen_urls.add(v["url"]); all_videos.append(v)
    for v in _try_unsplash_api(SEARCH_TOPICS):
        if v["url"] not in seen_urls:
            seen_urls.add(v["url"]); all_videos.append(v)
    logger.info(f"  API: {len(all_videos)} videos")

    # Tier 2: YouTube free scraper (if API didn't return enough)
    if len(all_videos) < 6:
        logger.info("[Discover] Tier 2: YouTube free scraper...")
        for v in _try_free_scraper(SEARCH_TOPICS):
            if v["url"] not in seen_urls:
                seen_urls.add(v["url"]); all_videos.append(v)
        logger.info(f"  + YouTube: total {len(all_videos)}")

    logger.info(f"[Discover] Total: {len(all_videos)} real videos")
    if not all_videos:
        logger.warning("NO real videos discovered!")
    return all_videos


# ═══════════════════════════════════════════════════════════════════════════
#  Step 2: Analyze — Keyframes -> Cloud API -> Humor Tags -> Shadow Index
# ═══════════════════════════════════════════════════════════════════════════

def analyze_videos(videos: list[dict]) -> tuple[list[dict], dict]:
    from auto_understanding.cloud_api import CloudAnalyzer

    analyzer = CloudAnalyzer()
    shadow_index = []

    for i, video in enumerate(videos[:10]):
        logger.info(f"[Analyze] [{i+1}/{len(videos[:10])}] {video['source']}: {video['title'][:40]}")

        # Determine file extension from URL
        url_path = video["url"].split("?")[0]
        url_ext = Path(url_path).suffix.lower()
        if url_ext not in (".mp4", ".webm", ".jpg", ".jpeg", ".png", ".webp"):
            url_ext = ".mp4"  # default

        safe_name = f"humor_{i:03d}_{video['source'][:6]}_{video['topic'][:10]}{url_ext}"
        safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in safe_name)
        if not safe_name.endswith(url_ext):
            safe_name += url_ext
        local_path = DOWNLOAD_DIR / safe_name

        try:
            if not local_path.exists():
                logger.info(f"  Downloading...")
                req = urllib.request.Request(
                    video["url"],
                    headers={
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Accept": "video/mp4,video/webm,video/*,*/*,image/jpeg,image/png,*/*",
                    }
                )
                with urllib.request.urlopen(req, timeout=30) as resp:
                    # Detect content type and fix extension if needed
                    content_type = resp.headers.get("Content-Type", "")
                    ct_ext = {".jpg": ["image/jpeg"], ".png": ["image/png"],
                              ".webp": ["image/webp"], ".gif": ["image/gif"],
                              ".mp4": ["video/mp4"], ".webm": ["video/webm"]}
                    detected_ext = None
                    for ext, mimes in ct_ext.items():
                        if any(m in content_type for m in mimes):
                            detected_ext = ext
                            break
                    if detected_ext and detected_ext != url_ext:
                        # Fix the extension
                        new_name = safe_name.rsplit(".", 1)[0] + detected_ext
                        local_path = DOWNLOAD_DIR / new_name
                        safe_name = new_name

                    with open(local_path, "wb") as f:
                        f.write(resp.read())
                logger.info(f"  Saved: {safe_name} ({local_path.stat().st_size//1024}KB)")
        except Exception as e:
            logger.warning(f"  Download failed: {e}")
            continue

        # For image sources, use directly. For videos, extract keyframe.
        is_image = Path(local_path).suffix.lower() in (".jpg", ".jpeg", ".png", ".webp", ".gif")
        keyframe_path = None

        if is_image:
            keyframe_path = str(local_path)
            logger.info(f"  Direct image: {Path(local_path).name}")
        else:
            try:
                kf_out = KEYFRAME_DIR / f"humor_kf_{i:03d}.jpg"
                subprocess.run(["ffmpeg", "-y", "-ss", "0.5", "-i", str(local_path),
                               "-vframes", "1", "-q:v", "2", str(kf_out)],
                              capture_output=True, timeout=30)
                if kf_out.exists() and kf_out.stat().st_size > 0:
                    keyframe_path = str(kf_out)
            except Exception:
                pass

        # Cloud analysis
        analysis = {}
        if keyframe_path and analyzer.backend != "fallback":
            analysis = analyzer.analyze_image(keyframe_path)
        else:
            analysis = analyzer.analyze_video(str(local_path))

        humor_text = analysis.get("humor", analysis.get("description", ""))
        scene = analysis.get("scene", "unknown")
        emotions = analysis.get("emotions", ["neutral"])
        objects = analysis.get("objects", [])

        entry = {"video_id": f"humor_{i:03d}", "title": video["title"],
                 "url": video["url"], "source": video["source"],
                 "topic": video["topic"], "local_path": str(local_path),
                 "humor": humor_text, "scene": scene,
                 "emotions": emotions, "objects": objects,
                 "backend": analyzer.backend}
        shadow_index.append(entry)
        logger.info(f"  Humor: \"{humor_text[:60]}...\"")
        logger.info(f"  Scene: {scene} | Emotions: {emotions}")

    # Save shadow index
    with open(SHADOW_INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "total_videos": len(shadow_index), "videos": shadow_index},
                  f, ensure_ascii=False, indent=2)
    logger.info(f"[Analyze] Shadow index saved: {SHADOW_INDEX_PATH}")
    logger.info(f"[Analyze] Token usage: {analyzer.token_usage()}")
    return shadow_index, analyzer.token_usage()


# ═══════════════════════════════════════════════════════════════════════════
#  Step 3: Render — Match script -> Concat segments -> Voice track
# ═══════════════════════════════════════════════════════════════════════════

def match_and_render(shadow_index: list[dict], token_usage: dict) -> str:
    logger.info("[Render] Matching script to shadow index...")
    selected_videos = []
    used_indices = set()
    shadow_available = [sv for sv in shadow_index
                        if sv.get("local_path") and Path(sv["local_path"]).exists()]
    fallback_idx = 0

    for scene in HUMOR_SCRIPT["scenes"]:
        keywords = [kw.lower() for kw in scene["visual_keywords"]]
        best_match, best_score = None, 0
        for idx, sv in enumerate(shadow_index):
            if idx in used_indices: continue
            text = f"{sv['humor']} {sv['title']} {' '.join(sv['objects'])}".lower()
            score = sum(1 for kw in keywords if kw in text)
            if score > best_score: best_score, best_match = score, (idx, sv)

        if best_match and best_score > 0:
            idx, sv = best_match
            used_indices.add(idx)
            selected_videos.append({"scene_id": scene["id"],
                "narration_en": scene["narration_en"],
                "local_path": sv["local_path"], "humor": sv["humor"],
                "duration": scene["duration_s"]})
            logger.info(f"  Scene {scene['id']}: MATCH '{sv['title'][:30]}' score={best_score}")
        elif shadow_available:
            sv = shadow_available[fallback_idx % len(shadow_available)]
            fallback_idx += 1
            selected_videos.append({"scene_id": scene["id"],
                "narration_en": scene["narration_en"],
                "local_path": sv["local_path"], "humor": sv["humor"],
                "duration": scene["duration_s"]})
            logger.info(f"  Scene {scene['id']}: fallback to '{Path(sv['local_path']).name}'")
        else:
            selected_videos.append({"scene_id": scene["id"],
                "narration_en": scene["narration_en"],
                "local_path": None, "humor": "[placeholder]",
                "duration": scene["duration_s"]})
            logger.warning(f"  Scene {scene['id']}: NO ASSET")

    # Create individual segments
    seg_dir = OUTPUT_DIR / "humor_segments"
    seg_dir.mkdir(parents=True, exist_ok=True)
    segment_files = []

    for i, sv in enumerate(selected_videos):
        seg_path = seg_dir / f"scene_{i:02d}_{sv['duration']}s.mp4"
        src = sv.get("local_path")
        if src and Path(src).exists():
            ext = Path(src).suffix.lower()
            if ext in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
                # Image → video clip (loop with crossfade)
                subprocess.run(["ffmpeg", "-y", "-loop", "1", "-i", str(src),
                               "-c:v", "libx264", "-t", str(sv['duration']),
                               "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                               "-vf", "scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2",
                               str(seg_path)], capture_output=True, timeout=60)
            else:
                subprocess.run(["ffmpeg", "-y", "-ss", "0", "-i", str(src), "-t", str(sv['duration']),
                               "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                               str(seg_path)], capture_output=True, timeout=60)
        else:
            # Blue placeholder with scene label
            label = f"Scene {sv['scene_id']}: {sv['narration_en'][:40]}"
            subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i",
                           f"color=c=blue:s=640x480:d={sv['duration']}:r=10",
                           "-vf", f"drawtext=text='{label}':fontsize=24:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2",
                           "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                           str(seg_path)], capture_output=True, timeout=60)
        if seg_path.exists():
            segment_files.append(str(seg_path))
            logger.info(f"  Segment {i}: {seg_path.name}")

    # Concat using full paths
    concat_file = OUTPUT_DIR / "humor_concat.txt"
    with open(concat_file, "w") as f:
        for sp in segment_files:
            abs_path = str(Path(sp).resolve())
            f.write(f"file '{abs_path}'\n")

    output_clip = OUTPUT_DIR / "humor_cuckolded_hen_roughcut.mp4"
    logger.info(f"[Render] Concat file: {concat_file}")
    with open(concat_file) as f:
        logger.info(f"  Content: {f.read()[:200]}")

    # Concat with re-encode (more reliable than copy)
    result = subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0",
         "-i", str(concat_file),
         "-c:v", "libx264", "-preset", "ultrafast",
         "-pix_fmt", "yuv420p",
         "-an", str(output_clip)],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        logger.warning(f"  Concat error: {result.stderr[-200:]}")
    else:
        logger.info(f"  Concat OK")

    # Voiceover
    total_dur = sum(sv["duration"] for sv in selected_videos)
    voice_path = OUTPUT_DIR / "humor_voiceover.mp3"
    subprocess.run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
                    "-t", str(total_dur), str(voice_path)], capture_output=True, timeout=30)

    final_clip = OUTPUT_DIR / "humor_cuckolded_hen_final.mp4"
    
    # Try audio mix
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", str(output_clip), "-i", str(voice_path),
         "-c:v", "copy", "-c:a", "aac", "-shortest", str(final_clip)],
        capture_output=True, text=True, timeout=120,
    )
    if result.returncode != 0:
        logger.warning(f"  Audio mix error (non-fatal): {result.stderr[-200:]}")
        # Fallback: copy roughcut as final (no audio)
        if output_clip.stat().st_size > 1024:
            import shutil
            shutil.copy2(str(output_clip), str(final_clip))
            logger.info(f"  Using roughcut as final (no audio)")
    else:
        logger.info(f"  Audio mix OK")

    if final_clip.exists() and final_clip.stat().st_size > 1024:
        output_clip = final_clip

    if output_clip.exists():
        logger.info(f"[Render] Output: {output_clip.name} ({output_clip.stat().st_size//1024//1024}MB)")
    return str(output_clip)


# ═══════════════════════════════════════════════════════════════════════════
#  Main
# ═══════════════════════════════════════════════════════════════════════════

def main():
    start_total = time.time()
    print("\n" + "="*72)
    print("  MediaIndexerPro v4 — Humor Pipeline E2E")
    print("  Script: \"%s\"" % HUMOR_SCRIPT['meta']['title'])
    print("="*72)

    # Step 1
    t1 = time.time()
    print("\n[Step 1/3] DISCOVER — Real web sources...\n")
    videos = discover_animal_videos()
    d1 = time.time() - t1
    print(f"\n  Discovered {len(videos)} real videos in {d1:.1f}s\n")

    if not videos:
        logger.error("No videos — aborting (install beautifulsoup4 for scraper fallback)")
        sys.exit(1)

    # Step 2
    t2 = time.time()
    print("\n[Step 2/3] ANALYZE — Keyframes -> Qwen-VL -> Shadow Index...\n")
    shadow_index, token_usage = analyze_videos(videos)
    d2 = time.time() - t2
    print(f"\n  Analyzed {len(shadow_index)} videos in {d2:.1f}s\n")

    # Step 3
    t3 = time.time()
    print("\n[Step 3/3] RENDER — Match -> Concat -> Voice...\n")
    output_path = match_and_render(shadow_index, token_usage)
    d3 = time.time() - t3

    total = time.time() - start_total

    # Report
    print("\n" + "="*72)
    print("  PIPELINE EXECUTION REPORT")
    print("="*72)
    print(f"  Phase 1 (Discover):  {d1:.1f}s — {len(videos)} videos")
    print(f"  Phase 2 (Analyze):   {d2:.1f}s — {len(shadow_index)} analyzed")
    print(f"  Phase 3 (Render):    {d3:.1f}s")
    print(f"  Total:               {total:.1f}s")
    print()
    print(f"  Token Usage:")
    print(f"    API calls:      {token_usage['total_api_calls']}")
    print(f"    Prompt tokens:  {token_usage['total_prompt_tokens']}")
    print(f"    Completion:     {token_usage['total_completion_tokens']}")
    print(f"    Total tokens:   {token_usage['total_tokens']}")
    print()
    print(f"  Final clip: {output_path}")
    if Path(output_path).exists():
        print(f"    Size: {Path(output_path).stat().st_size//1024//1024} MB")

    # Save report
    report = {"pipeline": "humor_e2e", "script": HUMOR_SCRIPT['meta']['title'],
              "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "total_elapsed_s": round(total, 1), "token_usage": token_usage,
              "output_clip": output_path}
    rp = OUTPUT_DIR / "humor_pipeline_report.json"
    with open(rp, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n  Report: {rp}")
    print("="*72)

    # Print shadow index snapshot
    print("\n  Shadow Index Snapshot:\n")
    for sv in shadow_index[:3]:
        print(f"    [{sv['source']}] {sv['title'][:50]}")
        print(f"    Humor: \"{sv['humor'][:80]}...\"" if len(sv['humor'])>80
              else f"    Humor: \"{sv['humor']}\"")
        print(f"    Scene: {sv['scene']} | Emotions: {sv['emotions']} | Objects: {sv['objects'][:3]}")
        print()


if __name__ == "__main__":
    main()
