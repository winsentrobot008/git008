"""网络媒体策略 —— Pexels / MediaIndexerPro / 本地素材库 三级取料。

策略（按优先级）：
1. 动态关键词提取：每镜取 `asset_queries`（2-3 个英文查询），缺省由旁白文本派生；
2. Pexels 竖版（9:16）视频 → 失败降级 Pexels 竖版高清图（预览渲染时走 Ken Burns）；
3. MediaIndexerPro 本地素材索引（media_index.json / local_assets）；
4. 008-video-factory 本地素材缓存（assets/stock / assets/captured）；
5. 全部失败返回 None，由渲染器回退渐变背景 + 文字卡。

下载产物统一缓存到 work/media_cache/<query-hash>.<ext>，避免重复抓取。
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

from src.core.paths import REPO_ROOT, WORK_DIR

_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
_VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v", ".mkv"}
_STOPWORDS = {
    "a", "an", "the", "of", "on", "in", "for", "with", "and", "or", "to",
    "your", "my", "person", "people", "photo", "photos", "picture", "pictures",
}
DEFAULT_CACHE_DIR = WORK_DIR / "media_cache"

# 会话级网络状态：首次请求失败即视为离线，后续场景直接走本地素材
_NETWORK_STATE = {"checked": False, "ok": True}


def _network_available() -> bool:
    return not _NETWORK_STATE["checked"] or _NETWORK_STATE["ok"]


def _mark_network_failure() -> None:
    _NETWORK_STATE["checked"] = True
    _NETWORK_STATE["ok"] = False


def _env_key(key: str) -> Optional[str]:
    value = os.environ.get(key)
    if value and value not in {"YOUR_KEY_HERE", "your_deepseek_key_here"}:
        return value
    env_path = REPO_ROOT / ".env"
    if env_path.exists():
        try:
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith(key + "="):
                    value = line.split("=", 1)[1].strip().strip("\"'")
                    if value and value not in {"YOUR_KEY_HERE", "your_deepseek_key_here"}:
                        return value
        except OSError:
            pass
    return None


def extract_queries(scene: dict) -> list[str]:
    """每镜提取 2-3 个英文检索词（asset_queries 优先，其次文本派生）。"""
    queries = scene.get("asset_queries") or []
    if isinstance(queries, str):
        queries = [queries]
    queries = [str(q).strip() for q in queries if str(q).strip()]
    if len(queries) >= 2:
        return queries[:3]
    # 文本派生：按标点/换行切句，过滤停用词后取前 8 个 token
    text = str(scene.get("text") or "")
    tokens = [
        t.lower()
        for t in re.split(r"[^a-zA-Z0-9]+", text)
        if t and t.lower() not in _STOPWORDS
    ]
    if tokens:
        queries.append(" ".join(tokens[:6]))
    if not queries:
        queries.append("healthy food")
    return queries[:3]


def _cache_path(cache_dir: Path, query: str, ext: str) -> Path:
    digest = hashlib.sha1(query.lower().encode("utf-8")).hexdigest()[:16]
    return cache_dir / f"{digest}{ext}"


def _download(url: str, target: Path, *, timeout: int = 8) -> Optional[Path]:
    """下载文件到缓存目录；失败返回 None（不抛异常，走降级链）。"""
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url, headers={"User-Agent": "git008-video-factory/1.0"})
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            data = resp.read()
        if not data:
            return None
        target.write_bytes(data)
        return target if target.exists() and target.stat().st_size > 0 else None
    except Exception:
        return None


def _pexels_get(url: str, timeout: int = 8) -> Optional[dict]:
    key = _env_key("PEXELS_API_KEY")
    if not key:
        return None
    try:
        request = urllib.request.Request(url, headers={"Authorization": key})
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def pexels_video(query: str, cache_dir: Path, *, timeout: int = 6) -> Optional[Path]:
    """抓取 Pexels 竖版视频，返回本地缓存路径；失败返回 None。"""
    if not _network_available():
        return None
    params = urllib.parse.urlencode(
        {"query": query, "orientation": "portrait", "per_page": 5}
    )
    data = _pexels_get(f"https://api.pexels.com/videos/search?{params}", timeout=timeout)
    if not data:
        _mark_network_failure()
        return None
    for video in data.get("videos") or []:
        files = video.get("video_files") or []
        # 偏好竖版（高≥宽）且分辨率 ≥480 的文件
        candidates = [
            f
            for f in files
            if f.get("width") and f.get("height")
            and f["height"] >= f["width"]
            and min(f["width"], f["height"]) >= 480
            and f.get("link")
        ]
        if not candidates:
            continue
        picked = sorted(
            candidates,
            key=lambda f: abs(f["width"] - 720) + abs(f["height"] - 1280),
        )[0]
        ext = ".mp4"
        target = _cache_path(cache_dir, f"pexels-video:{query}", ext)
        if _download(picked["link"], target, timeout=timeout):
            return target
    return None


def pexels_photo(query: str, cache_dir: Path, *, timeout: int = 6) -> Optional[Path]:
    """抓取 Pexels 竖版高清图，返回本地缓存路径；失败返回 None。"""
    if not _network_available():
        return None
    params = urllib.parse.urlencode(
        {"query": query, "orientation": "portrait", "per_page": 5}
    )
    data = _pexels_get(f"https://api.pexels.com/v1/search?{params}", timeout=timeout)
    if not data:
        _mark_network_failure()
        return None
    for photo in data.get("photos") or []:
        src = photo.get("src") or {}
        url = src.get("large2x") or src.get("large") or src.get("medium")
        if not url:
            continue
        target = _cache_path(cache_dir, f"pexels-photo:{query}", ".jpg")
        if _download(url, target, timeout=timeout):
            return target
    return None


def _score_path(path: Path, tokens: set[str]) -> int:
    """文件名/路径关键词打分（token 命中计数）。"""
    name = path.stem.lower()
    parts = set(re.split(r"[^a-z0-9]+", name))
    parent = path.parent.name.lower()
    score = len(parts & tokens) * 3
    if tokens & set(re.split(r"[^a-z0-9]+", parent)):
        score += 1
    return score


def _scan_media(root: Path, extensions: set[str]) -> list[Path]:
    if not root.exists():
        return []
    results = []
    for ext in extensions:
        results.extend(root.rglob(f"*{ext}"))
    # 排除明显的非素材目录
    return [p for p in results if "node_modules" not in p.parts]


def _local_ranked(queries: list[str], roots: list[Path]) -> list[Path]:
    tokens = set()
    for q in queries:
        tokens.update(
            t
            for t in re.split(r"[^a-zA-Z0-9]+", q.lower())
            if t and t not in _STOPWORDS
        )
    if not tokens:
        return []
    candidates = []
    for root in roots:
        for path in _scan_media(root, _VIDEO_EXTENSIONS | _IMAGE_EXTENSIONS):
            score = _score_path(path, tokens)
            if score > 0:
                candidates.append((score, path))
    candidates.sort(key=lambda item: (-item[0], str(item[1])))
    return [p for _, p in candidates]


def mediaindexer_search(queries: list[str]) -> list[Path]:
    """MediaIndexerPro 本地素材：media_index.json 索引 + local_assets/ 扫描。"""
    index_path = REPO_ROOT / "products" / "MediaIndexerPro" / "media_index.json"
    roots = [
        REPO_ROOT / "products" / "MediaIndexerPro" / "local_assets",
        REPO_ROOT / "products" / "MediaIndexerPro" / "assets",
    ]
    ranked = _local_ranked(queries, roots)
    # 索引命中（路径记录）合并去重
    indexed: list[Path] = []
    if index_path.exists():
        try:
            data = json.loads(index_path.read_text(encoding="utf-8"))
            entries = data if isinstance(data, list) else data.get("items") or []
            tokens = set()
            for q in queries:
                tokens.update(
                    t
                    for t in re.split(r"[^a-zA-Z0-9]+", q.lower())
                    if t and t not in _STOPWORDS
                )
            for entry in entries:
                path = Path(str(entry.get("path") or ""))
                if not path.is_absolute():
                    path = REPO_ROOT / "products" / "MediaIndexerPro" / path
                if path.exists() and path.suffix.lower() in (_VIDEO_EXTENSIONS | _IMAGE_EXTENSIONS):
                    indexed.append(path)
        except (OSError, json.JSONDecodeError):
            pass
    seen = set()
    merged = []
    for path in [*indexed, *ranked]:
        key = str(path.resolve())
        if key not in seen:
            seen.add(key)
            merged.append(path)
    return merged


def local_stock_search(queries: list[str]) -> list[Path]:
    """008-video-factory 本地素材缓存（assets/stock / assets/captured）。"""
    roots = [
        REPO_ROOT / "products" / "008-video-factory" / "assets" / "stock",
        REPO_ROOT / "products" / "008-video-factory" / "assets" / "captured",
    ]
    return _local_ranked(queries, roots)


def resolve_scene_media(
    scene: dict,
    *,
    cache_dir: Optional[Path] = None,
    use_network: bool = True,
) -> Optional[dict]:
    """为单镜解析媒体素材，返回 {"source", "kind", "via"} 或 None。"""
    cache_dir = cache_dir or DEFAULT_CACHE_DIR
    cache_dir.mkdir(parents=True, exist_ok=True)
    queries = extract_queries(scene)

    if use_network:
        for query in queries:
            path = pexels_video(query, cache_dir)
            if path:
                return {"source": str(path), "kind": "video", "via": "pexels-video", "query": query}
            if not _network_available():
                break
        for query in queries:
            path = pexels_photo(query, cache_dir)
            if path:
                return {"source": str(path), "kind": "image", "via": "pexels-photo", "query": query}
            if not _network_available():
                break

    local = mediaindexer_search(queries)
    if not local:
        local = local_stock_search(queries)
    if local:
        path = local[0]
        kind = (
            "video"
            if path.suffix.lower() in _VIDEO_EXTENSIONS
            else "image"
        )
        return {"source": str(path), "kind": kind, "via": "local", "query": queries[0]}
    return None


__all__ = [
    "extract_queries",
    "resolve_scene_media",
    "pexels_video",
    "pexels_photo",
    "mediaindexer_search",
    "local_stock_search",
    "DEFAULT_CACHE_DIR",
]
