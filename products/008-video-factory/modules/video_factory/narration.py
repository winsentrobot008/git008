# -*- coding: utf-8 -*-
"""Edge-TTS 旁白合成与时轴对齐（Stage-2 音频前置）。

输入 `voice_script`（由 director_adapter 生成，每句含 text / start_seconds /
end_seconds），逐句调用 Edge-TTS 合成 MP3，再用 FFmpeg 把各句按起始时间叠加到
一条静音底轨，输出与成片等长的单轨旁白（默认 m4a/AAC，可直接 mux 进成片）。

设计要点：
- `synth` 可注入：测试用确定性合成器替换 Edge-TTS，避免联网依赖；
- 单句合成失败只丢该句（记入 dropped），不影响其余旁白；
- 输出时长严格对齐 total_seconds（超出裁剪、不足静音补齐），保证音画同步质检。
"""

from __future__ import annotations

import asyncio
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable, Optional

from src.core import ffmpeg

__all__ = ["DEFAULT_VOICE", "default_synth", "build_narration_track"]

DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"
_SYNTH_EXT = ".mp3"
_AUDIO_EXT = {".m4a", ".mp4", ".aac"}


def default_synth(text: str, voice: str, out_path: Path) -> bool:
    """Edge-TTS 合成单句旁白；SDK 缺失或联网失败返回 False。"""
    try:
        import edge_tts  # noqa: PLC0415
    except Exception:  # noqa: BLE001 - SDK 缺失按不可用处理
        return False

    async def _run() -> None:
        await edge_tts.Communicate(str(text), voice).save(str(out_path))

    try:
        asyncio.run(_run())
    except Exception as exc:  # noqa: BLE001 - 联网合成失败按丢句处理
        print(f"[tts] Edge-TTS 合成失败：{type(exc).__name__}: {exc}", file=sys.stderr)
        return False
    return out_path.exists() and out_path.stat().st_size > 0


def _normalize_lines(voice_script: Any) -> list[dict]:
    lines: list[dict] = []
    for i, raw in enumerate(voice_script or []):
        if not isinstance(raw, dict):
            continue
        text = str(raw.get("text") or "").strip()
        if not text:
            continue
        start = max(0.0, float(raw.get("start_seconds") or 0.0))
        end = max(float(raw.get("end_seconds") or 0.0), start)
        lines.append(
            {"index": i, "text": text, "start_seconds": start, "end_seconds": end}
        )
    return lines


def build_narration_track(
    voice_script: Any,
    output_path: Path | str,
    *,
    voice: str = DEFAULT_VOICE,
    total_seconds: Optional[float] = None,
    synth: Optional[Callable[[str, str, Path], bool]] = None,
    timeout: int = 300,
) -> dict:
    """voice_script → 单轨旁白音频。

    返回 {ok, output, duration_seconds, voice, lines, dropped, reason}。
    没有任何可合成句子时 ok=False（调用方回退为无声渲染）。
    """
    lines = _normalize_lines(voice_script)
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    if not lines:
        return {"ok": False, "reason": "no_lines", "output": None, "lines": [], "dropped": []}

    synthesizer = synth or default_synth
    tmpdir = Path(tempfile.mkdtemp(prefix="vf_tts_"))
    clips: list[tuple[dict, Path]] = []
    dropped: list[dict] = []
    try:
        for line in lines:
            clip = tmpdir / f"line_{line['index']:03d}{_SYNTH_EXT}"
            ok = False
            try:
                ok = bool(synthesizer(line["text"], voice, clip))
            except Exception as exc:  # noqa: BLE001 - 单句失败不影响整轨
                print(f"[tts] 合成器异常：{type(exc).__name__}: {exc}", file=sys.stderr)
            if ok and clip.exists() and clip.stat().st_size > 0:
                clips.append((line, clip))
            else:
                dropped.append(
                    {"text": line["text"], "start_seconds": line["start_seconds"]}
                )

        if not clips:
            return {
                "ok": False,
                "reason": "tts_unavailable",
                "output": None,
                "lines": [],
                "dropped": dropped,
            }

        if total_seconds and float(total_seconds) > 0:
            total = float(total_seconds)
        else:
            total = max(line["end_seconds"] for line in lines)
        total = max(total, 1.0)

        args = [
            "-y",
            "-f", "lavfi", "-t", f"{total:.3f}",
            "-i", "anullsrc=r=24000:cl=mono",
        ]
        for _, clip in clips:
            args += ["-i", str(clip)]

        filters: list[str] = []
        labels: list[str] = ["[0:a]"]
        for n, (line, _) in enumerate(clips, start=1):
            delay_ms = int(round(line["start_seconds"] * 1000))
            filters.append(f"[{n}:a]adelay={delay_ms}:all=1[a{n}]")
            labels.append(f"[a{n}]")
        filters.append(
            "".join(labels)
            + f"amix=inputs={len(labels)}:normalize=0:dropout_transition=0[out]"
        )

        if out.suffix.lower() in _AUDIO_EXT:
            codec = ["-c:a", "aac", "-b:a", "128k"]
        else:
            codec = ["-c:a", "libmp3lame", "-q:a", "4"]

        args += [
            "-filter_complex", ";".join(filters),
            "-map", "[out]",
            "-t", f"{total:.3f}",
            *codec,
            str(out),
        ]
        try:
            ffmpeg.run_ffmpeg(args, timeout=timeout)
        except Exception as exc:  # noqa: BLE001 - 失败转为可读原因
            return {
                "ok": False,
                "reason": f"mux_failed: {exc}",
                "output": None,
                "lines": [],
                "dropped": dropped,
            }

        try:
            duration = ffmpeg.probe_duration(out)
        except Exception:  # noqa: BLE001 - 探测失败沿用目标时长
            duration = total
        return {
            "ok": True,
            "output": str(out),
            "duration_seconds": round(float(duration), 3),
            "voice": voice,
            "lines": [
                {
                    "text": line["text"],
                    "start_seconds": round(line["start_seconds"], 2),
                    "end_seconds": round(line["end_seconds"], 2),
                }
                for line, _ in clips
            ],
            "dropped": dropped,
        }
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)