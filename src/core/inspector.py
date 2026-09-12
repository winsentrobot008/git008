"""ffprobe 质量断言引擎（视频成品门禁）。

在渲染完成后自动执行：
  1. 视频流存在性、分辨率、帧率断言；
  2. 音频轨存在性（可跳过）与音画时长偏差（< 0.2s）；
  3. 无黑屏断层（blackdetect）与无静音断层（silencedetect）；
  4. 全部通过才允许落盘 `products/008-video-factory/output/`；
     失败记录 `runtime_data/logs/inspector.log` 并把坏片移入
     `runtime_data/quarantine/` 拦截。

CLI（供 Node / Python 各渲染路径统一调用）：
  python src/core/inspector.py <video> [--width W --height H --fps N]
      [--allow-no-audio] [--no-quarantine]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
RUNTIME_DATA = REPO_ROOT / "runtime_data"
LOG_DIR = RUNTIME_DATA / "logs"
QUARANTINE_DIR = RUNTIME_DATA / "quarantine"
INSPECTOR_LOG = LOG_DIR / "inspector.log"

# 默认断言阈值
DURATION_DEVIATION_MAX_S = 0.2
BLACK_MIN_S = 0.5
SILENCE_MIN_S = 0.5
SILENCE_NOISE_DB = -40


def _run(cmd: list[str], *, timeout: int = 180) -> subprocess.CompletedProcess:
    """执行 ffprobe / ffmpeg，返回捕获结果；超时或异常转 RuntimeError。"""
    try:
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"{cmd[0]} 超时（>{timeout}s）") from exc


def _ffprobe_bin() -> str:
    exe = os.environ.get("FFPROBE_BIN") or shutil.which("ffprobe")
    if not exe:
        raise RuntimeError("ffprobe 未安装或不在 PATH（设置 FFPROBE_BIN 可显式指定）")
    return exe


def _ffmpeg_bin() -> str:
    exe = os.environ.get("FFMPEG_BIN") or shutil.which("ffmpeg")
    if not exe:
        raise RuntimeError("ffmpeg 未安装或不在 PATH（设置 FFMPEG_BIN 可显式指定）")
    return exe


def parse_fps(value: str) -> Optional[float]:
    """'24000/1001' / '24.0' → float；解析失败返回 None。"""
    if not value:
        return None
    try:
        if "/" in value:
            num, _, den = value.partition("/")
            return float(num) / float(den or 1)
        return float(value)
    except (ValueError, ZeroDivisionError):
        return None


def probe_streams(video: Path) -> dict:
    """ffprobe 探测 → {video: {...}|None, audio: {...}|None}。"""
    if not Path(video).exists():
        raise RuntimeError(f"inspector: 文件不存在 {video}")
    proc = _run(
        [
            _ffprobe_bin(),
            "-v", "error",
            "-show_entries",
            "stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,duration",
            "-show_entries",
            "format=duration,size",
            "-of", "json",
            str(video),
        ]
    )
    if proc.returncode != 0:
        raise RuntimeError(f"inspector: ffprobe 失败（exit {proc.returncode}）: {proc.stderr[-800:]}")
    try:
        data = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"inspector: ffprobe 输出解析失败: {exc}") from exc

    streams = data.get("streams") or []
    video_stream = next(
        (s for s in streams if s.get("codec_type") == "video"),
        None,
    )
    audio_stream = next(
        (s for s in streams if s.get("codec_type") == "audio"),
        None,
    )
    fmt = data.get("format") or {}
    return {
        "video": video_stream,
        "audio": audio_stream,
        "format_duration": float(fmt.get("duration") or 0) or None,
        "format_size": int(fmt.get("size") or 0) or None,
        "raw": data,
    }


def detect_black_segments(video: Path, *, min_s: float = BLACK_MIN_S) -> list[dict]:
    """blackdetect：返回超过 min_s 的黑屏片段 [{start_s, end_s, duration_s}]。"""
    proc = _run(
        [
            _ffmpeg_bin(),
            "-v", "info",
            "-i", str(video),
            "-vf", f"blackdetect=d={min_s:.3f}:pix_th=0.10",
            "-an",
            "-f", "null",
            "NUL" if os.name == "nt" else "/dev/null",
        ]
    )
    segments: list[dict] = []
    for line in (proc.stdout + "\n" + proc.stderr).splitlines():
        match = re.search(
            r"black_start:([\d.]+).*?black_end:([\d.]+).*?black_duration:([\d.]+)",
            line,
        )
        if match:
            segments.append(
                {
                    "start_s": float(match.group(1)),
                    "end_s": float(match.group(2)),
                    "duration_s": float(match.group(3)),
                }
            )
    return segments


def detect_silence_segments(
    video: Path,
    *,
    min_s: float = SILENCE_MIN_S,
    noise_db: float = SILENCE_NOISE_DB,
) -> list[dict]:
    """silencedetect：返回超过 min_s 的静音片段 [{start_s, end_s, duration_s}]。"""
    proc = _run(
        [
            _ffmpeg_bin(),
            "-v", "info",
            "-i", str(video),
            "-af", f"silencedetect=noise={noise_db:g}dB:d={min_s:.3f}",
            "-vn",
            "-f", "null",
            "NUL" if os.name == "nt" else "/dev/null",
        ]
    )
    starts: list[tuple[str, float]] = []
    ends: list[tuple[str, float]] = []
    for line in (proc.stdout + "\n" + proc.stderr).splitlines():
        m_start = re.search(r"silence_start:\s*([\d.]+)", line)
        m_end = re.search(r"silence_end:\s*([\d.]+)", line)
        if m_start:
            starts.append((line, float(m_start.group(1))))
        elif m_end:
            ends.append((line, float(m_end.group(1))))

    segments: list[dict] = []
    for i, (_, start_s) in enumerate(starts):
        end_s = ends[i][1] if i < len(ends) else None
        segments.append(
            {
                "start_s": start_s,
                "end_s": end_s,
                "duration_s": (end_s - start_s) if end_s is not None else None,
            }
        )
    return segments


def _write_log(entry: dict) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    entry = dict(entry)
    entry.setdefault("timestamp", datetime.now().isoformat(timespec="seconds"))
    line = json.dumps(entry, ensure_ascii=False, default=str)
    with INSPECTOR_LOG.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def inspect_video(
    video: Path,
    *,
    expected: Optional[dict] = None,
    require_audio: bool = True,
    duration_deviation_max_s: float = DURATION_DEVIATION_MAX_S,
    black_min_s: float = BLACK_MIN_S,
    silence_min_s: float = SILENCE_MIN_S,
    quarantine: bool = True,
) -> dict:
    """完整质检：通过返回 ok=True；失败记录日志并（可选）隔离坏片。"""
    video = Path(video)
    expected = expected or {}
    issues: list[str] = []
    checks: dict[str, dict] = {}

    def add_check(name: str, ok: bool, detail: str) -> None:
        checks[name] = {"ok": ok, "detail": detail}
        if not ok:
            issues.append(f"{name}: {detail}")

    # 1) 流信息
    info = probe_streams(video)
    vstream = info.get("video")
    astream = info.get("audio")
    fmt_duration = info.get("format_duration")
    if not vstream:
        add_check("video_stream", False, "未发现视频流")
    else:
        width = int(vstream.get("width") or 0)
        height = int(vstream.get("height") or 0)
        fps = parse_fps(vstream.get("r_frame_rate") or vstream.get("avg_frame_rate"))
        vdur = float(vstream.get("duration") or 0) or fmt_duration

        exp_w = expected.get("width")
        exp_h = expected.get("height")
        exp_fps = expected.get("fps")
        if exp_w and exp_h and (width, height) != (exp_w, exp_h):
            add_check("resolution", False, f"期望 {exp_w}x{exp_h}，实际 {width}x{height}")
        else:
            add_check("resolution", True, f"{width}x{height}")
        if exp_fps and fps is not None and abs(fps - float(exp_fps)) > 0.5:
            add_check("frame_rate", False, f"期望 {exp_fps} fps，实际 {fps:.3f}")
        else:
            add_check("frame_rate", True, f"{fps:.3f}" if fps is not None else "未知")

        # 2) 音频轨存在性
        if require_audio and not astream:
            add_check("audio_track", False, "未发现音频轨")
        else:
            add_check("audio_track", True, astream.get("codec_name", "none") if astream else "跳过（无音频要求）")

        # 3) 音画时长偏差
        if astream:
            adur = float(astream.get("duration") or 0)
            if vdur and adur:
                deviation = abs(vdur - adur)
                if deviation > duration_deviation_max_s:
                    add_check(
                        "av_sync",
                        False,
                        f"音画时长偏差 {deviation:.3f}s > 上限 {duration_deviation_max_s}s "
                        f"（video={vdur:.3f}s audio={adur:.3f}s）",
                    )
                else:
                    add_check("av_sync", True, f"偏差 {deviation:.3f}s（≤{duration_deviation_max_s}s）")
            else:
                add_check("av_sync", True, f"时长无法完整探测（video={vdur}, audio={adur}）")

        # 4) 黑屏断层
        black = detect_black_segments(video, min_s=black_min_s)
        if black:
            add_check("black_screen", False, f"检测到 {len(black)} 段黑屏（>={black_min_s}s）：{black[:3]}")
        else:
            add_check("black_screen", True, f"无 >={black_min_s}s 黑屏")

        # 5) 静音断层
        if astream:
            silence = detect_silence_segments(video, min_s=silence_min_s)
            long_silence = [s for s in silence if s.get("duration_s") is not None and s["duration_s"] >= silence_min_s]
            if long_silence:
                add_check("silence_gap", False, f"检测到 {len(long_silence)} 段静音（>={silence_min_s}s）：{long_silence[:3]}")
            else:
                add_check("silence_gap", True, f"无 >={silence_min_s}s 静音")
        else:
            add_check("silence_gap", True, "跳过（无音频轨）")

    ok = not issues
    report = {
        "ok": ok,
        "file": str(video),
        "expected": expected,
        "require_audio": require_audio,
        "video": {
            "width": int(vstream.get("width") or 0) if vstream else None,
            "height": int(vstream.get("height") or 0) if vstream else None,
            "fps": parse_fps(vstream.get("r_frame_rate") or vstream.get("avg_frame_rate")) if vstream else None,
            "codec": vstream.get("codec_name") if vstream else None,
            "duration_s": float(vstream.get("duration") or 0) or fmt_duration,
        },
        "audio": {
            "codec": astream.get("codec_name") if astream else None,
            "duration_s": float(astream.get("duration") or 0) if astream else None,
        },
        "checks": checks,
        "issues": issues,
    }
    _write_log({**report, "event": "PASS" if ok else "FAIL"})

    if not ok and quarantine:
        QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)
        target = QUARANTINE_DIR / video.name
        shutil.move(str(video), str(target))
        report["quarantined_to"] = str(target)
        report["issues"].append(f"已拦截并移至 quarantine: {target}")
    return report


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="inspector",
        description="ffprobe 视频质量断言（渲染落盘前的门禁）",
    )
    parser.add_argument("video", help="待质检视频路径")
    parser.add_argument("--width", type=int, help="期望宽度")
    parser.add_argument("--height", type=int, help="期望高度")
    parser.add_argument("--fps", type=float, help="期望帧率")
    parser.add_argument(
        "--allow-no-audio",
        action="store_true",
        help="允许无音频轨（分镜预览等无声素材）",
    )
    parser.add_argument(
        "--no-quarantine",
        action="store_true",
        help="失败时不移动坏片（仅记录日志）",
    )
    args = parser.parse_args(argv)

    expected = {}
    if args.width:
        expected["width"] = args.width
    if args.height:
        expected["height"] = args.height
    if args.fps:
        expected["fps"] = args.fps

    try:
        report = inspect_video(
            Path(args.video),
            expected=expected or None,
            require_audio=not args.allow_no_audio,
            quarantine=not args.no_quarantine,
        )
    except RuntimeError as exc:
        _write_log({"event": "ERROR", "file": args.video, "error": str(exc)})
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 2

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())


__all__ = [
    "probe_streams",
    "detect_black_segments",
    "detect_silence_segments",
    "inspect_video",
    "main",
    "INSPECTOR_LOG",
    "QUARANTINE_DIR",
]
