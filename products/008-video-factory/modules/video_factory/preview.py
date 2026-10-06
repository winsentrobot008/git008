"""FFmpeg 低清预览渲染器（storyboard → mp4，快迭代）。

与 HyperFrames（HTML/GSAP）高质量路径互补：`--preview` 走本模块，
纯本地 FFmpeg 出片，秒级迭代。能力对齐分镜契约：

- 视频素材：9:16 中心裁切（经 src/core/ffmpeg.py 探测）后缩放目标画幅；
- 图片素材：Ken Burns 平移缩放（zoompan）；
- 无素材：ComfyUI 文生图补帧（staging 阶段）→ lavfi 品牌渐变背景兜底；
- 文字卡：drawtext 大标题 / 副标题；
- overlay：营养卡（Instant Macros + P/F/C 行）、App Store 徽章。
"""

from __future__ import annotations

import logging
import re
import shutil
import unicodedata
from pathlib import Path
from typing import Optional

from src.core import ffmpeg
from src.core.inspector import inspect_video
from src.core.paths import OUTPUT_DIR, WORK_DIR

from . import media, storyboard

logger = logging.getLogger(__name__)

_FONT_BOLD = "font_bold.ttf"
_FONT_REGULAR = "font_regular.ttf"
# drawtext 不会自动做 CJK 字形回退：字体一旦没有汉字，就渲染成 tofu 方框（□□□□）。
# 因此这里按「中文 → 拉丁」顺序探测候选字体，命中者被复制进工作目录，
# drawtext 用相对文件名引用（规避盘符冒号在 filter 语法里的歧义，见 _stage_fonts）。
_FONT_SOURCES = {
    _FONT_BOLD: [
        "C:/Windows/Fonts/msyhbd.ttc",   # 微软雅黑 Bold
        "C:/Windows/Fonts/msyh.ttc",     # 微软雅黑
        "C:/Windows/Fonts/simhei.ttf",   # 黑体
        "C:/Windows/Fonts/simsun.ttc",   # 宋体
        "C:/Windows/Fonts/arialbd.ttf",  # 纯拉丁：最后兜底（无 CJK）
        "C:/Windows/Fonts/segoeuib.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        "/System/Library/Fonts/PingFang.ttc",
    ],
    _FONT_REGULAR: [
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/System/Library/Fonts/PingFang.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
}
_TITLE_SCALE = 110.0   # 1080x1920 基准字号
_SUBTITLE_SCALE = 54.0
_TAG_SCALE = 48.0
_NUTRITION_TITLE_SCALE = 44.0
_NUTRITION_ROW_SCALE = 38.0
_BADGE_SCALE = 42.0


def _hex(value: str) -> str:
    """'#RRGGBB' / 'RRGGBB' → drawtext 可用的 '0xRRGGBB'。"""
    text = str(value or "").strip().lstrip("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    if len(text) != 6:
        return "0xFFFFFF"
    return "0x" + text.upper()


def _filter_text(value: str) -> str:
    """转义 drawtext 文本内容中的特殊字符（冒号/百分号）。"""
    return str(value).replace("\\", "\\\\").replace(":", "\\:").replace("%", "%%")


def _is_wide_char(ch: str) -> bool:
    """全角字符（CJK / 假名 / 全角标点）判定：drawtext 下约占 1 em 宽。"""
    return unicodedata.east_asian_width(ch) in ("W", "F")


def _glyph_width(ch: str, fontsize: float) -> float:
    """单字符宽度估算：全角 ≈ 1.0 em，拉丁等窄字符 ≈ 0.62 em，空格更窄。"""
    if ch.isspace():
        return fontsize * 0.35
    return fontsize if _is_wide_char(ch) else fontsize * 0.62


def _wrap_units(raw: str) -> list[tuple[str, bool]]:
    """切成断行单元 (unit, is_word)：含全角的串逐字可断，拉丁词保持整体。"""
    units: list[tuple[str, bool]] = []
    for chunk in re.findall(r"\s+|\S+", raw):
        if chunk.isspace():
            continue
        if any(_is_wide_char(ch) for ch in chunk):
            units.extend((ch, False) for ch in chunk)
        else:
            units.append((chunk, True))
    return units


def _break_word(word: str, *, fontsize: float, max_width: float) -> list[str]:
    """把放不下的长词按字硬切成多段，保证每段都不超宽。"""
    pieces: list[str] = []
    current = ""
    current_w = 0.0
    for ch in word:
        width = _glyph_width(ch, fontsize)
        if current and current_w + width > max_width:
            pieces.append(current)
            current, current_w = "", 0.0
        current += ch
        current_w += width
    if current:
        pieces.append(current)
    return pieces


def _wrap_line(raw: str, *, fontsize: float, max_width: float) -> list[str]:
    """贪心折行：优先在可断点换行，仅当单个词自身超宽时才硬切。"""
    lines: list[str] = []
    current = ""
    current_w = 0.0
    for unit, is_word in _wrap_units(raw):
        prefix = " " if (is_word and current) else ""
        prefix_w = _glyph_width(" ", fontsize) if prefix else 0.0
        unit_w = sum(_glyph_width(ch, fontsize) for ch in unit)
        if current and current_w + prefix_w + unit_w > max_width:
            lines.append(current)
            current, current_w, prefix, prefix_w = "", 0.0, "", 0.0
        if prefix_w + unit_w > max_width and len(unit) > 1:
            pieces = _break_word(unit, fontsize=fontsize, max_width=max_width)
            lines.extend(pieces[:-1])
            current = pieces[-1]
            current_w = sum(_glyph_width(ch, fontsize) for ch in current)
            continue
        current += prefix + unit
        current_w += prefix_w + unit_w
    if current:
        lines.append(current)
    return lines


def _wrap_text(value: str, *, fontsize: int, max_width: int) -> str:
    """按估算宽度折行（drawtext 无内置换行）。

    拉丁文本按词断行；中文没有空格，整句会被当成单个 token 而永不换行，
    因此含全角字符时按字断行，确保长标题不会横向溢出画面。
    """
    text = str(value)
    if not text or max_width <= 0:
        return text
    wrapped: list[str] = []
    for raw in text.splitlines() or [text]:
        if not raw.strip():
            wrapped.append("")
            continue
        wrapped.extend(_wrap_line(raw, fontsize=fontsize, max_width=max_width))
    return "\n".join(wrapped)


def _stage_fonts(workdir: Path) -> None:
    """把系统字体复制进工作目录，drawtext 用相对路径规避盘符冒号。"""
    for target_name, candidates in _FONT_SOURCES.items():
        for candidate in candidates:
            src = Path(candidate)
            if src.exists():
                shutil.copy2(src, workdir / target_name)
                break


def _drawtext(
    textfile: str,
    *,
    fontsize: int,
    fontcolor: str = "white",
    x: str = "(w-text_w)/2",
    y: str = "0",
    box: bool = False,
    boxcolor: str = "black@0.38",
    fontfile: str = _FONT_BOLD,
    borderw: int = 0,
    bordercolor: str = "0x000000",
    line_spacing: int = 8,
) -> str:
    parts = [
        f"drawtext=fontfile={fontfile}",
        f"textfile={textfile}",
        f"fontsize={fontsize}",
        f"fontcolor={fontcolor}",
        f"x={x}",
        f"y={y}",
    ]
    if box:
        parts.append("box=1")
        parts.append(f"boxcolor={boxcolor}")
        parts.append("boxborderw=18")
    if borderw > 0:
        parts.append(f"borderw={borderw}")
        parts.append(f"bordercolor={bordercolor}")
    parts.append(f"line_spacing={line_spacing}")
    return ":".join(parts)


def _write_text(workdir: Path, name: str, lines: list[str]) -> str:
    target = workdir / name
    target.write_text("\n".join(str(x) for x in lines if str(x)), encoding="utf-8")
    return name


def _crop_filter(src_w: int, src_h: int, width: int, height: int) -> str:
    """按目标画幅中心裁切后缩放（与 src/core/ffmpeg.py compose_vertical 同策略）。

    1:1 目标改用 ffmpeg 表达式 min(iw,ih)：无论输入是 16:9 还是 9:16，都取短边
    居中裁成正方形（crop 默认居中），因此不会拉伸变形；随后的 scale 把边长
    归一到目标分辨率。
    """
    if width == height:
        side = "min(iw,ih)"
        return f"crop='{side}':'{side}',scale={width}:{height},setsar=1"
    target_ratio = width / height
    src_ratio = src_w / src_h
    if target_ratio > src_ratio:
        crop_w = src_w
        crop_h = int(src_w / target_ratio)
    else:
        crop_h = src_h
        crop_w = int(src_h * target_ratio)
    crop_w -= crop_w % 2
    crop_h -= crop_h % 2
    crop_x = (src_w - crop_w) // 2
    crop_y = (src_h - crop_h) // 2
    return f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale={width}:{height},setsar=1"


def _scene_text_layers(
    scene: dict,
    workdir: Path,
    index: int,
    *,
    width: int,
    height: int,
    theme: Optional[dict] = None,
) -> list[str]:
    """生成场景文字叠加滤镜链（大标题 / 副标题 / overlay 卡）。"""
    theme = theme or {}
    scale = height / 1920
    layers: list[str] = []
    title = str(scene.get("text") or "").strip()
    subtitle = str(scene.get("subtitle") or "").strip()
    has_media = bool(scene.get("source"))
    style = scene.get("style") or {}
    highlight = str(style.get("highlight") or "").strip()
    title_color = _hex(style.get("color") or theme.get("fg") or "#FFFFFF")
    align = str(style.get("align") or "center")
    title_x = "(w-text_w)/2" if align != "left" else "w*0.1"
    tag_size = max(22, round(_TAG_SCALE * scale))
    max_title_width = max(120, round(width * 0.85))

    if title:
        title_size = max(28, round(_TITLE_SCALE * scale))
        name = _write_text(
            workdir,
            f"scene_{index:03d}_title.txt",
            [_filter_text(_wrap_text(title, fontsize=title_size, max_width=max_title_width))],
        )
        base_y = "h*0.30" if has_media else "h*0.36"
        if highlight:
            tag_name = _write_text(
                workdir, f"scene_{index:03d}_tag.txt", [_filter_text(highlight)]
            )
            tag_y = f"{base_y}-{max(28, round(tag_size * 1.5))}"
            layers.append(
                _drawtext(
                    tag_name,
                    fontsize=tag_size,
                    fontcolor=_hex(theme.get("tag_fg") or "#111111"),
                    x=title_x,
                    y=tag_y,
                    box=True,
                    boxcolor=f"0x{str(theme.get('tag_bg') or '#FACC15').lstrip('#').upper()}",
                    fontfile=_FONT_BOLD,
                )
            )
            title_y = base_y
        else:
            title_y = base_y
        layers.append(
            _drawtext(
                name,
                fontsize=title_size,
                fontcolor=title_color,
                x=title_x,
                y=title_y,
                box=has_media,
            )
        )
        if subtitle:
            sub_size = max(18, round(_SUBTITLE_SCALE * scale))
            name = _write_text(
                workdir,
                f"scene_{index:03d}_subtitle.txt",
                [_filter_text(_wrap_text(subtitle, fontsize=sub_size, max_width=max_title_width))],
            )
            sub_y = f"{title_y}+{max(24, round(_SUBTITLE_SCALE * scale))}+{max(14, round(30 * scale))}"
            layers.append(
                _drawtext(
                    name,
                    fontsize=sub_size,
                    fontcolor=_hex(theme.get("accent") or "#F472B6"),
                    x=title_x,
                    y=sub_y,
                )
            )

    overlay = scene.get("overlay") or {}
    kind = str(overlay.get("kind") or "")
    if kind == "nutrition":
        n_title = str(overlay.get("title") or "Instant Macros")
        rows = [r for r in (overlay.get("rows") or []) if isinstance(r, dict)]
        n_name = _write_text(
            workdir, f"scene_{index:03d}_nutrition_title.txt", [_filter_text(n_title)]
        )
        n_y = f"h*0.62"
        layers.append(
            _drawtext(
                n_name,
                fontsize=max(20, round(_NUTRITION_TITLE_SCALE * scale)),
                fontcolor=_hex(theme.get("accent") or "#F472B6"),
                y=n_y,
                box=True,
            )
        )
        row_size = max(18, round(_NUTRITION_ROW_SCALE * scale))
        value_color = _hex(theme.get("highlight") or "#FACC15")
        row_w = max(200, round(width * 0.62))
        value_x = f"(w-text_w)/2+{row_w // 2}"
        for i, row in enumerate(rows[:3]):
            label = str(row.get("label") or "")
            value = str(row.get("value") or "")
            r_y = f"{n_y}+{max(24, round(_NUTRITION_TITLE_SCALE * scale))}+{i * (row_size + max(10, round(18 * scale)))}"
            if label:
                l_name = _write_text(
                    workdir, f"scene_{index:03d}_row_{i}_label.txt", [_filter_text(label)]
                )
                layers.append(
                    _drawtext(
                        l_name,
                        fontsize=row_size,
                        y=r_y,
                        box=True,
                        fontfile=_FONT_REGULAR,
                    )
                )
            if value:
                v_name = _write_text(
                    workdir, f"scene_{index:03d}_row_{i}_value.txt", [_filter_text(value)]
                )
                layers.append(
                    _drawtext(
                        v_name,
                        fontsize=row_size,
                        fontcolor=value_color,
                        x=value_x,
                        y=r_y,
                        box=True,
                        fontfile=_FONT_BOLD,
                    )
                )
    elif kind == "badge":
        badge = str(overlay.get("text") or "Download on the App Store")
        b_name = _write_text(
            workdir, f"scene_{index:03d}_badge.txt", [_filter_text(badge)]
        )
        layers.append(
            _drawtext(
                b_name,
                fontsize=max(20, round(_BADGE_SCALE * scale)),
                fontcolor="0xFFFFFF",
                y=f"h-{max(56, round(130 * scale))}",
                box=True,
                boxcolor="0x000000",
                borderw=3,
                bordercolor="0xFFFFFF",
            )
        )
    return layers


def _scene_segment(
    scene: dict,
    index: int,
    *,
    workdir: Path,
    width: int,
    height: int,
    fps: int,
    theme: Optional[dict] = None,
) -> Path:
    duration = float(scene["duration_s"])
    source = scene.get("source") or ""
    kind = scene.get("_media_kind") or ""
    out = workdir / f"seg_{index:03d}.mp4"
    frames = max(1, round(duration * fps))

    text_layers = _scene_text_layers(
        scene, workdir, index, width=width, height=height, theme=theme
    )
    vf_extra = ",".join(text_layers)

    src_path = Path(source) if source else None
    if kind == "video" and src_path and src_path.exists():
        src_w, src_h = ffmpeg.probe_size(src_path)
        vf = _crop_filter(src_w, src_h, width, height)
        if vf_extra:
            vf += "," + vf_extra
        ffmpeg.run(
            "ffmpeg",
            [
                "-y",
                "-stream_loop", "-1",
                "-i", str(src_path),
                "-t", f"{duration:.3f}",
                "-vf", vf,
                "-r", str(fps),
                "-frames:v", str(frames),
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24",
                "-pix_fmt", "yuv420p", "-an",
                str(out),
            ],
            timeout=600,
            cwd=str(workdir),
        )
        return out

    if kind == "image" and src_path and src_path.exists():
        # Ken Burns：放大到 2x 画幅后 zoompan 平移缩放
        canvas_w = width * 2
        canvas_h = height * 2
        vf = (
            f"scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=increase,"
            f"crop={canvas_w}:{canvas_h},"
            f"zoompan=z='min(zoom+0.0012,1.12)':d={frames}:"
            f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={width}x{height}:fps={fps}"
        )
        if vf_extra:
            vf += "," + vf_extra
        ffmpeg.run(
            "ffmpeg",
            [
                "-y",
                "-loop", "1",
                "-i", str(src_path),
                "-t", f"{duration:.3f}",
                "-vf", vf,
                "-r", str(fps),
                "-frames:v", str(frames),
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24",
                "-pix_fmt", "yuv420p", "-an",
                str(out),
            ],
            timeout=600,
            cwd=str(workdir),
        )
        return out

    # 无素材：品牌渐变背景 + 文字
    theme = theme or {}
    bg = theme.get("bg") or ["#1E1B4B", "#8B5CF6", "#EC4899"]
    defaults = ["1E1B4B", "8B5CF6", "EC4899"]
    colors = [str(c).lstrip("#") for c in bg[:3]]
    while len(colors) < 3:
        colors.append(defaults[len(colors)])
    c0, c1, c2 = colors
    vf = vf_extra or "null"
    ffmpeg.run(
        "ffmpeg",
        [
            "-y",
            "-f", "lavfi",
            "-i", f"gradients=s={width}x{height}:d={duration:.3f}:c0=0x{c0}:c1=0x{c1}:c2=0x{c2}:x0=0:y0=0:x1={width}:y1={height}",
            "-t", f"{duration:.3f}",
            "-vf", vf,
            "-r", str(fps),
            "-frames:v", str(frames),
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24",
            "-pix_fmt", "yuv420p", "-an",
            str(out),
            ],
            timeout=600,
            cwd=str(workdir),
        )
    return out




def _mux_narration(video: Path, audio: Path, out: Path) -> None:
    """把 Edge-TTS 旁白音轨混入无声预览（视频流直拷，只转音频）。"""
    ffmpeg.run(
        "ffmpeg",
        [
            "-y",
            "-i", str(video),
            "-i", str(audio),
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "128k",
            "-shortest",
            "-movflags", "+faststart",
            str(out),
        ],
        timeout=300,
    )


def _resolve_narration(sb: dict, narration_path: Optional[Path]) -> Optional[Path]:
    """显式参数优先；否则取 audio.narration[0].src（存在且非空才启用）。"""
    candidate: Optional[Path] = Path(narration_path) if narration_path else None
    if candidate is None:
        for raw in (sb.get("audio") or {}).get("narration") or []:
            if isinstance(raw, dict) and raw.get("src"):
                candidate = Path(str(raw["src"]))
                break
    if candidate and candidate.exists() and candidate.stat().st_size > 0:
        return candidate
    return None

def render_preview(
    storyboard_data: dict,
    *,
    output_path: Optional[Path] = None,
    width: int = 480,
    height: int = 854,
    fps: int = 24,
    cache_dir: Optional[Path] = None,
    use_network: bool = True,
    inspect: bool = True,
    narration_path: Optional[Path] = None,
) -> dict:
    """分镜 → 低清预览 MP4（纯 FFmpeg，网络媒体可用时先抓取）。"""
    sb = storyboard.resolve_media_for_storyboard(
        storyboard_data,
        cache_dir=cache_dir,
        use_network=use_network,
    )
    theme = sb.get("theme") or {}
    narration = _resolve_narration(sb, narration_path)
    slug = storyboard.slugify(sb.get("title") or "storyboard")
    workdir = WORK_DIR / "preview" / slug
    workdir.mkdir(parents=True, exist_ok=True)
    _stage_fonts(workdir)

    segments: list[Path] = []
    render_diagnostics: list[dict] = []
    for i, scene in enumerate(sb["scenes"]):
        if scene.get("source"):
            print(
                f"[media] scene {i + 1} <- {scene.get('_media_via') or 'preset'} "
                f"({scene.get('_media_kind')}): {Path(scene['source']).name}"
            )
        else:
            detail = scene.get("_media_diagnostics")
            reason = str(scene.get("_media_reason") or "no_stock_match")
            # 无素材兜底分支：把「为什么没用上真实素材」写清楚，避免只看到一片纯渐变。
            logger.warning(
                "[media] scene %d 回退品牌渐变背景：reason=%s queries=%s",
                i + 1,
                reason,
                detail.get("queries") if isinstance(detail, dict) else None,
            )
            render_diagnostics.append(
                {"index": i, "reason": reason, "diagnostics": detail}
            )
        seg = _scene_segment(
            scene,
            i,
            workdir=workdir,
            width=width,
            height=height,
            fps=fps,
            theme=theme,
        )
        segments.append(seg)

    staged = Path(output_path or WORK_DIR / "preview" / slug / f"{slug}_{width}x{height}_preview.mp4")
    staged.parent.mkdir(parents=True, exist_ok=True)
    concat_out = workdir / f"{slug}_concat.mp4" if narration else staged
    concat_file = workdir / "concat.txt"
    concat_file.write_text(
        "".join(f"file '{p.name}'\n" for p in segments),
        encoding="utf-8",
    )
    ffmpeg.run(
        "ffmpeg",
        [
            "-y",
            "-f", "concat", "-safe", "0",
            "-i", str(concat_file),
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
            "-pix_fmt", "yuv420p", "-r", str(fps),
            "-movflags", "+faststart",
            str(concat_out),
        ],
        timeout=900,
        cwd=str(workdir),
    )
    if narration:
        _mux_narration(concat_out, narration, staged)
    duration = ffmpeg.probe_duration(staged)
    codec = ffmpeg.probe_codec(staged)
    size_mb = round(staged.stat().st_size / 1024 / 1024, 2)

    inspection = None
    if inspect:
        qc_kwargs: dict = {"require_audio": False}  # 默认无声合成，仅断言画面质量
        if narration:
            # 带旁白的草稿：断言音轨存在与音画同步；静音断层门禁留给高清成片复核
            qc_kwargs = {
                "require_audio": True,
                "check_silence": max(width, height) >= 1080,
            }
        inspection = inspect_video(
            staged,
            expected={"width": width, "height": height, "fps": fps},
            quarantine=False,
            **qc_kwargs,
        )
        if not inspection["ok"]:
            raise RuntimeError(
                f"分镜预览质检未通过，已拦截：{inspection['issues']}"
            )
        out = Path(output_path or OUTPUT_DIR / f"{slug}_{width}x{height}_preview.mp4")
        out.parent.mkdir(parents=True, exist_ok=True)
        if out.resolve() != staged.resolve():
            shutil.copy2(staged, out)  # output_path 已指向成片时无需自拷
    else:
        out = staged

    return {
        "ok": True,
        "output": str(out),
        "staged": str(staged),
        "duration_seconds": duration,
        "codec": codec,
        "resolution": f"{width}x{height}",
        "fps": fps,
        "size_mb": size_mb,
        "scenes": len(segments),
        "narration_track": str(narration) if narration else None,
        "render_diagnostics": render_diagnostics,
        "inspector": inspection,
    }


def render_cover(
    video_path: Path,
    *,
    output_path: Path,
    offset_s: float = 0.5,
) -> dict:
    """从成片抽取封面帧（默认第 0.5s，Hook 开场卡）。"""
    video_path = Path(video_path)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    if not video_path.exists():
        raise RuntimeError(f"render_cover: 视频缺失 {video_path}")
    ffmpeg.run(
        "ffmpeg",
        [
            "-y",
            "-ss", f"{max(0.0, float(offset_s)):.3f}",
            "-i", str(video_path),
            "-frames:v", "1",
            "-q:v", "2",
            str(out),
        ],
        timeout=120,
    )
    if not out.exists():
        raise RuntimeError(f"render_cover: 输出缺失 {out}")
    return {
        "ok": True,
        "output": str(out),
        "offset_s": max(0.0, float(offset_s)),
        "size_mb": round(out.stat().st_size / 1024 / 1024, 3),
    }


__all__ = ["render_preview", "render_cover"]
