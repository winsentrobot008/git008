"""分镜组装管道（Storyboard Assembly Pipeline）。

输入：分镜 JSON（title / scenes / audio / 画幅），输出：可直接交给
HyperFrames 渲染的 HTML 工作区。管道由以下环节组成：

1. validate_storyboard  —— 契约校验（scenes 必填、类型白名单、时长归一）
2. compute_timeline    —— 逐镜计算 in/out 时间轴（默认每镜 3.5s）
3. stage_assets        —— 本地图片/视频/音频复制进工作区 assets/
4. assemble            —— 套用 templates/hyperframes/ 模板生成
                          index.html + hyperframes.json + DESIGN.md

分镜 JSON 契约（示例）：
{
  "title": "calorie-ai-hook",
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "scenes": [
    {"type": "hero_title", "text": "Snap a photo.", "subtitle": "Know your calories instantly.", "duration_s": 3},
    {"type": "image", "source": "assets/shot-1.png", "duration_s": 4},
    {"type": "video", "source": "assets/stock.mp4", "duration_s": 5},
    {"type": "composition", "source": "compositions/chart.html", "duration_s": 4}
  ],
  "audio": {
    "narration": [{"src": "work/voice.mp3", "start_seconds": 0, "end_seconds": 12.4}],
    "music": {"src": "assets/music.mp3", "volume": 0.25}
  }
}
"""

from __future__ import annotations

import json
import re
import shutil
import string
from pathlib import Path
from typing import Any, Optional

from src.core.paths import REPO_ROOT, TEMPLATES_DIR

from . import semantic_bridge

_SCENE_TYPES = {
    "hero_title",
    "text_card",
    "callout",
    "image",
    "video",
    "composition",
}

# 主题默认值：与 templates/hyperframes/index.html 的历史默认一致，
# 未提供 theme 的分镜保持原有深靛蓝 + 粉点缀视觉，不破坏存量渲染。
DEFAULT_THEME = {
    "bg": ["#1E1B4B", "#8B5CF6", "#EC4899"],
    "fg": "#FFFFFF",
    "accent": "#F472B6",
    "highlight": "#FACC15",
    "tag_bg": "#FACC15",
    "tag_fg": "#111111",
    "card_bg": "rgba(13, 10, 35, 0.78)",
    "card_border": "rgba(255, 255, 255, 0.18)",
}
_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
_VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v", ".mkv"}
_AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".aac", ".ogg"}


def slugify(title: str) -> str:
    """标题 → 文件系统安全 slug（小写、连字符）。"""
    value = str(title or "storyboard").strip().lower()
    value = re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "-", value).strip("-")
    return value or "storyboard"


def _fmt(v: float) -> str:
    return f"{float(v):.3f}".rstrip("0").rstrip(".")


def _escape_text(value: str) -> str:
    return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _escape_attr(value: str) -> str:
    return _escape_text(value).replace('"', "&quot;")


def _scene_type(scene: dict) -> str:
    stype = str(scene.get("type") or "hero_title").lower()
    if stype not in _SCENE_TYPES:
        raise ValueError(
            f"分镜场景类型不支持：{stype!r}（可选：{sorted(_SCENE_TYPES)}）"
        )
    return stype


def _normalize_style(scene: dict) -> dict:
    """规范化场景 style（排版/配色覆盖，供 HyperFrames 与 FFmpeg 预览共用）。"""
    raw = scene.get("style")
    if not isinstance(raw, dict):
        return {}
    style = {
        "kind": str(raw.get("kind") or "").lower(),
        "align": str(raw.get("align") or "center").lower(),
        "color": str(raw.get("color") or ""),
        "highlight": str(raw.get("highlight") or ""),
    }
    return {k: v for k, v in style.items() if v}


def _normalize_theme(data: dict) -> dict:
    """规范化顶层 theme（高 CTR 设计令牌），缺失字段用默认值补齐。"""
    raw = data.get("theme")
    if not isinstance(raw, dict):
        return dict(DEFAULT_THEME)
    theme = dict(DEFAULT_THEME)
    bg = raw.get("bg") or theme["bg"]
    if isinstance(bg, str):
        bg = [bg]
    if isinstance(bg, list) and bg:
        theme["bg"] = [str(c) for c in bg[:3] if str(c)]
    for key in ("fg", "accent", "highlight", "tag_bg", "tag_fg", "card_bg", "card_border"):
        if str(raw.get(key) or ""):
            theme[key] = str(raw[key])
    return theme


# ---------------------------------------------------------------------------
# Prompt Engine —— Beat 语义 → SD/Flux 绘图提示词
#
# SD-first 工作流的第一步：把每段文案的核心意图拆成「具象主语/动作 + 情绪基调 +
# 镜头语言 + 画质词 + 画幅」，交给本地 ComfyUI(RTX 3060) 逐镜生成专属概念图。
# 提示词只输出 ASCII（SD1.5 不识别中文），且逐镜唯一，避免整片复用同一张图。
# ---------------------------------------------------------------------------
_SD_QUALITY = (
    "photorealistic, cinematic lighting, 35mm lens, shallow depth of field, "
    "film grain, highly detailed"
)
_ASPECT_TAGS = {
    "square": "square 1:1 composition",
    "vertical": "vertical 9:16 composition",
    "wide": "widescreen 16:9 composition",
}
_MOVEMENT_TAGS = {
    "push_in": "close-up framing, shallow depth of field",
    "pull_out": "wide establishing framing, deep focus",
    "static": "symmetrical medium framing",
}


def aspect_tag(width: int, height: int) -> str:
    """画幅 → SD 提示词用的构图标签（1:1 / 9:16 / 16:9）。"""
    if int(width) == int(height):
        return _ASPECT_TAGS["square"]
    return _ASPECT_TAGS["vertical"] if int(height) > int(width) else _ASPECT_TAGS["wide"]


def _agent_reach_bridge():
    """惰性加载 scripts/agent_reach_bridge.py —— 情绪/行为语义词典的唯一来源。

    经 semantic_bridge 按文件路径加载：绝不把 scripts/ 插进 sys.path（否则
    scripts/server.py 会顶掉同名 server 包），失败即退到纯查询词提示词。
    """
    return semantic_bridge.load_bridge()


def sd_semantics(text: str, limit: int = 3, index: int = 0) -> dict:
    """文案 → {"subjects": [...], "mood": str, "triggers": [...]}（词典不可用返回 {}）。

    ``index`` 是该 Beat 的镜序：相邻 Beat 若共享同一情绪词（如都提到"焦虑"），
    镜序会让它们岔到不同的具象镜头，避免整片反复出现同一张画。
    """
    if not str(text or "").strip():
        return {}
    bridge = _agent_reach_bridge()
    if bridge is None:
        return {}
    try:
        return dict(bridge.semantic_prompt_parts(str(text), limit=limit, index=index))
    except Exception:  # noqa: BLE001
        return {}


def build_sd_prompt(
    text: str,
    *,
    subjects: Optional[list] = None,
    mood: str = "",
    movement: str = "",
    aspect: str = "",
    extra: str = "",
    index: int = 0,
) -> str:
    """Beat 语义 → SD/Flux 绘图 Prompt（Prompt Engine 主入口）。

    :param subjects: 具象主语/动作；缺省由文案的情绪/行为词典推导。
    :param mood: 情绪基调；缺省由文案推导，仍未命中则用默认基调。
    :param movement: 镜头运动（push_in / pull_out / static）→ 构图短语。
    :param aspect: 画幅构图标签（见 aspect_tag）。
    :param extra: 追加细节（如本镜专属实拍关键词）。
    :param index: 镜序；文案未给专属主语时用它把相邻 Beat 岔到不同的具象镜头。
    """
    parts = sd_semantics(text, index=index)
    # 具象主语一律过一遍抽象词黑名单：LLM/历史分镜给的 "code / keyboard / network"
    # 这类通用空镜词绝不能进 SD Prompt，否则每条视频都会长得一样、还和文案脱节。
    raw_subjects = subjects if subjects is not None else parts.get("subjects") or []
    candidate = [str(s).strip() for s in raw_subjects if str(s).strip()]
    bridge = _agent_reach_bridge()
    if bridge is not None:
        try:
            candidate = list(bridge.strip_abstract_visuals(candidate))
        except Exception:  # noqa: BLE001 - 词典异常退回语义推导
            candidate = []
    if not candidate:
        candidate = [str(s).strip() for s in (parts.get("subjects") or []) if str(s).strip()]
    subject_list: list[str] = []
    for item in candidate:
        if item and item not in subject_list:
            subject_list.append(item)
    segments: list[str] = []
    if subject_list:
        segments.append(", ".join(subject_list[:3]))
    # setting：把文案里的时空（凌晨两点 / 深夜 / 窗外）写进提示词，画面时空必须一致。
    setting = str(parts.get("setting") or "").strip()
    if setting:
        segments.append(setting)
    segments.append(str(mood or parts.get("mood") or "cinematic dramatic mood").strip())
    framing = _MOVEMENT_TAGS.get(str(movement or "").strip())
    if framing:
        segments.append(framing)
    if str(extra or "").strip():
        segments.append(str(extra).strip())
    segments.append(_SD_QUALITY)
    if str(aspect or "").strip():
        segments.append(str(aspect).strip())
    return ", ".join(part for part in segments if part)


def validate_storyboard(data: dict) -> dict:
    """校验分镜 JSON，返回规范化副本（含默认值）。"""
    if not isinstance(data, dict):
        raise ValueError("分镜必须是 JSON 对象")
    scenes = data.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise ValueError("分镜缺少 scenes 数组（至少 1 个场景）")

    width_hint = int(data.get("width") or 1080)
    height_hint = int(data.get("height") or 1920)
    normalized_scenes: list[dict] = []
    for i, scene in enumerate(scenes):
        if not isinstance(scene, dict):
            raise ValueError(f"scenes[{i}] 必须是对象")
        item = dict(scene)
        item["type"] = _scene_type(item)
        item["text"] = str(item.get("text") or item.get("title") or "")
        item["subtitle"] = str(item.get("subtitle") or item.get("caption") or "")
        item["source"] = str(item.get("source") or "")
        style = _normalize_style(item)
        if style:
            item["style"] = style
        else:
            item.pop("style", None)
        queries = item.get("asset_queries") or []
        if isinstance(queries, str):
            queries = [queries]
        item["asset_queries"] = [str(q).strip() for q in queries if str(q).strip()][:3]
        # Prompt Engine：SD-first 的绘图提示词，与本镜文案 Beat 语义强绑定。
        item["sd_prompt"] = str(item.get("sd_prompt") or "").strip() or build_sd_prompt(
            str(item.get("script_text") or item["text"] or ""),
            subjects=item["asset_queries"] or None,
            movement=str(item.get("camera_movement") or ""),
            aspect=aspect_tag(width_hint, height_hint),
            index=i,
        )
        overlay = item.get("overlay")
        if isinstance(overlay, dict):
            item["overlay"] = overlay
        else:
            item.pop("overlay", None)
        duration = float(item.get("duration_s") or item.get("duration_seconds") or 3.5)
        item["duration_s"] = max(0.5, duration)
        normalized_scenes.append(item)

    audio = data.get("audio") or {}
    narration = []
    for nar in audio.get("narration") or []:
        if not isinstance(nar, dict) or not nar.get("src"):
            continue
        narration.append(
            {
                "src": str(nar["src"]),
                "start_seconds": float(nar.get("start_seconds", 0) or 0),
                "end_seconds": float(nar.get("end_seconds", 0) or 0),
            }
        )
    music = audio.get("music")
    if isinstance(music, dict) and music.get("src"):
        music = {
            "src": str(music["src"]),
            "volume": float(music.get("volume", 0.25) or 0.25),
        }
    else:
        music = None

    width = int(data.get("width") or 1080)
    height = int(data.get("height") or 1920)
    fps = int(data.get("fps") or 30)
    return {
        "title": str(data.get("title") or "storyboard"),
        "product": str(data.get("product") or "calorie-ai"),
        "width": width,
        "height": height,
        "fps": max(1, fps),
        "theme": _normalize_theme(data),
        "scenes": normalized_scenes,
        "audio": {"narration": narration, "music": music},
        # 旁白脚本必须随校验副本一起下发：stage_narration 优先取 voice_script，
        # 一旦缺失就退化成朗读 scenes[].text（屏幕字幕），dialogue 会被静默丢弃。
        "voice_script": [
            dict(line) for line in (data.get("voice_script") or []) if isinstance(line, dict)
        ],
    }


def compute_timeline(scenes: list[dict]) -> list[dict]:
    """为每镜计算 in/out 秒（依次累加 duration_s）。"""
    timeline = []
    cursor = 0.0
    for scene in scenes:
        duration = float(scene["duration_s"])
        timeline.append({**scene, "in_seconds": cursor, "out_seconds": cursor + duration})
        cursor += duration
    return timeline


def _stage_source(source: str, assets_dir: Path) -> Optional[str]:
    """把本地资源复制进工作区 assets/，返回相对路径；网络/缺失资源返回原值。"""
    if not source:
        return None
    if re.match(r"^https?://", source, re.IGNORECASE):
        return source
    path = Path(source)
    if not path.is_absolute():
        candidate = REPO_ROOT / source
        if candidate.exists():
            path = candidate
    if not path.exists():
        return source
    assets_dir.mkdir(parents=True, exist_ok=True)
    target = assets_dir / path.name
    if not target.exists():
        shutil.copy2(path, target)
    return f"assets/{target.name}"


def _scene_to_html(
    index: int,
    scene: dict,
    *,
    width: int,
    height: int,
    assets_dir: Path,
    scene_template: string.Template,
) -> tuple[str, Optional[str]]:
    """渲染单个分镜 → (HTML 片段, GSAP 入场 tween 或 None)。"""
    cut_id = f"cut-{index}"
    in_s = float(scene["in_seconds"])
    out_s = float(scene["out_seconds"])
    duration = max(0.1, out_s - in_s)
    stype = scene["type"]
    source = _stage_source(scene["source"], assets_dir) if scene["source"] else ""
    text = scene["text"]
    subtitle = scene["subtitle"]
    style = scene.get("style") or {}
    style_kind = style.get("kind") or "default"
    style_align = style.get("align") or "center"
    style_class = f"style-{style_kind}" if style_kind and style_kind != "default" else ""
    tag = ""
    if style.get("highlight"):
        tag = (
            f'<div class="highlight-tag">{_escape_text(str(style["highlight"]))}</div>'
        )

    if stype in {"hero_title", "text_card", "callout"} or (not source and text):
        html = scene_template.substitute(
            id=cut_id,
            style_class=style_class,
            style_kind=style_kind,
            style_align=style_align,
            start=_fmt(in_s),
            duration=_fmt(duration),
            text=_escape_text(text or f"Scene {index + 1}"),
            tag=tag,
            subtitle=(
                f'<div class="subtitle">{_escape_text(subtitle)}</div>'
                if subtitle
                else ""
            ),
        )
        tween = (
            f'tl.from("#{cut_id} h1", {{ y: 40, opacity: 0, duration: 0.6, '
            f'ease: "power3.out" }}, {_fmt(in_s + 0.1)});'
        )
        return html, tween

    ext = Path(source).suffix.lower() if source else ""
    if stype == "image" and ext in _IMAGE_EXTENSIONS:
        html = (
            f'<img id="{cut_id}" class="clip image-clip" '
            f'src="{_escape_attr(source)}" '
            f'data-start="{_fmt(in_s)}" data-duration="{_fmt(duration)}" '
            f'data-track-index="1" alt="">'
        )
        # Ken Burns：淡入后缓慢平移缩放（图像场景的动效升级）
        kb_duration = max(0.3, duration - 0.7)
        tweens = [
            (
                f'tl.from("#{cut_id}", {{ x: -24, scale: 1.16, opacity: 0, '
                f'duration: 0.7, ease: "power2.out" }}, {_fmt(in_s)});'
            ),
            (
                f'tl.to("#{cut_id}", {{ x: 12, scale: 1.02, duration: {_fmt(kb_duration)}, '
                f'ease: "none" }}, {_fmt(in_s + 0.7)});'
            ),
        ]
        return html, "\n      ".join(tweens)

    if stype == "video" and ext in _VIDEO_EXTENSIONS:
        html = (
            f'<video id="{cut_id}" class="clip video-clip" '
            f'src="{_escape_attr(source)}" '
            f'data-start="{_fmt(in_s)}" data-duration="{_fmt(duration)}" '
            f'data-track-index="1" muted playsinline></video>'
        )
        return html, None

    if stype == "composition" and ext == ".html":
        composition_id = Path(source).stem
        html = (
            f'<div id="{cut_id}" class="clip composition-clip" '
            f'data-composition-id="{_escape_attr(composition_id)}" '
            f'data-composition-src="{_escape_attr(source)}" '
            f'data-start="{_fmt(in_s)}" data-duration="{_fmt(duration)}" '
            f'data-width="{width}" data-height="{height}" '
            f'data-track-index="1"></div>'
        )
        return html, None

    # 未知形状 → 占位文字卡，保证渲染不中断（lint/validate 会暴露问题）
    placeholder = text or scene.get("reason") or f"Scene {index + 1}"
    html = (
        f'<div id="{cut_id}" class="clip text-card" '
        f'data-start="{_fmt(in_s)}" data-duration="{_fmt(duration)}" '
        f'data-track-index="1"><h1>{_escape_text(placeholder)}</h1></div>'
    )
    return html, None


def _overlay_html(overlay: Optional[dict]) -> str:
    """结构化 overlay → HTML（营养卡 / App Store 徽章）。"""
    if not isinstance(overlay, dict):
        return ""
    kind = str(overlay.get("kind") or "")
    if kind == "nutrition":
        title = _escape_text(str(overlay.get("title") or "Nutrition"))
        rows = overlay.get("rows") or []
        row_html = "".join(
            (
                '<div class="nutrition-row">'
                f'<span>{_escape_text(str(row.get("label") or ""))}</span>'
                f'<b>{_escape_text(str(row.get("value") or ""))}</b>'
                "</div>"
            )
            for row in rows
            if isinstance(row, dict)
        )
        return (
            '<div class="overlay-card nutrition-card">'
            f'<div class="overlay-title">{title}</div>'
            f"{row_html}"
            "</div>"
        )
    if kind == "badge":
        text = _escape_text(str(overlay.get("text") or "Download on the App Store"))
        return f'<div class="appstore-badge">{text}</div>'
    return ""


def _audio_html(
    audio: dict,
    *,
    total_duration: float,
    assets_dir: Path,
) -> str:
    """旁白 + 音乐音轨的 <audio> 片段。"""
    chunks: list[str] = []
    for j, nar in enumerate(audio.get("narration") or []):
        src = _stage_source(nar["src"], assets_dir)
        if not src:
            continue
        start = float(nar.get("start_seconds", 0) or 0)
        end = float(nar.get("end_seconds", 0) or 0)
        duration = (end - start) if end > start else max(0.0, total_duration - start)
        chunks.append(
            f'<audio id="nar-{j}" data-start="{_fmt(start)}" '
            f'data-duration="{_fmt(duration)}" data-track-index="2" '
            f'src="{_escape_attr(src)}" data-volume="1"></audio>'
        )
    music = audio.get("music")
    if isinstance(music, dict):
        src = _stage_source(music["src"], assets_dir)
        if src:
            chunks.append(
                f'<audio id="music" data-start="0" '
                f'data-duration="{_fmt(total_duration)}" data-track-index="3" '
                f'src="{_escape_attr(src)}" '
                f'data-volume="{_fmt(float(music.get("volume", 0.25) or 0.25))}"></audio>'
            )
    return "\n    ".join(chunks)


def assemble(
    storyboard_data: dict,
    *,
    workspace: Path,
    templates_dir: Optional[Path] = None,
    width: Optional[int] = None,
    height: Optional[int] = None,
    fps: Optional[int] = None,
    title: Optional[str] = None,
) -> dict:
    """分镜 → HyperFrames 工作区（index.html + hyperframes.json + DESIGN.md）。"""
    normalized = validate_storyboard(storyboard_data)
    if width:
        normalized["width"] = int(width)
    if height:
        normalized["height"] = int(height)
    if fps:
        normalized["fps"] = int(fps)
    if title:
        normalized["title"] = str(title)

    workspace = Path(workspace)
    workspace.mkdir(parents=True, exist_ok=True)
    assets_dir = workspace / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    compositions_dir = workspace / "compositions"
    compositions_dir.mkdir(parents=True, exist_ok=True)

    timeline = compute_timeline(normalized["scenes"])
    total_duration = timeline[-1]["out_seconds"] if timeline else 0.0
    tpl_dir = Path(templates_dir or (TEMPLATES_DIR / "hyperframes"))
    index_tpl = string.Template((tpl_dir / "index.html").read_text(encoding="utf-8"))
    scene_tpl = string.Template((tpl_dir / "scene.html").read_text(encoding="utf-8"))

    scenes_html: list[str] = []
    tweens: list[str] = []
    for i, scene in enumerate(timeline):
        html, tween = _scene_to_html(
            i,
            scene,
            width=normalized["width"],
            height=normalized["height"],
            assets_dir=assets_dir,
            scene_template=scene_tpl,
        )
        overlay_html = _overlay_html(scene.get("overlay"))
        if overlay_html:
            html += "\n    " + overlay_html
        scenes_html.append(html)
        if tween:
            tweens.append(tween)

    audio_html = _audio_html(
        normalized["audio"],
        total_duration=total_duration,
        assets_dir=assets_dir,
    )

    theme = normalized.get("theme") or {}
    bg = theme.get("bg") or ["#1E1B4B"]
    css_vars = {
        "--color-bg": bg[0] if bg else "#1E1B4B",
        "--color-fg": theme.get("fg") or "#FFFFFF",
        "--color-accent": theme.get("accent") or "#F472B6",
        "--color-highlight": theme.get("highlight") or "#FACC15",
        "--color-tag-bg": theme.get("tag_bg") or "#FACC15",
        "--color-tag-fg": theme.get("tag_fg") or "#111111",
        "--color-card-bg": theme.get("card_bg") or "rgba(13, 10, 35, 0.78)",
        "--color-card-border": theme.get("card_border") or "rgba(255, 255, 255, 0.18)",
        "--font-heading": "Inter, system-ui, sans-serif",
        "--font-body": "Inter, system-ui, sans-serif",
    }
    vars_css = "\n      ".join(f"{k}: {v};" for k, v in css_vars.items())
    tween_block = "\n      ".join(tweens) if tweens else "// no tweens"

    index_html = index_tpl.substitute(
        title=_escape_text(normalized["title"]),
        width=normalized["width"],
        height=normalized["height"],
        duration=_fmt(total_duration),
        vars_css=vars_css,
        scenes="\n    ".join(scenes_html),
        audio=audio_html,
        tweens=tween_block,
    )
    (workspace / "index.html").write_text(index_html, encoding="utf-8")

    # hyperframes.json（registry 配置）
    hf_json = tpl_dir / "hyperframes.json"
    if hf_json.exists():
        (workspace / "hyperframes.json").write_text(
            hf_json.read_text(encoding="utf-8"), encoding="utf-8"
        )
    else:
        (workspace / "hyperframes.json").write_text(
            json.dumps(
                {
                    "registry": "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
                    "compositions": ["index.html"],
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    (workspace / "DESIGN.md").write_text(
        "# DESIGN\n\n"
        f"Generated by GIT008 modules/video_factory storyboard pipeline.\n\n"
        f"- Title: `{normalized['title']}`\n"
        f"- Canvas: `{normalized['width']}x{normalized['height']} @ {normalized['fps']}fps`\n"
        f"- Scenes: {len(timeline)}\n"
        f"- Duration: {_fmt(total_duration)}s\n"
        f"- Background: `{css_vars['--color-bg']}`\n"
        f"- Foreground: `{css_vars['--color-fg']}`\n"
        f"- Accent: `{css_vars['--color-accent']}`\n"
        f"- Highlight: `{css_vars['--color-highlight']}`\n",
        encoding="utf-8",
    )

    return {
        "workspace": str(workspace),
        "index_html": str(workspace / "index.html"),
        "scenes": len(timeline),
        "duration_seconds": total_duration,
        "width": normalized["width"],
        "height": normalized["height"],
        "fps": normalized["fps"],
    }


def resolve_media_for_storyboard(
    storyboard_data: dict,
    *,
    cache_dir: Optional[Path] = None,
    use_network: bool = True,
    allow_video: bool = False,
) -> dict:
    """为缺少 source 的分镜按媒体策略填装素材（改写副本，返回副本）。

    SD-first 策略：默认 ``allow_video=False`` —— 只允许静图（本地 SD 概念图或具象
    强相关图片），严格禁止通用视频切片。
    """
    from . import media

    normalized = validate_storyboard(storyboard_data)
    used: set = set()
    for scene in normalized["scenes"]:
        if scene.get("source"):
            used.add(str(scene["source"]))
            continue
        outcome = media.resolve_scene_media_ex(
            scene,
            cache_dir=cache_dir,
            use_network=use_network,
            allow_cache_reuse=False,
            exclude=used,
            allow_video=allow_video,
        )
        scene["_media_reason"] = outcome.get("reason")
        scene["_media_diagnostics"] = outcome.get("diagnostics")
        hit = outcome.get("hit")
        if hit:
            scene["source"] = hit["source"]
            scene["_media_kind"] = hit["kind"]
            scene["_media_via"] = hit["via"]
            used.add(str(hit["source"]))
    return normalized


__all__ = [
    "validate_storyboard",
    "compute_timeline",
    "assemble",
    "slugify",
    "resolve_media_for_storyboard",
    "validate_storyboard",
    "build_sd_prompt",
    "sd_semantics",
    "aspect_tag",
]
