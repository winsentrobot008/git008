"""GIT008 工厂 FFmpeg 工具层。

封装 008-video-factory（Node）与 RoastBro 沉淀的 FFmpeg 命令，供
modules/video_factory 直接复用：

- ffprobe：尺寸 / 时长 / 编码探测
- compose_vertical：1:1 或 9:16 中心裁切 + 字幕烧录 + 音视频合成
- generate_background：lavfi 渐变背景（素材缺失兜底）
- concat_segments：多段素材按目标时长循环拼接
- compose_pip：真人背景 + UI 录屏画中画
- ASS 字幕生成 / 落盘
"""

from __future__ import annotations

import os
import math
import re
import shutil
import subprocess
from pathlib import Path
from typing import Iterable, Optional, Sequence, Union

PathLike = Union[str, os.PathLike]


def ffmpeg_bin() -> Optional[str]:
    """返回 ffmpeg 可执行路径（FFMPEG_PATH → C:\ffmpeg\bin → PATH）。"""
    return _resolve_binary("FFMPEG_PATH", "FFMPEG_BIN", name="ffmpeg")


def ffprobe_bin() -> Optional[str]:
    """返回 ffprobe 可执行路径（FFPROBE_PATH → C:\ffmpeg\bin → PATH）。"""
    return _resolve_binary("FFPROBE_PATH", "FFPROBE_BIN", name="ffprobe")


def _resolve_binary(*env_keys: str, name: str) -> Optional[str]:
    """按 环境变量 → C:\ffmpeg\bin → PATH 的顺序解析可执行文件。"""
    suffix = ".exe" if os.name == "nt" else ""
    for key in env_keys:
        candidate = os.environ.get(key)
        if not candidate:
            continue
        path = Path(candidate)
        if path.is_dir():
            path = path / f"{name}{suffix}"
        if path.is_file():
            return str(path)
    canonical = Path(r"C:\ffmpeg\bin") / f"{name}{suffix}"
    if canonical.is_file():
        return str(canonical)
    return shutil.which(f"{name}{suffix}") or shutil.which(name)


def ensure_binaries() -> None:
    if not ffmpeg_bin():
        raise RuntimeError("ffmpeg 未安装或不在 PATH（设置 FFMPEG_PATH 可显式指定）")
    if not ffprobe_bin():
        raise RuntimeError("ffprobe 未安装或不在 PATH（设置 FFPROBE_PATH 可显式指定）")


def run(
    cmd: str,
    args: Sequence[str],
    *,
    timeout: int = 600,
    check: bool = True,
    cwd: Optional[Union[str, os.PathLike]] = None,
) -> subprocess.CompletedProcess:
    """执行外部命令，捕获输出；check=True 时非零退出抛 RuntimeError。"""
    try:
        proc = subprocess.run(
            [cmd, *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            cwd=cwd,
        )
    except subprocess.TimeoutExpired as exc:
        tail = (exc.stderr or "")[-1500:] if isinstance(exc.stderr, str) else ""
        raise RuntimeError(f"{cmd} 超时（>{timeout}s）：{tail}") from exc
    if check and proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "")[-2000:]
        raise RuntimeError(f"{cmd} 退出码 {proc.returncode}: {tail}")
    return proc


_NVENC_CACHE: Optional[bool] = None

_X264_PRESETS = (
    "ultrafast", "superfast", "veryfast", "faster", "fast",
    "medium", "slow", "slower", "veryslow", "placebo",
)

_NVENC_PRESETS = {
    "ultrafast": "p1", "superfast": "p1", "veryfast": "p2", "faster": "p3",
    "fast": "p4", "medium": "p5", "slow": "p6", "slower": "p7",
    "veryslow": "p7", "placebo": "p7",
}


def nvenc_enabled(refresh: bool = False) -> bool:
    """当前 ffmpeg 是否带 h264_nvenc（结果缓存；FFMPEG_DISABLE_NVENC=1 强制关闭）。"""
    global _NVENC_CACHE
    if refresh:
        _NVENC_CACHE = None
    if _NVENC_CACHE is None:
        binary = ffmpeg_bin()
        disabled = os.environ.get("FFMPEG_DISABLE_NVENC", "").lower() in {"1", "true", "yes"}
        if binary is None or disabled:
            _NVENC_CACHE = False
        else:
            try:
                proc = run(binary, ["-hide_banner", "-encoders"])
                _NVENC_CACHE = "h264_nvenc" in (proc.stdout or "")
            except Exception:
                _NVENC_CACHE = False
    return _NVENC_CACHE


def _encoder_args(crf: int, preset: str, *, use_nvenc: bool) -> list[str]:
    """返回视频编码器参数：h264_nvenc 硬编 或 libx264 软编回退。"""
    if use_nvenc:
        return [
            "-c:v", "h264_nvenc",
            "-preset", _NVENC_PRESETS.get(preset, "p4"),
            "-rc", "vbr", "-cq", str(crf), "-b:v", "0",
        ]
    return [
        "-c:v", "libx264",
        "-preset", preset if preset in _X264_PRESETS else "fast",
        "-crf", str(crf),
    ]


def run_encode(
    input_args: Sequence[str],
    output_path: PathLike,
    *,
    filter_args: Sequence[str] = (),
    output_args: Sequence[str] = (),
    crf: int = 20,
    preset: str = "fast",
) -> subprocess.CompletedProcess:
    """优先 h264_nvenc 硬编（自动加 -hwaccel cuda），失败回退 libx264 软编。"""
    binary = ffmpeg_bin()
    if binary is None:
        raise RuntimeError("ffmpeg 未安装或不在 PATH（设置 FFMPEG_PATH 可显式指定）")
    out = Path(output_path)
    attempts = [True, False] if nvenc_enabled() else [False]
    last_error: Optional[BaseException] = None
    for index, use_nvenc in enumerate(attempts):
        cmd: list[str] = ["-y"]
        if use_nvenc:
            cmd += ["-hwaccel", "cuda"]
        cmd += list(input_args)
        cmd += list(filter_args)
        cmd += _encoder_args(crf, preset, use_nvenc=use_nvenc)
        cmd += list(output_args)
        cmd.append(str(out))
        try:
            proc = run(binary, cmd)
        except RuntimeError as exc:
            last_error = exc
            if index == len(attempts) - 1:
                raise
            continue
        if out.exists():
            return proc
        last_error = RuntimeError(f"run_encode: 输出缺失 {out}")
    if last_error is not None:
        raise last_error
    raise RuntimeError("run_encode: 编码失败")
def probe_size(file: PathLike) -> tuple[int, int]:
    """读取视频宽高（ffprobe），返回 (width, height)。"""
    ensure_binaries()
    proc = run(
        ffprobe_bin(),  # type: ignore[arg-type]
        [
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "csv=p=0:s=x",
            str(file),
        ],
    )
    match = re.match(r"\s*(\d+)x(\d+)", proc.stdout.strip())
    if not match:
        raise RuntimeError(f"probe_size: 无法解析视频尺寸 {file}")
    return int(match.group(1)), int(match.group(2))


def probe_duration(file: PathLike) -> float:
    """读取媒体时长（秒，ffprobe format.duration）。"""
    ensure_binaries()
    proc = run(
        ffprobe_bin(),  # type: ignore[arg-type]
        [
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(file),
        ],
    )
    try:
        value = float(proc.stdout.strip())
    except ValueError as exc:
        raise RuntimeError(f"probe_duration: 无法解析时长 {file}") from exc
    if value <= 0:
        raise RuntimeError(f"probe_duration: 时长非法（{value}s）{file}")
    return value


def probe_codec(file: PathLike) -> Optional[str]:
    """读取首个视频流编码（如 h264）；无视频流返回 None。"""
    ensure_binaries()
    proc = run(
        ffprobe_bin(),  # type: ignore[arg-type]
        [
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=codec_name",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(file),
        ],
    )
    value = proc.stdout.strip()
    return value or None


def compose_vertical(
    input_path: PathLike,
    output_path: PathLike,
    *,
    audio: Optional[PathLike] = None,
    subtitles: Optional[PathLike] = None,
    width: int = 1080,
    height: int = 1920,
    mode: str = "vertical",
    crf: int = 20,
    preset: str = "fast",
) -> dict:
    """1:1 / 9:16 中心裁切 + ASS 字幕烧录 + 音视频合成。

    与 products/008-video-factory/src/modules/render.mjs 的 composeVertical
    保持同参数语义：square=取短边裁正方形；vertical=按目标比例中心裁切。
    """
    ensure_binaries()
    src = Path(input_path)
    out = Path(output_path)
    if not src.exists():
        raise RuntimeError(f"compose_vertical: 输入缺失 {src}")
    out.parent.mkdir(parents=True, exist_ok=True)

    src_w, src_h = probe_size(src)
    target_ratio = width / height
    src_ratio = src_w / src_h
    if mode == "square":
        crop_w = crop_h = min(src_w, src_h)
        crop_x = (src_w - crop_w) // 2
        crop_y = (src_h - crop_h) // 2
        vf = f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale={width}:{height}"
    else:
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
        vf = (
            f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},"
            f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black"
        )

    input_args: list[str] = ["-i", str(src)]
    if audio is not None:
        audio_path = Path(audio)
        if not audio_path.exists():
            raise RuntimeError(f"compose_vertical: 音频缺失 {audio_path}")
        input_args += ["-i", str(audio_path)]

    if subtitles is not None and Path(subtitles).exists():
        ass = str(Path(subtitles)).replace("\\", "/").replace(":", "\\:")
        vf += f",subtitles='{ass}'"

    output_args = ["-pix_fmt", "yuv420p"]
    if audio is not None:
        output_args += ["-c:a", "aac", "-b:a", "192k", "-shortest"]
    output_args += ["-movflags", "+faststart"]

    run_encode(
        input_args,
        out,
        filter_args=["-vf", vf],
        output_args=output_args,
        crf=crf,
        preset=preset,
    )
    if not out.exists():
        raise RuntimeError("compose_vertical: 输出缺失")
    return {"output": str(out)}


def generate_background(
    output_path: PathLike,
    *,
    duration_seconds: float = 15,
    width: int = 1080,
    height: int = 1920,
) -> dict:
    """lavfi 粉紫渐变背景（素材缺失兜底），1080x1920 竖屏 + 静音音轨。"""
    ensure_binaries()
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    duration = max(1.0, float(duration_seconds))
    run_encode(
        [
            "-f", "lavfi",
            "-i", f"gradients=s={width}x{height}:d={duration:.3f}:c0=0xEC4899:c1=0x8B5CF6:c2=0x1E1B4B:x0=0:y0=0:x1={width}:y1={height}",
            "-f", "lavfi",
            "-i", "anullsrc=r=44100:cl=stereo",
        ],
        out,
        output_args=["-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"],
        crf=23,
        preset="fast",
    )
    if not out.exists():
        raise RuntimeError("generate_background: 输出缺失")
    return {"output": str(out), "duration": duration}


def concat_segments(
    videos: Iterable[PathLike],
    output_path: PathLike,
    *,
    target_duration: float = 15,
    width: int = 1080,
    height: int = 1920,
) -> dict:
    """多段素材循环补足后按序拼接为一段连续背景视频。"""
    ensure_binaries()
    video_list = [Path(v) for v in videos]
    if not video_list:
        raise RuntimeError("concat_segments: 素材列表为空")
    for v in video_list:
        if not v.exists():
            raise RuntimeError(f"concat_segments: 输入缺失 {v}")

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    per = target_duration / len(video_list)

    inputs: list[str] = []
    chain: list[str] = []
    parts: list[str] = []
    for i, src in enumerate(video_list):
        src_dur = probe_duration(src)
        loop_times = max(1, int(math.ceil(per / max(src_dur, 0.1))) + 1)
        inputs += ["-stream_loop", str(loop_times), "-i", str(src)]
        chain.append(
            f"[{i}:v]trim=duration={per:.3f},setpts=PTS-STARTPTS,"
            f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black[v{i}]"
        )
        parts.append(f"[v{i}]")

    filter_complex = (
        ";".join(chain)
        + f";{''.join(parts)}concat=n={len(video_list)}:v=1:a=0[vout]"
    )
    run_encode(
        [*inputs],
        out,
        filter_args=["-filter_complex", filter_complex, "-map", "[vout]"],
        output_args=["-pix_fmt", "yuv420p"],
        crf=20,
        preset="fast",
    )
    if not out.exists():
        raise RuntimeError("concat_segments: 输出缺失")
    return {"output": str(out), "segments": len(video_list), "per_segment": per}


def compose_pip(
    background: PathLike,
    overlay: PathLike,
    output_path: PathLike,
    *,
    duration: Optional[float] = None,
    width: int = 1080,
    height: int = 1920,
    overlay_width_ratio: float = 0.45,
    position: str = "bottom",
) -> dict:
    """真人背景 + UI 录屏画中画（默认底部居中、45% 宽、圆角白边）。"""
    ensure_binaries()
    bg = Path(background)
    ov = Path(overlay)
    out = Path(output_path)
    if not bg.exists():
        raise RuntimeError(f"compose_pip: 背景缺失 {bg}")
    if not ov.exists():
        raise RuntimeError(f"compose_pip: 画中画素材缺失 {ov}")
    out.parent.mkdir(parents=True, exist_ok=True)

    pip_w = max(64, round(width * overlay_width_ratio))
    pip_h = max(64, round(pip_w * 844 / 390))
    x = (width - pip_w) // 2
    if position == "center":
        y = (height - pip_h) // 2
    else:
        y = height - pip_h - round(height * 0.08)
    radius = min(24, round(pip_w * 0.1))
    bg_dur = duration if duration else probe_duration(bg)

    mask_expr = (
        f"lte(abs(X-({pip_w}/2)),({pip_w}/2)-{radius})"
        f"*lte(abs(Y-({pip_h}/2)),({pip_h}/2)-{radius})"
        f"+lte(hypot(abs(X-({pip_w}/2))-({pip_w}/2-{radius}),"
        f"abs(Y-({pip_h}/2))-({pip_h}/2-{radius})),{radius})"
    )
    filter_complex = (
        f"[1:v]loop=loop=-1:size=32767:start=0,"
        f"trim=duration={bg_dur:.3f},setpts=PTS-STARTPTS,"
        f"tpad=stop_mode=clone:stop_duration=86400,"
        f"scale={pip_w}:{pip_h},format=rgba,"
        f"geq=r='if({mask_expr},255,0)':a='if({mask_expr},255,0)'[pip];"
        f"[0:v][pip]overlay={x}:{y}:shortest=1,"
        f"drawbox=x={x}:y={y}:w={pip_w}:h={pip_h}:color=white@0.85:t=3[vout]"
    )
    run_encode(
        ["-i", str(bg), "-i", str(ov)],
        out,
        filter_args=["-filter_complex", filter_complex, "-map", "[vout]", "-t", f"{bg_dur:.3f}"],
        output_args=["-pix_fmt", "yuv420p"],
        crf=20,
        preset="fast",
    )
    if not out.exists():
        raise RuntimeError("compose_pip: 输出缺失")
    return {"output": str(out), "pip_w": pip_w, "pip_h": pip_h}


def build_ass_script(
    lines: Sequence,
    *,
    duration_seconds: float = 15,
    width: int = 480,
    height: int = 480,
) -> str:
    """将旁白行转为 ASS 字幕脚本（逐行等分显示，底部白字描边）。"""
    items = list(lines) if lines else []
    n = max(1, len(items))
    per = duration_seconds / n
    font_scale = min(width, height) / 1080
    font_size = max(16, round(54 * font_scale))
    margin_v = max(24, round(140 * font_scale))
    header = (
        "[Script Info]\n"
        "Title: 008-video-factory\n"
        "ScriptType: v4.00+\n"
        f"PlayResX: {width}\n"
        f"PlayResY: {height}\n"
        "WrapStyle: 0\n"
        "ScaledBorderAndShadow: yes\n"
        "\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,Segoe UI,{font_size},&H00FFFFFF,&H000000FF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,2,{round(60 * font_scale)},{round(60 * font_scale)},{margin_v},1\n"
        "\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )

    def to_ts(seconds: float) -> str:
        h = str(int(seconds // 3600)).zfill(1)
        m = str(int((seconds % 3600) // 60)).zfill(2)
        s = str(int(seconds % 60)).zfill(2)
        cs = str(int((seconds % 1) * 100)).zfill(2)
        return f"{h}:{m}:{s}.{cs}"

    events = []
    for i, item in enumerate(items):
        if isinstance(item, str):
            text = item
        else:
            text = item.get("text") or item.get("hook") or ""
        text = str(text).replace("\n", "\\N")
        start = i * per
        end = min(start + per, duration_seconds)
        events.append(
            f"Dialogue: 0,{to_ts(start)},{to_ts(end)},Default,,0,0,0,,{text}"
        )
    return header + "\n".join(events) + "\n"


def write_ass_file(
    lines: Sequence,
    output_path: PathLike,
    *,
    duration_seconds: float = 15,
    width: int = 480,
    height: int = 480,
) -> Path:
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        build_ass_script(
            lines,
            duration_seconds=duration_seconds,
            width=width,
            height=height,
        ),
        encoding="utf-8",
    )
    return out


__all__ = [
    "ffmpeg_bin",
    "ffprobe_bin",
    "ensure_binaries",
    "run",
    "nvenc_enabled",
    "run_encode",
    "probe_size",
    "probe_duration",
    "probe_codec",
    "compose_vertical",
    "generate_background",
    "concat_segments",
    "compose_pip",
    "build_ass_script",
    "write_ass_file",
]
