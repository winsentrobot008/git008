"""端到端自动化流水线自检（无需 pytest，直接运行）。

覆盖链路：原始文本 → 结构化分镜（script_text / search_keywords /
camera_movement）→ Edge-TTS 旁白时轴 → 图库素材暂存 → 480x480 草稿 MP4
+ 封面 → ffprobe 质检通过。

    python products/008-video-factory/tests/test_e2e_pipeline.py

说明：TTS 与图库下载均注入确定性替身（ffmpeg 生成正弦音 + 关键字命名短片），
不依赖网络与 Edge-TTS 服务；渲染与质检走真实 FFmpeg / ffprobe 路径。
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PRODUCT_ROOT.parents[1]
for entry in (str(PRODUCT_ROOT), str(REPO_ROOT)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from src.core import ffmpeg  # noqa: E402
from modules.video_factory import director_adapter, narration, pipeline, preview  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []
TEXT = (
    "凌晨两点的冰箱第三次自己亮起。"
    "她发现里面冻着一封写给未来的信。"
    "信上说：别怕，你正在成为你想成为的人。"
)
MOVEMENTS = {"push_in", "static", "pull_out"}
WORK = Path(tempfile.mkdtemp(prefix="vf_e2e_"))


def check(name: str, condition: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(condition), detail))


def _fixture(path: Path, size: str) -> Path:
    """关键字命名的真实短片（作为本地图库素材替身）。"""
    ffmpeg.run(
        ffmpeg.ffmpeg_bin(),
        [
            "-y", "-f", "lavfi", "-t", "3",
            "-i", f"testsrc=size={size}:rate=24",
            "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "ultrafast",
            str(path),
        ],
        timeout=120,
    )
    return path


def _fake_tts(text: str, voice: str, out_path: Path) -> bool:
    """确定性 TTS 替身：0.9s 正弦音，验证真实 FFmpeg 混轨路径。"""
    ffmpeg.run(
        ffmpeg.ffmpeg_bin(),
        [
            "-y", "-f", "lavfi", "-t", "0.9",
            "-i", "sine=frequency=520:sample_rate=24000",
            "-c:a", "libmp3lame", "-q:a", "5", str(out_path),
        ],
        timeout=120,
    )
    return out_path.exists()


def _mapper(keywords, text_summary: str = "", limit: int = 3) -> list[str]:
    """把中文旁白映射成与本地素材文件名一致的英文检索词。"""
    return ["fridge", "night", "kitchen"]


def test_text_to_shots() -> None:
    """1) 原始文本 → 结构化镜头（三要素齐全且取值受约束）。"""
    script = director_adapter.parse_text_to_shots(
        TEXT,
        shot_count=3,
        target_duration=7.5,
        provider="offline",
        visual_mapper=_mapper,
    )
    shots = script["shots"]
    check("text: 产出镜头", len(shots) == 3, str(len(shots)))
    check(
        "text: 每镜都有 script_text",
        all(str(s.get("script_text") or "").strip() for s in shots),
    )
    check(
        "text: 每镜都有英文检索词",
        all(s.get("search_keywords") for s in shots),
        str([s.get("search_keywords") for s in shots[:1]]),
    )
    movements = [s.get("camera_movement") for s in shots]
    check("text: 运动取值受限", set(movements) <= MOVEMENTS, str(movements))
    check("text: 开场推入 / 结尾拉出", movements[0] == "push_in" and movements[-1] == "pull_out", str(movements))

    storyboard = director_adapter.text_to_storyboard(
        TEXT, shot_count=3, target_duration=7.5, provider="offline", visual_mapper=_mapper
    )
    scenes = storyboard["scenes"]
    check("text: storyboard 场景数", len(scenes) == 3, str(len(scenes)))
    check(
        "text: 场景携带三要素",
        all(s.get("script_text") and s.get("search_keywords") and s.get("camera_movement") for s in scenes),
    )


def test_narration_track() -> None:
    """2) Edge-TTS 旁白轨：时轴正确、时长对齐、失败可降级。"""
    lines = [
        {"text": "凌晨两点的冰箱第三次自己亮起。", "start_seconds": 0.0, "end_seconds": 2.5},
        {"text": "她发现里面冻着一封写给未来的信。", "start_seconds": 2.5, "end_seconds": 5.0},
    ]
    out = WORK / "narration.m4a"
    report = narration.build_narration_track(lines, out, total_seconds=5.0, synth=_fake_tts)
    check("tts: 合成成功", report["ok"], str(report.get("reason")))
    check("tts: 输出落盘", out.exists() and out.stat().st_size > 0, str(out))
    check("tts: 时长对齐成片", abs(float(report["duration_seconds"]) - 5.0) <= 0.2, str(report["duration_seconds"]))
    check("tts: 每句都有 timecode", len(report["lines"]) == 2, str(report.get("lines")))
    starts = [round(float(l["start_seconds"]), 1) for l in report["lines"]]
    check("tts: 起始时间单调不减", starts == sorted(starts), str(starts))
    check("tts: 相邻句首尾相接", abs(starts[0]) < 0.01 and abs(starts[1] - 2.5) < 0.01, str(starts))

    failed = narration.build_narration_track(lines, WORK / "silent.m4a", synth=lambda *a: False)
    check("tts: 合成器全失败时降级", failed["ok"] is False and len(failed["dropped"]) == 2, str(failed["reason"]))
    empty = narration.build_narration_track([], WORK / "none.m4a")
    check("tts: 空脚本返回 no_lines", empty["ok"] is False and empty["reason"] == "no_lines", str(empty["reason"]))


def test_stock_fetch() -> None:
    """3) 图库取材：命中缓存目录里的关键字素材，未命中标记回退。"""
    cache = WORK / "assets_cache"
    cache.mkdir(parents=True, exist_ok=True)
    _fixture(cache / "fridge_night_kitchen.mp4", "640x360")

    storyboard = director_adapter.text_to_storyboard(
        TEXT, shot_count=2, target_duration=5.0, provider="offline", visual_mapper=_mapper
    )
    staged = pipeline.stage_assets(storyboard, use_network=False, cache_dir=cache)
    report = staged["staging"]["assets"]
    check("stock: 命中本地关键字素材", report["resolved"] == 2, str(report["entries"]))
    check(
        "stock: 记录来源与类型",
        all(e["via"] == "local" and e["kind"] == "video" for e in report["entries"]),
        str(report["entries"]),
    )
    check("stock: 场景写入 source", all(s.get("source") for s in staged["scenes"]))
    check("stock: 缓存目录契约", report["cache_dir"].endswith("assets_cache"), report["cache_dir"])

    miss_cache = WORK / "assets_miss"
    miss_cache.mkdir(parents=True, exist_ok=True)
    missing = pipeline.stage_assets(storyboard, use_network=False, cache_dir=miss_cache)
    miss = missing["staging"]["assets"]
    check("stock: 未命中走回退", miss["resolved"] == 0 and miss["fallback"] == 2, str(miss["entries"]))
    check(
        "stock: 回退原因可读",
        all(e["via"] == "gradient" and e["reason"] == "no_stock_match" for e in miss["entries"]),
        str(miss["entries"]),
    )


def test_text_to_preview_480() -> None:
    """4) 全链路：文本 → 分镜 → 素材/旁白暂存 → 480x480 MP4 + 封面 → 质检通过。"""
    cache = WORK / "render_cache"
    cache.mkdir(parents=True, exist_ok=True)
    _fixture(cache / "fridge_night_kitchen.mp4", "640x360")
    _fixture(cache / "portrait_night_city.mp4", "360x640")

    storyboard = director_adapter.text_to_storyboard(
        TEXT, shot_count=3, target_duration=7.5, provider="offline", visual_mapper=_mapper
    )
    staged = pipeline.stage_storyboard(
        storyboard,
        use_network=False,
        use_tts=True,
        synth=_fake_tts,
        cache_dir=cache,
    )
    staging = staged["staging"]
    check("e2e: 素材全部命中", staging["assets"]["resolved"] == 3, str(staging["assets"]["entries"]))
    check("e2e: 旁白轨就绪", staging["narration"]["ok"], str(staging["narration"]))
    check("e2e: audio.narration 已写入", bool(staged["audio"]["narration"]), str(staged["audio"]["narration"]))

    out_path = WORK / "e2e_480x480_preview.mp4"
    result = preview.render_preview(
        staged,
        output_path=out_path,
        width=480,
        height=480,
        fps=24,
        use_network=False,
        inspect=True,
    )
    check("e2e: 480x480 输出", result["resolution"] == "480x480", result["resolution"])
    check("e2e: 文件落盘", out_path.exists() and out_path.stat().st_size > 0, str(out_path))
    width, height = ffmpeg.probe_size(out_path)
    check("e2e: ffprobe 尺寸 1:1", (width, height) == (480, 480), f"{width}x{height}")
    check("e2e: 旁白已混轨", bool(result.get("narration_track")), str(result.get("narration_track")))

    inspection = result["inspector"]
    check("e2e: 质检通过", inspection["ok"], str(inspection["issues"]))
    checks = inspection["checks"]
    for name in ("resolution", "frame_rate", "audio_track", "av_sync", "black_screen"):
        check(f"e2e: 质检项 {name}", bool(checks.get(name, {}).get("ok")), str(checks.get(name)))
    check("e2e: 音轨编码 aac", inspection["audio"]["codec"] == "aac", str(inspection["audio"]))

    cover = preview.render_cover(out_path, output_path=WORK / "e2e_cover.jpg", offset_s=0.3)
    check("e2e: 封面抽取", Path(cover["output"]).exists() and cover["size_mb"] > 0, str(cover))


def main() -> int:
    try:
        test_text_to_shots()
        test_narration_track()
        test_stock_fetch()
        test_text_to_preview_480()
    finally:
        shutil.rmtree(WORK, ignore_errors=True)

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
