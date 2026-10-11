"""SVD 运动片段 → 旁白 → 字幕 → 多镜拼接 闭环回归（无需 pytest）。

    python products/008-video-factory/tests/test_motion_closure.py

背景：cmd_director 的 ComfyUI 分支曾经直接 return 0 —— SVD 出的运动片段既不烧
字幕、也不混旁白，更不与其他镜头拼接（审计断头路 ①）。本测试锁定修复后的闭环：

1. _upgrade_scenes_with_motion 把 SVD 出片回填成 scene.source + _media_kind=video，
   并清掉陈旧的静图兜底原因；SVD 全失败时只降级、不抛异常；
2. 视频素材镜头走 preview 的裁切分支（不再被误判为「无素材」退化成渐变卡）；
3. 旁白轨真正混入成片（ffprobe 质检 av_sync 通过）；
4. 多镜拼接后时长 = 各镜时长之和（SVD 片段没有被吞掉或重复）。
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):  # Windows 控制台默认 cp1252/cp936
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PRODUCT_ROOT.parents[1]
for entry in (str(PRODUCT_ROOT), str(REPO_ROOT)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from modules.video_factory import (  # noqa: E402
    director_adapter,
    pipeline,
    preview,
    render_backend,
    storyboard,
)
from src.core import ffmpeg  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(condition), detail))


def _make_clip(path: Path, *, seconds: float, fps: int = 12) -> Path:
    """用 FFmpeg 合成一段纯色 mp4，冒充 SVD 运动片段。"""
    ffmpeg.run_ffmpeg(
        [
            "-y",
            "-f", "lavfi",
            "-i", f"color=c=0x224466:s=320x320:d={seconds:.2f}:r={fps}",
            "-frames:v", str(max(1, round(seconds * fps))),
            "-c:v", "libx264", "-preset", "ultrafast",
            "-pix_fmt", "yuv420p",
            str(path),
        ],
        timeout=120,
    )
    return path


def _make_audio(path: Path, *, seconds: float) -> Path:
    ffmpeg.run_ffmpeg(
        [
            "-y",
            "-f", "lavfi",
            "-i", f"sine=frequency=440:duration={seconds:.2f}",
            "-c:a", "aac", "-b:a", "96k",
            str(path),
        ],
        timeout=120,
    )
    return path


def _storyboard(clip: Path, audio: Path) -> dict:
    return {
        "title": "motion-closure",
        "width": 320,
        "height": 320,
        "fps": 12,
        "theme": {"bg": ["#1E1B4B", "#8B5CF6", "#EC4899"]},
        "scenes": [
            # 镜头 1：SVD 运动片段（刻意不写 _media_kind，验证扩展名兜底）
            {
                "type": "video",
                "text": "运动镜头",
                "subtitle": "由 SVD 片段提供画面",
                "source": str(clip),
                "duration_s": 2.0,
            },
            # 镜头 2：无素材 → 品牌渐变兜底（证明多镜仍会拼接）
            {
                "type": "text_card",
                "text": "兜底镜头",
                "subtitle": "无素材走渐变",
                "duration_s": 2.0,
            },
        ],
        "audio": {
            "narration": [{"src": str(audio), "start_seconds": 0.0, "end_seconds": 4.0}]
        },
    }


def test_motion_upgrade_backfills_scene(tmp: Path) -> None:
    clip = _make_clip(tmp / "svd_scene_000.mp4", seconds=2.0)
    data = {
        "title": "backfill",
        "scenes": [
            {"source": str(tmp / "input_000.png"), "duration_s": 2.0, "_media_reason": "no_stock_match"},
            {"source": str(tmp / "input_001.png"), "duration_s": 2.0},
        ],
    }
    report = {
        "backend": "comfyui",
        "clips": [{"index": 0, "image": str(tmp / "input_000.png"), "clip": str(clip)}],
        "skipped": [],
        "count": 1,
        "candidates": 2,
    }
    original = render_backend.generate_scene_clips
    render_backend.generate_scene_clips = lambda *a, **k: report  # noqa: ARG005
    try:
        out = pipeline._upgrade_scenes_with_motion(data, out_dir=tmp / "svd")
    finally:
        render_backend.generate_scene_clips = original

    scene = data["scenes"][0]
    check("upgrade: 报告原样返回", out is report, str(out.get("count")))
    check("upgrade: 片段回填为 scene.source", scene["source"] == str(clip), scene["source"])
    check("upgrade: _media_kind 置为 video", scene["_media_kind"] == "video", str(scene.get("_media_kind")))
    check("upgrade: 记录 _media_via", scene.get("_media_via") == "comfyui-svd", str(scene.get("_media_via")))
    check("upgrade: 清除陈旧 _media_reason", "_media_reason" not in scene, str(scene.get("_media_reason")))
    check(
        "upgrade: 未命中镜头保持原样",
        data["scenes"][1]["source"] == str(tmp / "input_001.png")
        and data["scenes"][1].get("_media_kind") is None,
        str(data["scenes"][1]),
    )


def test_motion_upgrade_degrades_without_raising(tmp: Path) -> None:
    data = {"title": "degrade", "scenes": [{"source": str(tmp / "a.png"), "duration_s": 2.0}]}
    original = render_backend.generate_scene_clips

    def boom(*args, **kwargs):  # noqa: ANN002, ANN003, ARG001
        raise RuntimeError("ComfyUI 不可达")

    render_backend.generate_scene_clips = boom
    try:
        out = pipeline._upgrade_scenes_with_motion(data, out_dir=tmp / "svd")
    finally:
        render_backend.generate_scene_clips = original

    check("degrade: 不抛异常", isinstance(out, dict), type(out).__name__)
    check("degrade: count=0", out.get("count") == 0, str(out.get("count")))
    check("degrade: 原因可读", "ComfyUI" in str(out.get("reason")), str(out.get("reason")))
    check(
        "degrade: 镜头保留静图兜底",
        data["scenes"][0]["source"] == str(tmp / "a.png"),
        str(data["scenes"][0]),
    )


def test_video_scene_closure_with_narration(tmp: Path) -> None:
    clip = _make_clip(tmp / "clip.mp4", seconds=2.0)
    audio = _make_audio(tmp / "narration.m4a", seconds=4.0)
    data = _storyboard(clip, audio)

    result = preview.render_preview(
        data,
        output_path=tmp / "closure.mp4",
        width=320,
        height=320,
        fps=12,
        use_network=False,
        inspect=True,
    )

    out = Path(result["output"])
    check("closure: 成片落盘", out.is_file() and out.stat().st_size > 0, str(out))
    check("closure: 镜头数 = 2", result["scenes"] == 2, str(result["scenes"]))
    check("closure: 旁白已混轨", bool(result.get("narration_track")), str(result.get("narration_track")))
    check(
        "closure: 时长 = 两镜之和（2+2=4s）",
        abs(float(result["duration_seconds"]) - 4.0) <= 0.35,
        str(result["duration_seconds"]),
    )
    diagnostics = [d["index"] for d in result.get("render_diagnostics") or []]
    check(
        "closure: 视频镜头未退化为渐变（仅镜头 2 走兜底）",
        diagnostics == [1],
        str(diagnostics),
    )
    inspection = result.get("inspector") or {}
    check("closure: 质检通过", inspection.get("ok") is True, str(inspection.get("issues")))
    checks = inspection.get("checks") or {}
    for name in ("resolution", "frame_rate", "audio_track", "av_sync"):
        check(f"closure: 质检项 {name}", bool(checks.get(name, {}).get("ok")), str(checks.get(name)))
    check(
        "closure: 音轨编码 aac",
        (inspection.get("audio") or {}).get("codec") == "aac",
        str(inspection.get("audio")),
    )


def test_narration_reads_authored_lines(tmp: Path) -> None:
    """dialogue/voice_script 才是旁白来源：校验副本若丢掉它，整片会改读屏幕字幕。"""
    script = {
        "title": "voice-script-probe",
        "shots": [
            {
                "id": "s1-01", "scene": "s1", "kind": "hook",
                "text": "屏幕短字幕",
                "duration_s": 3.0,
                "search_keywords": ["probe clip"],
                "camera": {"shot_size": "medium", "side": "left", "movement": "push_in"},
                "dialogue": [{"speaker": "narrator", "line": "这才是真正的旁白台词"}],
            }
        ],
    }
    data = director_adapter.adapt_director_script(script, strict_axis=True)
    check("voice_script: 适配层保留 dialogue 旁白", bool(data.get("voice_script")), "adapt 未产出 voice_script")
    kept = storyboard.validate_storyboard(data)
    check(
        "voice_script: 校验副本不丢 voice_script",
        bool(kept.get("voice_script")),
        "validate_storyboard 丢弃 voice_script",
    )

    spoken: list[str] = []

    def _probe_synth(text: str, voice: str, out: Path) -> bool:
        spoken.append(text)
        ffmpeg.run_ffmpeg(
            [
                "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.3",
                "-f", "wav", "-c:a", "pcm_s16le", "-ar", "24000", "-ac", "1",
                str(out),
            ],
            timeout=60,
        )
        return out.exists() and out.stat().st_size > 0

    report = pipeline.stage_narration(data, synth=_probe_synth, cache_dir=tmp)["staging"]["narration"]
    check(
        "voice_script: 旁白朗读 authored 台词",
        spoken == ["这才是真正的旁白台词"],
        f"spoken={spoken}",
    )
    check("voice_script: 旁白不朗读屏幕字幕", "屏幕短字幕" not in spoken, f"spoken={spoken}")
    check("voice_script: 旁白轨合成成功", bool(report.get("ok")), str(report.get("reason")))


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="motion-closure-") as td:
        tmp = Path(td)
        test_motion_upgrade_backfills_scene(tmp)
        test_motion_upgrade_degrades_without_raising(tmp)
        test_video_scene_closure_with_narration(tmp)
        test_narration_reads_authored_lines(tmp)

    failed = 0
    for name, ok, detail in RESULTS:
        mark = "PASS" if ok else "FAIL"
        suffix = f"  <- {detail}" if (detail and not ok) else ""
        print(f"[{mark}] {name}{suffix}")
        failed += 0 if ok else 1
    print(f"\n{len(RESULTS) - failed}/{len(RESULTS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
