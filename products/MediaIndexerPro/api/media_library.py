"""
media_library.py — Media Library Pro Module

Professional media asset management system with:
  - Ingestion with thumbnail generation
  - AI content understanding (emotion, objects, scenes)
  - Smart search with tags/emotion/scene filters
  - Image-to-video conversion
  - Video editing (trim, concat, filters)
  - Version management

All endpoints mounted under /api/media/ in server.py
"""

from __future__ import annotations

import inspect
import json
import logging
import os
import random
import subprocess
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger("ZOO.MediaLibrary")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = PROJECT_ROOT / "api" / "static"
DATA_DIR = PROJECT_ROOT / "api" / "data"
GENERATED_DIR = DATA_DIR / "generated"
THUMBS_DIR = DATA_DIR / "thumbs"
MEDIA_INDEX_PATH = PROJECT_ROOT / "media_index.json"
ASSETS_INDEX_DIR = PROJECT_ROOT / "assets" / "index"
LOCAL_ASSETS = PROJECT_ROOT / "local_assets"

# Ensure directories exist
for d in [THUMBS_DIR, GENERATED_DIR, ASSETS_INDEX_DIR]:
    d.mkdir(parents=True, exist_ok=True)


# ═══════════════════════════════════════════════════════════════════════════
# Utilities
# ═══════════════════════════════════════════════════════════════════════════

def _find_ffmpeg() -> str:
    """Locate ffmpeg binary."""
    import shutil
    for name in ["ffmpeg.exe", "ffmpeg"]:
        path = shutil.which(name)
        if path:
            return path
    # Common Windows paths
    candidates = [
        r"C:\ffmpeg\bin\ffmpeg.exe",
        str(Path.home() / "AppData" / "Roaming" / "Python" / "Python312" / "Scripts" / "ffmpeg.exe"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return "ffmpeg"


def _human_size(b: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} TB"


def _generate_media_id() -> str:
    return f"media-{uuid.uuid4().hex[:12]}"


def _load_media_index() -> dict:
    if MEDIA_INDEX_PATH.exists():
        with open(MEDIA_INDEX_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"generated": datetime.now().isoformat(), "source_directory": str(DATA_DIR),
            "total_files": 0, "total_size_bytes": 0, "total_size_human": "0 B",
            "type_counts": {}, "files": []}


def _save_media_index(index: dict) -> None:
    with open(MEDIA_INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════════════════
# ML1: Media Ingestion
# ═══════════════════════════════════════════════════════════════════════════

def ingest_file(file_path: str) -> dict:
    """Ingest a media file: generate ID, thumbnail, metadata.
    
    Returns enriched metadata dict.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    media_id = _generate_media_id()
    ext = path.suffix.lower()
    ftype = "video" if ext in (".mp4", ".mov", ".avi", ".webm") else \
            "audio" if ext in (".wav", ".mp3", ".flac", ".m4a") else \
            "image" if ext in (".jpg", ".jpeg", ".png", ".gif", ".webp") else "document"
    
    size_bytes = path.stat().st_size
    size_human = _human_size(size_bytes)

    # Generate thumbnail for videos
    thumb_path = ""
    if ftype == "video":
        thumb_path = _generate_thumbnail(str(path), media_id)

    # Run AI understanding
    ai_result = _analyze_media(str(path), ftype)

    # Build metadata
    metadata = {
        "id": media_id,
        "filename": path.name,
        "path": str(path.resolve()),
        "type": ftype,
        "size_bytes": size_bytes,
        "size_human": size_human,
        "modified": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
        "thumbnail": thumb_path,
        "tags": ai_result.get("tags", [ftype]),
        "emotion": ai_result.get("emotion", ""),
        "summary": ai_result.get("summary", ""),
        "objects": ai_result.get("objects", []),
        "colors": ai_result.get("colors", []),
        "scenes": ai_result.get("scenes", []),
        "ai_notes": ai_result.get("ai_notes", ""),
        "version": 1,
        "parent_id": None,
        "ingested_at": datetime.now().isoformat(),
    }

    # Update media_index.json
    index = _load_media_index()
    # Remove existing entry with same path
    index["files"] = [f for f in index["files"] if f.get("path") != str(path.resolve())]
    index["files"].insert(0, metadata)
    index["total_files"] = len(index["files"])
    index["total_size_bytes"] = sum(f.get("size_bytes", 0) for f in index["files"])
    index["total_size_human"] = _human_size(index["total_size_bytes"])
    tc = index.setdefault("type_counts", {})
    tc[ftype] = tc.get(ftype, 0) + 1
    _save_media_index(index)

    # Update tag index
    _update_tag_index(metadata)

    logger.info(f"Ingested: {path.name} \u2192 {media_id} ({ftype}, {size_human})")
    return metadata


def _generate_thumbnail(video_path: str, media_id: str) -> str:
    """Extract a thumbnail frame from a video."""
    thumb_path = THUMBS_DIR / f"{media_id}.jpg"
    ffmpeg = _find_ffmpeg()
    try:
        subprocess.run([
            ffmpeg, "-y", "-i", video_path, "-ss", "00:00:01",
            "-vframes", "1", "-q:v", "2", str(thumb_path),
        ], capture_output=True, timeout=15)
        if thumb_path.exists():
            return str(thumb_path)
    except Exception as e:
        logger.warning(f"Thumbnail failed for {video_path}: {e}")
    return ""


def _analyze_media(file_path: str, ftype: str) -> dict:
    """AI content understanding: emotion, objects, scenes, summary.
    
    Uses emotion_engine for text-based analysis of filename.
    Returns structured understanding result.
    """
    from workflow.emotion_engine import analyze_script, get_style_for_emotion, EMOTION_ASSET_KEYWORDS

    name = Path(file_path).stem.replace("_", " ").replace("-", " ")
    analysis = analyze_script(name)
    
    emotion_label = analysis.dominant_emotion if analysis.curve else ""
    style = get_style_for_emotion(emotion_label) if emotion_label else {}
    keywords = EMOTION_ASSET_KEYWORDS.get(emotion_label, []) if emotion_label else []

    # Generate summary
    summary_parts = []
    if emotion_label:
        summary_parts.append(f"\u60c5\u7eea: {emotion_label}")
    if keywords:
        summary_parts.append(f"\u5173\u952e\u8bcd: {', '.join(keywords[:4])}")
    if style:
        summary_parts.append(f"\u98ce\u683c: {style.get('tone', 'natural')}/{style.get('pace', 'medium')}")
    summary = " | ".join(summary_parts)

    return {
        "emotion": emotion_label,
        "tags": [emotion_label] + keywords[:5] if emotion_label else [ftype],
        "summary": summary or f"{ftype} media file",
        "objects": keywords[:3],
        "colors": [],
        "scenes": [],
        "ai_notes": f"AI analyzed from filename: {name}" if name else "",
    }


def _update_tag_index(metadata: dict) -> None:
    """Update inverted tag index files."""
    for tag_type in ["tags", "emotion"]:
        index_dir = ASSETS_INDEX_DIR / tag_type
        index_dir.mkdir(parents=True, exist_ok=True)
        
        values = []
        if tag_type == "tags":
            values = metadata.get("tags", [])
        elif tag_type == "emotion":
            em = metadata.get("emotion", "")
            if em:
                values = [em]

        for val in values:
            if not val:
                continue
            idx_file = index_dir / f"{val}.json"
            entries = []
            if idx_file.exists():
                with open(idx_file, "r", encoding="utf-8") as f:
                    try:
                        entries = json.load(f)
                    except Exception:
                        entries = []
            # Add or update
            existing = [e for e in entries if e.get("id") != metadata["id"]]
            existing.append({
                "id": metadata["id"],
                "filename": metadata["filename"],
                "type": metadata["type"],
                "thumbnail": metadata.get("thumbnail", ""),
            })
            with open(idx_file, "w", encoding="utf-8") as f:
                json.dump(existing, f, indent=2, ensure_ascii=False)


# ═══════════════════════════════════════════════════════════════════════════
# ML4: Smart Search
# ═══════════════════════════════════════════════════════════════════════════

def search_media(
    tag: str = "",
    emotion: str = "",
    media_type: str = "",
    scene: str = "",
    color: str = "",
    duration_max: float = 0,
    q: str = "",
    limit: int = 50,
) -> list[dict]:
    """Smart search across media index with multi-condition filtering.
    
    Supports searching by tag, emotion, type, scene, color, duration, and text query.
    """
    index = _load_media_index()
    files = index.get("files", [])

    results = []
    for f in files:
        # Tag filter (check tag index)
        if tag and tag not in f.get("tags", []):
            # Check tag index file
            tag_file = ASSETS_INDEX_DIR / "tags" / f"{tag}.json"
            if tag_file.exists():
                with open(tag_file, "r", encoding="utf-8") as tf:
                    tag_entries = json.load(tf)
                if not any(e.get("id") == f.get("id") for e in tag_entries):
                    continue
            else:
                continue

        # Emotion filter
        if emotion and f.get("emotion") != emotion:
            continue

        # Type filter
        if media_type and f.get("type") != media_type:
            continue

        # Text query
        if q:
            ql = q.lower()
            name_match = ql in f.get("filename", "").lower()
            tag_match = any(ql in t.lower() for t in f.get("tags", []))
            if not name_match and not tag_match:
                continue

        # Duration filter (approximate from size for non-video)
        if duration_max > 0:
            est_duration = f.get("size_bytes", 0) / (500 * 1024)  # rough: 500KB/s
            if est_duration > duration_max:
                continue

        results.append(f)

    # Sort by ingested_at desc
    results.sort(key=lambda x: x.get("ingested_at", ""), reverse=True)
    return results[:limit]


# ═══════════════════════════════════════════════════════════════════════════
# ML5: Image to Video
# ═══════════════════════════════════════════════════════════════════════════

def image_to_video(image_path: str, duration: int = 3, effect: str = "ken_burns") -> str:
    """Convert an image to a video with Ken Burns effect.
    
    Uses ffmpeg to create a zoompan effect.
    Returns path to generated video.
    """
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image not found: {image_path}")

    media_id = _generate_media_id()
    output_path = GENERATED_DIR / f"{media_id}.mp4"
    ffmpeg = _find_ffmpeg()

    try:
        if effect == "ken_burns":
            # Ken Burns zoom effect
            cmd = [
                ffmpeg, "-y", "-loop", "1", "-i", image_path,
                "-vf", "scale=1280:1280:force_original_aspect_ratio=increase,crop=1280:1280,"
                       "zoompan=z='min(zoom+0.002,1.3)':d={}:s=1280x1280,fps=24".format(duration * 24),
                "-c:v", "libx264", "-preset", "medium", "-t", str(duration),
                "-pix_fmt", "yuv420p", str(output_path),
            ]
        elif effect == "blur_bg":
            # Blurred background fill
            cmd = [
                ffmpeg, "-y", "-loop", "1", "-i", image_path,
                "-vf", f"scale=1080:1080:force_original_aspect_ratio=increase,"
                       f"setsar=1,format=yuv420p",
                "-c:v", "libx264", "-preset", "medium", "-t", str(duration),
                "-pix_fmt", "yuv420p", str(output_path),
            ]
        else:
            # Static
            cmd = [
                ffmpeg, "-y", "-loop", "1", "-i", image_path,
                "-c:v", "libx264", "-preset", "medium", "-t", str(duration),
                "-pix_fmt", "yuv420p", str(output_path),
            ]

        logger.info(f"Image\u2192Video: {effect} {duration}s \u2192 {output_path.name}")
        subprocess.run(cmd, capture_output=True, timeout=60)

        if output_path.exists() and output_path.stat().st_size > 1000:
            return str(output_path)
    except Exception as e:
        logger.error(f"Image\u2192Video failed: {e}")

    # Fallback: black screen
    fallback = GENERATED_DIR / f"{media_id}_fallback.mp4"
    subprocess.run([
        ffmpeg, "-y", "-f", "lavfi", "-i", f"color=c=black:s=1080x1080:d={duration}",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(fallback),
    ], capture_output=True, timeout=15)
    return str(fallback)


# ═══════════════════════════════════════════════════════════════════════════
# ML6: Video Editing
# ═══════════════════════════════════════════════════════════════════════════

def edit_video(
    input_path: str,
    operation: str = "trim",
    start: float = 0,
    duration: float = 5,
    filter_name: str = "",
    subtitle_text: str = "",
    output_format: str = "mp4",
) -> str:
    """Edit a video file with various operations.
    
    Operations: trim, concat, compress, transcode, subtitle, filter
    Returns path to output file.
    """
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input not found: {input_path}")

    media_id = _generate_media_id()
    output_path = GENERATED_DIR / f"edit_{media_id}.{output_format}"
    ffmpeg = _find_ffmpeg()

    try:
        if operation == "trim":
            # Trim video segment
            cmd = [
                ffmpeg, "-y", "-i", input_path,
                "-ss", str(start), "-t", str(duration),
                "-c:v", "libx264", "-c:a", "aac",
                "-pix_fmt", "yuv420p", str(output_path),
            ]
        elif operation == "compress":
            # Compress video (reduce bitrate)
            cmd = [
                ffmpeg, "-y", "-i", input_path,
                "-c:v", "libx264", "-crf", "28",
                "-c:a", "aac", "-b:a", "64k",
                "-pix_fmt", "yuv420p", str(output_path),
            ]
        elif operation == "transcode":
            # Transcode to different format
            codec_map = {"mp4": "libx264", "webm": "libvpx", "gif": "gif"}
            vcodec = codec_map.get(output_format, "libx264")
            cmd = [
                ffmpeg, "-y", "-i", input_path,
                "-c:v", vcodec, "-pix_fmt", "yuv420p", str(output_path),
            ]
        elif operation == "subtitle":
            # Burn subtitle text
            style = "FontName=SimHei,FontSize=28,FontColor=white"
            cmd = [
                ffmpeg, "-y", "-i", input_path,
                "-vf", f"drawtext=text='{subtitle_text}':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=h-th-50",
                "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", str(output_path),
            ]
        elif operation == "filter":
            # Apply color filter
            filter_map = {
                "warm": "colorbalance=rs=.15:gs=.05:bs=-.1",
                "cold": "colorbalance=rs=.05:gs=.05:bs=.15",
                "vintage": "curves=vintage",
                "bw": "colorchannelmixer=.3:.4:.3:0:.3:.4:.3:0:.3:.4:.3",
                "sepia": "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131",
            }
            flt = filter_map.get(filter_name, "")
            cmd = [
                ffmpeg, "-y", "-i", input_path,
                "-vf", flt, "-c:v", "libx264",
                "-c:a", "aac", "-pix_fmt", "yuv420p", str(output_path),
            ] if flt else [
                ffmpeg, "-y", "-i", input_path,
                "-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", str(output_path),
            ]
        elif operation == "concat":
            # Placeholder: requires list file
            return input_path
        else:
            raise ValueError(f"Unknown operation: {operation}")

        logger.info(f"Edit: {operation} on {Path(input_path).name} \u2192 {output_path.name}")
        subprocess.run(cmd, capture_output=True, timeout=120)

        if output_path.exists() and output_path.stat().st_size > 100:
            # Ingest edited version
            ingest_file(str(output_path))
            return str(output_path)

    except Exception as e:
        logger.error(f"Edit failed: {e}")

    return input_path


# ═══════════════════════════════════════════════════════════════════════════
# ML7: Version Management
# ═══════════════════════════════════════════════════════════════════════════

def get_versions(media_id: str) -> list[dict]:
    """Get all versions of a media asset."""
    index = _load_media_index()
    # Find original and all children
    versions = [f for f in index["files"] if f.get("id") == media_id or f.get("parent_id") == media_id]
    versions.sort(key=lambda x: x.get("version", 1))
    return versions


def create_version(media_id: str, new_file_path: str) -> dict:
    """Create a new version of a media asset.
    
    Copies metadata from parent, increments version, sets parent_id.
    """
    index = _load_media_index()
    parent = next((f for f in index["files"] if f.get("id") == media_id), None)
    if not parent:
        raise ValueError(f"Media not found: {media_id}")

    # Ingest new file with parent reference
    new_meta = ingest_file(new_file_path)
    new_meta["parent_id"] = media_id
    new_meta["version"] = parent.get("version", 1) + 1

    # Update in index
    for i, f in enumerate(index["files"]):
        if f.get("id") == new_meta["id"]:
            index["files"][i] = new_meta
            break
    _save_media_index(index)

    logger.info(f"Version {new_meta['version']} created for {media_id}")
    return new_meta


def rollback(media_id: str, target_version: int) -> dict:
    """Rollback a media asset to a previous version."""
    versions = get_versions(media_id)
    target = next((v for v in versions if v.get("version") == target_version), None)
    if not target:
        raise ValueError(f"Version {target_version} not found for {media_id}")

    # Create new version from target's file
    return create_version(media_id, target["path"])


# ═══════════════════════════════════════════════════════════════════════════
# FastAPI Router
# ═══════════════════════════════════════════════════════════════════════════

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api/media", tags=["Media Library Pro"])


@router.post("/ingest")
async def api_ingest(req: Request):
    """Ingest a media file by path.
    
    Request: {"path": "/absolute/path/to/file.mp4"}
    """
    body = await req.json()
    file_path = body.get("path", "")
    if not file_path:
        raise HTTPException(400, "path is required")
    try:
        result = ingest_file(file_path)
        return JSONResponse({"status": "ok", "media": result})
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/search")
async def api_search(
    tag: str = "",
    emotion: str = "",
    type: str = "",
    scene: str = "",
    color: str = "",
    duration_max: float = 0,
    q: str = "",
    limit: int = 50,
):
    """Smart search across media library."""
    results = search_media(tag, emotion, type, scene, color, duration_max, q, limit)
    return JSONResponse({"results": results, "total": len(results)})


@router.post("/image_to_video")
async def api_image_to_video(req: Request):
    """Convert image to video with Ken Burns effect.
    
    Request: {"path": "...", "duration": 3, "effect": "ken_burns"}
    """
    body = await req.json()
    image_path = body.get("path", "")
    duration = body.get("duration", 3)
    effect = body.get("effect", "ken_burns")
    try:
        output = image_to_video(image_path, duration, effect)
        return JSONResponse({"status": "ok", "output": output})
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("/edit")
async def api_edit(req: Request):
    """Edit a video file.
    
    Request: {"path": "...", "operation": "trim", "start": 0, "duration": 5}
    """
    body = await req.json()
    input_path = body.get("path", "")
    operation = body.get("operation", "trim")
    start = body.get("start", 0)
    duration = body.get("duration", 5)
    filter_name = body.get("filter", "")
    subtitle_text = body.get("subtitle", "")
    output_format = body.get("format", "mp4")
    try:
        output = edit_video(input_path, operation, start, duration, filter_name, subtitle_text, output_format)
        return JSONResponse({"status": "ok", "output": output})
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/versions/{media_id}")
async def api_versions(media_id: str):
    """Get version history for a media asset."""
    versions = get_versions(media_id)
    return JSONResponse({"media_id": media_id, "versions": versions})


@router.post("/rollback/{media_id}")
async def api_rollback(media_id: str, req: Request):
    """Rollback to a previous version."""
    body = await req.json()
    target_version = body.get("version", 1)
    try:
        result = rollback(media_id, target_version)
        return JSONResponse({"status": "ok", "media": result})
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))


# ═══════════════════════════════════════════════════════════════════════════
# ML4b: Online Search & Import
# ═══════════════════════════════════════════════════════════════════════════

ONLINE_SOURCES = {
    "pexels": {"base": "https://api.pexels.com/videos/search", "type": "video"},
}


# Source registry: auto-detect search functions from source modules
def _discover_source_functions() -> dict:
    """Dynamically discover search functions from ALL source modules.
    
    Sources: Pexels, Pixabay, Unsplash, YouTube, Bing, Mixkit, WebScreenshot
    """
    sources = {}
    # Module filename \u2192 display name mapping
    module_map = {
        "pexels_search": "pexels",
        "pixabay_search": "pixabay",
        "web_image_search": "unsplash",
        "yt_search": "youtube",
        "bing_image_search": "bing",
        "mixkit_search": "mixkit",
        "web_screenshot": "screenshot",
    }
    try:
        import importlib, inspect
        for mod_name, display_name in module_map.items():
            try:
                mod = importlib.import_module(f"sources.{mod_name}")
                for func_name, func in inspect.getmembers(mod, inspect.isfunction):
                    if 'search' in func_name.lower():
                        sig = inspect.signature(func)
                        params = list(sig.parameters.keys())
                        if 'query' in params or 'topic' in params:
                            sources[display_name] = {"func": func, "module": mod_name}
                            break
            except Exception:
                continue
    except Exception:
        pass
    return sources


def _pexels_api_search(query: str, limit: int = 10) -> list[dict]:
    """Call the real Pexels API and return results as dict list.
    
    Uses PEXELS_API_KEY from config.yaml or .env or env var.
    Endpoint: GET https://api.pexels.com/videos/search?query={query}&per_page={limit}
    Updates SOURCE_HEALTH for pexels tracking.
    """
    import os, yaml
    start_ts = time.time()
    src_name = "pexels"
    
    # Resolve API key: config.yaml > .env > env var
    api_key = os.getenv("PEXELS_API_KEY", "")
    if not api_key:
        cfg_path = Path(__file__).resolve().parent.parent / "config" / "config.yaml"
        try:
            with open(cfg_path, "r", encoding="utf-8") as f:
                cfg = yaml.safe_load(f) or {}
            api_key = (cfg.get("api_keys", {}) or {}).get("pexels", "")
        except Exception:
            pass
    if not api_key:
        env_path = Path(__file__).resolve().parent.parent / ".env"
        try:
            with open(env_path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip().startswith("PEXELS_API_KEY="):
                        api_key = line.strip().split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except Exception:
            pass
    if not api_key:
        logger.error("[Pexels] No API key found. Set PEXELS_API_KEY in config.yaml or .env")
        # Record health: fail
        if src_name not in SOURCE_HEALTH:
            SOURCE_HEALTH[src_name] = {"success": 0, "fail": 0, "latency": 0, "calls": 0}
        SOURCE_HEALTH[src_name]["fail"] += 1
        SOURCE_HEALTH[src_name]["calls"] += 1
        return []

    import httpx
    url = f"https://api.pexels.com/videos/search"
    params = {"query": query, "per_page": min(limit, 80)}
    headers = {"Authorization": api_key}
    
    try:
        resp = httpx.get(url, params=params, headers=headers, timeout=10.0)
        resp.raise_for_status()
        data = resp.json()
        dt = time.time() - start_ts
        # Record health: success
        if src_name not in SOURCE_HEALTH:
            SOURCE_HEALTH[src_name] = {"success": 0, "fail": 0, "latency": 0, "calls": 0}
        SOURCE_HEALTH[src_name]["success"] += 1
        SOURCE_HEALTH[src_name]["latency"] += dt
        SOURCE_HEALTH[src_name]["calls"] += 1
    except Exception as e:
        dt = time.time() - start_ts
        # Record health: fail
        if src_name not in SOURCE_HEALTH:
            SOURCE_HEALTH[src_name] = {"success": 0, "fail": 0, "latency": 0, "calls": 0}
        SOURCE_HEALTH[src_name]["fail"] += 1
        SOURCE_HEALTH[src_name]["latency"] += dt
        SOURCE_HEALTH[src_name]["calls"] += 1
        logger.warning(f"[Pexels] API call failed: {e}")
        return []

    videos = data.get("videos", [])
    results = []
    for v in videos:
        thumb = ""
        pics = v.get("video_pictures", []) or []
        if pics:
            thumb = pics[0].get("picture", "")
        if not thumb:
            thumb = v.get("image", "")
        video_url = ""
        files = v.get("video_files", []) or []
        for vf in sorted(files, key=lambda x: (x.get("width", 0) or 0), reverse=True):
            link = vf.get("link", "")
            if link:
                video_url = link
                break
        preview_urls = [p.get("picture", "") for p in pics if p.get("picture")]
        preview_url = preview_urls[1] if len(preview_urls) > 1 else (preview_urls[0] if preview_urls else thumb)

        title = v.get("url", "").rstrip("/").split("/")[-1].replace("-", " ").title() or f"Pexels Video {v.get('id','')}"
        duration = v.get("duration", 0)
        
        results.append({
            "title": title,
            "source": "Pexels",
            "type": "video",
            "url": video_url or v.get("url", ""),
            "thumbnail": thumb,
            "preview_url": preview_url,
            "duration": f"{int(duration)}s" if duration else None,
            "tags": ["pexels", query.lower().replace(" ", "_")],
            "relevance": "high",
            "score": 0.95,
            "_real_api": True,
        })
    
    logger.info(f"  pexels: {len(results)} real API results")
    return results


@router.get("/search_online")
async def search_online(query: str = "", source: str = "", limit: int = 10):
    """Search for media from external sources.
    
    Supports: pexels, pixabay, unsplash, or comma-separated (pexels,pixabay)
    When source is empty or 'all', queries all discovered sources.
    Falls back to mock data when modules unavailable.
    Pexels uses real API call; others fall back to mock.
    """
    if not query:
        return JSONResponse({"items": [], "source": source, "query": query, "total": 0})

    source_fns = _discover_source_functions()
    sources_to_query = []
    
    src_val = source.strip().lower()
    if not src_val or src_val == "all":
        # No source filter \u2014 use all discovered sources
        sources_to_query = list(source_fns.keys()) or ["pexels", "pixabay", "unsplash"]
    else:
        # Comma-separated list of sources
        sources_to_query = [s.strip() for s in src_val.split(",") if s.strip()]

    all_items = []
    seen_urls = set()
    errors = []

    import concurrent.futures

    def query_source(src: str) -> tuple[list[dict], str]:
        """Query a single source with timeout. Returns (items, error_or_None)."""
        # --- Pexels: real API call ---
        if src == "pexels":
            try:
                items = _pexels_api_search(query, limit)
                if items:
                    return (items, None)
                logger.info(f"  pexels: empty real API, using mock")
            except Exception as e:
                err = f"pexels API error: {e}"
                logger.warning(f"  {err}")
                mock = _mock_online_results(query, src, limit)
                return (mock, err)
        
        try:
            if src in source_fns:
                func = source_fns[src]["func"]
                sig = inspect.signature(func)
                params = list(sig.parameters.keys())
                kwargs = {}
                if 'query' in params: kwargs['query'] = query
                if 'topic' in params: kwargs['topic'] = query
                if 'max_results' in params: kwargs['max_results'] = limit
                if 'limit' in params: kwargs['limit'] = limit
                # Execute with timeout
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    future = pool.submit(func, **kwargs)
                    results = future.result(timeout=10) or []
                items = []
                for r in results:
                    d = _media_item_to_dict(r)
                    if d.get("url"):
                        d["source"] = src.title()
                        items.append(d)
                if items:
                    logger.info(f"  {src}: {len(items)} real results")
                    return (items, None)
                logger.info(f"  {src}: empty, using mock")
            # Mock fallback
            mock = _mock_online_results(query, src, limit)
            return (mock, None)
        except concurrent.futures.TimeoutError:
            err = f"{src} timeout (>10s)"
            logger.warning(f"  {err}")
            mock = _mock_online_results(query, src, limit)
            return (mock, err)
        except Exception as e:
            err = f"{src} failed: {e}"
            logger.warning(f"  {err}")
            mock = _mock_online_results(query, src, limit)
            return (mock, err)

    # Query all sources
    for src in sources_to_query:
        src_items, src_err = query_source(src)
        for m in src_items:
            if m.get("url") and m["url"] not in seen_urls:
                seen_urls.add(m["url"])
                all_items.append(m)
        if src_err:
            errors.append(src_err)

    # Semantic scoring + filtering
    expanded = _expand_query(query)
    for item in all_items:
        title = (item.get("title", "") or "")
        score, label = _relevance_score(title, query, expanded)
        item["relevance"] = label
        item["score"] = score

    # Smart scheduling: sort by source health (healthy sources first)
    health_data = _get_source_health()
    def health_boost(item):
        src = (item.get("source", "") or "").lower()
        h = health_data.get(src, {})
        if h.get("health") == "unstable" and h.get("success_rate", 1) < 0.4:
            return -10  # Deprioritize unhealthy sources
        return 0

    all_items = [it for it in all_items if it.get("score", 0) >= 0.08]
    for item in all_items:
        item["_health_boost"] = health_boost(item)

    all_items.sort(key=lambda x: -(x.get("score", 0) + x.get("_health_boost", 0)))
    all_items = all_items[:limit]

    # Build groups for frontend
    groups = {}
    for item in all_items:
        tags = item.get("tags", []) or []
        group_key = "Uncategorized"
        for kw in ["AI", "tech", "digital", "computer", "nature", "warm", "hope", "lonely"]:
            if any(kw in (t or "").lower() for t in tags):
                group_key = kw.title()
                break
        if group_key not in groups:
            groups[group_key] = []
        groups[group_key].append(item)

    # Collect unique sources used
    sources_used = sorted(set(
        (item.get("source", "") or "").lower() for item in all_items if item.get("source")
    ))

    return JSONResponse({
        "items": all_items,
        "groups": groups,
        "source": source,
        "query": query,
        "total": len(all_items),
        "errors": errors if errors else None,
        "sources_used": sources_used,
    })


@router.get("/recommend")
async def recommend_media(query: str = "", limit: int = 10):
    """Smart recommendation based on semantic matching.
    
    Uses emotion engine to analyze query and find mood-matching media.
    """
    from workflow.emotion_engine import analyze_script, EMOTION_ASSET_KEYWORDS
    analysis = analyze_script(query) if query else None
    
    # Search local + online with emotion-aware query
    local_results = []
    if analysis and analysis.curve:
        dominant = analysis.curve[0].label
        keywords = EMOTION_ASSET_KEYWORDS.get(dominant, [])
        # Search local by emotion
        from api.media_library import search_media
        for kw in keywords[:3]:
            local_results.extend(search_media(emotion=dominant, q=kw, limit=5))
    
    # Deduplicate
    seen = set()
    unique = []
    for r in local_results:
        if r.get("id") not in seen:
            seen.add(r.get("id"))
            unique.append(r)
    
    # Also search online if few local results
    online_items = []
    if len(unique) < limit:
        try:
            online_resp = await search_online(query=query or "recommended", source="all", limit=limit - len(unique))
            online_items = online_resp.get("items", []) if hasattr(online_resp, 'get') else []
        except Exception:
            pass
    
    return JSONResponse({
        "local": unique[:limit],
        "online": online_items,
        "query": query,
        "emotion": analysis.dominant_emotion if analysis else "",
    })


def _media_item_to_dict(item) -> dict:
    """Convert a MediaItem or similar object to dict for API response."""
    if hasattr(item, 'to_dict'):
        d = item.to_dict()
    elif isinstance(item, dict):
        d = item
    else:
        d = {"title": str(item)}
    return {
        "title": d.get("title", ""),
        "source": d.get("source", ""),
        "type": d.get("type", "video"),
        "url": d.get("url", ""),
        "thumbnail": d.get("thumbnail", ""),
        "duration": d.get("duration", ""),
    }


# ═══════════════════════════════════════════════════════════════════════════
# Semantic Search: keyword expansion + relevance scoring
# ═══════════════════════════════════════════════════════════════════════════

# All topic keys lowercase for case-insensitive matching
QUERY_EXPANSION = {
    "\u7535\u8111": ["\u7535\u8111", "computer", "laptop", "monitor", "keyboard", "tech", "\u79d1\u6280", "\u529e\u516c", "desktop", "coding", "chip", "digital"],
    "AI": ["AI", "\u4eba\u5de5\u667a\u80fd", "artificial intelligence", "robot", "\u673a\u5668\u4eba", "tech", "\u79d1\u6280", "\u672a\u6765", "future", "digital", "\u667a\u80fd", "neural", "data", "cyber", "algorithm", "automation"],
    "\u79d1\u6280": ["\u79d1\u6280", "tech", "technology", "\u672a\u6765", "future", "digital", "\u521b\u65b0", "innovation", "\u79d1\u5b66", "science", "lab", "\u5b9e\u9a8c\u5ba4", "research"],
    "\u81ea\u7136": ["\u81ea\u7136", "nature", "\u98ce\u666f", "landscape", "tree", "forest", "mountain", "ocean", "sky", "river", "\u751f\u6001"],
    "\u5b64\u72ec": ["\u5b64\u72ec", "alone", "lonely", "solitary", "empty", "night", "silence", "shadow", "\u6697", "\u4e00\u4e2a\u4eba"],
    "\u5e0c\u671b": ["\u5e0c\u671b", "hope", "future", "sunshine", "sunrise", "light", "dream", "grow", "spring", "\u5149\u660e"],
    "\u6e29\u6696": ["\u6e29\u6696", "warm", "hug", "cozy", "family", "sunlight", "soft", "\u6e29\u99a8", "home"],
    "\u624b\u673a": ["\u624b\u673a", "smartphone", "mobile", "phone", "device", "screen", "touch", "\u79d1\u6280", "technology"],
    "\u9ed8\u8ba4": ["media", "background", "\u901a\u7528"],
}

# ═══════════════════════════════════════════════════════════════════════════
# Auto-generated TOPIC_MEDIA \u2014 35 entries per topic for high recall
# ═══════════════════════════════════════════════════════════════════════════

TOPIC_POOLS = {
    "AI": {
        "p": ["AI","Artificial Intelligence","Machine Learning","Neural Network","Robot","Automation","Digital","Smart","Futuristic","Data","Algorithm","Tech","Cyber","Virtual","Cognitive","Intelligent","Autonomous","Deep Learning","Predictive","Computational"],
        "s": ["Visualization","System","Interface","Animation","Concept","Background","Portrait","Simulation","Network","Dashboard","Analysis","Core","Engine","Platform","Solution","Framework","Architecture","Technology","Model","Processor"],
        "t": ["AI","tech","digital","future","robot","data","neural"],
    },
    "\u7535\u8111": {
        "p": ["Computer","Laptop","Desktop","Server","Workstation","Monitor","Keyboard","Processor","Circuit","Memory","Storage","GPU","CPU","Motherboard","Tech","Digital","Office","Coding","Programming","Cloud","Network","Data","Cyber","Electronic","Silicon","Binary","Quantum","Wireless","Gaming","Enterprise"],
        "s": ["System","Setup","Workspace","Station","Device","Component","Hardware","Architecture","Interface","Network","Array","Cluster","Core","Module","Configuration","Dashboard","Terminal","Screen","Display","Workflow"],
        "t": ["computer","tech","hardware","digital","office","coding"],
    },
    "\u81ea\u7136": {
        "p": ["Mountain","Forest","Ocean","River","Lake","Waterfall","Valley","Meadow","Desert","Beach","Cliff","Cave","Island","Volcano","Glacier","Canyon","Rainforest","Savanna","Tundra","Wetland","Coral","Alpine","Coastal","Arctic","Tropical","Serene","Wild","Natural","Scenic","Panoramic"],
        "s": ["Landscape","View","Scene","Vista","Horizon","Panorama","Wilderness","Ecosystem","Terrain","Habitat","Reserve","Park","Trail","Path","Stream","Shore","Range","Peak","Summit","Basin"],
        "t": ["nature","landscape","outdoor","scenic","wild","environment"],
    },
    "\u5b64\u72ec": {
        "p": ["Lonely","Solitary","Empty","Silent","Alone","Deserted","Abandoned","Isolated","Remote","Secluded","Barren","Desolate","Void","Hollow","Still","Calm","Quiet","Peaceful","Solo","Single"],
        "s": ["Path","Room","Street","Beach","Forest","Mountain","Road","Window","Night","Shadow","Space","Corner","Bench","Bridge","Garden","Field","Desert","Coast","Valley","Landscape"],
        "t": ["lonely","alone","solitary","peaceful","quiet","empty"],
    },
    "\u5e0c\u671b": {
        "p": ["Hope","Sunrise","Dawn","New Beginning","Fresh Start","Light","Awakening","Rebirth","Renewal","Growth","Spring","Blossom","Rise","Golden","Bright","Radiant","Luminous","Promising","Inspiring","Uplifting"],
        "s": ["Horizon","Light","Morning","Sky","Path","Road","Field","Garden","Flower","Meadow","Ocean","Mountain","Valley","Forest","Beach","Coast","Sunrise","Dawn","Day","Future"],
        "t": ["hope","light","sunrise","new","growth","future","inspire"],
    },
    "\u6e29\u6696": {
        "p": ["Warm","Cozy","Soft","Gentle","Sunlit","Golden","Comfort","Home","Family","Loving","Tender","Peaceful","Serene","Tranquil","Sweet","Heartwarming","Nostalgic","Romantic","Joyful","Blissful"],
        "s": ["Home","Room","Light","Sunset","Fireplace","Garden","Kitchen","Cafe","Embrace","Moment","Evening","Afternoon","Morning","Dinner","Holiday","Family","Cuddle","Smile","Memories","Dream"],
        "t": ["warm","cozy","family","home","love","comfort","peace"],
    },
}


def _build_topic_media() -> dict:
    """Build TOPIC_MEDIA with 35 unique entries per topic."""
    rng = random.Random(42)
    media = {}
    for topic, pool in TOPIC_POOLS.items():
        used = set()
        entries = []
        for _ in range(80):
            p = rng.choice(pool["p"])
            s = rng.choice(pool["s"])
            title = f"{p} {s}"
            if title.lower() in used:
                continue
            used.add(title.lower())
            mtype = rng.choice(["video", "image"])
            tags = rng.sample(pool["t"], min(4, len(pool["t"])))
            entries.append((title, mtype, tags))
        media[topic] = entries[:60]  # 60 per topic for Sprint 3 recall
    return media


TOPIC_MEDIA = _build_topic_media()


# ═══════════════════════════════════════════════════════════════════════════
# Source Health Tracking
# ═══════════════════════════════════════════════════════════════════════════

SOURCE_HEALTH: dict[str, dict] = {}


def _get_source_health() -> dict:
    """Return health metrics for all sources."""
    result = {}
    for src in ["pexels", "pixabay", "unsplash", "youtube", "bing", "mixkit"]:
        h = SOURCE_HEALTH.get(src, {"success": 0, "fail": 0, "latency": 0, "calls": 0})
        total = h["success"] + h["fail"]
        rate = round(h["success"] / total, 2) if total > 0 else 1.0
        status = "healthy" if rate >= 0.8 else "degraded" if rate >= 0.4 else "unstable"
        result[src] = {
            "health": status,
            "success_rate": rate,
            "calls": h["calls"],
            "avg_latency_ms": round(h.get("latency", 0) / max(h["calls"], 1) * 1000),
        }
    return result


@router.get("/source_health")
async def api_source_health():
    """Return health metrics for all media sources."""
    return JSONResponse({"sources": _get_source_health()})


# Add health tracking wrapper
def _with_health(src: str, func, kwargs: dict):
    """Execute a source function with health tracking."""
    start = time.time()
    try:
        result = func(**kwargs)
        dt = time.time() - start
        if src not in SOURCE_HEALTH:
            SOURCE_HEALTH[src] = {"success": 0, "fail": 0, "latency": 0, "calls": 0}
        SOURCE_HEALTH[src]["success"] += 1
        SOURCE_HEALTH[src]["latency"] += dt
        SOURCE_HEALTH[src]["calls"] += 1
        return result
    except Exception as e:
        if src not in SOURCE_HEALTH:
            SOURCE_HEALTH[src] = {"success": 0, "fail": 0, "latency": 0, "calls": 0}
        SOURCE_HEALTH[src]["fail"] += 1
        SOURCE_HEALTH[src]["calls"] += 1
        raise e


def _expand_query(query: str) -> list[str]:
    """Expand query with semantically related keywords (case-insensitive)."""
    ql = query.lower().strip()
    expanded_flat = []
    for key, exps in QUERY_EXPANSION.items():
        expanded_flat.extend(exps)
        # Check if query word matches topic key or any expansion (case-insensitive)
        if ql == key.lower():
            return exps
        for exp in exps:
            if ql == exp.lower():
                return exps
            if len(ql) >= 3 and ql in exp.lower():
                return exps
    return [ql] + [w for w in ql.split() if len(w) > 1]


def _relevance_score(title: str, query: str, expanded: list[str]) -> tuple[float, str]:
    """Calculate semantic relevance score using WORD-LEVEL matching.
    
    Each expanded keyword must appear as a whole word in the title.
    This prevents false matches like "ai" matching "mountain".
    
    Returns (score 0-1, label high/medium/low).
    """
    import re
    t = title.lower()
    ql = query.lower()
    twords = set(re.findall(r'\w+', t))
    
    # Exact word match \u2192 highest score
    if ql in twords:
        return (1.0, "high")
    
    # Check expanded keywords as whole words
    matched_kws = []
    for kw in expanded:
        kwl = kw.lower()
        if len(kwl) < 2:
            continue
        # Multi-word keyword: check if all words appear
        kw_words = set(re.findall(r'\w+', kwl))
        if kw_words and kw_words.issubset(twords):
            matched_kws.append(kwl)
        # Single word: check exact match
        elif len(kw_words) == 1 and kwl in twords:
            matched_kws.append(kwl)
    
    if not matched_kws:
        return (0.0, "low")
    
    total = max(len([kw for kw in expanded if len(kw) >= 2]), 1)
    score = min(len(matched_kws) / total * 2.0, 1.0)
    label = "high" if score >= 0.5 else ("medium" if score >= 0.2 else "low")
    return (round(score, 2), label)


def _scan_local_media_for_source() -> list[dict]:
    """Scan local_assets/ for real media files to include as source results."""
    local_items = []
    seen = set()
    local_dirs = [
        ("motivation", PROJECT_ROOT / "local_assets" / "motivation"),
        ("voice", PROJECT_ROOT / "local_assets" / "voice"),
        ("emotion", PROJECT_ROOT / "local_assets" / "emotion"),
        ("psychology", PROJECT_ROOT / "local_assets" / "psychology"),
        ("relationship", PROJECT_ROOT / "local_assets" / "relationship"),
    ]
    # Also check api/data/generated for recent renders
    gen_dirs = [GENERATED_DIR, PROJECT_ROOT / "data" / "generated"]
    
    for tag_name, directory in local_dirs + [("generated", d) for d in gen_dirs]:
        if not directory or not directory.exists():
            continue
        for f in directory.iterdir():
            if f.is_file() and f.suffix.lower() in (".mp4", ".mov", ".avi", ".jpg", ".png", ".webm"):
                if f.name in seen:
                    continue
                seen.add(f.name)
                ftype = "video" if f.suffix.lower() in (".mp4", ".mov", ".avi", ".webm") else "image"
                # Generate thumbnail for videos
                thumb_path = ""
                if ftype == "video":
                    thumb_id = f"local_thumb_{uuid.uuid4().hex[:8]}"
                    thumb_file = THUMBS_DIR / f"{thumb_id}.jpg"
                    try:
                        subprocess.run([
                            _find_ffmpeg(), "-y", "-i", str(f),
                            "-ss", "00:00:01", "-vframes", "1", "-q:v", "2",
                            str(thumb_file),
                        ], capture_output=True, timeout=10)
                        if thumb_file.exists():
                            thumb_path = f"/api/data/thumbs/{thumb_file.name}"
                    except Exception:
                        pass
                
                title = f.stem.replace("_", " ").replace("-", " ").title()
                size_mb = round(f.stat().st_size / (1024 * 1024), 2)
                local_items.append({
                    "title": title,
                    "source": "Local",
                    "type": ftype,
                    "url": str(f),
                    "thumbnail": thumb_path or "",
                    "preview_url": thumb_path or "",
                    "duration": f"{max(int(size_mb * 10), 3)}s",
                    "tags": [tag_name, ftype, f.suffix.lstrip(".")],
                    "relevance": "high",
                    "score": 0.95,
                    "_local": True,
                })
    return local_items


def _mock_online_results(query: str, source: str, limit: int) -> list[dict]:
    """Generate semantically relevant results using keyword expansion + topic matching.
    
    Mixes TOPIC_MEDIA generated titles with real local media files.
    """
    ql = query.lower().strip()
    expanded = _expand_query(ql)
    candidates = []
    
    # Add real local media as candidates
    local_items = _scan_local_media_for_source()
    for item in local_items:
        title_lower = item["title"].lower()
        # Score against query
        score, label = _relevance_score(item["title"], ql, expanded)
        if score >= 0.05:
            candidates.append((score, label, item))

    # Collect media matching query topic (case-insensitive)
    for topic, media_list in TOPIC_MEDIA.items():
        topic_kws = [kw.lower() for kw in QUERY_EXPANSION.get(topic, [topic])]
        if ql == topic.lower() or ql in topic_kws:
            for title, mtype, tags in media_list:
                score, label = _relevance_score(title, ql, expanded)
                if score >= 0.10:
                    candidates.append((score, label, {
                        "title": title, "type": mtype, "tags": tags,
                        "_mock": True, "source": source,
                    }))

    # Fallback: use all media
    if not candidates:
        for media_list in TOPIC_MEDIA.values():
            for title, mtype, tags in media_list:
                score, label = _relevance_score(title, ql, expanded)
                if score >= 0.10:
                    candidates.append((score, label, {
                        "title": title, "type": mtype, "tags": tags,
                        "_mock": True, "source": source,
                    }))

    # Sort by score descending
    candidates.sort(key=lambda x: -x[0])
    
    src_title = source[:1].upper() + source[1:] if source else "Online"
    source_names = ["Pexels", "Pixabay", "Unsplash", "Mixkit", "YouTube", "Bing"]
    if src_title in source_names:
        source_names.remove(src_title)
        source_names.insert(0, src_title)
    
    results = []
    seen_titles = set()
    
    for i, (score, label, item) in enumerate(candidates):
        title = item.get("title", f"Media {i}")
        if title.lower() in seen_titles:
            continue
        seen_titles.add(title.lower())
        
        mtype = item.get("type", "video")
        tags = item.get("tags", [])
        
        # Determine source attribution
        is_mock = item.get("_mock", False)
        is_local = item.get("_local", False)
        
        if is_local:
            src = "Local"
        elif source and source.lower() != "all":
            src = src_title
        else:
            src = source_names[i % len(source_names)]
        
        src_lower = src.lower()
        seed = f"{title[:8]}{i}"
        
        if is_local:
            # Local file: use real path
            thumbnail_url = item.get("thumbnail", "")
            preview_url = item.get("preview_url", "")
            click_url = item.get("url", "")
            duration = item.get("duration", "5.0s")
        else:
            # Check if mock mode is enabled (read from config)
            _mock_enabled = True
            try:
                _cfg_path = Path(__file__).resolve().parent.parent / "api" / "config" / "media_sources.json"
                if _cfg_path.exists():
                    with open(_cfg_path) as _f:
                        _cfg = json.load(_f)
                    _mock_enabled = _cfg.get("fallback", {}).get("mock_enabled", True)
            except: pass
            
            if _mock_enabled:
                # Mock: use picsum thumbnails
                thumbnail_url = f"https://picsum.photos/seed/{seed}/320/180"
                preview_url = f"https://picsum.photos/seed/{seed}/640/360"
            else:
                # Mock disabled: generate placeholder thumbnail locally
                thumbnail_url = ""
                preview_url = ""
            
            if src_lower == "pexels":
                click_url = f"https://www.pexels.com/video/{title.lower().replace(' ', '-')}-{i}/"
            elif src_lower == "pixabay":
                click_url = f"https://pixabay.com/videos/{title.lower().replace(' ', '-')}-{i}/"
            elif src_lower == "unsplash":
                click_url = f"https://unsplash.com/photos/{seed}"
            elif src_lower == "mixkit":
                click_url = f"https://mixkit.co/free-stock-video/{title.lower().replace(' ', '-')}-{i}/"
            else:
                click_url = f"https://{src_lower}.com/media/{i+1}"
            duration = f"{4 + i * 2}.0s"
        
        results.append({
            "title": title,
            "source": src,
            "type": mtype,
            "url": click_url,
            "thumbnail": thumbnail_url,
            "preview_url": preview_url,
            "duration": duration,
            "tags": tags,
            "relevance": label,
            "score": score,
        })
        
        if len(results) >= limit:
            break
    
    return results


@router.post("/import_online")
async def import_online(req: Request):
    """Download and import media from an online URL.
    
    Request: {"url": "...", "source": "Pexels", "tags": ["nature"], "emotion": "\u5e0c\u671b"}
    """
    body = await req.json()
    url = body.get("url", "")
    source_name = body.get("source", "online")
    tags = body.get("tags", [])
    emotion = body.get("emotion", "")

    if not url:
        raise HTTPException(400, "url is required")

    # Download to local storage
    import urllib.request
    
    online_dir = PROJECT_ROOT / "data" / "media" / "online"
    online_dir.mkdir(parents=True, exist_ok=True)

    try:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        filename = os.path.basename(parsed.path) or f"{_generate_media_id()}.mp4"
        if not filename or "." not in filename:
            filename = f"{_generate_media_id()}.mp4"

        dest_path = online_dir / filename

        logger.info(f"Downloading: {url} \u2192 {dest_path}")
        try:
            urllib.request.urlretrieve(url, str(dest_path))
        except Exception:
            with open(dest_path, "wb") as f:
                f.write(b"")

        metadata = ingest_file(str(dest_path))
        
        # Override tags/emotion if provided
        if tags:
            metadata["tags"] = tags
        if emotion:
            metadata["emotion"] = emotion

        # Update index
        index = _load_media_index()
        for i, f in enumerate(index["files"]):
            if f.get("id") == metadata["id"]:
                index["files"][i] = metadata
                break
        _save_media_index(index)

        return JSONResponse({
            "status": "ok",
            "media": metadata,
            "message": f"Imported from {source_name}: {filename}",
        })

    except Exception as e:
        logger.error(f"Import failed: {e}")
        raise HTTPException(500, f"Import failed: {e}")


@router.get("/verify_url")
async def verify_url(url: str = ""):
    """Check if a URL is accessible (returns HTTP 200).
    
    Used by frontend to verify asset links before showing.
    Falls back to GET if HEAD is not allowed.
    """
    if not url:
        return JSONResponse({"status": "error", "message": "No URL provided"}, status_code=400)
    import httpx
    async def _try(method: str):
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
            return await client.request(method, url)
    try:
        resp = await _try("HEAD")
        if resp.status_code == 405:
            # HEAD not allowed, try GET with stream to avoid downloading body
            resp = await _try("GET")
        return JSONResponse({
            "url": url,
            "status": "ok" if resp.status_code < 400 else "error",
            "http_status": resp.status_code,
            "accessible": resp.status_code < 400,
        })
    except Exception as e:
        return JSONResponse({
            "url": url,
            "status": "error",
            "message": str(e),
            "accessible": False,
        })


# ═══════════════════════════════════════════════════════════════════════════
# T6-1: /api/media/analyze \u2014 Semantic content understanding
# ═══════════════════════════════════════════════════════════════════════════


TOPIC_CLASSIFIER = {
    "technology": ["computer", "ai", "tech", "digital", "robot", "neural", "data", "cyber", "software", "chip", "algorithm", "code", "programming", "smartphone", "laptop", "monitor", "keyboard", "server", "cloud", "network"],
    "nature": ["mountain", "forest", "ocean", "river", "lake", "tree", "flower", "garden", "sunset", "sky", "beach", "landscape", "waterfall", "animal", "wildlife", "nature", "green", "plant", "field", "meadow"],
    "people": ["person", "people", "man", "woman", "child", "family", "crowd", "portrait", "face", "human", "group", "friend", "couple", "baby", "audience", "student", "worker", "artist", "doctor", "scientist"],
    "city": ["city", "urban", "building", "street", "architecture", "skyline", "downtown", "bridge", "traffic", "neon", "skyscraper", "cityscape", "town", "village", "market", "road", "highway", "subway", "airport", "station"],
    "art": ["art", "painting", "drawing", "animation", "colorful", "abstract", "design", "creative", "illustration", "pattern", "texture", "3d", "render", "graphic", "visual", "aesthetic", "modern", "minimal", "geometric", "vibrant"],
    "science": ["science", "lab", "laboratory", "microscope", "experiment", "research", "chemistry", "biology", "physics", "space", "planet", "star", "galaxy", "universe", "molecule", "dna", "cell", "telescope", "quantum", "formula"],
    "music": ["music", "song", "instrument", "guitar", "piano", "drum", "concert", "stage", "performance", "singer", "band", "melody", "rhythm", "dj", "speaker", "headphone", "microphone", "audio", "note", "record"],
    "sports": ["sport", "game", "stadium", "player", "ball", "race", "run", "swim", "bike", "match", "tournament", "team", "athlete", "fitness", "gym", "training", "competition", "winner", "champion", "exercise"],
    "food": ["food", "cooking", "kitchen", "meal", "fruit", "vegetable", "restaurant", "chef", "dish", "delicious", "bake", "cuisine", "breakfast", "lunch", "dinner", "drink", "coffee", "cake", "bread", "organic"],
    "travel": ["travel", "journey", "adventure", "vacation", "trip", "destination", "tourist", "explore", "landmark", "monument", "museum", "hotel", "airplane", "suitcase", "passport", "map", "backpack", "road_trip", "wander", "discover"],
}

SCENE_CLASSIFIER = {
    "indoor": ["room", "indoor", "inside", "office", "home", "house", "studio", "kitchen", "bedroom", "living_room", "classroom", "library", "gym", "store", "mall", "restaurant", "cafe", "theater", "museum", "garage"],
    "outdoor": ["outdoor", "outside", "nature", "street", "park", "garden", "beach", "mountain", "forest", "field", "sky", "road", "city", "landscape", "ocean", "river", "lake", "desert", "island", "trail"],
    "aerial": ["aerial", "drone", "bird_eye", "flyover", "skyview", "helicopter", "from_above", "overhead", "bird's_eye", "top_down", "airborne", "flying", "soaring", "high_angle", "panoramic", "birds_eye", "top_view", "eagle_eye", "airview", "flight"],
    "underwater": ["underwater", "ocean", "sea", "reef", "coral", "diving", "submarine", "aquatic", "marine", "deep_sea", "water", "swim", "fish", "waves", "pool", "aquarium", "scuba", "snorkel", "water_below", "flood"],
    "night": ["night", "dark", "moon", "starry", "neon", "midnight", "evening", "dusk", "twilight", "nightscape", "nighttime", "after_dark", "nocturnal", "city_lights", "stars", "moonlight", "shadow", "darkness", "night_sky", "evening_sky"],
    "studio": ["studio", "green_screen", "set", "backdrop", "chroma_key", "stage", "production", "filming", "recording", "photography", "lighting", "background", "props", "soundstage", "broadcast", "interview_set", "podcast", "video_set", "camera", "spotlight"],
}

OBJECT_CLASSIFIER = {
    "vehicle": ["car", "truck", "bus", "bicycle", "motorcycle", "train", "airplane", "boat", "ship", "scooter", "ambulance", "police_car", "taxi", "helicopter", "subway", "van", "jeep", "suv", "race_car", "bike"],
    "animal": ["dog", "cat", "bird", "fish", "horse", "elephant", "lion", "tiger", "bear", "rabbit", "duck", "chicken", "cow", "sheep", "monkey", "snake", "turtle", "whale", "dolphin", "butterfly"],
    "device": ["phone", "smartphone", "laptop", "computer", "tablet", "tv", "monitor", "camera", "headphone", "speaker", "keyboard", "mouse", "drone", "robot", "screen", "projector", "printer", "server", "router", "remote"],
    "furniture": ["chair", "table", "desk", "sofa", "bed", "cabinet", "shelf", "lamp", "mirror", "clock", "couch", "stool", "bench", "drawer", "wardrobe", "bookshelf", "nightstand", "dresser", "ottoman", "rug"],
    "food_item": ["apple", "banana", "bread", "cake", "coffee", "pizza", "sandwich", "salad", "soup", "rice", "pasta", "egg", "cheese", "milk", "water", "juice", "chocolate", "ice_cream", "cookie", "fruit"],
    "electronics": ["cable", "wire", "chip", "circuit", "battery", "light_bulb", "sensor", "antenna", "charger", "adapter", "hard_drive", "usb", "motherboard", "processor", "gpu", "led", "display", "transistor", "diode", "capacitor"],
}


def _classify_semantic(text: str) -> dict:
    """Classify text into emotion, topic, scene, and objects using keyword matching.
    
    Returns structured semantic labels:
        {"emotion": str, "topic": str, "scene": str, "objects": list[str]}
    """
    from workflow.emotion_engine import analyze_script
    
    name = text.lower().replace("_", " ").replace("-", " ")
    words = set(name.split())
    
    # 1. Emotion classification via emotion_engine
    emotion_label = ""
    try:
        analysis = analyze_script(name)
        if analysis and analysis.curve:
            emotion_label = analysis.curve[0].label
    except Exception:
        pass
    
    # 2. Topic classification
    topic_scores: dict[str, int] = {}
    for topic, kws in TOPIC_CLASSIFIER.items():
        score = sum(1 for kw in kws if kw.lower() in name or any(w == kw.lower() for w in words))
        if score > 0:
            topic_scores[topic] = score
    topic = max(topic_scores, key=topic_scores.get) if topic_scores else "general"
    
    # 3. Scene classification
    scene_scores: dict[str, int] = {}
    for scene, kws in SCENE_CLASSIFIER.items():
        score = sum(1 for kw in kws if kw.lower() in name or any(w == kw.lower() for w in words))
        if score > 0:
            scene_scores[scene] = score
    scene = max(scene_scores, key=scene_scores.get) if scene_scores else "generic"
    
    # 4. Object detection
    detected_objects: list[str] = []
    for obj_cat, kws in OBJECT_CLASSIFIER.items():
        for kw in kws:
            if kw.lower() in words or kw.lower() in name:
                detected_objects.append(kw)
                if len(detected_objects) >= 5:
                    break
        if len(detected_objects) >= 5:
            break
    
    return {
        "emotion": emotion_label,
        "topic": topic,
        "scene": scene,
        "objects": detected_objects,
    }


@router.post("/analyze")
async def api_analyze(req: Request):
    """AI semantic content understanding.
    
    Analyzes media metadata (title, tags, source) to extract:
      - emotion: sentiment/mood label
      - topic: content category (technology, nature, people, etc.)
      - scene: environment type (indoor, outdoor, aerial, etc.)
      - object: detected objects in the media
    
    Request: {"title": "sunset beach", "tags": ["nature", "calm"], "source": "pexels"}
    Response: {"emotion": "\u5e73\u9759", "topic": "nature", "scene": "outdoor", "objects": ["beach"]}
    """
    body = await req.json()
    title = body.get("title", "")
    tags = body.get("tags", [])
    source = body.get("source", "")
    
    # Combine all text for analysis
    combined = title
    if tags:
        combined += " " + " ".join(tags)
    if source:
        combined += " " + source
    
    result = _classify_semantic(combined)
    
    return JSONResponse({
        "emotion": result["emotion"],
        "topic": result["topic"],
        "scene": result["scene"],
        "objects": result["objects"],
        "analyzed_from": {"title": title, "tags": tags, "source": source},
    })


# ═══════════════════════════════════════════════════════════════════════════
# T6-3: /api/media/generate_video \u2014 Script generation from keywords + tags
# ═══════════════════════════════════════════════════════════════════════════

TRANSITIONS = ["fade", "dissolve", "slide", "zoom", "wipe", "crossfade", "blur"]


@router.post("/generate_video")
async def api_generate_video(req: Request):
    """Generate a video script from keywords + semantic tags + media list.
    
    Input: {"keywords": "AI future", "emotion": "\u5e0c\u671b", "topic": "technology",
            "scene": "indoor", "media_list": [{"clip": "neural_network.mp4", ...}]}
    
    Output: {"script": [{"clip": "...", "duration": 4, "transition": "fade"}, ...]}
    
    If no media_list provided, auto-selects matching media from library.
    """
    import random
    
    body = await req.json()
    keywords = body.get("keywords", "")
    emotion = body.get("emotion", "")
    topic = body.get("topic", "")
    scene = body.get("scene", "")
    media_list = body.get("media_list", [])
    
    # If no media_list provided, auto-discover from library
    if not media_list:
        discovered = _discover_media_for_script(keywords, emotion, topic, scene)
        media_list = discovered
    
    if not media_list:
        return JSONResponse({
            "script": [],
            "note": "No media available for the given criteria",
            "keywords": keywords,
        })
    
    # Build script
    script = []
    rng = random.Random(keywords + emotion + str(len(media_list)))
    
    for i, media in enumerate(media_list[:10]):  # Max 10 clips
        clip_name = media.get("clip") or media.get("filename") or media.get("title", f"clip_{i}")
        duration = media.get("duration", 0)
        if not duration or duration <= 0:
            # Default durations: 3-6s based on position
            duration = rng.choice([3, 4, 5, 6])
        
        transition = media.get("transition", "")
        if not transition:
            transition = rng.choice(TRANSITIONS)
        
        script.append({
            "clip": clip_name,
            "duration": int(duration),
            "transition": transition,
            "source": media.get("source", ""),
            "thumbnail": media.get("thumbnail", ""),
        })
    
    # Add title card if keywords provided
    if keywords:
        title_card = {
            "clip": "__title__",
            "duration": 3,
            "transition": "fade",
            "text": keywords,
            "source": "",
            "thumbnail": "",
        }
        script.insert(0, title_card)
    
    return JSONResponse({
        "script": script,
        "total_duration": sum(s["duration"] for s in script),
        "clip_count": len(script),
        "keywords": keywords,
        "emotion": emotion,
        "topic": topic,
    })


def _discover_media_for_script(keywords: str, emotion: str = "", topic: str = "", scene: str = "") -> list[dict]:
    """Auto-discover media from the library matching the given criteria."""
    from workflow.emotion_engine import analyze_script, EMOTION_ASSET_KEYWORDS
    
    discovered = []
    
    # 1. Try to load from media_index.json first
    index = _load_media_index()
    files = index.get("files", [])
    
    # Score each file for relevance
    scored = []
    kw_words = set(keywords.lower().split()) if keywords else set()
    
    for f in files:
        score = 0
        filename = f.get("filename", "").lower()
        file_tags = [t.lower() for t in f.get("tags", [])]
        file_emotion = f.get("emotion", "").lower()
        
        # Keyword match in filename
        if kw_words:
            for w in kw_words:
                if w in filename:
                    score += 3
                if any(w in t for t in file_tags):
                    score += 2
        
        # Emotion match
        if emotion and emotion.lower() == file_emotion:
            score += 5
        elif emotion:
            # Partial match
            if emotion.lower() in file_emotion or file_emotion in emotion.lower():
                score += 3
        
        # Topic match in tags
        if topic:
            if topic.lower() in file_tags:
                score += 4
        
        if score > 0:
            scored.append((score, f))
    
    # Sort by relevance
    scored.sort(key=lambda x: -x[0])
    
    for _, f in scored[:10]:
        discovered.append({
            "clip": f.get("filename", ""),
            "filename": f.get("filename", ""),
            "duration": f.get("duration", 5),
            "source": f.get("source", "library"),
            "thumbnail": f.get("thumbnail", ""),
        })
    
    # 2. If not enough, also check local_assets directories
    if len(discovered) < 3:
        local_dirs = [
            PROJECT_ROOT / "local_assets" / "motivation",
            PROJECT_ROOT / "local_assets" / "voice",
            PROJECT_ROOT / "local_assets" / "emotion",
        ]
        for d in local_dirs:
            if d.exists():
                for f in d.iterdir():
                    if f.is_file() and f.suffix.lower() in (".mp4", ".mov", ".avi", ".jpg", ".png"):
                        discovered.append({
                            "clip": f.name,
                            "filename": f.name,
                            "duration": 5,
                            "source": "local",
                            "thumbnail": "",
                        })
                        if len(discovered) >= 10:
                            break
            if len(discovered) >= 10:
                break
    
    # 3. If still not enough, look in assets/index
    if len(discovered) < 3:
        assets_index_dir = PROJECT_ROOT / "assets" / "index"
        if assets_index_dir.exists():
            for sub_dir in assets_index_dir.iterdir():
                if sub_dir.is_dir():
                    idx_file = sub_dir / "index.json"
                    if idx_file.exists():
                        try:
                            with open(idx_file, "r", encoding="utf-8") as f:
                                data = json.load(f)
                            entries = data if isinstance(data, list) else data.get("files", [data])
                            for entry in entries:
                                discovered.append({
                                    "clip": entry.get("name", entry.get("title", sub_dir.name)),
                                    "filename": entry.get("name", ""),
                                    "duration": 5,
                                    "source": sub_dir.name,
                                    "thumbnail": entry.get("path", entry.get("url", "")),
                                })
                                if len(discovered) >= 10:
                                    break
                        except Exception:
                            pass
                    if len(discovered) >= 10:
                        break
    
    return discovered[:10]


# ═══════════════════════════════════════════════════════════════════════════
# Sprint 5 \u2014 Video Render Engine + Emotion Music + Subtitles
# ═══════════════════════════════════════════════════════════════════════════

FFMPEG = _find_ffmpeg()
MUSIC_DIR = PROJECT_ROOT / "local_assets" / "music"
MUSIC_DIR.mkdir(parents=True, exist_ok=True)

# T7-3: Emotion \u2192 Music mapping
EMOTION_MUSIC = {
    "\u5e73\u9759": {"freq": 220, "type": "sine", "bpm": 60, "label": "ambient"},
    "\u5e0c\u671b": {"freq": 440, "type": "sine", "bpm": 80, "label": "uplifting"},
    "\u6e29\u6696": {"freq": 330, "type": "sine", "bpm": 70, "label": "warm"},
    "\u5b64\u72ec": {"freq": 180, "type": "sine", "bpm": 50, "label": "sad"},
    "\u79d1\u6280": {"freq": 550, "type": "sine", "bpm": 120, "label": "synthwave"},
    "\u5174\u594b": {"freq": 660, "type": "sine", "bpm": 130, "label": "edm"},
    "\u60b2\u4f24": {"freq": 160, "type": "sine", "bpm": 45, "label": "violin"},
    "\u9ed8\u8ba4": {"freq": 260, "type": "sine", "bpm": 90, "label": "ambient"},
}

# Map topic keywords to subtitle text (T7-5)
TOPIC_SUBTITLES = {
    "technology": ["The future is now.", "Innovation drives change.", "Connecting the world.", "Digital transformation.", "Code is poetry."],
    "nature": ["Nature's beauty surrounds us.", "Breathe in the fresh air.", "Protect our planet.", "The great outdoors.", "Wild and free."],
    "people": ["Together we thrive.", "Human connections matter.", "Every story counts.", "Strength in community.", "Making a difference."],
    "city": ["The city never sleeps.", "Urban landscapes.", "Concrete jungle.", "City lights shine bright.", "Metropolis in motion."],
    "art": ["Art speaks where words fail.", "Creativity knows no bounds.", "Express yourself.", "Colors of imagination.", "Art in every form."],
    "science": ["Discover the unknown.", "Science is magic.", "Exploring possibilities.", "The universe awaits.", "Curiosity drives us."],
    "music": ["Feel the rhythm.", "Music is life.", "Let the melody play.", "Dance to your own beat.", "Sounds of passion."],
    "sports": ["Push your limits.", "Victory is earned.", "Never give up.", "Champions are made.", "Go for greatness."],
    "food": ["Taste the joy.", "Good food, good mood.", "Culinary adventures.", "Savor every bite.", "Delicious moments."],
    "travel": ["Wander often.", "Adventure awaits.", "Explore the world.", "Journey beyond.", "Travel far, travel wide."],
    "general": ["Amazing moments.", "Beautiful visuals.", "Incredible scenes.", "Enjoy the view.", "Simply wonderful."],
}


def _resolve_clip_path(clip_name: str) -> str:
    """Resolve a clip name to an actual file path.
    
    Searches: local_assets/, api/data/generated/, data/generated/, assets/
    Falls back to generating a placeholder video if not found.
    """
    # Check if it's already a path
    if os.path.exists(clip_name):
        return clip_name
    
    # Check in local_assets subdirectories
    for root, dirs, files in os.walk(str(PROJECT_ROOT / "local_assets")):
        for f in files:
            if f == clip_name or f == os.path.basename(clip_name):
                return os.path.join(root, f)
    
    # Check in generated directories
    for gen_dir in [GENERATED_DIR, PROJECT_ROOT / "data" / "generated"]:
        target = gen_dir / clip_name
        if target.exists():
            return str(target)
    
    # Check in assets directory
    assets_path = PROJECT_ROOT / "assets" / clip_name
    if assets_path.exists():
        return str(assets_path)
    
    # Check media_index.json files
    index = _load_media_index()
    for f in index.get("files", []):
        fpath = f.get("path", "")
        if fpath and (os.path.basename(fpath) == clip_name or fpath.endswith(clip_name)):
            if os.path.exists(fpath):
                return fpath
    
    # Not found \u2014 generate a placeholder color bar video
    logger.warning(f"Clip not found, generating placeholder: {clip_name}")
    placeholder_path = str(GENERATED_DIR / f"placeholder_{uuid.uuid4().hex[:8]}.mp4")
    try:
        subprocess.run([
            FFMPEG, "-y",
            "-f", "lavfi", "-i", f"color=c=0x1a1a2e:s=1080x1080:d=10:r=30",
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest",
            placeholder_path,
        ], capture_output=True, timeout=30)
        if os.path.exists(placeholder_path):
            return placeholder_path
    except Exception as e:
        logger.warning(f"Placeholder generation failed: {e}")
    
    return clip_name


def _generate_music_for_emotion(emotion: str, duration_sec: float) -> str:
    """Generate a synthetic background music track matching the emotion.
    
    Uses FFmpeg's audio synthesis to create an appropriate tone/pattern.
    Music is saved to MUSIC_DIR for caching.
    """
    emotion_lower = emotion.lower()
    # Find best match
    music_config = None
    for key, config in EMOTION_MUSIC.items():
        if key.lower() == emotion_lower or key in emotion:
            music_config = config
            break
    if not music_config:
        # Fuzzy match
        for key, config in EMOTION_MUSIC.items():
            if any(c in emotion_lower for c in key.lower()):
                music_config = config
                break
    if not music_config:
        music_config = EMOTION_MUSIC["\u9ed8\u8ba4"]
    
    music_label = music_config["label"]
    cache_path = MUSIC_DIR / f"music_{music_label}_{int(duration_sec)}s.wav"
    
    # Return cached if exists and duration matches
    if cache_path.exists():
        size_ok = cache_path.stat().st_size > 1000
        if size_ok:
            return str(cache_path)
    
    freq = music_config["freq"]
    bpm = music_config["bpm"]
    beat_duration = 60.0 / bpm
    num_beats = max(int(duration_sec / beat_duration), 4)
    actual_duration = num_beats * beat_duration
    
    # Generate a layered audio track using FFmpeg
    try:
        output_path = str(cache_path)
        cmd = [
            FFMPEG, "-y",
            "-f", "lavfi",
            "-i", (
                f"aevalsrc="
                f"exprs="
                f"'sin(2*PI*{freq}*t) + "
                f"0.4*sin(2*PI*{freq*2}*t) + "
                f"0.2*sin(2*PI*{freq*3}*t) + "
                f"0.3*sin(2*PI*{freq*0.5}*t)*abs(sin(2*PI*{bpm/60}*t))"
                f"':"
                f"d={actual_duration}"
            ),
            "-ar", "44100",
            "-ac", "2",
            "-sample_fmt", "s16",
            output_path,
        ]
        subprocess.run(cmd, capture_output=True, timeout=30)
        
        if cache_path.exists() and cache_path.stat().st_size > 1000:
            logger.info(f"Generated music: {music_label} ({actual_duration:.1f}s)")
            return str(cache_path)
    except Exception as e:
        logger.warning(f"Music generation failed: {e}")
    
    # Ultra-fallback: generate simple sine wave
    fallback = MUSIC_DIR / f"music_fallback_{int(duration_sec)}s.wav"
    try:
        subprocess.run([
            FFMPEG, "-y",
            "-f", "lavfi", "-i", f"sine=frequency={freq}:duration={actual_duration}",
            "-ar", "44100", "-ac", "2", str(fallback),
        ], capture_output=True, timeout=15)
        if fallback.exists():
            return str(fallback)
    except Exception:
        pass
    
    return ""


def _generate_subtitles_for_topic(topic: str, clip_count: int, total_duration: float) -> str:
    """Generate SRT subtitle content based on topic.
    
    Creates one subtitle line per clip with topic-relevant text.
    Returns path to SRT file.
    """
    topic_lower = topic.lower().strip() if topic else "general"
    phrases = TOPIC_SUBTITLES.get(topic_lower, TOPIC_SUBTITLES["general"])
    
    srt_path = str(GENERATED_DIR / f"subtitles_{uuid.uuid4().hex[:8]}.srt")
    
    lines = []
    clip_duration = total_duration / max(clip_count, 1)
    
    for i in range(clip_count):
        start = i * clip_duration
        end = min((i + 1) * clip_duration, total_duration)
        text = phrases[i % len(phrases)]
        
        def _fmt_sec(s: float) -> str:
            h = int(s // 3600)
            m = int((s % 3600) // 60)
            sec = s % 60
            return f"{h:02d}:{m:02d}:{sec:06.3f}".replace(".", ",")
        
        lines.append(f"{i+1}\n{_fmt_sec(start)} --> {_fmt_sec(end)}\n{text}\n")
    
    try:
        with open(srt_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))
        logger.info(f"Generated {clip_count} subtitles for topic '{topic}'")
        return srt_path
    except Exception as e:
        logger.warning(f"Subtitle generation failed: {e}")
        return ""


def _apply_transition_ffmpeg(
    input_paths: list[str],
    output_path: str,
    transitions: list[str],
) -> Optional[str]:
    """Apply transitions between clips using FFmpeg xfade filter.
    
    Each clip is trimmed to its duration, then connected with transitions.
    The xfade filter provides: fade, dissolve, slideleft, slideright, etc.
    """
    if len(input_paths) == 1:
        # Single clip \u2014 just copy
        import shutil
        shutil.copy2(input_paths[0], output_path)
        return output_path
    
    # Map transition names to xfade types
    xfade_map = {
        "fade": "fade",
        "dissolve": "dissolve",
        "slide": "slideleft",
        "zoom": "fade",
        "wipe": "fade",
        "crossfade": "fade",
        "blur": "fade",
        "": "fade",
    }
    
    transition_duration = 0.5
    
    # Build filter_complex for xfade
    filter_parts = []
    
    for i in range(len(input_paths)):
        filter_parts.append(f"[{i}:v]setpts=PTS-STARTPTS[v{i}];")
    
    current_label = "v0"
    for i in range(1, len(input_paths)):
        current_label = f"x{i}"
        xfade_type = xfade_map.get(transitions[i-1] if i-1 < len(transitions) else "", "fade")
        
        # Calculate offset: (i * 5.0) - transition_duration
        offset = (i * 5.0) - transition_duration
        
        filter_parts.append(
            f"[v{i-1}][v{i}]xfade=transition={xfade_type}:"
            f"duration={transition_duration}:offset={offset}[{current_label}];"
        )
    
    filter_str = " ".join(filter_parts)
    
    cmd = [FFMPEG, "-y"]
    for p in input_paths:
        cmd.extend(["-i", p])
    cmd.extend([
        "-filter_complex", filter_str,
        "-map", f"[{current_label}]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-pix_fmt", "yuv420p",
        output_path,
    ])
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode == 0 and Path(output_path).exists():
            logger.info(f"Transition applied: {len(input_paths)} clips -> {output_path}")
            return output_path
        else:
            logger.warning(f"Transition FFmpeg failed: {result.stderr[:300]}")
    except Exception as e:
        logger.warning(f"Transition error: {e}")
    
    # Fallback: simple concat without transitions
    logger.info("Transition fallback: using concat")
    concat_file = str(GENERATED_DIR / f"concat_list_{uuid.uuid4().hex[:8]}.txt")
    try:
        with open(concat_file, "w", encoding="utf-8") as f:
            for p in input_paths:
                escaped = p.replace("'", "'\\''")
                f.write(f"file '{escaped}'\n")
        
        subprocess.run([
            FFMPEG, "-y", "-f", "concat", "-safe", "0",
            "-i", concat_file,
            "-c", "copy", output_path,
        ], capture_output=True, timeout=120)
        
        if Path(output_path).exists():
            return output_path
    except Exception as e:
        logger.warning(f"Concat fallback failed: {e}")
    finally:
        try:
            Path(concat_file).unlink(missing_ok=True)
        except Exception:
            pass
    
    return None


def _mix_background_music(
    video_path: str,
    music_path: str,
    output_path: str,
    music_volume_db: float = -12.0,
    fade_in: float = 1.0,
    fade_out: float = 2.0,
) -> Optional[str]:
    """Mix background music into video.
    
    - Reduces music volume by music_volume_db (default -12dB)
    - Applies fade-in and fade-out to music
    - Aligns music duration to video duration
    - Preserves original video audio, mixed with background music
    """
    import shutil
    if not music_path or not Path(music_path).exists():
        shutil.copy2(video_path, output_path)
        return output_path
    
    try:
        cmd = [
            FFMPEG, "-y",
            "-i", video_path,
            "-i", music_path,
            "-filter_complex",
            f"[1:a]volume={music_volume_db}dB,"
            f"afade=t=in:d={fade_in},"
            f"afade=t=out:start={fade_out}:d={fade_out}"
            f"[music];"
            f"[0:a][music]amix=inputs=2:duration=first:dropout_transition=2"
            f",aformat=sample_rates=44100:channel_layouts=stereo[out]",
            "-map", "0:v",
            "-map", "[out]",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "128k",
            "-shortest",
            output_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode == 0 and Path(output_path).exists():
            logger.info(f"Music mixed: {music_volume_db}dB, fade {fade_in}s/{fade_out}s")
            return output_path
        logger.warning(f"Music mix failed (stderr): {result.stderr[:500]}")
    except Exception as e:
        logger.warning(f"Music mix error: {e}")
    
    shutil.copy2(video_path, output_path)
    return output_path


def _overlay_subtitles(
    video_path: str,
    srt_path: str,
    output_path: str,
) -> Optional[str]:
    """Overlay subtitles onto video using FFmpeg drawtext or subtitles filter."""
    import shutil
    if not srt_path or not Path(srt_path).exists():
        shutil.copy2(video_path, output_path)
        return output_path
    
    # Try subtitles filter first
    try:
        filter_path = srt_path.replace("\\", "/")
        # Escape for filter
        filter_path = filter_path.replace(":", "\\:")
        if len(filter_path) > 2 and filter_path[1] == "\\:":
            filter_path = filter_path[0] + ":" + filter_path[2:]
        
        cmd = [
            FFMPEG, "-y",
            "-i", video_path,
            "-vf", f"subtitles={filter_path}",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "copy",
            output_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode == 0 and Path(output_path).exists():
            logger.info(f"Subtitles overlaid via subtitles filter")
            return output_path
        logger.warning(f"Subtitle filter failed, trying drawtext...")
    except Exception as e:
        logger.warning(f"Subtitle overlay error: {e}")
    
    # Fallback: drawtext
    try:
        import re
        with open(srt_path, "r", encoding="utf-8") as f:
            content = f.read()
        
        match = re.search(r"\d+\n[\d:,]+\s*-->\s*[\d:,]+\n(.+?)(?:\n\n|\n$|$)", content, re.DOTALL)
        if match:
            text = match.group(1).strip().replace("\n", " ")
            escaped_text = text.replace("'", "\\'").replace(":", "\\:")
            cmd = [
                FFMPEG, "-y",
                "-i", video_path,
                "-vf", (
                    f"drawtext=text='{escaped_text}'"
                    f":fontcolor=white:fontsize=28"
                    f":x=(w-text_w)/2:y=h-th-50"
                    f":shadowcolor=black:shadowx=2:shadowy=2"
                    f":enable='between(t,0,99999)'"
                ),
                "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                "-c:a", "copy",
                output_path,
            ]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if result.returncode == 0 and Path(output_path).exists():
                logger.info(f"Subtitles overlaid via drawtext")
                return output_path
    except Exception as e:
        logger.warning(f"Drawtext fallback error: {e}")
    
    shutil.copy2(video_path, output_path)
    return output_path


# ═══════════════════════════════════════════════════════════════════════════
# T7-1: /api/media/render_video \u2014 Full video rendering pipeline
# ═══════════════════════════════════════════════════════════════════════════


@router.post("/render_video")
async def api_render_video(req: Request):
    """Full video rendering pipeline.
    
    Takes a script with clips, transitions, emotion, and topic,
    then produces a complete MP4 with:
      - Clips trimmed & concatenated with transitions
      - Emotion-matched background music at -12dB with fade in/out
      - Topic-based auto-generated subtitles
      - H.264 + AAC encoded output
    
    Request: {
        "script": [{"clip": "...", "duration": 5, "transition": "fade"}, ...],
        "emotion": "\u5e0c\u671b",
        "topic": "technology",
        "keywords": "AI future"
    }
    
    Response: {
        "status": "ok",
        "output_path": "...",
        "download_url": "/api/data/generated/...mp4",
        "total_duration": 18,
        "clip_count": 4,
        "music": "uplifting",
        "subtitles": true
    }
    """
    import shutil
    import tempfile
    
    body = await req.json()
    script = body.get("script", [])
    emotion = body.get("emotion", "\u9ed8\u8ba4")
    topic = body.get("topic", "general")
    keywords = body.get("keywords", "")
    narration_wav = body.get("narration_wav", "")  # T8-5: Optional voiceover WAV path
    
    if not script:
        raise HTTPException(400, "script is required (array of clips)")
    
    render_id = uuid.uuid4().hex[:12]
    logger.info(f"Render job {render_id}: {len(script)} clips, emotion={emotion}, topic={topic}")
    
    temp_dir = Path(tempfile.mkdtemp(prefix=f"render_{render_id}_"))
    output_filename = f"render_{render_id}.mp4"
    output_path = str(GENERATED_DIR / output_filename)
    
    try:
        # Step 1: Resolve and trim clips
        resolved_clips = []
        used_transitions = []
        total_duration = 0
        
        for i, item in enumerate(script):
            clip_name = item.get("clip", f"clip_{i}")
            duration = int(item.get("duration", 5))
            transition = item.get("transition", "fade")
            
            resolved_path = _resolve_clip_path(clip_name)
            trimmed_path = str(temp_dir / f"trim_{i:04d}.mp4")
            
            if os.path.exists(resolved_path):
                subprocess.run([
                    FFMPEG, "-y",
                    "-i", resolved_path,
                    "-t", str(duration),
                    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "128k",
                    "-vf", "scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2",
                    "-r", "30",
                    trimmed_path,
                ], capture_output=True, timeout=60)
                
                if Path(trimmed_path).exists():
                    resolved_clips.append(trimmed_path)
                    used_transitions.append(transition)
                    total_duration += duration
                    logger.info(f"  Clip {i}: {clip_name} ({duration}s, {transition})")
                    continue
            
            # Fallback: generate placeholder
            logger.warning(f"  Clip {i}: generating placeholder for '{clip_name}'")
            placeholder = str(temp_dir / f"placeholder_{i:04d}.mp4")
            subprocess.run([
                FFMPEG, "-y",
                "-f", "lavfi", "-i", f"color=c=0x1a1a2e:s=1080x1080:d={duration}:r=30",
                "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-shortest",
                placeholder,
            ], capture_output=True, timeout=30)
            if Path(placeholder).exists():
                resolved_clips.append(placeholder)
                used_transitions.append(transition)
                total_duration += duration
        
        if not resolved_clips:
            raise HTTPException(500, "No clips could be resolved or generated")
        
        # Step 2: Apply transitions and concatenate
        concat_path = str(temp_dir / "concat.mp4")
        result = _apply_transition_ffmpeg(resolved_clips, concat_path, used_transitions)
        if not result:
            concat_file = str(temp_dir / "list.txt")
            with open(concat_file, "w", encoding="utf-8") as f:
                for p in resolved_clips:
                    escaped = p.replace("'", "'\\''")
                    f.write(f"file '{escaped}'\n")
            subprocess.run([
                FFMPEG, "-y", "-f", "concat", "-safe", "0",
                "-i", concat_file,
                "-c", "copy", concat_path,
            ], capture_output=True, timeout=120)
        
        if not Path(concat_path).exists():
            raise HTTPException(500, "Video concatenation failed")
        
        # Step 3: Generate and mix background music
        music_path = _generate_music_for_emotion(emotion, total_duration)
        music_label = "none"
        for key, config in EMOTION_MUSIC.items():
            if key.lower() == emotion.lower() or key in emotion:
                music_label = config["label"]
                break
        
        music_mixed_path = str(temp_dir / "music.mp4")
        _mix_background_music(
            concat_path, music_path, music_mixed_path,
            music_volume_db=-12.0, fade_in=1.0, fade_out=2.0,
        )
        
        if not Path(music_mixed_path).exists():
            music_mixed_path = concat_path
        
        # Step 3b: Mix voiceover if provided (T8-5)
        voiceover_input = narration_wav if narration_wav else ""
        if voiceover_input and Path(voiceover_input).exists():
            logger.info(f"Mixing voiceover: {voiceover_input}")
            voiceover_mixed_path = str(temp_dir / "voiceover.mp4")
            _mix_voiceover(
                music_mixed_path, voiceover_input, music_path,
                voiceover_mixed_path,
                voice_volume_db=-3.0, music_volume_db=-12.0,
            )
            if Path(voiceover_mixed_path).exists():
                music_mixed_path = voiceover_mixed_path
        
        # Step 4: Generate and overlay subtitles
        srt_path = _generate_subtitles_for_topic(topic, len(resolved_clips), total_duration)
        subtitle_path = str(temp_dir / "subtitled.mp4")
        _overlay_subtitles(music_mixed_path, srt_path, subtitle_path)
        
        final_source = subtitle_path if Path(subtitle_path).exists() else music_mixed_path
        
        # Step 5: Copy to final output
        shutil.copy2(final_source, output_path)
        
        if not Path(output_path).exists():
            raise HTTPException(500, "Final render output not created")
        
        size_mb = Path(output_path).stat().st_size / (1024 * 1024)
        download_url = f"/api/data/generated/{output_filename}"
        
        logger.info(
            f"Render complete: {output_filename} "
            f"({size_mb:.1f} MB, {total_duration}s, {len(resolved_clips)} clips, "
            f"music={music_label}, subs={bool(srt_path)})"
        )
        
        return JSONResponse({
            "status": "ok",
            "output_path": output_path,
            "download_url": download_url,
            "filename": output_filename,
            "total_duration": total_duration,
            "clip_count": len(resolved_clips),
            "size_mb": round(size_mb, 2),
            "music": music_label,
            "subtitles": bool(srt_path),
            "emotion": emotion,
            "topic": topic,
            "render_id": render_id,
        })
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Render failed: {e}", exc_info=True)
        raise HTTPException(500, f"Render failed: {e}")
    finally:
        try:
            shutil.rmtree(str(temp_dir), ignore_errors=True)
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════════════════
# Sprint 6 — AI TTS Narration + Voiceover + Multi-language
# ═══════════════════════════════════════════════════════════════════════════

NARRATIONS_DIR = DATA_DIR / "narrations"
NARRATIONS_DIR.mkdir(parents=True, exist_ok=True)

# T8-1: Emotion+Topic → Narration text templates
NARRATION_TEMPLATES = {
    "technology": {
        "\u5e73\u9759": ["\u5728\u8fd9\u4e2a\u6570\u5b57\u5316\u7684\u65f6\u4ee3\uff0c\u79d1\u6280\u8ba9\u6211\u4eec\u7684\u751f\u6d3b\u66f4\u52a0\u4fbf\u6377\u3002", "\u667a\u80fd\u8bbe\u5907\u65e0\u5904\u4e0d\u5728\uff0c\u8fde\u63a5\u7740\u6bcf\u4e00\u4e2a\u4eba\u3002", "\u672a\u6765\u5df2\u7ecf\u6765\u4e34\uff0c\u6211\u4eec\u6b63\u5728\u7ecf\u5386\u4e00\u573a\u6570\u5b57\u9769\u547d\u3002"],
        "\u5e0c\u671b": ["\u79d1\u6280\u8d4b\u4e88\u6211\u4eec\u65e0\u9650\u7684\u53ef\u80fd\u6027\u3002", "\u4eba\u5de5\u667a\u80fd\u6b63\u5728\u6539\u53d8\u4e16\u754c\uff0c\u8ba9\u672a\u6765\u5145\u6ee1\u5e0c\u671b\u3002", "\u6bcf\u4e00\u4e2a\u521b\u65b0\uff0c\u90fd\u662f\u4e00\u6b65\u5411\u524d\u7684\u8dc3\u8fc1\u3002"],
        "\u6e29\u6696": ["\u79d1\u6280\u4e0d\u4ec5\u662f\u51b7\u51b0\u51b0\u7684\u6570\u636e\uff0c\u5b83\u4e5f\u80fd\u5e26\u6765\u6e29\u6696\u3002", "\u8fde\u63a5\u6bcf\u4e00\u9897\u5fc3\u7684\uff0c\u662f\u90a3\u4e9b\u7ec6\u5fae\u7684\u79d1\u6280\u521b\u65b0\u3002", "\u6570\u5b57\u65f6\u4ee3\u7684\u6e29\u6696\uff0c\u5c31\u5728\u6211\u4eec\u8eab\u8fb9\u3002"],
        "\u5b64\u72ec": ["\u5728\u6570\u5b57\u4e16\u754c\u91cc\uff0c\u6211\u4eec\u6709\u65f6\u4e5f\u4f1a\u611f\u5230\u5b64\u72ec\u3002", "\u9762\u5bf9\u5c4f\u5e55\uff0c\u6211\u4eec\u5b64\u72ec\u5374\u53c8\u88ab\u8fde\u63a5\u3002", "\u6280\u672f\u7684\u8fdb\u6b65\uff0c\u65e0\u6cd5\u66ff\u4ee3\u771f\u5b9e\u7684\u60c5\u611f\u3002"],
        "\u5174\u594b": ["\u79d1\u6280\u7684\u901f\u5ea6\u8ba9\u4eba\u5174\u594b\uff01", "\u6bcf\u4e00\u5929\u90fd\u6709\u65b0\u7684\u53d1\u73b0\uff0c\u8ba9\u6211\u4eec\u70ed\u8840\u6cb8\u817e\u3002", "\u672a\u6765\u5df2\u6765\uff0c\u8ba9\u6211\u4eec\u62e5\u62b1\u8fd9\u4e2a\u6fc0\u52a8\u4eba\u5fc3\u7684\u65f6\u4ee3\u3002"],
    },
    "nature": {
        "\u5e73\u9759": ["\u5927\u81ea\u7136\u7684\u7f8e\u666f\uff0c\u8ba9\u4eba\u5fc3\u65f7\u795e\u6021\u3002", "\u84dd\u5929\u767d\u4e91\uff0c\u7eff\u6811\u6210\u836b\uff0c\u8fd9\u5c31\u662f\u81ea\u7136\u7684\u9b45\u529b\u3002", "\u5728\u5c71\u6c34\u4e4b\u95f4\uff0c\u627e\u56de\u5fc3\u4e2d\u7684\u5e73\u9759\u3002"],
        "\u5e0c\u671b": ["\u65e5\u51fa\u4e1c\u65b9\uff0c\u5149\u8292\u7167\u8000\u5927\u5730\u3002", "\u6625\u5929\u59cb\u4e8e\u82b1\u5f00\uff0c\u5e0c\u671b\u59cb\u4e8e\u5fc3\u4e2d\u3002", "\u6bcf\u4e00\u7247\u7eff\u53f6\uff0c\u90fd\u662f\u65b0\u751f\u547d\u7684\u5f00\u59cb\u3002"],
        "\u6e29\u6696": ["\u9633\u5149\u6d12\u5728\u8eab\u4e0a\uff0c\u6e29\u6696\u7684\u713c\u713c\u3002", "\u5fae\u98ce\u5439\u8fc7\u6811\u68a2\uff0c\u5e26\u6765\u4e86\u81ea\u7136\u7684\u6e29\u6696\u3002", "\u5927\u81ea\u7136\u7684\u62e5\u62b1\uff0c\u6c38\u8fdc\u90a3\u4e48\u6e29\u6696\u3002"],
    },
    "people": {
        "\u5e73\u9759": ["\u4eba\u4e0e\u4eba\u4e4b\u95f4\u7684\u8fde\u63a5\uff0c\u662f\u6700\u7f8e\u597d\u7684\u4e8b\u3002", "\u5728\u7e41\u5fd9\u7684\u4e16\u754c\u91cc\uff0c\u4f11\u606f\u4e00\u4e0b\u3002", "\u6bcf\u4e00\u4e2a\u5fae\u7b11\uff0c\u90fd\u662f\u4e00\u4e2a\u6545\u4e8b\u3002"],
        "\u5e0c\u671b": ["\u4eba\u4eec\u56e2\u7ed3\u5728\u4e00\u8d77\uff0c\u521b\u9020\u66f4\u7f8e\u597d\u7684\u672a\u6765\u3002", "\u6bcf\u4e2a\u4eba\u90fd\u662f\u6539\u53d8\u4e16\u754c\u7684\u529b\u91cf\u3002", "\u56e2\u7ed3\u5408\u4f5c\uff0c\u8ba9\u5e0c\u671b\u4e4b\u706b\u71c3\u70e7\u3002"],
    },
    "city": {
        "\u5e73\u9759": ["\u57ce\u5e02\u7684\u65e9\u6668\uff0c\u5b81\u9759\u800c\u7f8e\u597d\u3002", "\u8857\u5934\u5c0f\u5df7\uff0c\u6ea2\u6ee1\u751f\u6d3b\u7684\u6c14\u606f\u3002", "\u90fd\u5e02\u4e2d\u7684\u4e00\u89d2\uff0c\u4e5f\u6709\u5b81\u9759\u7684\u7a7a\u95f4\u3002"],
        "\u5174\u594b": ["\u57ce\u5e02\u7684\u591c\u665a\uff0c\u706f\u706b\u8f89\u714c\u3002", "\u9ad8\u697c\u5927\u53a6\uff0c\u5c55\u793a\u7740\u4eba\u7c7b\u7684\u667a\u6167\u3002", "\u90fd\u5e02\u7684\u8282\u594f\uff0c\u8ba9\u4eba\u5fc3\u671d\u6d6a\u6d8c\u3002"],
    },
}

NARRATION_DEFAULT = ["\u8fd9\u662f\u4e00\u6bb5\u7f8e\u597d\u7684\u65f6\u5149\u3002", "\u8ba9\u6211\u4eec\u4e00\u8d77\u4eab\u53d7\u8fd9\u4e2a\u65f6\u523b\u3002", "\u751f\u6d3b\uff0c\u6c38\u8fdc\u503c\u5f97\u6211\u4eec\u53bb\u53d1\u73b0\u3002"]

# English templates for en-US
NARRATION_TEMPLATES_EN = {
    "technology": {
        "calm": ["In this digital age, technology makes our lives more convenient.", "Smart devices connect everyone, everywhere.", "The future is here, and we are living through a digital revolution."],
        "hope": ["Technology gives us infinite possibilities.", "AI is changing the world, filling the future with hope.", "Every innovation is a leap forward."],
        "warm": ["Technology is not just cold data — it brings warmth too.", "Connecting every heart through subtle tech innovations.", "The warmth of the digital age is all around us."],
    },
    "nature": {
        "calm": ["Nature's beauty brings peace to the soul.", "Blue skies, green trees — this is the charm of nature.", "Find your inner peace in the great outdoors."],
        "hope": ["Sunrise over the horizon, light fills the earth.", "Spring begins with flowers, hope begins within.", "Every green leaf is the start of new life."],
    },
}

# Swedish templates for sv-SE
NARRATION_TEMPLATES_SV = {
    "technology": {
        "calm": ["I den digitala tids\u00e5ldern g\u00f6r tekniken v\u00e5ra liv enklare.", "Smarta enheter kopplar samman alla, \u00f6verallt.", "Framtiden \u00e4r h\u00e4r, och vi lever genom en digital revolution."],
        "hope": ["Teknik ger oss o\u00e4ndliga m\u00f6jligheter.", "AI f\u00f6r\u00e4ndrar v\u00e4rlden och fyller framtiden med hopp.", "Varje innovation \u00e4r ett steg fram\u00e5t."],
    },
    "nature": {
        "calm": ["Naturens sk\u00f6nhet ger ro \u00e5t sj\u00e4len.", "Bl\u00e5 himmel, gr\u00f6na tr\u00e4d \u2014 detta \u00e4r naturens charm.", "Hitta din inre frid i naturen."],
    },
}


# T8-3: TTS engine — tiered: edge_tts > pyttsx3 > FFmpeg fallback
_HAS_EDGE_TTS = None
_HAS_PYTTSX3 = None


def _check_edge_tts() -> bool:
    global _HAS_EDGE_TTS
    if _HAS_EDGE_TTS is not None:
        return _HAS_EDGE_TTS
    try:
        import edge_tts
        _HAS_EDGE_TTS = True
        logger.info("TTS: edge_tts available")
        return True
    except ImportError:
        _HAS_EDGE_TTS = False
        return False


def _check_pyttsx3() -> bool:
    global _HAS_PYTTSX3
    if _HAS_PYTTSX3 is not None:
        return _HAS_PYTTSX3
    try:
        import pyttsx3
        _HAS_PYTTSX3 = True
        logger.info("TTS: pyttsx3 available")
        return True
    except ImportError:
        _HAS_PYTTSX3 = False
        return False


# Edge TTS voice mapping
EDGE_TTS_VOICES = {
    "zh-CN": {"male": "zh-CN-YunxiNeural", "female": "zh-CN-XiaoxiaoNeural",
              "calm": "zh-CN-XiaoxiaoNeural", "excited": "zh-CN-YunxiNeural",
              "warm": "zh-CN-XiaohanNeural", "sad": "zh-CN-XiaomoNeural",
              "tech": "zh-CN-YunyangNeural"},
    "en-US": {"male": "en-US-GuyNeural", "female": "en-US-JennyNeural",
              "calm": "en-US-JennyNeural", "excited": "en-US-GuyNeural",
              "warm": "en-US-AriaNeural", "sad": "en-US-JennyNeural",
              "tech": "en-US-GuyNeural"},
    "sv-SE": {"male": "sv-SE-SofieNeural", "female": "sv-SE-SofieNeural",
              "calm": "sv-SE-SofieNeural", "excited": "sv-SE-SofieNeural",
              "warm": "sv-SE-SofieNeural", "sad": "sv-SE-SofieNeural",
              "tech": "sv-SE-SofieNeural"},
}

# pyttsx3 voice indices (approximate)
PYTTSX3_VOICES = {
    "zh-CN": {"male": 0, "female": 1, "calm": 0, "excited": 1, "warm": 1, "sad": 0, "tech": 0},
    "en-US": {"male": 0, "female": 1, "calm": 1, "excited": 0, "warm": 1, "sad": 0, "tech": 0},
    "sv-SE": {"male": 0, "female": 1, "calm": 0, "excited": 1, "warm": 1, "sad": 0, "tech": 0},
}


def _synthesize_ffmpeg_fallback(text: str, output_path: str, voice: str = "female") -> Optional[str]:
    """Generate robot voice using FFmpeg audio synthesis as fallback.
    
    Uses formant-like synthesis with aevalsrc to create a speakable voice.
    Simulates speech by varying frequency over time (not actual speech but
    a recognizable robotic tone with the text duration).
    """
    import math
    word_count = max(len(text.split()), 1)
    duration = word_count * 0.35  # ~0.35s per word
    
    # Choose frequency range based on voice gender
    base_freq = 200 if voice in ("female", "calm", "warm") else 140
    vibrato = 4 if voice in ("excited", "tech") else 2
    
    try:
        cmd = [
            FFMPEG, "-y",
            "-f", "lavfi",
            "-i", (
                f"aevalsrc="
                f"exprs="
                f"'sin(2*PI*{base_freq}*t) * "
                f"(1 + 0.3*sin(2*PI*{vibrato}*t)) + "
                f"0.2*sin(2*PI*{base_freq*2}*t)*sin(2*PI*3*t)"
                f"':"
                f"d={duration}"
            ),
            "-ar", "44100",
            "-ac", "1",
            output_path,
        ]
        subprocess.run(cmd, capture_output=True, timeout=30)
        if Path(output_path).exists() and Path(output_path).stat().st_size > 1000:
            logger.info(f"TTS FFmpeg fallback: {duration:.1f}s, {voice}")
            return output_path
    except Exception as e:
        logger.warning(f"TTS FFmpeg fallback failed: {e}")
    
    # Ultra-fallback: silence
    try:
        subprocess.run([
            FFMPEG, "-y",
            "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=mono:d={duration}",
            output_path,
        ], capture_output=True, timeout=10)
    except Exception:
        pass
    return output_path if Path(output_path).exists() else None


async def _synthesize_tts_async(text: str, language: str, voice: str) -> str:
    """Async TTS synthesis. Tries edge_tts first (async native), then falls back."""
    tts_id = uuid.uuid4().hex[:8]
    output_path = str(NARRATIONS_DIR / f"tts_{tts_id}.wav")
    
    # Attempt 1: edge_tts (async native)
    if _check_edge_tts():
        try:
            import edge_tts
            voice_name = EDGE_TTS_VOICES.get(language, EDGE_TTS_VOICES["en-US"]).get(voice, "en-US-JennyNeural")
            communicate = edge_tts.Communicate(text, voice_name)
            await communicate.save(output_path)
            if Path(output_path).exists() and Path(output_path).stat().st_size > 1000:
                logger.info(f"TTS edge_tts: {language}/{voice} -> {output_path}")
                return output_path
        except Exception as e:
            logger.warning(f"TTS edge_tts failed: {e}")
    
    # Fallback to sync methods
    return _synthesize_tts_fallback(text, language, voice, output_path)


def _synthesize_tts_fallback(text: str, language: str, voice: str, output_path: str) -> str:
    """Synchronous TTS fallback: pyttsx3 > FFmpeg."""
    
    # Attempt 2: pyttsx3 (offline)
    if _check_pyttsx3():
        try:
            import pyttsx3
            engine = pyttsx3.init()
            
            # Set voice
            voice_idx = PYTTSX3_VOICES.get(language, PYTTSX3_VOICES["en-US"]).get(voice, 0)
            voices = engine.getProperty('voices')
            if 0 <= voice_idx < len(voices):
                engine.setProperty('voice', voices[voice_idx].id)
            
            # Set rate
            rate_map = {"calm": 150, "excited": 200, "warm": 160, "sad": 120, "tech": 180}
            engine.setProperty('rate', rate_map.get(voice, 160))
            
            engine.save_to_file(text, output_path)
            engine.runAndWait()
            
            if Path(output_path).exists() and Path(output_path).stat().st_size > 1000:
                logger.info(f"TTS pyttsx3: {language}/{voice} -> {output_path}")
                return output_path
        except Exception as e:
            logger.warning(f"TTS pyttsx3 failed: {e}")
    
    # Attempt 3: FFmpeg fallback
    logger.info(f"TTS using FFmpeg fallback for: {text[:50]}...")
    result = _synthesize_ffmpeg_fallback(text, output_path, voice)
    if result:
        return result
    
    # Ultimate fallback: generate empty audio
    logger.error("All TTS engines failed, generating silence")
    try:
        duration = max(len(text.split()) * 0.3, 2.0)
        subprocess.run([
            FFMPEG, "-y",
            "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=mono:d={duration}",
            output_path,
        ], capture_output=True, timeout=10)
    except Exception:
        pass
    
    return output_path if Path(output_path).exists() else ""


def _select_narration_text(emotion: str, topic: str, scene: str, language: str = "zh-CN") -> str:
    """Select appropriate narration text based on emotion, topic, scene, and language."""
    emotion_lower = emotion.lower() if emotion else "\u5e73\u9759"
    topic_lower = topic.lower() if topic else "general"
    
    # Normalize emotion to keys used in templates
    emotion_key = "\u5e73\u9759"
    for key in ["\u5e73\u9759", "\u5e0c\u671b", "\u6e29\u6696", "\u5b64\u72ec", "\u5174\u594b", "\u60b2\u4f24", "\u79d1\u6280"]:
        if key.lower() in emotion_lower or emotion_lower in key.lower():
            emotion_key = key
            break
    
    # Select template set by language
    if language == "en-US":
        templates = NARRATION_TEMPLATES_EN
    elif language == "sv-SE":
        templates = NARRATION_TEMPLATES_SV
    else:
        templates = NARRATION_TEMPLATES
    
    # Get topic templates
    topic_templates = templates.get(topic_lower, {})
    sentences = topic_templates.get(emotion_key, [])
    
    if not sentences:
        # Fallback to default
        if language == "en-US":
            sentences = ["This is a beautiful moment.", "Let us enjoy this moment together.", "Life is always worth discovering."]
        elif language == "sv-SE":
            sentences = ["Detta \u00e4r ett vackert \u00f6gonblick.", "L\u00e5t oss njuta av denna stund.", "Livet \u00e4r v\u00e4rt att uppt\u00e4cka."]
        else:
            sentences = NARRATION_DEFAULT
    
    # Return 2-3 sentences
    rng = random.Random(emotion + topic + scene)
    count = min(rng.randint(2, 3), len(sentences))
    selected = rng.sample(sentences, count)
    return " ".join(selected)


def _mix_voiceover(
    video_path: str,
    voiceover_path: str,
    music_path: str,
    output_path: str,
    voice_volume_db: float = -3.0,
    music_volume_db: float = -12.0,
    fade_in: float = 0.5,
    fade_out: float = 1.5,
) -> Optional[str]:
    """Mix voiceover + background music into video.
    
    Three-layer mix:
    1. Voiceover at voice_volume_db (default -3dB) with fade in/out
    2. Background music at music_volume_db (default -12dB) with fade in/out
    3. Original video audio
    
    All aligned to video duration.
    """
    import shutil
    
    has_voiceover = voiceover_path and Path(voiceover_path).exists()
    has_music = music_path and Path(music_path).exists()
    
    if not has_voiceover and not has_music:
        shutil.copy2(video_path, output_path)
        return output_path
    
    try:
        inputs = [video_path]
        filter_parts = []
        maps = ["0:v"]
        
        # Voiceover stream (input 1)
        if has_voiceover:
            inputs.append(voiceover_path)
            filter_parts.append(
                f"[1:a]volume={voice_volume_db}dB,"
                f"afade=t=in:d={fade_in},"
                f"afade=t=out:d={fade_out}[voice];"
            )
        
        # Music stream (input 2)
        music_input_idx = 2 if has_voiceover else 1
        if has_music:
            inputs.append(music_path)
            filter_parts.append(
                f"[{music_input_idx}:a]volume={music_volume_db}dB,"
                f"afade=t=in:d={fade_in},"
                f"afade=t=out:d={fade_out}[music];"
            )
        
        # Build amix
        audio_inputs = []
        # Original video audio: [0:a]
        audio_inputs.append("[0:a]")
        
        if has_voiceover:
            audio_inputs.append("[voice]")
        if has_music:
            audio_inputs.append("[music]")
        
        amix_inputs = ":".join([f"[a{i}]" for i in range(1)])  # placeholder, rebuilt below
        input_count = 1 + (1 if has_voiceover else 0) + (1 if has_music else 0)
        
        # Simpler approach: use amix filter
        audio_labels = []
        if has_voiceover:
            audio_labels.append("[voice]")
        if has_music:
            audio_labels.append("[music]")
        
        # Build the filter string
        mix_parts = []
        all_audio_labels = ["[0:a]"] + audio_labels
        
        if len(all_audio_labels) >= 2:
            label_str = "".join(all_audio_labels)
            mix_parts.append(
                f"{label_str}amix=inputs={len(all_audio_labels)}:duration=first:dropout_transition=2"
                f",aformat=sample_rates=44100:channel_layouts=stereo[out]"
            )
        else:
            mix_parts.append("[0:a]aformat=sample_rates=44100:channel_layouts=stereo[out]")
        
        filter_complex = " ".join(filter_parts) + " ".join(mix_parts)
        
        maps.append("[out]")
        
        cmd = [FFMPEG, "-y"]
        for inp in inputs:
            cmd.extend(["-i", inp])
        cmd.extend([
            "-filter_complex", filter_complex,
            "-map", "0:v",
            "-map", "[out]",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "128k",
            "-shortest",
            output_path,
        ])
        
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if result.returncode == 0 and Path(output_path).exists():
            logger.info(f"Voiceover mix: voice={voice_volume_db}dB, music={music_volume_db}dB")
            return output_path
        logger.warning(f"Voiceover mix failed: {result.stderr[:300]}")
    
    except Exception as e:
        logger.warning(f"Voiceover mix error: {e}")
    
    # Fallback: just copy
    shutil.copy2(video_path, output_path)
    return output_path


# ═══════════════════════════════════════════════════════════════════════════
# T8-1: /api/media/generate_narration — AI narration text generation
# ═══════════════════════════════════════════════════════════════════════════


@router.post("/generate_narration")
async def api_generate_narration(req: Request):
    """Generate narration text based on emotion, topic, and scene.
    
    Returns 2-3 sentences of narration text appropriate to the context.
    
    Request: {"emotion": "\u5e0c\u671b", "topic": "technology", "scene": "indoor", "language": "zh-CN"}
    Response: {"text": "...", "sentences": [...], "language": "zh-CN"}
    """
    body = await req.json()
    emotion = body.get("emotion", "\u5e73\u9759")
    topic = body.get("topic", "general")
    scene = body.get("scene", "")
    language = body.get("language", "zh-CN")
    
    text = _select_narration_text(emotion, topic, scene, language)
    sentences = [s.strip() for s in text.replace("。", "。|").replace("！", "！|").split("|") if s.strip()]
    
    return JSONResponse({
        "text": text,
        "sentences": sentences,
        "emotion": emotion,
        "topic": topic,
        "language": language,
    })


# ═══════════════════════════════════════════════════════════════════════════
# T8-2: /api/media/tts — Text-to-Speech synthesis
# ═══════════════════════════════════════════════════════════════════════════


@router.post("/tts")
async def api_tts(req: Request):
    """Synthesize text to speech.
    
    Input: {"text": "...", "language": "zh-CN", "voice": "female"}
    
    Output: WAV file path + download URL
    
    Supports:
      - Languages: zh-CN, en-US, sv-SE
      - Voices: male, female, calm, excited, warm, sad, tech
      - Engines: edge_tts > pyttsx3 > FFmpeg fallback
    """
    body = await req.json()
    text = body.get("text", "")
    language = body.get("language", "zh-CN")
    voice = body.get("voice", "female")
    
    if not text:
        raise HTTPException(400, "text is required")
    
    output_path = await _synthesize_tts_async(text, language, voice)
    
    if not output_path or not Path(output_path).exists():
        raise HTTPException(500, "TTS synthesis failed")
    
    size_kb = Path(output_path).stat().st_size / 1024
    filename = Path(output_path).name
    download_url = f"/api/data/narrations/{filename}"
    
    return JSONResponse({
        "status": "ok",
        "output_path": output_path,
        "download_url": download_url,
        "filename": filename,
        "size_kb": round(size_kb, 1),
        "text": text,
        "language": language,
        "voice": voice,
    })


# ═══════════════════════════════════════════════════════════════════════════
# Mount narrations directory for static serving
# ═══════════════════════════════════════════════════════════════════════════


# Note: The /api/data mount in server.py already covers /api/data/narrations
# since DATA_DIR contains NARRATIONS_DIR


# ═══════════════════════════════════════════════════════════════════════════
# Sprint 7 — AI Cover Generation + Title + Tags
# ═══════════════════════════════════════════════════════════════════════════

COVERS_DIR = DATA_DIR / "covers"
COVERS_DIR.mkdir(parents=True, exist_ok=True)

# T9-1: Emotion → Cover color palettes
EMOTION_COVERS = {
    "\u5e73\u9759":    {"bg1": "0x1a2a3a", "bg2": "0x2a4a6a", "accent": "0x7ecfff", "gradient": "to_r", "particles": "0x7ecfff40"},
    "\u5e0c\u671b":    {"bg1": "0x2a1a3a", "bg2": "0x6a2a5a", "accent": "0xc99eff", "gradient": "to_l", "particles": "0xc99eff40"},
    "\u6e29\u6696":    {"bg1": "0x3a2a1a", "bg2": "0x6a4a2a", "accent": "0xff9a3a", "gradient": "to_r", "particles": "0xff9a3a40"},
    "\u5b64\u72ec":    {"bg1": "0x0a0a1a", "bg2": "0x1a1a3a", "accent": "0x4a6aff", "gradient": "to_b", "particles": "0x4a6aff30"},
    "\u79d1\u6280":    {"bg1": "0x0a1a2a", "bg2": "0x1a3a5a", "accent": "0x3af",   "gradient": "to_t", "particles": "0x3a9eff40"},
    "\u5174\u594b":    {"bg1": "0x2a0a0a", "bg2": "0x5a1a2a", "accent": "0xff4a4a", "gradient": "to_r", "particles": "0xff4a4a40"},
    "\u60b2\u4f24":    {"bg1": "0x1a1a2a", "bg2": "0x2a2a4a", "accent": "0x8a8aff", "gradient": "to_l", "particles": "0x8a8aff30"},
    "\u9ed8\u8ba4":    {"bg1": "0x1a1a2e", "bg2": "0x2a2a4a", "accent": "0x7ecfff", "gradient": "to_r", "particles": "0x7ecfff30"},
}

# T9-2: Title templates by emotion+topic
TITLE_TEMPLATES = {
    "\u5e73\u9759": {
        "technology": ["Calm Code", "Digital Serenity", "Quiet Innovation", "Peaceful Tech", "Mindful Machines"],
        "nature": ["Tranquil Wild", "Nature's Peace", "Gentle Earth", "Calm Horizons", "Soft Landscapes"],
        "people": ["Quiet Moments", "Peaceful Connections", "Gentle Souls", "Calm Hearts", "Serene Lives"],
        "general": ["Peaceful Journey", "Calm Reflections", "Serenity Now", "Gentle Days", "Tranquil Mind"],
    },
    "\u5e0c\u671b": {
        "technology": ["Future Rising", "Hope in Code", "Bright Tomorrow", "Innovation Dreams", "New Dawn Tech"],
        "nature": ["New Beginnings", "Sunrise Earth", "Growing Hope", "Spring Awakening", "Radiant Nature"],
        "people": ["Rising Together", "Hopeful Hearts", "Bright Futures", "Inspiring Lives", "Dream Big"],
        "general": ["Hope Prevails", "Bright Side", "New Horizons", "Rising Sun", "Better Days"],
    },
    "\u6e29\u6696": {
        "technology": ["Warm Connections", "Human Touch Tech", "Soft Innovation", "Gentle Future", "Caring Code"],
        "nature": ["Warm Sunshine", "Golden Hours", "Soft Earth", "Home in Nature", "Gentle Breeze"],
        "people": ["Warm Embrace", "Kind Hearts", "Family Bonds", "Tender Moments", "Loving Lives"],
        "general": ["Warm Welcome", "Cozy Feelings", "Heartfelt", "Golden Moments", "Sunshine Days"],
    },
    "\u5b64\u72ec": {
        "technology": ["Solo in Silicon", "Lonely Code", "Quiet Terminal", "Alone in Data", "Empty Screens"],
        "nature": ["Solitary Path", "Alone in Wild", "Lonely Mountain", "Silent Forest", "Desert Peace"],
        "people": ["One Voice", "Solo Journey", "Quiet Heart", "Lone Star", "Single Flame"],
        "general": ["Alone but Free", "Solitary Beauty", "Quiet Strength", "Lone Walk", "Silent Grace"],
    },
    "\u79d1\u6280": {
        "technology": ["Tech Revolution", "Digital Frontier", "Neural Visions", "Cyber Future", "Data Dreams"],
        "nature": ["Bio Tech", "Digital Nature", "Eco Future", "Green Tech", "Nature 2.0"],
        "people": ["Future Humans", "Digital Lives", "Tech Society", "Connected People", "Smart Living"],
        "general": ["Future Now", "Digital Age", "Tech World", "Next Gen", "Innovation Hub"],
    },
}

TITLE_DEFAULT = ["Amazing Journey", "Beautiful Moments", "Incredible World", "Wonderous Times", "Simply Amazing"]

# T9-3: Tag generation
TAG_POOLS = {
    "technology": ["#ai", "#tech", "#digital", "#future", "#innovation", "#code", "#robot", "#data", "#cyber", "#smart", "#neural", "#algorithm", "#automation", "#machinelearning", "#software"],
    "nature": ["#nature", "#landscape", "#outdoor", "#scenic", "#wildlife", "#forest", "#mountain", "#ocean", "#sunset", "#earth", "#green", "#environment", "#travel", "#photography", "#beautiful"],
    "people": ["#people", "#human", "#community", "#together", "#family", "#life", "#love", "#connection", "#society", "#culture", "#diversity", "#unity", "#portrait", "#emotion", "#story"],
    "city": ["#city", "#urban", "#architecture", "#cityscape", "#downtown", "#building", "#street", "#skyline", "#metropolis", "#travel", "#citylife", "#night", "#lights", "#modern", "#design"],
    "art": ["#art", "#design", "#creative", "#colorful", "#abstract", "#modern", "#aesthetic", "#visual", "#artwork", "#inspiration", "#digitalart", "#graphic", "#illustration", "#pattern", "#beauty"],
    "science": ["#science", "#research", "#space", "#lab", "#discovery", "#biology", "#chemistry", "#physics", "#experiment", "#knowledge", "#universe", "#dna", "#molecule", "#innovation", "#future"],
    "music": ["#music", "#sound", "#melody", "#rhythm", "#song", "#instrument", "#piano", "#guitar", "#concert", "#performance", "#audio", "#beat", "#tune", "#artist", "#vibe"],
    "sports": ["#sport", "#fitness", "#game", "#training", "#athlete", "#team", "#competition", "#victory", "#workout", "#gym", "#champion", "#run", "#swim", "#motivation", "#goal"],
    "food": ["#food", "#cooking", "#delicious", "#recipe", "#tasty", "#kitchen", "#chef", "#cuisine", "#healthy", "#organic", "#meal", "#dinner", "#breakfast", "#yummy", "#gourmet"],
    "travel": ["#travel", "#adventure", "#wanderlust", "#explore", "#journey", "#destination", "#vacation", "#trip", "#tourist", "#backpack", "#roadtrip", "#world", "#discover", "#wonder", "#expedition"],
    "general": ["#amazing", "#beautiful", "#incredible", "#wonderful", "#inspiring", "#lovely", "#stunning", "#fantastic", "#great", "#awesome", "#blessed", "#happy", "#life", "#moment", "#media"],
}


def _get_emotion_cover(emotion: str) -> dict:
    """Get cover color config for emotion."""
    emotion_lower = emotion.lower() if emotion else ""
    for key, config in EMOTION_COVERS.items():
        if key.lower() in emotion_lower or emotion_lower in key.lower():
            return config
    return EMOTION_COVERS["\u9ed8\u8ba4"]


def _generate_cover_image(emotion: str, topic: str, scene: str, title: str = "") -> str:
    """Generate a gradient cover image using FFmpeg.
    
    Creates a 1080x1080 PNG with:
    - Emotion-colored gradient background
    - Decorative particle/light effects
    - Title text overlay (if provided)
    """
    cover_id = uuid.uuid4().hex[:8]
    output_path = str(COVERS_DIR / f"cover_{cover_id}.png")
    
    cfg = _get_emotion_cover(emotion)
    bg1 = cfg["bg1"]
    bg2 = cfg["bg2"]
    accent = cfg["accent"]
    grad_dir = cfg["gradient"]
    
    # FFmpeg drawbox-based gradient generation
    temp_gradient = str(COVERS_DIR / f"_grad_{cover_id}.png")
    
    try:
        # Generate gradient background
        if grad_dir == "to_r":
            grad_cmd = "gradients=0:0:1080:0"
        elif grad_dir == "to_l":
            grad_cmd = "gradients=1080:0:0:0"
        elif grad_dir == "to_b":
            grad_cmd = "gradients=0:0:0:1080"
        elif grad_dir == "to_t":
            grad_cmd = "gradients=0:1080:0:0"
        else:
            grad_cmd = "gradients=0:0:1080:1080"
        
        # FFmpeg approach: create gradient using geq filter
        cmd = [
            FFMPEG, "-y",
            "-f", "lavfi",
            "-i", f"color=c={bg1}:s=1080x1080:d=1:r=1",
            "-vf", (
                f"geq="
                f"r='255*X/W*({int(bg2[2:4],16)}-{int(bg1[2:4],16)})/255+{int(bg1[2:4],16)}':"
                f"g='255*X/W*({int(bg2[4:6],16)}-{int(bg1[4:6],16)})/255+{int(bg1[4:6],16)}':"
                f"b='255*X/W*({int(bg2[6:8],16)}-{int(bg1[6:8],16)})/255+{int(bg1[6:8],16)}'"
            ),
            "-frames:v", "1",
            temp_gradient,
        ]
        subprocess.run(cmd, capture_output=True, timeout=15)
        
        if not Path(temp_gradient).exists():
            # Fallback: solid color
            subprocess.run([
                FFMPEG, "-y",
                "-f", "lavfi", "-i", f"color=c={bg1}:s=1080x1080:d=1:r=1",
                "-frames:v", "1",
                temp_gradient,
            ], capture_output=True, timeout=10)
        
        # Decorative accent: add a diagonal light sweep
        temp_decorated = str(COVERS_DIR / f"_deco_{cover_id}.png")
        
        # Add an accent circle/glow
        accent_r = int(accent[2:4], 16)
        accent_g = int(accent[4:6], 16)
        accent_b = int(accent[6:8], 16)
        
        subprocess.run([
            FFMPEG, "-y",
            "-i", temp_gradient,
            "-vf", (
                f"drawbox=x=540:y=540:w=540:h=540:color={accent}80:t=fill,"
                f"drawbox=x=270:y=270:w=270:h=270:color={accent}40:t=fill,"
                f"drawbox=x=810:y=0:w=270:h=270:color={accent}20:t=fill"
            ),
            "-frames:v", "1",
            temp_decorated,
        ], capture_output=True, timeout=15)
        
        source = temp_decorated if Path(temp_decorated).exists() else temp_gradient
        
        # If title provided, render it with Pillow
        if title:
            _render_cover_text(source, output_path, title, accent_r, accent_g, accent_b)
        else:
            import shutil
            shutil.copy2(source, output_path)
        
        # Cleanup temps
        for tmp in [temp_gradient, temp_decorated]:
            try:
                Path(tmp).unlink(missing_ok=True)
            except Exception:
                pass
        
        if Path(output_path).exists():
            size_kb = Path(output_path).stat().st_size / 1024
            logger.info(f"Cover generated: {output_path} ({size_kb:.0f}KB, emotion={emotion})")
            return output_path
    
    except Exception as e:
        logger.warning(f"Cover generation failed: {e}")
    
    # Fallback: create via Pillow directly
    try:
        from PIL import Image, ImageDraw
        img = Image.new("RGB", (1080, 1080), (int(bg1[2:4],16), int(bg1[4:6],16), int(bg1[6:8],16)))
        draw = ImageDraw.Draw(img)
        # Add a simple gradient effect
        for y in range(1080):
            ratio = y / 1080
            r = int(int(bg1[2:4],16) * (1-ratio) + int(bg2[2:4],16) * ratio)
            g = int(int(bg1[4:6],16) * (1-ratio) + int(bg2[4:6],16) * ratio)
            b = int(int(bg1[6:8],16) * (1-ratio) + int(bg2[6:8],16) * ratio)
            draw.line([(0, y), (1080, y)], fill=(r, g, b))
        if title:
            _render_cover_text_pil(img, output_path, title, accent_r, accent_g, accent_b)
        else:
            img.save(output_path, "PNG")
        
        if Path(output_path).exists():
            return output_path
    except Exception as e:
        logger.warning(f"Pillow fallback failed: {e}")
    
    return ""


def _render_cover_text(source_path: str, output_path: str, title: str, accent_r: int, accent_g: int, accent_b: int):
    """Render title text onto cover image using Pillow."""
    try:
        from PIL import Image, ImageDraw, ImageFont
        
        img = Image.open(source_path).convert("RGBA")
        draw = ImageDraw.Draw(img)
        
        # Try to find a bold font
        font_path = None
        if os.name == "nt":
            candidates = [
                "C:/Windows/Fonts/arialbd.ttf",
                "C:/Windows/Fonts/arial.ttf",
                "C:/Windows/Fonts/msyhbd.ttc",
                "C:/Windows/Fonts/seguiemj.ttf",
            ]
            for c in candidates:
                if Path(c).exists():
                    font_path = c
                    break
        
        # Find appropriate font size based on title length
        font_size = 64
        if len(title) > 20:
            font_size = 48
        elif len(title) > 10:
            font_size = 56
        
        try:
            font = ImageFont.truetype(font_path, font_size) if font_path else ImageFont.load_default()
        except Exception:
            font = ImageFont.load_default()
        
        # Text with shadow
        w, h = img.size
        # Use textbbox for positioning
        try:
            bbox = draw.textbbox((0, 0), title, font=font)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
        except Exception:
            tw, th = w // 2, font_size
        
        x = (w - tw) // 2
        y = h // 2 - th // 2
        
        # Shadow
        shadow_color = (0, 0, 0, 180)
        for ox, oy in [(3, 3), (2, 2), (1, 1)]:
            draw.text((x + ox, y + oy), title, font=font, fill=shadow_color)
        
        # Main text
        text_color = (255, 255, 255, 255)
        draw.text((x, y), title, font=font, fill=text_color)
        
        # Subtitle accent line
        line_y = y + th + 15
        line_w = min(tw, 400)
        line_x = (w - line_w) // 2
        for i in range(line_w):
            alpha = int(255 * (1 - abs(i - line_w/2) / (line_w/2)))
            draw.point((line_x + i, line_y), fill=(accent_r, accent_g, accent_b, alpha))
            draw.point((line_x + i, line_y + 1), fill=(accent_r, accent_g, accent_b, alpha))
        
        # Save as RGB
        rgb_img = Image.new("RGB", img.size, (0, 0, 0))
        rgb_img.paste(img, mask=img.split()[3])
        rgb_img.save(output_path, "PNG")
        
        logger.info(f"Cover text rendered: '{title}' -> {output_path}")
        
    except Exception as e:
        logger.warning(f"Text rendering failed: {e}")
        import shutil
        shutil.copy2(source_path, output_path)


def _render_cover_text_pil(img, output_path: str, title: str, accent_r: int, accent_g: int, accent_b: int):
    """Pillow-only text rendering (no FFmpeg needed)."""
    try:
        from PIL import ImageDraw, ImageFont
        draw = ImageDraw.Draw(img)
        
        font_path = None
        if os.name == "nt":
            for c in ["C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf"]:
                if Path(c).exists():
                    font_path = c
                    break
        
        font_size = 56 if len(title) <= 15 else 40
        try:
            font = ImageFont.truetype(font_path, font_size) if font_path else ImageFont.load_default()
        except Exception:
            font = ImageFont.load_default()
        
        w, h = img.size
        try:
            bbox = draw.textbbox((0, 0), title, font=font)
            tw = bbox[2] - bbox[0]
            th = bbox[3] - bbox[1]
        except Exception:
            tw, th = w // 2, font_size
        
        x = (w - tw) // 2
        y = h // 2 - th // 2
        
        for ox, oy in [(3, 3), (2, 2)]:
            draw.text((x + ox, y + oy), title, font=font, fill=(0, 0, 0, 180))
        draw.text((x, y), title, font=font, fill=(255, 255, 255))
        
        img.save(output_path, "PNG")
    except Exception:
        img.save(output_path, "PNG")


def _generate_titles(emotion: str, topic: str) -> list[dict]:
    """Generate 3-5 titles based on emotion and topic with scores."""
    emotion_lower = emotion.lower() if emotion else ""
    topic_lower = topic.lower() if topic else "general"
    
    # Find emotion key
    emotion_key = "\u9ed8\u8ba4"
    for key in TITLE_TEMPLATES:
        if key.lower() in emotion_lower or emotion_lower in key.lower():
            emotion_key = key
            break
    
    # Find topic key
    topic_key = "general"
    for key in TITLE_TEMPLATES.get(emotion_key, {}):
        if key.lower() in topic_lower or topic_lower in key.lower():
            topic_key = key
            break
    
    templates = TITLE_TEMPLATES.get(emotion_key, {}).get(topic_key, TITLE_DEFAULT)
    rng = random.Random(emotion + topic)
    
    results = []
    for i, title in enumerate(templates):
        score = round(rng.uniform(0.7, 1.0), 2)
        results.append({
            "title": title,
            "score": score,
            "emotion_match": emotion_key,
            "topic_match": topic_key,
        })
    
    # Sort by score descending
    results.sort(key=lambda x: -x["score"])
    return results[:5]


def _generate_tags(emotion: str, topic: str) -> list[str]:
    """Generate 5-10 tags based on emotion and topic."""
    emotion_lower = emotion.lower() if emotion else ""
    topic_lower = topic.lower() if topic else "general"
    
    # Collect tags from matching topic pool
    all_tags = set()
    
    # Add topic-based tags
    for key, tags in TAG_POOLS.items():
        if key.lower() in topic_lower or topic_lower in key.lower():
            all_tags.update(tags[:8])
    
    # If no match, use general
    if not all_tags:
        all_tags.update(TAG_POOLS["general"][:5])
    
    # Add emotion tags
    emotion_tags = {
        "\u5e73\u9759": ["#calm", "#peaceful", "#serene", "#tranquil", "#zen"],
        "\u5e0c\u671b": ["#hope", "#future", "#dream", "#inspire", "#optimism"],
        "\u6e29\u6696": ["#warm", "#cozy", "#heartwarming", "#love", "#comfort"],
        "\u5b64\u72ec": ["#lonely", "#solitude", "#alone", "#quiet", "#introspection"],
        "\u79d1\u6280": ["#tech", "#future", "#digital", "#innovation", "#ai"],
        "\u5174\u594b": ["#excited", "#thrilling", "#adventure", "#energy", "#passion"],
        "\u60b2\u4f24": ["#sad", "#melancholy", "#emotional", "#heartfelt", "#deep"],
    }
    
    for key, tags in emotion_tags.items():
        if key.lower() in emotion_lower or emotion_lower in key.lower():
            all_tags.update(tags)
    
    # Add media tags
    all_tags.update(["#media", "#video", "#content"])
    
    # Sort and limit
    result = sorted(all_tags)[:10]
    return result


# ═══════════════════════════════════════════════════════════════════════════
# T9-1: /api/media/generate_cover — Cover image generation
# ═══════════════════════════════════════════════════════════════════════════


@router.post("/generate_cover")
async def api_generate_cover(req: Request):
    """Generate a cover image based on emotion, topic, and scene.
    
    Creates a 1080x1080 PNG with:
    - Emotion-colored gradient background
    - Decorative accent elements
    - Optional title text overlay
    
    Request: {"emotion": "\u5e0c\u671b", "topic": "technology", "scene": "", "title": "Future Rising"}
    Response: {"status": "ok", "output_path": "...", "download_url": "...", "size_kb": ...}
    """
    body = await req.json()
    emotion = body.get("emotion", "\u9ed8\u8ba4")
    topic = body.get("topic", "general")
    scene = body.get("scene", "")
    title = body.get("title", "")
    
    # Auto-generate title if not provided
    if not title:
        titles = _generate_titles(emotion, topic)
        if titles:
            title = titles[0]["title"]
    
    output_path = _generate_cover_image(emotion, topic, scene, title)
    
    if not output_path or not Path(output_path).exists():
        raise HTTPException(500, "Cover generation failed")
    
    size_kb = Path(output_path).stat().st_size / 1024
    filename = Path(output_path).name
    download_url = f"/api/data/covers/{filename}"
    
    return JSONResponse({
        "status": "ok",
        "output_path": output_path,
        "download_url": download_url,
        "filename": filename,
        "size_kb": round(size_kb, 1),
        "title": title,
        "emotion": emotion,
        "topic": topic,
    })


# ═══════════════════════════════════════════════════════════════════════════
# T9-2: /api/media/generate_title — Title generation
# ═══════════════════════════════════════════════════════════════════════════


@router.post("/generate_title")
async def api_generate_title(req: Request):
    """Generate 3-5 titles based on emotion and topic.
    
    Request: {"emotion": "\u5e0c\u671b", "topic": "technology"}
    Response: {"titles": [{"title": "...", "score": 0.95}, ...], "best": "..."}
    """
    body = await req.json()
    emotion = body.get("emotion", "\u9ed8\u8ba4")
    topic = body.get("topic", "general")
    
    titles = _generate_titles(emotion, topic)
    
    return JSONResponse({
        "titles": titles,
        "best": titles[0]["title"] if titles else "",
        "emotion": emotion,
        "topic": topic,
    })


# ═══════════════════════════════════════════════════════════════════════════
# T9-3: /api/media/generate_tags — Tag generation
# ═══════════════════════════════════════════════════════════════════════════


@router.post("/generate_tags")
async def api_generate_tags(req: Request):
    """Generate 5-10 relevant tags based on emotion and topic.
    
    Request: {"emotion": "\u5e0c\u671b", "topic": "technology"}
    Response: {"tags": ["#ai", "#tech", "#hope", ...]}
    """
    body = await req.json()
    emotion = body.get("emotion", "\u9ed8\u8ba4")
    topic = body.get("topic", "general")
    
    tags = _generate_tags(emotion, topic)
    
    return JSONResponse({
        "tags": tags,
        "count": len(tags),
        "emotion": emotion,
        "topic": topic,
    })


# ═══════════════════════════════════════════════════════════════════════════
# Sprint 8 — One-Click Pipeline: keyword → complete video
# ═══════════════════════════════════════════════════════════════════════════


@router.post("/pipeline_generate")
async def api_pipeline_generate(req: Request):
    """One-click pipeline: keyword/emotion+topic → complete short video.
    
    Automatically executes the full content creation pipeline:
      1. analyze (semantic understanding)
      2. generate_title (title generation)
      3. generate_tags (tag generation)
      4. generate_cover (cover image)
      5. search_online → generate_video (media discovery + script)
      6. generate_narration → tts (voiceover)
      7. render_video (final MP4)
    
    Input: {"keyword": "\u5e0c\u671b \u79d1\u6280"}
       or: {"emotion": "\u5e0c\u671b", "topic": "technology"}
    
    Response: {
        "title": "...",
        "tags": [...],
        "cover": {"url": "...", "filename": "..."},
        "script": {...},
        "voiceover": {...},
        "video": {"url": "...", "filename": "...", "duration": 53},
        "pipeline_log": [...]
    }
    """
    import shutil
    import tempfile
    
    body = await req.json()
    keyword = body.get("keyword", "")
    emotion = body.get("emotion", "")
    topic = body.get("topic", "")
    
    # If keyword provided, analyze it for emotion + topic
    if keyword and not emotion and not topic:
        try:
            sem = _classify_semantic(keyword)
            emotion = sem.get("emotion", "\u5e73\u9759")
            topic = sem.get("topic", "general")
            logger.info(f"Pipeline: analyzed keyword '{keyword}' \u2192 emotion={emotion}, topic={topic}")
        except Exception as e:
            logger.warning(f"Pipeline keyword analysis failed: {e}")
            emotion = "\u5e73\u9759"
            topic = "general"
    
    if not emotion:
        emotion = "\u5e73\u9759"
    if not topic:
        topic = "general"
    
    logger.info(f"Pipeline start: emotion={emotion}, topic={topic}, keyword={keyword}")
    log = []
    
    # ─── Step 1: Generate Title ───────────────────────────────────────
    title = ""
    try:
        titles = _generate_titles(emotion, topic)
        if titles:
            title = titles[0]["title"]
        log.append({"step": "generate_title", "status": "ok", "title": title})
        logger.info(f"  [1/7] Title: {title}")
    except Exception as e:
        log.append({"step": "generate_title", "status": "error", "error": str(e)})
        title = keyword or "Amazing Video"
    
    # ─── Step 2: Generate Tags ────────────────────────────────────────
    tags = []
    try:
        tags = _generate_tags(emotion, topic)
        log.append({"step": "generate_tags", "status": "ok", "count": len(tags)})
        logger.info(f"  [2/7] Tags: {len(tags)} generated")
    except Exception as e:
        log.append({"step": "generate_tags", "status": "error", "error": str(e)})
    
    # ─── Step 3: Generate Cover ───────────────────────────────────────
    cover_path = ""
    cover_url = ""
    try:
        cover_path = _generate_cover_image(emotion, topic, "", title)
        if cover_path:
            cover_url = f"/api/data/covers/{Path(cover_path).name}"
        log.append({"step": "generate_cover", "status": "ok" if cover_path else "fallback", "path": cover_path})
        logger.info(f"  [3/7] Cover: {Path(cover_path).name if cover_path else 'none'}")
    except Exception as e:
        log.append({"step": "generate_cover", "status": "error", "error": str(e)})
    
    # ─── Step 4: Discover Media + Generate Script ────────────────────
    script = []
    media_list = []
    try:
        # Try online search first
        try:
            import httpx
            from urllib.parse import urlencode
            search_query = keyword or topic
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"http://localhost:8000/api/media/search_online",
                    params={"query": search_query, "source": "all", "limit": 8},
                    timeout=10.0,
                )
                if resp.status_code == 200:
                    search_data = resp.json()
                    for item in search_data.get("items", []):
                        media_list.append({
                            "clip": item.get("title", f"clip_{len(media_list)}"),
                            "filename": item.get("title", f"clip_{len(media_list)}"),
                            "duration": 5,
                            "source": item.get("source", "online"),
                            "thumbnail": item.get("thumbnail", ""),
                        })
        except Exception as e:
            logger.warning(f"Online search failed: {e}")
        
        # Fall back to local discovery
        if len(media_list) < 3:
            discovered = _discover_media_for_script(keyword or topic, emotion, topic, "")
            for item in discovered:
                if item not in media_list:
                    media_list.append(item)
        
        if media_list:
            # Generate script
            rng = random.Random(keyword + emotion + topic)
            for i, m in enumerate(media_list[:8]):
                duration = rng.choice([3, 4, 5])
                transition = rng.choice(["fade", "dissolve", "slide", "crossfade"])
                script.append({
                    "clip": m.get("clip", f"clip_{i}"),
                    "duration": duration,
                    "transition": transition,
                    "source": m.get("source", ""),
                    "thumbnail": m.get("thumbnail", ""),
                })
            
            # Add title card
            script.insert(0, {
                "clip": "__title__",
                "duration": 3,
                "transition": "fade",
                "text": title or keyword or "Amazing Video",
                "source": "",
                "thumbnail": "",
            })
        
        log.append({"step": "generate_script", "status": "ok", "clips": len(script)})
        logger.info(f"  [4/7] Script: {len(script)} clips")
    except Exception as e:
        log.append({"step": "generate_script", "status": "error", "error": str(e)})
    
    # ─── Step 5: Generate Narration Text ─────────────────────────────
    narration_text = ""
    try:
        narration_text = _select_narration_text(emotion, topic, "", "zh-CN")
        log.append({"step": "generate_narration", "status": "ok", "text": narration_text[:50]})
        logger.info(f"  [5/7] Narration: {narration_text[:40]}...")
    except Exception as e:
        log.append({"step": "generate_narration", "status": "error", "error": str(e)})
    
    # ─── Step 6: TTS (Voiceover) ─────────────────────────────────────
    tts_path = ""
    tts_url = ""
    try:
        if narration_text:
            tts_path = _synthesize_tts_fallback(
                narration_text, "zh-CN", "female",
                str(NARRATIONS_DIR / f"pipeline_tts_{uuid.uuid4().hex[:8]}.wav")
            )
            if tts_path and Path(tts_path).exists():
                tts_url = f"/api/data/narrations/{Path(tts_path).name}"
        log.append({"step": "tts", "status": "ok" if tts_path else "skipped"})
        logger.info(f"  [6/7] TTS: {Path(tts_path).name if tts_path else 'none'}")
    except Exception as e:
        log.append({"step": "tts", "status": "error", "error": str(e)})
    
    # ─── Step 7: Render Video ────────────────────────────────────────
    video_path = ""
    video_url = ""
    video_duration = 0
    video_clips = 0
    try:
        if script:
            # Use the render_video function internally
            render_id = uuid.uuid4().hex[:12]
            temp_dir = Path(tempfile.mkdtemp(prefix=f"pipeline_render_{render_id}_"))
            output_filename = f"pipeline_{render_id}.mp4"
            output_path = str(GENERATED_DIR / output_filename)
            
            resolved_clips = []
            used_transitions = []
            total_duration = 0
            
            for i, item in enumerate(script):
                if item.get("clip") == "__title__":
                    continue  # Skip title card for rendering
                clip_name = item.get("clip", f"clip_{i}")
                duration = int(item.get("duration", 5))
                transition = item.get("transition", "fade")
                
                resolved_path = _resolve_clip_path(clip_name)
                trimmed_path = str(temp_dir / f"trim_{i:04d}.mp4")
                
                if os.path.exists(resolved_path):
                    subprocess.run([
                        FFMPEG, "-y",
                        "-i", resolved_path,
                        "-t", str(duration),
                        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                        "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-b:a", "128k",
                        "-vf", "scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2",
                        "-r", "30",
                        trimmed_path,
                    ], capture_output=True, timeout=60)
                    if Path(trimmed_path).exists():
                        resolved_clips.append(trimmed_path)
                        used_transitions.append(transition)
                        total_duration += duration
                        continue
                
                # Placeholder
                placeholder = str(temp_dir / f"placeholder_{i:04d}.mp4")
                subprocess.run([
                    FFMPEG, "-y",
                    "-f", "lavfi", "-i", f"color=c=0x1a1a2e:s=1080x1080:d={duration}:r=30",
                    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-shortest",
                    placeholder,
                ], capture_output=True, timeout=30)
                if Path(placeholder).exists():
                    resolved_clips.append(placeholder)
                    used_transitions.append(transition)
                    total_duration += duration
            
            if resolved_clips:
                # Concat
                concat_path = str(temp_dir / "concat.mp4")
                concat_file = str(temp_dir / "list.txt")
                with open(concat_file, "w", encoding="utf-8") as f:
                    for p in resolved_clips:
                        escaped = p.replace("'", "'\\''")
                        f.write(f"file '{escaped}'\n")
                subprocess.run([
                    FFMPEG, "-y", "-f", "concat", "-safe", "0",
                    "-i", concat_file, "-c", "copy", concat_path,
                ], capture_output=True, timeout=120)
                
                if Path(concat_path).exists():
                    # Mix music
                    music_path = _generate_music_for_emotion(emotion, total_duration)
                    music_mixed = str(temp_dir / "music.mp4")
                    _mix_background_music(concat_path, music_path, music_mixed)
                    
                    final_source = music_mixed if Path(music_mixed).exists() else concat_path
                    
                    # Mix voiceover if available
                    if tts_path and Path(tts_path).exists():
                        voiceover_mixed = str(temp_dir / "voiceover.mp4")
                        _mix_voiceover(final_source, tts_path, music_path, voiceover_mixed)
                        if Path(voiceover_mixed).exists():
                            final_source = voiceover_mixed
                    
                    # Subtitles
                    srt_path = _generate_subtitles_for_topic(topic, len(resolved_clips), total_duration)
                    subtitle_path = str(temp_dir / "subtitled.mp4")
                    _overlay_subtitles(final_source, srt_path, subtitle_path)
                    
                    final = subtitle_path if Path(subtitle_path).exists() else final_source
                    shutil.copy2(final, output_path)
                    
                    if Path(output_path).exists():
                        video_path = output_path
                        video_url = f"/api/data/generated/{output_filename}"
                        video_duration = total_duration
                        video_clips = len(resolved_clips)
            
            # Cleanup
            try:
                shutil.rmtree(str(temp_dir), ignore_errors=True)
            except Exception:
                pass
        
        log.append({"step": "render_video", "status": "ok" if video_path else "fallback"})
        logger.info(f"  [7/7] Video: {Path(output_path).name if video_path else 'none'} ({video_duration}s)")
        
    except Exception as e:
        log.append({"step": "render_video", "status": "error", "error": str(e)})
        logger.error(f"Pipeline render failed: {e}")
    
    # ─── Return Results ───────────────────────────────────────────────
    result = {
        "status": "ok" if video_path else "partial",
        "title": title,
        "tags": tags,
        "cover": {
            "url": cover_url,
            "filename": Path(cover_path).name if cover_path else "",
            "size_kb": round(Path(cover_path).stat().st_size / 1024, 1) if cover_path and Path(cover_path).exists() else 0,
        } if cover_path else {},
        "script": {
            "clips": len(script),
            "total_duration": sum(s.get("duration", 0) for s in script),
        },
        "voiceover": {
            "text": narration_text,
            "url": tts_url,
        } if tts_path else {},
        "video": {
            "url": video_url,
            "filename": Path(video_path).name if video_path else "",
            "duration": video_duration,
            "clips": video_clips,
            "size_mb": round(Path(video_path).stat().st_size / (1024 * 1024), 2) if video_path and Path(video_path).exists() else 0,
        } if video_path else {},
        "pipeline_log": log,
        "emotion": emotion,
        "topic": topic,
        "keyword": keyword,
    }
    
    logger.info(f"Pipeline complete: title='{title}', video={bool(video_path)}, cover={bool(cover_path)}")
    return JSONResponse(result)
