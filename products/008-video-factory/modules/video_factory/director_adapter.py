"""导演 Skill 适配器（Director Skill Adapter）。

把「短剧导演 Skill」的结构化产出（characters / locations / scenes / shots /
camera / dialogue）转换成 008-video-factory 渲染管线可直接消费的 storyboard
JSON 契约（契约定义见 `modules/video_factory/storyboard.py`）。

适配层强制执行两条导演规范：

1. **资产锁定（Asset Lock）**
   `characters[].locked` / `locations[].locked` 为真时，任何引用该资产的镜头
   必须直接复用锁定的参考素材（`ref`）作为画面来源，禁止再走 Pexels 随机
   取材；被引用却缺少 `ref` 视为锁定违规，直接报错。
2. **180° 轴线（Axis of Action）**
   同一场内相邻镜头必须停留在轴线的同一侧（`camera.side: left|right`）。
   越轴必须显式声明 `camera.axis_break: true`，或以中性镜头
   （`camera.side: neutral`）重建轴线；否则 strict 模式报错，非 strict 模式
   降级为 warning 记录在 `director_meta.warnings`。

输入（导演分镜，示例见 `templates/director/example_short_drama.json`）：

    {
      "title": "fridge-2am",
      "width": 1080, "height": 1920, "fps": 24,
      "characters": [
        {"id": "lin", "name": "林岚", "locked": true,
         "ref": "assets/lin_ref.png",
         "visual_keywords": ["young woman programmer", "night desk lamp"]}
      ],
      "locations": [
        {"id": "kitchen", "name": "深夜厨房", "locked": true,
         "ref": "assets/kitchen.png",
         "visual_keywords": ["modern kitchen at night"]}
      ],
      "shots": [
        {"id": "s1-01", "scene": "s1", "kind": "hook",
         "text": "凌晨两点，冰箱第三次亮起。",
         "duration_s": 3,
         "characters": ["lin"], "location": "kitchen",
         "camera": {"shot_size": "close", "side": "left", "movement": "push_in"},
         "dialogue": [{"speaker": "lin", "line": "又是你。"}]}
      ]
    }

输出：storyboard JSON（额外带 `voice_script` 供 Stage-2 TTS 配音、`director_meta`
供质检与审计）。

用法：
    python products/008-video-factory/src/cli.py video director --input script.json
    python -m modules.video_factory.director_adapter -i script.json -o storyboard.json
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import re
import sys
from pathlib import Path
from typing import Any, Callable, Optional

from src.core.paths import REPO_ROOT

from .storyboard import slugify, validate_storyboard

__all__ = [
    "DirectorAdapterError",
    "AssetLockError",
    "AxisRuleError",
    "adapt_director_script",
    "adapt_file",
    "write_storyboard",
    "main",
    "parse_text_to_shots",
    "text_to_storyboard",
]

# 镜头语汇 → storyboard 场景类型（_SCENE_TYPES 白名单）
_KIND_TO_SCENE_TYPE = {
    "hook": "hero_title",
    "hero": "hero_title",
    "title": "hero_title",
    "opening": "hero_title",
    "cold_open": "hero_title",
    "narration": "text_card",
    "voiceover": "text_card",
    "vo": "text_card",
    "text": "text_card",
    "dialogue": "text_card",
    "beat": "text_card",
    "value": "text_card",
    "image": "image",
    "still": "image",
    "insert": "image",
    "photo": "image",
    "video": "video",
    "broll": "video",
    "b_roll": "video",
    "footage": "video",
    "clip": "video",
    "composition": "composition",
    "chart": "composition",
    "overlay": "composition",
    "ui": "composition",
}

# 场景类型 → 戏剧节拍 style.kind（与 templates/hyperframes 模板一致）
_TYPE_TO_STYLE_KIND = {
    "hero_title": "hook",
    "callout": "cta",
    "text_card": "value",
}

_SHOT_SIZE_HINTS = {
    "extreme_close": "extreme close up detail",
    "close": "close up",
    "medium_close": "medium close up",
    "medium": "medium shot",
    "wide": "wide establishing shot",
    "extreme_wide": "aerial wide shot",
}

_MOVEMENT_HINTS = {
    "push_in": "slow push in",
    "pull_out": "slow pull out",
    "pan": "camera pan",
    "tilt": "camera tilt",
    "dolly": "dolly shot",
    "tracking": "tracking shot",
    "handheld": "handheld camera",
    "static": "",
}


# 纯文本 → 分镜：镜头运动与景别白名单（任务契约 push_in / static / pull_out）
_TEXT_MOVEMENTS = ("push_in", "static", "pull_out")
_TEXT_SHOT_SIZES = ("medium", "wide", "close", "medium_close", "extreme_close")
_TEXT_FALLBACK_KEYWORDS = (
    "cinematic b-roll",
    "night city lights",
    "modern indoor lifestyle",
)

# 词典未命中时逐镜轮换的实拍修饰词：同一分镜的 6 个镜头必须拿到不同提示词，
# 否则 ComfyUI/图库会为整片返回同一张画面。
_TEXT_VISUAL_VARIATIONS = (
    "wide establishing shot",
    "close-up detail shot",
    "medium portrait shot",
    "over-the-shoulder shot",
    "top-down flat lay shot",
    "backlit silhouette shot",
)


# 兜底通用科技视觉词（与 scripts/agent_reach_bridge.py 的兜底保持一致）
DEFAULT_VISUAL_FALLBACK = [
    "technology background",
    "abstract digital network",
    "modern office laptop",
]

_NEUTRAL_SIDES = {"", "neutral", "center", "n/a", "none"}

_VIDEO_EXT = {".mp4", ".webm", ".mov", ".m4v", ".mkv"}
_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}


PRODUCT_ROOT = Path(__file__).resolve().parents[2]
_REMOTE_PREFIX = ("http://", "https://", "rtmp://")


def _resolve_source(value: str) -> str:
    """把仓库相对路径解析成绝对路径。

    FFmpeg 预览渲染在独立工作目录里执行，相对路径会直接丢源；资产锁定素材
    必须落到绝对路径才能稳定复用。
    """
    source = _as_str(value)
    if not source or source.lower().startswith(_REMOTE_PREFIX):
        return source
    path = Path(source)
    if path.is_absolute():
        return str(path)
    for base in (REPO_ROOT, PRODUCT_ROOT):
        candidate = base / source
        if candidate.exists():
            return str(candidate)
    return source


def _media_kind_for(source: str) -> str:
    """按后缀推断媒体类型，供 preview 渲染器直接消费（锁定素材也能真实出画）。"""
    ext = Path(source).suffix.lower()
    if ext in _VIDEO_EXT:
        return "video"
    if ext in _IMAGE_EXT:
        return "image"
    return ""


class DirectorAdapterError(ValueError):
    """导演分镜无法映射到 storyboard 契约。"""


class AssetLockError(DirectorAdapterError):
    """资产锁定违规：被引用的锁定资产缺少参考素材。"""


class AxisRuleError(DirectorAdapterError):
    """180° 轴线违规：越轴镜头未声明 axis_break / 中性重建。"""


# --------------------------------------------------------------------------
# 小工具
# --------------------------------------------------------------------------
def _as_list(value: Any) -> list:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    return [value]


def _as_str(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _dedupe(items: Any, limit: int) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in _as_list(items):
        text = _as_str(raw)
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
        if len(out) >= limit:
            break
    return out


def _index_assets(script: dict, key: str, label: str, warnings: list[str]) -> dict[str, dict]:
    """把 characters / locations 归一化成 {id/lower-name: asset} 索引。"""
    index: dict[str, dict] = {}
    for i, raw in enumerate(_as_list(script.get(key))):
        if not isinstance(raw, dict):
            continue
        ident = _as_str(raw.get("id") or raw.get("name") or f"{key}{i + 1}")
        asset = {
            "id": ident,
            "name": _as_str(raw.get("name") or ident),
            "locked": bool(raw.get("locked") or raw.get("asset_lock")),
            "ref": _as_str(raw.get("ref") or raw.get("source") or raw.get("asset")),
            "visual_keywords": _dedupe(raw.get("visual_keywords") or raw.get("asset_queries"), 3),
            "origin": _as_str(raw.get("origin") or raw.get("from")),
        }
        if asset["locked"] and not asset["ref"]:
            warnings.append(
                f"资产锁定：{label} '{asset['name']}' 标记 locked 但未提供 ref，"
                "若被镜头引用将报错"
            )
        for alias in {asset["id"].lower(), asset["name"].lower()}:
            if alias:
                index[alias] = asset
    return index


def _lookup(index: dict[str, dict], ident: Any) -> Optional[dict]:
    key = _as_str(ident).lower()
    if not key:
        return None
    return index.get(key)


def _flatten_shots(script: dict) -> list[dict]:
    """兼容两种写法：平铺 `shots[]`，或 `scenes[].shots[]` 嵌套分镜。"""
    nested = script.get("scenes")
    if isinstance(nested, list) and any(
        isinstance(scene, dict) and scene.get("shots") for scene in nested
    ):
        flat: list[dict] = []
        for i, scene in enumerate(nested):
            if not isinstance(scene, dict):
                continue
            scene_id = _as_str(scene.get("id") or scene.get("scene_id") or f"scene{i + 1}")
            for j, shot in enumerate(_as_list(scene.get("shots"))):
                if not isinstance(shot, dict):
                    continue
                item = dict(shot)
                item.setdefault("scene", scene_id)
                item.setdefault("id", f"{scene_id}-{j + 1}")
                if not item.get("characters") and scene.get("characters"):
                    item["characters"] = scene["characters"]
                if not item.get("location") and scene.get("location"):
                    item["location"] = scene["location"]
                flat.append(item)
        return flat
    return [dict(shot) for shot in _as_list(script.get("shots")) if isinstance(shot, dict)]


def _scene_axis(script: dict, scenes: list[dict]) -> dict[str, dict]:
    """收集场次级轴线声明（显式 scenes[].axis 或 axis.scenes{}）。"""
    declared: dict[str, dict] = {}
    for i, scene in enumerate(scenes):
        if not isinstance(scene, dict):
            continue
        axis = scene.get("axis")
        if isinstance(axis, dict):
            scene_id = _as_str(scene.get("id") or scene.get("scene_id") or f"scene{i + 1}")
            declared[scene_id.lower()] = axis
    top = script.get("axis")
    if isinstance(top, dict):
        per_scene = top.get("scenes")
        if isinstance(per_scene, dict):
            for key, value in per_scene.items():
                if isinstance(value, dict):
                    declared.setdefault(_as_str(key).lower(), value)
        line = _as_str(top.get("side") or top.get("line_side"))
        if line:
            for key, value in list(declared.items()):
                value.setdefault("side", line)
    return declared


def _camera_side(shot: dict) -> str:
    camera = shot.get("camera") if isinstance(shot.get("camera"), dict) else {}
    side = _as_str(camera.get("side") or shot.get("axis_side") or shot.get("side"))
    return side.lower()


def _camera_hint(shot: dict) -> str:
    camera = shot.get("camera") if isinstance(shot.get("camera"), dict) else {}
    parts = [
        _SHOT_SIZE_HINTS.get(_as_str(camera.get("shot_size")).lower(), ""),
        _MOVEMENT_HINTS.get(_as_str(camera.get("movement")).lower(), ""),
    ]
    return ", ".join(p for p in parts if p)


def _estimate_duration(shot: dict, text: str, default_duration: float) -> float:
    explicit = shot.get("duration_s", shot.get("duration_seconds"))
    try:
        if explicit is not None and float(explicit) > 0:
            return max(0.5, round(float(explicit), 2))
    except (TypeError, ValueError):
        pass
    # 中文旁白 ≈ 4.5 字/秒；英文 ≈ 2.6 词/秒，取折中估算后对齐到 0.5s
    cjk = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
    other = len(text) - cjk
    seconds = cjk / 4.5 + other / 13.0
    estimate = max(float(default_duration), seconds + 0.6)
    return round(min(12.0, estimate) * 2) / 2


def _scene_type_for(shot: dict, has_source: bool) -> str:
    explicit = _as_str(shot.get("type") or shot.get("scene_type")).lower()
    if explicit in set(_KIND_TO_SCENE_TYPE.values()):
        return explicit
    kind = _as_str(shot.get("kind") or shot.get("shot") or shot.get("beat")).lower()
    if kind in _KIND_TO_SCENE_TYPE:
        return _KIND_TO_SCENE_TYPE[kind]
    if _as_str(shot.get("text")):
        return "text_card"
    if has_source:
        return "video"
    return "text_card"


def _visual_queries(
    shot: dict,
    characters: dict[str, dict],
    locations: dict[str, dict],
    *,
    mapper: Optional[Callable[[list[str], str], list[str]]],
    text: str,
) -> list[str]:
    # 导演显式给出的检索词已是视觉词，尊重原文；映射器只负责把「派生词」转成视觉词
    explicit = _dedupe(
        shot.get("asset_queries")
        or shot.get("visual_keywords")
        or shot.get("queries")
        or shot.get("search_keywords"),
        3,
    )
    queries = list(explicit)
    if not queries:
        for cid in _as_list(shot.get("characters") or shot.get("cast")):
            asset = _lookup(characters, cid)
            if asset:
                queries += asset["visual_keywords"] or [asset["name"]]
        location = _lookup(locations, shot.get("location") or shot.get("location_id"))
        if location:
            queries += location["visual_keywords"] or [location["name"]]
        hint = _camera_hint(shot)
        if hint:
            queries.append(hint)
    queries = _dedupe(queries, 3)
    if mapper is not None and not explicit:
        try:
            mapped = mapper(list(queries), text)
        except Exception:  # noqa: BLE001 - 映射器失败不得阻断出片
            mapped = None
        if mapped:
            queries = _dedupe(mapped, 3)
    if not queries:
        queries = list(DEFAULT_VISUAL_FALLBACK)
    return queries[:3]


def _dialogue_lines(shot: dict) -> list[dict]:
    lines: list[dict] = []
    for raw in _as_list(shot.get("dialogue") or shot.get("lines")):
        if isinstance(raw, dict):
            text = _as_str(raw.get("line") or raw.get("text"))
            speaker = _as_str(raw.get("speaker") or raw.get("character"))
        else:
            text, speaker = _as_str(raw), ""
        if text:
            lines.append({"speaker": speaker, "text": text})
    return lines


# --------------------------------------------------------------------------
# 纯文本 → 结构化镜头（script_text / search_keywords / camera_movement）
# --------------------------------------------------------------------------
_TEXT_SYSTEM_PROMPT = (
    "你是短视频导演兼编剧。把用户给的原始文本拆成若干镜头，为每个镜头写出"
    "可直接配音的旁白、用于图库检索的英文关键词、以及镜头运动。只返回 JSON。"
)

_TEXT_SCHEMA_HINT = """{
  "title": "不超过 16 字的标题",
  "shots": [
    {
      "script_text": "该镜头的配音旁白（中文，1-2 句）",
      "search_keywords": ["english stock footage query", "2-3 words each"],
      "camera_movement": "push_in | static | pull_out",
      "shot_size": "wide | medium | close",
      "duration_s": 3.0
    }
  ]
}"""


def _load_visual_mapper() -> Optional[Callable[..., list[str]]]:
    """复用 Agent-Reach 的中英视觉词典把中文转成英文检索词；缺失返回 None。"""
    try:
        scripts_dir = REPO_ROOT / "scripts"
        if str(scripts_dir) not in sys.path:
            sys.path.insert(0, str(scripts_dir))
        from agent_reach_bridge import map_to_visual_keywords  # noqa: PLC0415
    except Exception:  # noqa: BLE001 - 词典可选，缺失即回退通用词
        return None

    def _mapper(raw_keywords, text_summary="", limit=3):
        """静音封装：映射器会向 stdout 打印命中日志，避免污染 CLI 输出。"""
        with contextlib.redirect_stdout(io.StringIO()):
            return map_to_visual_keywords(raw_keywords, text_summary, limit=limit)

    return _mapper


def _english_keywords(
    text: str,
    *,
    index: int,
    mapper: Optional[Callable[..., list[str]]],
    seed_keywords: Optional[list[str]] = None,
    avoid: Optional[list[list[str]]] = None,
) -> list[str]:
    """旁白文本 → 英文图库检索词；同一分镜内保证与 avoid 的组合不重复。

    词典对普通中文短句命中率很低，未命中时全部落到同一组通用科技词，于是 6 个
    镜头拿到完全相同的检索词与文生图提示词。撞车时**保留**原检索词（相关性仍在），
    再追加本镜专属视觉修饰词，既保证逐镜唯一，也不破坏本地素材/图库关键字命中。
    """
    seen = {tuple(item) for item in (avoid or [])}
    primary = _mapped_keywords(text, index=index, mapper=mapper, seed_keywords=seed_keywords)
    if tuple(primary) not in seen:
        return primary
    merged = _dedupe([*primary, *_varied_keywords(text, index=index)], 4)
    if tuple(merged) not in seen:
        return merged
    return _dedupe([*merged, f"shot {index + 1}"], 5)


def _mapped_keywords(
    text: str,
    *,
    index: int,
    mapper: Optional[Callable[..., list[str]]],
    seed_keywords: Optional[list[str]] = None,
) -> list[str]:
    """词典/英文原文/通用兜底三条路径的原始检索词。"""
    if seed_keywords:
        cleaned = [str(k).strip() for k in seed_keywords if str(k).strip()]
        if cleaned:
            return cleaned[:3]
    if mapper is not None:
        try:
            mapped = mapper([], text, limit=3)
        except Exception:  # noqa: BLE001 - 词典失败不得阻断出片
            mapped = None
        if mapped:
            cleaned = [str(m).strip() for m in mapped if str(m).strip()]
            if cleaned:
                return cleaned[:3]
    latin = [t.lower() for t in re.split(r"[^A-Za-z0-9]+", text) if len(t) >= 3]
    if latin:
        return _dedupe(latin, 3)
    return [_TEXT_FALLBACK_KEYWORDS[index % len(_TEXT_FALLBACK_KEYWORDS)]]


def _varied_keywords(text: str, *, index: int) -> list[str]:
    """逐镜差异化检索词：本镜实拍修饰 + 轮换通用视觉词。"""
    latin = _dedupe([t.lower() for t in re.split(r"[^A-Za-z0-9]+", text) if len(t) >= 3], 2)
    variation = _TEXT_VISUAL_VARIATIONS[index % len(_TEXT_VISUAL_VARIATIONS)]
    generic = _TEXT_FALLBACK_KEYWORDS[index % len(_TEXT_FALLBACK_KEYWORDS)]
    return _dedupe([*latin, variation, generic], 3)


def _movement_for(index: int, total: int) -> str:
    """确定性镜头运动：开场推入、结尾拉出、中段静态。"""
    if index == 0:
        return "push_in"
    if total > 1 and index == total - 1:
        return "pull_out"
    return "static"


def _coerce_text_shots(data: Any) -> dict:
    """容忍 LLM 返回 {"script": {...}} / {"shots": [...]} 等包装。"""
    if isinstance(data, list):
        return {"shots": data}
    if not isinstance(data, dict):
        raise DirectorAdapterError("文本解析未返回 JSON 对象/数组")
    for key in ("script", "director_script", "storyboard", "data"):
        inner = data.get(key)
        if isinstance(inner, dict) and ("shots" in inner or "scenes" in inner):
            return inner
    if "shots" in data or "scenes" in data:
        return data
    raise DirectorAdapterError("LLM 输出缺少 shots 字段")


def _offline_text_shots(
    text: str,
    *,
    shot_count: int,
    target_duration: float,
    mapper: Optional[Callable[..., list[str]]],
    seed_keywords: Optional[list[str]],
) -> dict:
    """不依赖 LLM 的确定性拆分：按标点切句 → 逐镜分配旁白/检索词/运动。"""
    count = max(1, int(shot_count or 6))
    sentences = [s.strip() for s in re.split(r"[。！？!?\n]+", str(text or "")) if s.strip()]
    if not sentences:
        sentences = [str(text or "").strip() or "一个关于科技与人的瞬间"]

    weights = [3.0 if i == 0 else (4.0 if i == count - 1 else 2.5) for i in range(count)]
    unit = max(1.0, float(target_duration)) / sum(weights)
    shots: list[dict] = []
    used_keywords: set[tuple[str, ...]] = set()
    for i in range(count):
        script_text = sentences[i] if i < len(sentences) else sentences[-1]
        keywords = _english_keywords(
            script_text,
            index=i,
            mapper=mapper,
            seed_keywords=seed_keywords if i == 0 else None,
            avoid=used_keywords,
        )
        used_keywords.add(tuple(keywords))
        shots.append(
            {
                "id": f"s1-{i + 1:02d}",
                "scene": "s1",
                "kind": "hook" if i == 0 else ("cta" if i == count - 1 else "text"),
                "script_text": script_text,
                "search_keywords": keywords,
                "camera_movement": _movement_for(i, count),
                "shot_size": _TEXT_SHOT_SIZES[i % len(_TEXT_SHOT_SIZES)],
                "duration_s": round(weights[i] * unit, 2),
            }
        )
    return {"shots": shots}


def _llm_text_shots(
    text: str,
    *,
    shot_count: int,
    target_duration: float,
    provider: Optional[str],
    seed_keywords: Optional[list[str]],
) -> dict:
    """LLM 路径：一次结构化调用产出全部镜头。"""
    from src.core.llm_client import LLMClient  # noqa: PLC0415

    client = LLMClient(provider)
    prompt_lines = [
        f"原始文本：{text}",
        f"目标时长：约 {target_duration} 秒；镜头数：约 {shot_count} 个。",
        "请输出如下 JSON（只返回 JSON）：",
        _TEXT_SCHEMA_HINT,
    ]
    if seed_keywords:
        prompt_lines.append(f"可参考的检索词：{', '.join(map(str, seed_keywords))}")
    return _coerce_text_shots(
        client.chat_structured(
            "\n".join(prompt_lines), system=_TEXT_SYSTEM_PROMPT, temperature=0.8
        )
    )


def _shots_to_script(
    shots: list[dict],
    *,
    style: str,
    source: str,
    mapper: Optional[Callable[..., list[str]]],
    seed_keywords: Optional[list[str]],
    default_duration: float,
) -> dict:
    """把词法不定的 shots 规范成导演分镜契约（字段齐全 + 轴线安全）。"""
    count = max(1, len(shots))
    out: list[dict] = []
    used_keywords: set[tuple[str, ...]] = set()
    for i, raw in enumerate(shots):
        if not isinstance(raw, dict):
            continue
        script_text = _as_str(
            raw.get("script_text")
            or raw.get("voiceover")
            or raw.get("voice_over")
            or raw.get("narration")
            or raw.get("text")
        )
        if not script_text:
            continue
        movement = _as_str(raw.get("camera_movement") or raw.get("movement")).lower()
        if movement not in _TEXT_MOVEMENTS:
            movement = _movement_for(i, count)
        keywords = _dedupe(
            raw.get("search_keywords") or raw.get("keywords") or raw.get("asset_queries"), 4
        )
        # LLM 偶尔会为每个镜头返回同一组词，撞车时按镜序改写，保证逐镜视觉差异。
        if not keywords or tuple(keywords) in used_keywords:
            keywords = _english_keywords(
                script_text,
                index=i,
                mapper=mapper,
                seed_keywords=seed_keywords if i == 0 else None,
                avoid=used_keywords,
            )
        used_keywords.add(tuple(keywords))
        out.append(
            {
                "id": _as_str(raw.get("id") or f"s1-{i + 1:02d}"),
                "scene": _as_str(raw.get("scene") or "s1"),
                "kind": _as_str(raw.get("kind") or ("hook" if i == 0 else "text")),
                "text": script_text,
                "script_text": script_text,
                "search_keywords": keywords,
                "asset_queries": keywords,
                "camera_movement": movement,
                "duration_s": raw.get("duration_s")
                or raw.get("duration_seconds")
                or default_duration,
                "camera": {
                    "shot_size": _as_str(raw.get("shot_size") or "medium"),
                    "side": "neutral" if i % 3 == 2 else "left",
                    "movement": movement,
                },
            }
        )
    if not out:
        raise DirectorAdapterError("文本解析没有产出有效镜头（缺少 script_text）")
    return {
        "title": "",
        "style": style,
        "format": "short_drama",
        "width": 1080,
        "height": 1920,
        "fps": 24,
        "shots": out,
        "audio": {"music": {"volume": 0.2}},
        "text_source": source,
    }


def _derive_text_title(text: str, shots: list[dict], title: Optional[str]) -> str:
    """标题优先用显式 title，其次首镜旁白，最后原始文本首句（≤16 字）。"""
    if title and str(title).strip():
        return str(title).strip()[:24]
    head = _as_str(shots[0].get("script_text")) if shots else ""
    if not head:
        head = str(text or "")
    head = re.split(r"[，。！？、,.!?；;：:\n]", head)[0].strip()
    return (head[:16] or "创意短片").strip()


def parse_text_to_shots(
    text: str,
    *,
    style: str = "短剧",
    shot_count: int = 6,
    target_duration: float = 15.0,
    title: Optional[str] = None,
    seed_keywords: Optional[list[str]] = None,
    provider: Optional[str] = None,
    use_llm: bool = True,
    visual_mapper: Optional[Callable[..., list[str]]] = None,
    default_duration: float = 3.5,
) -> dict:
    """原始文本 → 结构化镜头（导演分镜契约，可直接喂 adapt_director_script）。

    每个镜头都显式带 `script_text`（Edge-TTS 旁白）、`search_keywords`
    （图库检索英文词）与 `camera_movement`（push_in / static / pull_out）。
    LLM 不可用、抛错或 `provider="offline"` 时自动走确定性拆分。
    """
    raw_text = str(text or "").strip()
    if not raw_text:
        raise DirectorAdapterError("原始文本为空")

    mapper = visual_mapper if visual_mapper is not None else _load_visual_mapper()
    shots: list[dict] = []
    source = "offline"
    if use_llm and provider != "offline":
        try:
            data = _llm_text_shots(
                raw_text,
                shot_count=shot_count,
                target_duration=target_duration,
                provider=provider,
                seed_keywords=seed_keywords,
            )
            shots = [
                s
                for s in (data.get("shots") or data.get("scenes") or [])
                if isinstance(s, dict)
            ]
            if shots:
                source = "llm"
        except Exception as exc:  # noqa: BLE001 - LLM 不可用即降级
            print(
                f"[director] LLM 文本解析不可用，改用确定性拆分：{type(exc).__name__}: {exc}",
                file=sys.stderr,
            )
    if not shots:
        shots = _offline_text_shots(
            raw_text,
            shot_count=shot_count,
            target_duration=target_duration,
            mapper=mapper,
            seed_keywords=seed_keywords,
        )["shots"]
        source = "llm-fallback" if source == "llm" else "offline"

    script = _shots_to_script(
        shots,
        style=style,
        source=source,
        mapper=mapper,
        seed_keywords=seed_keywords,
        default_duration=default_duration,
    )
    script["title"] = _derive_text_title(raw_text, script["shots"], title)
    return script


def text_to_storyboard(text: str, **kwargs: Any) -> dict:
    """原始文本 → storyboard 契约（parse_text_to_shots + adapt_director_script）。"""
    strict_axis = bool(kwargs.pop("strict_axis", True))
    product = kwargs.pop("product", None)
    mapper = kwargs.get("visual_mapper")
    script = parse_text_to_shots(text, **kwargs)
    storyboard = adapt_director_script(
        script,
        strict_axis=strict_axis,
        visual_mapper=mapper,
        product=product,
    )
    storyboard["text_pipeline"] = {
        "source": script.get("text_source"),
        "style": script.get("style"),
    }
    return storyboard


# --------------------------------------------------------------------------
# 主适配逻辑
# --------------------------------------------------------------------------
def adapt_director_script(
    script: dict,
    *,
    strict_axis: bool = True,
    default_duration: float = 3.5,
    visual_mapper: Optional[Callable[[list[str], str], list[str]]] = None,
    product: Optional[str] = None,
) -> dict:
    """导演分镜 → storyboard JSON（dict）。两条导演规范在 strict 模式下强制。"""
    if not isinstance(script, dict):
        raise DirectorAdapterError("导演分镜必须是 JSON 对象")

    warnings: list[str] = []
    characters = _index_assets(script, "characters", "角色", warnings)
    locations = _index_assets(script, "locations", "场景", warnings)
    raw_scenes = _as_list(script.get("scenes"))
    declared_axis = _scene_axis(script, raw_scenes)
    shots = _flatten_shots(script)
    if not shots:
        raise DirectorAdapterError("导演分镜缺少 shots/scenes 列表（至少 1 个镜头）")

    out_scenes: list[dict] = []
    voice_script: list[dict] = []
    asset_locks: list[dict] = []
    violations: list[str] = []
    axis_state: dict[str, Optional[str]] = {}
    axis_trace: list[dict] = []
    cursor = 0.0

    for i, shot in enumerate(shots):
        shot_id = _as_str(shot.get("id") or f"shot-{i + 1}")
        scene_id = _as_str(shot.get("scene") or shot.get("scene_id") or "s1")
        text = _as_str(shot.get("text") or shot.get("subtitle") or shot.get("title"))
        lines = _dialogue_lines(shot)
        if not text and lines:
            text = " ".join(line["text"] for line in lines)

        # --- 资产锁定 ---
        locked_ref = ""
        for cid in _as_list(shot.get("characters") or shot.get("cast")):
            asset = _lookup(characters, cid)
            if asset and asset["locked"]:
                if not asset["ref"]:
                    raise AssetLockError(
                        f"资产锁定违规：镜头 '{shot_id}' 引用锁定角色 '{asset['name']}'，"
                        "该角色缺少 ref 参考素材"
                    )
                locked_ref = locked_ref or asset["ref"]
                asset_locks.append({"shot": shot_id, "kind": "character", "id": asset["id"], "ref": asset["ref"]})
        location = _lookup(locations, shot.get("location") or shot.get("location_id"))
        if location and location["locked"]:
            if not location["ref"]:
                raise AssetLockError(
                    f"资产锁定违规：镜头 '{shot_id}' 引用锁定场景 '{location['name']}'，"
                    "该场景缺少 ref 参考素材"
                )
            if not locked_ref:
                locked_ref = location["ref"]
            asset_locks.append({"shot": shot_id, "kind": "location", "id": location["id"], "ref": location["ref"]})

        source = _as_str(shot.get("source"))
        if locked_ref:
            source = locked_ref  # 锁定资产优先：不参与随机取材
        elif not source:
            prop = shot.get("asset") if isinstance(shot.get("asset"), dict) else {}
            source = _as_str(prop.get("ref") or shot.get("asset_ref"))
        source = _resolve_source(source)

        # --- 180° 轴线 ---
        side = _camera_side(shot)
        camera = shot.get("camera") if isinstance(shot.get("camera"), dict) else {}
        if side not in _NEUTRAL_SIDES:
            current = axis_state.get(scene_id)
            declared = _as_str((declared_axis.get(scene_id.lower()) or {}).get("side")).lower()
            if declared and not current:
                current = axis_state[scene_id] = declared
            if current is None:
                axis_state[scene_id] = side
            elif side != current:
                if bool(camera.get("axis_break")):
                    axis_state[scene_id] = side
                else:
                    message = (
                        f"轴线违规：场 '{scene_id}' 镜头 '{shot_id}' 由 side={current} "
                        f"越轴到 side={side}，且未声明 camera.axis_break"
                    )
                    violations.append(message)
                    if strict_axis:
                        raise AxisRuleError(message)
                    warnings.append(message)
                    axis_state[scene_id] = side
        else:
            axis_state[scene_id] = None  # 中性镜头重建轴线
        axis_trace.append({"shot": shot_id, "scene": scene_id, "side": side or "neutral"})

        # --- 场景组装 ---
        scene_type = _scene_type_for(shot, bool(source))
        duration = _estimate_duration(shot, text, default_duration)
        style = shot.get("style") if isinstance(shot.get("style"), dict) else {}
        style_kind = _as_str(style.get("kind")) or _TYPE_TO_STYLE_KIND.get(scene_type, "value")
        scene: dict[str, Any] = {
            "type": scene_type,
            "text": text,
            "subtitle": _as_str(shot.get("subtitle")),
            "duration_s": duration,
            "style": {
                "kind": style_kind,
                "align": _as_str(style.get("align")) or "center",
                "color": _as_str(style.get("color")),
                "highlight": _as_str(style.get("highlight")),
            },
        }
        scene["style"] = {k: v for k, v in scene["style"].items() if v}
        scene["asset_queries"] = _visual_queries(
            shot,
            characters,
            locations,
            mapper=visual_mapper,
            text=text,
        )
        # 纯文本管线字段：旁白 / 英文检索词 / 镜头运动（Stage-2 TTS + 图库取材）
        script_text = _as_str(
            shot.get("script_text")
            or shot.get("voiceover")
            or shot.get("voice_over")
            or shot.get("narration")
        ) or text
        movement = _as_str(
            shot.get("camera_movement") or shot.get("movement") or camera.get("movement")
        ).lower()
        if movement not in _TEXT_MOVEMENTS:
            movement = "static"
        keywords = _dedupe(shot.get("search_keywords") or shot.get("keywords"), 4)
        scene["script_text"] = script_text
        scene["search_keywords"] = keywords or list(scene["asset_queries"])
        scene["camera_movement"] = movement
        if source:
            scene["source"] = source
            media_kind = _media_kind_for(source)
            if media_kind:
                scene["_media_kind"] = media_kind
        if _as_str(shot.get("overlay_kind")) or isinstance(shot.get("overlay"), dict):
            scene["overlay"] = shot.get("overlay")
        if locked_ref:
            scene["_asset_lock"] = True
        if isinstance(shot.get("composition"), str):
            scene["_composition"] = shot["composition"]
        out_scenes.append(scene)

        # --- 配音脚本（Stage-2 TTS 交接） ---
        for line in lines:
            spoken = line["text"]
            spoken_dur = round(max(0.8, len(spoken) / 4.5 + 0.3), 2)
            voice_script.append(
                {
                    "shot_id": shot_id,
                    "scene": scene_id,
                    "speaker": line["speaker"],
                    "text": spoken,
                    "start_seconds": round(cursor, 2),
                    "end_seconds": round(cursor + min(spoken_dur, duration), 2),
                }
            )
        if not lines and text and scene_type in ("hero_title", "text_card", "callout"):
            voice_script.append(
                {
                    "shot_id": shot_id,
                    "scene": scene_id,
                    "speaker": _as_str(shot.get("narrator") or "narrator"),
                    "text": text,
                    "start_seconds": round(cursor, 2),
                    "end_seconds": round(cursor + duration, 2),
                }
            )
        cursor += duration

    audio = script.get("audio") if isinstance(script.get("audio"), dict) else {}
    storyboard: dict[str, Any] = {
        "title": _as_str(script.get("title")) or slugify(str(script.get("name") or "director-cut")),
        "product": product or _as_str(script.get("product")) or "short-drama",
        "width": int(script.get("width") or 1080),
        "height": int(script.get("height") or 1920),
        "fps": int(script.get("fps") or 24),
        "scenes": out_scenes,
        "audio": {
            "narration": _as_list(audio.get("narration")),
            "music": audio.get("music") if isinstance(audio.get("music"), dict) else None,
        },
        "voice_script": voice_script,
        "director_meta": {
            "format": _as_str(script.get("format")) or "short_drama",
            "shot_count": len(out_scenes),
            "duration_seconds": round(cursor, 2),
            "asset_locks": asset_locks,
            "axis_declared": {k: _as_str(v.get("side")) for k, v in declared_axis.items()},
            "axis_trace": axis_trace,
            "violations": violations,
            "warnings": warnings,
        },
    }
    if isinstance(script.get("theme"), dict):
        storyboard["theme"] = script["theme"]

    # 契约校验：任何越界类型 / 必填缺失都会在这里暴露
    try:
        validate_storyboard({k: v for k, v in storyboard.items() if k in {
            "title", "product", "width", "height", "fps", "theme", "scenes", "audio"
        }})
    except ValueError as exc:
        raise DirectorAdapterError(f"适配结果不满足 storyboard 契约：{exc}") from exc
    return storyboard


def adapt_file(
    path: Path | str,
    *,
    strict_axis: bool = True,
    default_duration: float = 3.5,
    visual_mapper: Optional[Callable[[list[str], str], list[str]]] = None,
    product: Optional[str] = None,
) -> dict:
    """读取导演分镜文件并适配。"""
    source = Path(path)
    try:
        script = json.loads(source.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise DirectorAdapterError(f"导演分镜文件不存在：{source}") from exc
    except (json.JSONDecodeError, OSError) as exc:
        raise DirectorAdapterError(f"导演分镜 JSON 读取失败：{exc}") from exc
    return adapt_director_script(
        script,
        strict_axis=strict_axis,
        default_duration=default_duration,
        visual_mapper=visual_mapper,
        product=product,
    )


def write_storyboard(storyboard: dict, path: Path | str) -> Path:
    """写出 storyboard JSON（UTF-8 无 BOM，供 pipeline 直读）。"""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps(storyboard, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return target


def _ensure_utf8_stdout() -> None:
    """Windows 控制台默认 cp936/cp1252，强制 UTF-8 以避免中文输出崩溃。"""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def main(argv: Optional[list[str]] = None) -> int:
    _ensure_utf8_stdout()
    parser = argparse.ArgumentParser(
        prog="director-adapter",
        description="导演 Skill 结构化分镜 → 008-video-factory storyboard 契约",
    )
    parser.add_argument("--input", "-i", required=True, help="导演分镜 JSON 路径")
    parser.add_argument("--output", "-o", help="输出 storyboard JSON（默认 work/director/<slug>.json）")
    parser.add_argument("--product", help="归档产品名（默认 short-drama）")
    parser.add_argument("--default-duration", type=float, default=3.5, help="缺省镜头时长（秒）")
    parser.add_argument("--no-strict-axis", action="store_true", help="轴线违规仅告警不报错")
    parser.add_argument("--validate-only", action="store_true", help="只做契约校验，不写文件")
    parser.add_argument("--quiet", action="store_true", help="不打印摘要 JSON")
    args = parser.parse_args(argv)

    try:
        storyboard = adapt_file(
            args.input,
            strict_axis=not args.no_strict_axis,
            default_duration=args.default_duration,
            product=args.product,
        )
    except DirectorAdapterError as exc:
        print(f"[director] FAILED: {exc}", file=sys.stderr)
        return 1

    meta = storyboard["director_meta"]
    summary = {
        "title": storyboard["title"],
        "shots": meta["shot_count"],
        "duration_seconds": meta["duration_seconds"],
        "asset_locks": len(meta["asset_locks"]),
        "axis_violations": len(meta["violations"]),
        "warnings": meta["warnings"],
    }
    if not args.validate_only:
        slug = slugify(storyboard["title"])
        target = Path(args.output) if args.output else Path("work") / "director" / f"{slug}.storyboard.json"
        summary["output"] = str(write_storyboard(storyboard, target))
    if not args.quiet:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
