"""网络媒体策略 —— Pexels / MediaIndexerPro / 本地素材库 三级取料。

策略（按优先级）：
1. 动态关键词提取：每镜取 `search_keywords` / `asset_queries`（2-3 个英文查询），
   缺省由旁白文本派生；
2. Pexels 竖版（9:16）视频 → 失败降级 Pexels 竖版高清图（预览渲染时走 Ken Burns）；
3. MediaIndexerPro 本地素材索引（media_index.json / local_assets）；
4. 008-video-factory 本地素材缓存（assets/stock / assets/captured / work/assets/cache）；
5. 上面全空时，若下载缓存里已有素材（any_match），直接复用最新一件；
6. 仍无素材才返回 None，由渲染器回退 ComfyUI 生成 / 渐变背景 + 文字卡。

下载产物统一缓存到 work/media_cache/<query-hash>.<ext>，避免重复抓取。
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

from src.core.paths import REPO_ROOT, WORK_DIR

logger = logging.getLogger(__name__)

_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
_VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v", ".mkv"}
_STOPWORDS = {
    "a", "an", "the", "of", "on", "in", "for", "with", "and", "or", "to",
    "your", "my", "person", "people", "photo", "photos", "picture", "pictures",
}
DEFAULT_CACHE_DIR = WORK_DIR / "media_cache"

# 会话级网络状态：只有真实连接失败才熔断，后续场景直接走本地素材。
# 缺少 API Key 属配置问题（no_api_key），不得把整个会话标记成离线。
_NETWORK_STATE = {"checked": False, "ok": True}
_KEY_STATE: dict = {"checked": False, "ok": False}


def _network_available() -> bool:
    return not _NETWORK_STATE["checked"] or _NETWORK_STATE["ok"]


def _mark_network_failure() -> None:
    _NETWORK_STATE["checked"] = True
    _NETWORK_STATE["ok"] = False


def has_pexels_key() -> bool:
    """Pexels API Key 是否可用（只判断存在性，绝不回显取值）。"""
    if not _KEY_STATE["checked"]:
        _KEY_STATE["checked"] = True
        _KEY_STATE["ok"] = bool(_env_key("PEXELS_API_KEY"))
    return bool(_KEY_STATE["ok"])


def _record_pexels_failure(reason: Optional[str]) -> None:
    """只有真实连接类故障才熔断网络；缺 Key / HTTP 错误仅记录原因。"""
    if reason and reason.startswith("network_error"):
        _mark_network_failure()
    elif reason:
        logger.warning("[media] Pexels 不可用（%s），转用本地素材 / ComfyUI 兜底", reason)


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
    """每镜提取 2-3 个英文检索词。

    优先级：`search_keywords`（文本分镜 LLM 产出）→ `asset_queries`（导演分镜）
    → `script_text` / `text` 派生。此前只读 `asset_queries`，文本分镜的英文检索词
    被整段丢弃、只能退回 `healthy food`，这是「有关键词却抓不到素材」的根因。
    """
    queries = scene.get("search_keywords") or scene.get("asset_queries") or []
    if isinstance(queries, str):
        queries = [queries]
    queries = [str(q).strip() for q in queries if str(q).strip()]
    if len(queries) >= 2:
        return queries[:3]
    # 文本派生：按标点/换行切句，过滤停用词后取前 8 个 token
    text = str(scene.get("script_text") or scene.get("text") or "")
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


def _pexels_get(url: str, timeout: int = 8) -> tuple[Optional[dict], Optional[str]]:
    """访问 Pexels API，返回 (数据, 失败原因)。

    区分「缺 Key（no_api_key）」与「真实网络故障（network_error）」：前者是配置
    问题，不应把整个会话熔断成离线。
    """
    key = _env_key("PEXELS_API_KEY")
    if not key:
        return None, "no_api_key"
    try:
        request = urllib.request.Request(url, headers={"Authorization": key})
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8")), None
    except urllib.error.HTTPError as exc:
        return None, f"http_{exc.code}"
    except urllib.error.URLError as exc:
        return None, f"network_error: {exc.reason}"
    except Exception as exc:  # noqa: BLE001 - 解析 / 超时统一降级
        return None, f"{type(exc).__name__}: {exc}"


def pexels_video(query: str, cache_dir: Path, *, timeout: int = 6) -> Optional[Path]:
    """抓取 Pexels 竖版视频，返回本地缓存路径；失败返回 None。"""
    if not _network_available():
        return None
    params = urllib.parse.urlencode(
        {"query": query, "orientation": "portrait", "per_page": 5}
    )
    data, reason = _pexels_get(f"https://api.pexels.com/videos/search?{params}", timeout=timeout)
    if not data:
        _record_pexels_failure(reason)
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
    data, reason = _pexels_get(f"https://api.pexels.com/v1/search?{params}", timeout=timeout)
    if not data:
        _record_pexels_failure(reason)
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


def local_stock_search(
    queries: list[str],
    *,
    extra_roots: Optional[list[Path]] = None,
    any_match: bool = False,
) -> list[Path]:
    """008-video-factory 本地素材缓存（assets/stock / assets/captured / 下载缓存）。

    `extra_roots` 让调用方把「已下载缓存目录」也算作本地源：命中缓存即零下载复用。
    `any_match=True` 时，关键字零命中后仍返回下载缓存里最新的一件素材——本地产物
    永远优先于纯渐变背景。只在显式缓存目录内放宽，避免从人工素材库随机取片。
    """
    roots = [
        REPO_ROOT / "products" / "008-video-factory" / "assets" / "stock",
        REPO_ROOT / "products" / "008-video-factory" / "assets" / "captured",
        *(extra_roots or []),
    ]
    ranked = _local_ranked(queries, roots)
    if ranked or not any_match:
        return ranked
    cached: list[Path] = []
    for root in extra_roots or []:
        cached.extend(_scan_media(root, _VIDEO_EXTENSIONS | _IMAGE_EXTENSIONS))
    cached = [p for p in cached if p.is_file() and p.stat().st_size > 0]
    cached.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    if cached:
        logger.warning(
            "[media] 关键字未命中（%s），改用缓存目录中最新素材：%s",
            queries,
            cached[0].name,
        )
    return cached


def _media_hit(path: Path, via: str, query: str) -> dict:
    kind = "video" if path.suffix.lower() in _VIDEO_EXTENSIONS else "image"
    return {"source": str(path), "kind": kind, "via": via, "query": query}


def resolve_scene_media_ex(
    scene: dict,
    *,
    cache_dir: Optional[Path] = None,
    use_network: bool = True,
    allow_cache_reuse: bool = True,
    exclude: Optional[set] = None,
) -> dict:
    """解析单镜素材，并给出可审计的失败原因（供日志与 staging 报告使用）。

    :return: ``{"hit": {...} | None, "reason": str, "diagnostics": {...}}``
    """
    cache_dir = cache_dir or DEFAULT_CACHE_DIR
    cache_dir.mkdir(parents=True, exist_ok=True)
    queries = extract_queries(scene)
    diagnostics: dict = {"queries": queries, "cache_dir": str(cache_dir)}
    reasons: list[str] = []

    if use_network:
        if not has_pexels_key():
            reasons.append("no_api_key")
            logger.warning(
                "[media] 未配置 PEXELS_API_KEY，跳过云端图库抓取（queries=%s），转本地缓存 / ComfyUI",
                queries,
            )
        elif not _network_available():
            reasons.append("network_unavailable")
            logger.warning("[media] 网络已熔断，跳过云端图库抓取（queries=%s）", queries)
        else:
            for query in queries:
                path = pexels_video(query, cache_dir)
                if path:
                    return {"hit": _media_hit(path, "pexels-video", query), "reason": "pexels-video", "diagnostics": diagnostics}
                if not _network_available():
                    reasons.append("network_unavailable")
                    break
            for query in queries:
                path = pexels_photo(query, cache_dir)
                if path:
                    return {"hit": _media_hit(path, "pexels-photo", query), "reason": "pexels-photo", "diagnostics": diagnostics}
                if not _network_available():
                    reasons.append("network_unavailable")
                    break

    # 已派给前面镜头的素材不再重复选用，避免整片画面重复；exclude 由调用方维护。
    used = {str(p) for p in (exclude or ())}
    local = [p for p in mediaindexer_search(queries) if str(p) not in used]
    via = "local"
    if not local:
        local = [
            p
            for p in local_stock_search(queries, extra_roots=[cache_dir])
            if str(p) not in used
        ]
    if not local and allow_cache_reuse:
        pool = [
            p
            for p in local_stock_search(queries, extra_roots=[cache_dir], any_match=True)
            if str(p) not in used
        ]
        reused = False
        if not pool:
            # 缓存里只剩已被其它镜头占用的素材：复用也好过一片纯渐变背景。
            pool = local_stock_search(queries, extra_roots=[cache_dir], any_match=True)
            reused = bool(pool)
        if pool:
            local = pool
            via = "local-cache-reused" if reused else "local-cache"
    if local:
        return {"hit": _media_hit(local[0], via, queries[0]), "reason": via, "diagnostics": diagnostics}

    reasons.append("no_stock_match")
    logger.warning(
        "[media] 单镜无可用素材（%s）：queries=%s cache=%s",
        ",".join(reasons),
        queries,
        cache_dir,
    )
    return {
        "hit": None,
        "reason": "no_stock_match",
        "diagnostics": {**diagnostics, "reasons": reasons},
    }


def resolve_scene_media(
    scene: dict,
    *,
    cache_dir: Optional[Path] = None,
    use_network: bool = True,
    allow_cache_reuse: bool = True,
    exclude: Optional[set] = None,
) -> Optional[dict]:
    """为单镜解析媒体素材，返回 {"source", "kind", "via"} 或 None。"""
    return resolve_scene_media_ex(
        scene,
        cache_dir=cache_dir,
        use_network=use_network,
        allow_cache_reuse=allow_cache_reuse,
        exclude=exclude,
    )["hit"]


def first_unused_local(
    queries: list[str], *, cache_dir: Path, exclude: Optional[set] = None
) -> Optional[dict]:
    """下载缓存里最新的、尚未被其它镜头占用的素材（本地产物优于纯渐变背景）。

    没有任何"未占用"素材时才退回复用一件，并把 via 标成 `local-cache-reused`
    让重复使用在报告里可见。
    """
    used = {str(p) for p in (exclude or ())}
    pool = [
        p
        for p in local_stock_search(queries, extra_roots=[cache_dir], any_match=True)
        if str(p) not in used
    ]
    if not pool:
        pool = local_stock_search(queries, extra_roots=[cache_dir], any_match=True)
        if not pool:
            return None
        return _media_hit(pool[0], "local-cache-reused", (queries or [""])[0])
    return _media_hit(pool[0], "local-cache", (queries or [""])[0])


__all__ = [
    "extract_queries",
    "resolve_scene_media",
    "resolve_scene_media_ex",
    "first_unused_local",
    "has_pexels_key",
    "pexels_video",
    "pexels_photo",
    "mediaindexer_search",
    "local_stock_search",
    "DEFAULT_CACHE_DIR",
]
