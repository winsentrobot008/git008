"""创意 → 导演分镜 桥梁（Idea / Agent-Reach 热点 → Director Script → storyboard）。

流程：

1. 注入「导演规范」系统 Prompt（资产锁定 / 180° 轴线 / 输出契约），驱动
   `src/core/llm_client.py` 的 LLM 网关产出 `example_short_drama.json` 结构；
2. 交给 `director_adapter.adapt_director_script` 做严格校验（strict_axis）；
3. 命中 `AssetLockError`（锁定资产缺 ref）或 180° 轴线冲突时，自动修复并
   重试一次：优先让 LLM 依据报错重写，失败则走确定性修复
   （解除缺 ref 的锁定 + 强制轴线连续性）。

未配置 LLM Key 时自动降级为**确定性草稿**（保证结构合法、可直接出片），
因此整条链路在离线状态下依然可跑通。

用法：
    python -m modules.video_factory.idea_to_drama_bridge --idea "凌晨两点的冰箱" -o script.json
    python -m modules.video_factory.idea_to_drama_bridge --topic github --style 漫剧
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import re
import sys
from pathlib import Path
from typing import Any, Optional

from src.core.paths import REPO_ROOT

from .director_adapter import (
    DEFAULT_VISUAL_FALLBACK,
    DirectorAdapterError,
    adapt_director_script,
    slugify,
    write_storyboard,
)

__all__ = [
    "BridgeError",
    "DIRECTOR_SYSTEM_PROMPT",
    "idea_to_drama",
    "from_topic_data",
    "offline_draft",
    "normalize_script",
    "main",
]

DIRECTOR_SYSTEM_PROMPT = """\
你是资深竖屏短剧/漫剧导演，负责把一句创意扩写成可执行的结构化分镜。你必须遵守两条硬性导演规范：

【资产锁定 Asset Lock】
- `characters[]` / `locations[]` 中只有提供了 `ref`（本地或远程素材路径）的资产才允许写 `"locked": true`；
- 锁定资产被镜头引用时，该镜头必须复用锁定的 `ref` 素材，禁止随机取材；
- 没有 `ref` 的资产必须写 `"locked": false`。违反会导致资产锁定违规，直接被拒绝。

【180° 轴线 Axis of Action】
- 同一场（`scene`）内相邻镜头必须停留在轴线同一侧，用 `camera.side: "left"` 或 `"right"` 标注；
- 需要越轴时必须显式声明 `camera.axis_break: true`，或用 `camera.side: "neutral"` 的中性镜头（特写/空镜/插入镜）重建轴线；
- 同场镜头不允许无声明地左右横跳。

【镜头契约】
- 每个镜头至少包含：`id`、`scene`、`kind`、`text`、`duration_s`、`camera{shot_size,side}`；
- `kind` 取值：hook / text / dialogue / insert / broll / cta；
- `shot_size` 取值：extreme_close / close / medium_close / medium / wide / extreme_wide；
- `asset_queries` 用 2-3 个**英文实拍检索词**（Pexels 风格），不要写抽象名词；
- 第一镜是 hook（3 秒内抓住注意力），最后一镜是 cta；对白镜头把台词放进 `dialogue[]`。
"""

REPAIR_SUFFIX = """
上一次输出未通过导演规范校验。请只修正报错指出的问题，保持其余内容不变，
仍然只返回 JSON。
"""

_REPAIR_HINT = (
    "若报错是资产锁定违规：为缺失 `ref` 的资产补上 `ref`，或把它改成 `\"locked\": false`。\n"
    "若报错是轴线违规：把越轴镜头的 `camera.side` 改回同场已确立的一侧，"
    "或为该镜头声明 `camera.axis_break: true`，或改成 `camera.side: \"neutral\"` 的中性镜头。"
)

_SCHEMA_HINT = """\
{
  "title": "...", "format": "short_drama", "width": 1080, "height": 1920, "fps": 24,
  "characters": [{"id": "...", "name": "...", "locked": false, "visual_keywords": ["english visual term"]}],
  "locations":  [{"id": "...", "name": "...", "locked": false, "visual_keywords": ["english visual term"]}],
  "axis": {"scenes": {"s1": {"side": "left"}}},
  "shots": [{
    "id": "s1-01", "scene": "s1", "kind": "hook", "text": "...", "subtitle": "...",
    "duration_s": 3, "characters": [], "location": "",
    "camera": {"shot_size": "close", "side": "left", "movement": "push_in"},
    "asset_queries": ["english search term", "another term"],
    "dialogue": [{"speaker": "...", "line": "..."}]
  }],
  "audio": {"music": {"volume": 0.2}}
}"""

_SENTENCE_SPLIT = re.compile(r"[。！？!?\n]+")
_SHOT_SIZES = ("wide", "medium", "close", "extreme_close", "medium_close", "wide")
_MOVEMENTS = ("push_in", "static", "pan", "pull_out")


class BridgeError(RuntimeError):
    """创意无法转换为合法导演分镜。"""


# --------------------------------------------------------------------------
# 工具
# --------------------------------------------------------------------------
def _derive_title(sentences: list[str]) -> str:
    """取首句第一个标点之前的内容作为标题（最多 16 字）。"""
    if not sentences:
        return "创意短片"
    head = re.split(r"[，。！？、,.!?；;：:\n]", sentences[0])[0].strip()
    title = head[:16].strip()
    return title or "创意短片"


def _split_sentences(text: str) -> list[str]:
    parts = [p.strip(" ，,、;；:：\"'“”") for p in _SENTENCE_SPLIT.split(str(text or ""))]
    return [p for p in parts if len(p) >= 2]


def _load_agent_reach_mapper():
    """复用 Agent-Reach 的视觉关键词映射（中英双语词典）。"""
    scripts_dir = REPO_ROOT / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    try:
        from agent_reach_bridge import map_to_visual_keywords  # noqa: PLC0415
    except Exception:  # noqa: BLE001 - 映射器可选，缺失即回退通用词
        return None

    def _quiet_mapper(raw_keywords, text_summary="", limit=5):
        """映射器会向 stdout 打印命中日志，这里静音以免污染 CLI / Streamlit。"""
        with contextlib.redirect_stdout(io.StringIO()):
            return map_to_visual_keywords(raw_keywords, text_summary, limit=limit)

    return _quiet_mapper


def _queries(text: str, seed_keywords: Optional[list[str]], mapper) -> list[str]:
    if seed_keywords:
        return [str(k) for k in seed_keywords if str(k).strip()][:3]
    if mapper is not None:
        try:
            out = mapper([], text, limit=3)
        except Exception:  # noqa: BLE001
            out = None
        if out:
            return [str(o) for o in out][:3]
    return list(DEFAULT_VISUAL_FALLBACK[:3])


def _coerce_script(data: Any) -> dict:
    """容忍 LLM 返回 {"script": {...}} / {"director_script": {...}} 包装。"""
    if not isinstance(data, dict):
        raise BridgeError("LLM 未返回 JSON 对象")
    for key in ("script", "director_script", "storyboard", "data"):
        inner = data.get(key)
        if isinstance(inner, dict) and ("shots" in inner or "scenes" in inner):
            return inner
    if "shots" in data or "scenes" in data:
        return data
    raise BridgeError("LLM 输出缺少 shots/scenes 字段")


# --------------------------------------------------------------------------
# 确定性草稿（离线兜底）
# --------------------------------------------------------------------------
def offline_draft(
    idea: str,
    *,
    style: str = "短剧",
    target_duration: float = 15.0,
    shot_count: int = 6,
    title: Optional[str] = None,
    seed_keywords: Optional[list[str]] = None,
    locked_assets: Optional[dict] = None,
) -> dict:
    """不依赖 LLM 也能产出合法分镜（严格满足资产锁定 + 180° 轴线）。"""
    count = max(3, int(shot_count or 6))
    sentences = _split_sentences(idea)
    if not sentences:
        sentences = [str(idea or "").strip() or "一个关于科技与人的瞬间"]

    texts: list[str] = []
    for i in range(count):
        texts.append(sentences[i] if i < len(sentences) else sentences[-1])

    mapper = _load_agent_reach_mapper()
    weights = [3.0 if i == 0 else (4.0 if i == count - 1 else 2.5) for i in range(count)]
    unit = max(1.0, float(target_duration)) / sum(weights)

    shots: list[dict] = []
    for i, text in enumerate(texts):
        if i == 0:
            kind = "hook"
        elif i == count - 1:
            kind = "cta"
        elif i % 3 == 1:
            kind = "dialogue"
        else:
            kind = "text"
        # 每 3 镜插入一个中性镜头重建轴线，其余保持同侧 → 严格满足 180° 规则
        side = "neutral" if i % 3 == 2 else "left"
        camera: dict[str, Any] = {
            "shot_size": _SHOT_SIZES[i % len(_SHOT_SIZES)],
            "side": side,
        }
        if side != "neutral":
            camera["movement"] = _MOVEMENTS[i % len(_MOVEMENTS)]
        shot: dict[str, Any] = {
            "id": f"s1-{i + 1:02d}",
            "scene": "s1",
            "kind": kind,
            "text": text,
            "duration_s": round(weights[i] * unit, 2),
            "camera": camera,
            "asset_queries": _queries(f"{text} {idea}", seed_keywords if i == 0 else None, mapper),
        }
        if kind == "dialogue":
            shot["dialogue"] = [{"speaker": "narrator", "line": text}]
        shots.append(shot)

    for i, shot in enumerate(shots):
        if i < len(shots) - 1:
            shot.pop("subtitle", None)

    draft: dict[str, Any] = {
        "title": title or _derive_title(sentences),
        "format": "manga_drama" if "漫" in style else "short_drama",
        "style": style,
        "width": 1080,
        "height": 1920,
        "fps": 24,
        "axis": {"scenes": {"s1": {"side": "left"}}},
        "shots": shots,
        "audio": {"music": {"volume": 0.2}},
    }
    if locked_assets:
        for key in ("characters", "locations"):
            if locked_assets.get(key):
                draft[key] = locked_assets[key]
    return draft


# --------------------------------------------------------------------------
# 确定性修复（LLM 不可用或 LLM 修复失败后的兜底）
# --------------------------------------------------------------------------
def _iter_shots(script: dict) -> list[dict]:
    out: list[dict] = []
    for shot in script.get("shots") or []:
        if isinstance(shot, dict):
            out.append(shot)
    for scene in script.get("scenes") or []:
        if isinstance(scene, dict):
            for shot in scene.get("shots") or []:
                if isinstance(shot, dict):
                    out.append(shot)
    return out


def _unlock_missing_refs(script: dict) -> list[str]:
    notes: list[str] = []
    for key, label in (("characters", "角色"), ("locations", "场景")):
        for asset in script.get(key) or []:
            if not isinstance(asset, dict):
                continue
            if asset.get("locked") and not str(asset.get("ref") or "").strip():
                asset["locked"] = False
                notes.append(f"修复：{label} '{asset.get('name') or asset.get('id')}' 缺少 ref，已解除资产锁定")
    return notes


def _enforce_axis_continuity(script: dict) -> list[str]:
    """把无声明越轴的镜头拉回同场已确立的一侧（保留 180° 轴线）。"""
    notes: list[str] = []
    state: dict[str, Optional[str]] = {}
    for shot in _iter_shots(script):
        camera = shot.get("camera")
        if not isinstance(camera, dict):
            continue
        scene = str(shot.get("scene") or "s1")
        side = str(camera.get("side") or "").strip().lower()
        if side in ("", "neutral", "center", "n/a", "none"):
            state[scene] = None  # 中性镜头重建轴线
            continue
        current = state.get(scene)
        if current is None:
            state[scene] = side
            continue
        if side != current and not camera.get("axis_break"):
            camera["side"] = current
            notes.append(f"修复：镜头 '{shot.get('id')}' 越轴 {side}→{current}，已拉回轴线同侧")
    return notes


def normalize_script(script: dict) -> tuple[dict, list[str]]:
    """确定性规范化：解除无效锁定 + 强制轴线连续性。"""
    notes = _unlock_missing_refs(script)
    notes += _enforce_axis_continuity(script)
    return script, notes


# --------------------------------------------------------------------------
# LLM 路径
# --------------------------------------------------------------------------
def _build_prompt(
    idea: str,
    *,
    style: str,
    target_duration: float,
    shot_count: int,
    seed_keywords: Optional[list[str]],
    locked_assets: Optional[dict],
) -> str:
    lines = [
        f"创意：{idea}",
        f"风格：{style}；目标时长：约 {target_duration} 秒；镜头数：约 {shot_count} 个。",
        "请输出一份完整的导演分镜 JSON，结构如下（只返回 JSON）：",
        _SCHEMA_HINT,
    ]
    if seed_keywords:
        lines.append(f"可参考的实拍视觉检索词（来自 Agent-Reach 热点）：{', '.join(map(str, seed_keywords))}")
    if locked_assets:
        lines.append(
            "以下资产已锁定，请直接复用它们的 id / ref，不要改动 locked 与 ref："
            + json.dumps(locked_assets, ensure_ascii=False)
        )
    lines.append("要求：同一场内遵守 180° 轴线；未提供 ref 的角色/场景一律 locked=false。")
    return "\n".join(lines)


def _llm_script(client, prompt: str, *, system: str) -> dict:
    return _coerce_script(client.chat_structured(prompt, system=system, temperature=0.8))


def _repair_with_llm(client, script: dict, error_text: str) -> dict:
    prompt = (
        "下面是上一版导演分镜 JSON：\n"
        + json.dumps(script, ensure_ascii=False, indent=2)
        + f"\n\n校验报错：{error_text}\n\n{_REPAIR_HINT}\n请返回修正后的完整 JSON。"
    )
    return _coerce_script(
        client.chat_structured(prompt, system=DIRECTOR_SYSTEM_PROMPT + REPAIR_SUFFIX, temperature=0.2)
    )


def _make_client(provider: Optional[str]):
    """尽力拿到 LLM 客户端；不可用返回 None（走离线草稿）。"""
    try:
        from src.core.llm_client import LLMClient  # noqa: PLC0415

        return LLMClient(provider)
    except Exception:  # noqa: BLE001 - 无 Key / 无 SDK 时降级
        return None


# --------------------------------------------------------------------------
# 主入口
# --------------------------------------------------------------------------
def idea_to_drama(
    idea: str,
    *,
    style: str = "短剧",
    target_duration: float = 15.0,
    shot_count: int = 6,
    title: Optional[str] = None,
    seed_keywords: Optional[list[str]] = None,
    locked_assets: Optional[dict] = None,
    provider: Optional[str] = None,
    client: Any = None,
    max_repairs: int = 1,
    prefer_llm: bool = True,
) -> dict:
    """自然语言创意 → 合法导演分镜 + storyboard 契约。"""
    if not str(idea or "").strip():
        raise BridgeError("创意文本为空")

    use_llm = prefer_llm and provider != "offline"
    if client is None and use_llm:
        client = _make_client(provider)
        if client is None:
            use_llm = False

    drafts: list[str] = []
    if use_llm and client is not None:
        try:
            script = _llm_script(
                client,
                _build_prompt(
                    idea,
                    style=style,
                    target_duration=target_duration,
                    shot_count=shot_count,
                    seed_keywords=seed_keywords,
                    locked_assets=locked_assets,
                ),
                system=DIRECTOR_SYSTEM_PROMPT,
            )
            source = "llm"
        except Exception as exc:  # noqa: BLE001 - LLM 不可用时降级
            drafts.append(f"LLM 生成失败，降级为确定性草稿：{type(exc).__name__}: {exc}")
            script = offline_draft(
                idea,
                style=style,
                target_duration=target_duration,
                shot_count=shot_count,
                title=title,
                seed_keywords=seed_keywords,
                locked_assets=locked_assets,
            )
            source = "offline-fallback"
            client = None
    else:
        script = offline_draft(
            idea,
            style=style,
            target_duration=target_duration,
            shot_count=shot_count,
            title=title,
            seed_keywords=seed_keywords,
            locked_assets=locked_assets,
        )
        source = "offline"

    script.setdefault("width", 1080)
    script.setdefault("height", 1920)
    script.setdefault("fps", 24)
    if title:
        script["title"] = title

    mapper = _load_agent_reach_mapper()
    repairs: list[str] = list(drafts)
    storyboard: Optional[dict] = None
    for attempt in range(max_repairs + 1):
        try:
            storyboard = adapt_director_script(
                script, strict_axis=True, visual_mapper=mapper
            )
            break
        except DirectorAdapterError as exc:
            message = str(exc)
            if attempt >= max_repairs:
                raise BridgeError(f"导演规范校验失败且修复重试已用尽：{message}") from exc
            repairs.append(f"第 {attempt + 1} 次校验失败：{message}")
            fixed: Optional[dict] = None
            if client is not None:
                try:
                    fixed = _repair_with_llm(client, script, message)
                    repairs.append("已请求 LLM 依据报错重写分镜")
                except Exception as repair_exc:  # noqa: BLE001
                    repairs.append(f"LLM 修复失败（{type(repair_exc).__name__}），改用确定性修复")
            script, notes = normalize_script(fixed if fixed is not None else script)
            repairs.extend(notes)
            script.setdefault("width", 1080)
            script.setdefault("height", 1920)
            script.setdefault("fps", 24)

    assert storyboard is not None
    return {
        "idea": idea,
        "style": style,
        "source": source,
        "director_script": script,
        "storyboard": storyboard,
        "repair_attempts": len(repairs),
        "repairs": repairs,
        "warnings": storyboard["director_meta"]["warnings"],
        "slug": slugify(str(script.get("title") or "director-cut")),
    }


def from_topic_data(topic_data: dict, **kwargs) -> dict:
    """Agent-Reach 热点数据 → 导演分镜。"""
    if not isinstance(topic_data, dict):
        raise BridgeError("Agent-Reach 数据必须是 dict")
    text = str(topic_data.get("text") or "").strip()
    if not text:
        items = topic_data.get("items") or []
        text = "；".join(str(i.get("title") or i) for i in items)[:400]
    if not text:
        raise BridgeError("Agent-Reach 数据中没有可用文本")
    keywords = topic_data.get("visual_keywords") or topic_data.get("keywords") or []
    kwargs.setdefault("seed_keywords", [str(k) for k in keywords][:3])
    kwargs.setdefault("title", f"{topic_data.get('source') or '热点'}·{text[:12]}")
    return idea_to_drama(text, **kwargs)


def main(argv: Optional[list[str]] = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(prog="idea-to-drama", description="创意/热点 → 导演分镜 → storyboard")
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--idea", help="自然语言创意")
    src.add_argument("--topic", help="Agent-Reach 热点主题（github/v2ex/rss/网址/搜索词）")
    parser.add_argument("--source", default="auto", choices=["auto", "github", "v2ex", "rss", "web"], help="Agent-Reach 取材路由")
    parser.add_argument("--style", default="短剧", help="短剧 / 漫剧")
    parser.add_argument("--duration", type=float, default=15.0, help="目标时长（秒）")
    parser.add_argument("--shots", type=int, default=6, help="镜头数")
    parser.add_argument("--title", help="标题（默认取创意首句）")
    parser.add_argument("--provider", help="LLM provider（缺省按 .env 路由；offline 强制离线草稿）")
    parser.add_argument("--max-repairs", type=int, default=1, help="校验失败后的修复重试次数")
    parser.add_argument("--output", "-o", help="导演分镜 JSON 输出路径")
    parser.add_argument("--storyboard-output", help="额外导出 storyboard 契约 JSON")
    parser.add_argument("--json", action="store_true", help="只输出摘要 JSON")
    args = parser.parse_args(argv)

    try:
        if args.topic:
            scripts_dir = str(REPO_ROOT / "scripts")
            if scripts_dir not in sys.path:
                sys.path.insert(0, scripts_dir)
            from agent_reach_bridge import extract_topic_data  # noqa: PLC0415

            topic = extract_topic_data(args.topic, source=args.source)
            result = from_topic_data(
                topic,
                style=args.style,
                target_duration=args.duration,
                shot_count=args.shots,
                title=args.title,
                provider=args.provider,
                max_repairs=args.max_repairs,
            )
        else:
            result = idea_to_drama(
                args.idea,
                style=args.style,
                target_duration=args.duration,
                shot_count=args.shots,
                title=args.title,
                provider=args.provider,
                max_repairs=args.max_repairs,
            )
    except BridgeError as exc:
        print(f"[bridge] FAILED: {exc}", file=sys.stderr)
        return 1

    script = result["director_script"]
    out = Path(args.output) if args.output else Path("work") / "director" / f"{result['slug']}.director.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(script, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    summary = {
        "title": script.get("title"),
        "source": result["source"],
        "shots": result["storyboard"]["director_meta"]["shot_count"],
        "duration_seconds": result["storyboard"]["director_meta"]["duration_seconds"],
        "repairs": result["repairs"],
        "director_script": str(out),
    }
    if args.storyboard_output:
        summary["storyboard"] = str(write_storyboard(result["storyboard"], args.storyboard_output))
    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    else:
        print(f"[bridge] {script.get('title')} — {summary['shots']} 镜 / {summary['duration_seconds']}s（{result['source']}）")
        for note in result["repairs"]:
            print(f"[bridge] {note}")
        print(f"[bridge] 导演分镜：{out}")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())