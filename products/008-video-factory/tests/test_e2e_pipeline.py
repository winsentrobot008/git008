"""端到端自动化流水线自检（无需 pytest，直接运行）。

覆盖链路：原始文本 → 结构化分镜（script_text / search_keywords /
camera_movement）→ Edge-TTS 旁白时轴 → 图库素材暂存 → 480x480 草稿 MP4
+ 封面 → ffprobe 质检通过。

    python products/008-video-factory/tests/test_e2e_pipeline.py

说明：TTS 与图库下载均注入确定性替身（ffmpeg 生成正弦音 + 关键字命名短片），
不依赖网络与 Edge-TTS 服务；渲染与质检走真实 FFmpeg / ffprobe 路径。
"""

from __future__ import annotations

import argparse
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
from modules.video_factory import director_adapter, media, narration, pipeline, preview  # noqa: E402

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


def _fake_frame(prompt, out_path, seed=0):
    """确定性文生图替身：单帧测试图案，验证 ComfyUI 接线与降级分支。"""
    ffmpeg.run(
        ffmpeg.ffmpeg_bin(),
        [
            "-y", "-f", "lavfi", "-t", "1",
            "-i", "testsrc=size=512x512:rate=1",
            "-frames:v", "1", "-pix_fmt", "rgb24", str(out_path),
        ],
        timeout=120,
    )
    return {"ok": True, "elapsed_s": 0.1}


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
    # 两镜两条命中素材：每镜必须拿到属于自己的文件。
    _fixture(cache / "kitchen_fridge_night_2.mp4", "640x360")

    storyboard = director_adapter.text_to_storyboard(
        TEXT, shot_count=2, target_duration=5.0, provider="offline", visual_mapper=_mapper
    )
    staged = pipeline.stage_assets(storyboard, use_network=False, cache_dir=cache)
    report = staged["staging"]["assets"]
    check("stock: 命中本地关键字素材", report["resolved"] == 2, str(report["entries"]))
    check(
        "stock: 首镜优先关键字命中（local）",
        report["entries"][0]["via"] == "local",
        str(report["entries"][0]),
    )
    check(
        "stock: 记录来源与类型",
        all(str(e["via"]).startswith("local") and e["kind"] == "video" for e in report["entries"]),
        str(report["entries"]),
    )
    check("stock: 场景写入 source", all(s.get("source") for s in staged["scenes"]))
    check("stock: 缓存目录合约", report["cache_dir"].endswith("assets_cache"), report["cache_dir"])
    check(
        "stock: 逐镜素材互不重复",
        len({e["source"] for e in report["entries"]}) == len(report["entries"]),
        str([e["source"] for e in report["entries"]]),
    )

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
    _fixture(cache / "kitchen_fridge_night_2.mp4", "640x360")
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
    check(
        "e2e: 逐镜素材互不重复",
        len({s.get("source") for s in staged["scenes"]}) == 3,
        str([s.get("source") for s in staged["scenes"]]),
    )
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


def test_asset_priority() -> None:
    """5) 素材优先级：search_keywords 生效 → 本地缓存 → ComfyUI 补帧 → 渐变兜底。"""
    scene = {"search_keywords": ["fridge", "night", "kitchen"], "script_text": "凌晨两点的冰箱"}
    check(
        "media: 采纳 search_keywords",
        media.extract_queries(scene) == ["fridge", "night", "kitchen"],
        str(media.extract_queries(scene)),
    )

    # 图库下载常见哈希文件名：关键字打分为 0，但仍必须优先于纯渐变背景
    hash_cache = WORK / "hash_cache"
    hash_cache.mkdir(parents=True, exist_ok=True)
    _fixture(hash_cache / "9f2c41ab77de.mp4", "640x360")
    sb = director_adapter.text_to_storyboard(
        TEXT, shot_count=2, target_duration=5.0, provider="offline", visual_mapper=_mapper
    )
    staged_hash = pipeline.stage_assets(sb, use_network=False, cache_dir=hash_cache)
    rep = staged_hash["staging"]["assets"]
    check("media: 哈希名缓存仍被采用（不再纯渐变）", rep["resolved"] == 1, str(rep["entries"]))
    check(
        "media: 采用来源标记为缓存",
        str(rep["entries"][0]["via"]).startswith("local-cache"),
        str(rep["entries"]),
    )
    check(
        "media: 单素材不复用给第二镜（逐镜唯一）",
        rep["entries"][1]["via"] == "gradient"
        and len([s for s in (sc.get("source") for sc in staged_hash["scenes"]) if s]) == 1,
        str(rep["entries"]),
    )

    # 缺 Key 属配置问题：如实上报 no_api_key，而不是把整个会话谎报成网络熔断
    empty = WORK / "empty_cache"
    empty.mkdir(parents=True, exist_ok=True)
    if not media.has_pexels_key():
        outcome = media.resolve_scene_media_ex(scene, cache_dir=empty, use_network=True)
        reasons = (outcome["diagnostics"] or {}).get("reasons") or []
        check(
            "media: 无素材如实上报 no_stock_match",
            outcome["hit"] is None and outcome["reason"] == "no_stock_match",
            str(outcome)[:200],
        )
        check("media: 缺 Key 上报 no_api_key", "no_api_key" in reasons, str(reasons))
    else:
        check("media: 已配置 PEXELS_API_KEY，跳过缺 Key 断言", True, "key present")
        check("media: 已配置 PEXELS_API_KEY，跳过缺 Key 断言（诊断）", True, "key present")

    sb2 = director_adapter.text_to_storyboard(
        TEXT, shot_count=2, target_duration=5.0, provider="offline", visual_mapper=_mapper
    )
    comfy_cache = WORK / "comfy_cache"
    comfy_cache.mkdir(parents=True, exist_ok=True)
    rep2 = pipeline.stage_assets(
        sb2,
        use_network=False,
        cache_dir=comfy_cache,
        use_comfyui=True,
        image_generator=_fake_frame,
    )["staging"]["assets"]
    check("media: ComfyUI 在线时逐镜补帧", rep2["comfyui_images"] == 2, str(rep2["entries"]))
    check(
        "media: 每镜拿到独立生成帧",
        len({e["source"] for e in rep2["entries"]}) == 2
        and all(e["via"] == "comfyui-image" for e in rep2["entries"]),
        str(rep2["entries"]),
    )

    def _boom(prompt, out_path, seed=0):
        raise RuntimeError("ComfyUI 执行失败：node 3 KSampler 缺少 model 输入")

    sb3 = director_adapter.text_to_storyboard(
        TEXT, shot_count=2, target_duration=5.0, provider="offline", visual_mapper=_mapper
    )
    fail_cache = WORK / "comfy_fail"
    fail_cache.mkdir(parents=True, exist_ok=True)
    rep3 = pipeline.stage_assets(
        sb3,
        use_network=False,
        cache_dir=fail_cache,
        use_comfyui=True,
        image_generator=_boom,
    )["staging"]["assets"]
    check("media: ComfyUI 生成失败降级渐变", rep3["fallback"] == 2, str(rep3["entries"]))
    check(
        "media: 降级后仍保留可读原因",
        all(e["via"] == "gradient" and e["reason"] == "no_stock_match" for e in rep3["entries"]),
        str(rep3["entries"]),
    )


def test_render_robustness() -> None:
    """6) 渲染健壮性：短旁白不截断成片、逐镜提示词与种子互不相同。"""
    video = WORK / "robust_v5.mp4"
    ffmpeg.run(
        ffmpeg.ffmpeg_bin(),
        [
            "-y", "-f", "lavfi", "-t", "5",
            "-i", "testsrc=size=480x480:rate=24",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(video),
        ],
        timeout=120,
    )
    short_audio = WORK / "robust_a1_5.m4a"
    ffmpeg.run(
        ffmpeg.ffmpeg_bin(),
        [
            "-y", "-f", "lavfi", "-t", "1.5",
            "-i", "sine=frequency=440:sample_rate=24000", "-c:a", "aac", str(short_audio),
        ],
        timeout=120,
    )
    muxed = WORK / "robust_muxed.mp4"
    preview._mux_narration(video, short_audio, muxed)
    muxed_duration = ffmpeg.probe_duration(muxed)
    check(
        "render: 短旁白不截断成片（保持画面长度）",
        abs(muxed_duration - 5.0) <= 0.3,
        f"{muxed_duration:.2f}s",
    )

    sb = director_adapter.text_to_storyboard(
        TEXT, shot_count=3, target_duration=7.5, provider="offline", visual_mapper=_mapper
    )
    prompts = [pipeline._comfyui_image_prompt(s) for s in sb["scenes"]]
    check("render: 逐镜提示词互不相同", len(set(prompts)) == 3, str(prompts))

    seeds: list[int] = []

    def _seed_probe(prompt, out_path, seed=0):
        seeds.append(seed)
        return _fake_frame(prompt, out_path, seed=seed)

    seed_cache = WORK / "robust_seed"
    seed_cache.mkdir(parents=True, exist_ok=True)
    sb2 = director_adapter.text_to_storyboard(
        TEXT, shot_count=3, target_duration=7.5, provider="offline", visual_mapper=_mapper
    )
    pipeline.stage_assets(
        sb2,
        use_network=False,
        cache_dir=seed_cache,
        use_comfyui=True,
        image_generator=_seed_probe,
        comfyui_seed=100,
    )
    check("render: 种子 = base_seed + 镜序", seeds == [100, 101, 102], str(seeds))


def test_asset_distinctness() -> None:
    """7) 多镜唯一性：渲染前清空 job 缓存，同一素材绝不复用给第二个镜头。"""
    purge_cache = WORK / "distinct_purge"
    purge_cache.mkdir(parents=True, exist_ok=True)
    (purge_cache / "comfyui_shot_000.png").write_bytes(b"stale-frame-from-previous-job")
    (purge_cache / "9f2c41ab77de.mp4").write_bytes(b"stale-download")
    purged = pipeline.clear_stock_cache(purge_cache)
    check("cache: 渲染前清空 stale job 缓存", purged["removed"] == 2, str(purged))
    check(
        "cache: 清理后无残留素材",
        not [p for p in purge_cache.rglob("*") if p.is_file()],
        str(list(purge_cache.rglob("*"))),
    )

    one_cache = WORK / "distinct_single"
    one_cache.mkdir(parents=True, exist_ok=True)
    _fixture(one_cache / "fridge_night_kitchen.mp4", "640x360")
    sb = director_adapter.text_to_storyboard(
        TEXT, shot_count=3, target_duration=7.5, provider="offline", visual_mapper=_mapper
    )
    staged = pipeline.stage_assets(sb, use_network=False, cache_dir=one_cache)
    rep = staged["staging"]["assets"]
    sources = [s.get("source") for s in staged["scenes"]]
    check(
        "distinct: 单素材只覆盖一个镜头",
        rep["resolved"] == 1 and rep["fallback"] == 2,
        str(rep["entries"]),
    )
    check(
        "distinct: 其余镜头不复用同一文件",
        len([s for s in sources if s]) == 1 and len([s for s in sources if not s]) == 2,
        str(sources),
    )
    check(
        "distinct: 不再出现 local-cache-reused",
        all(e["via"] != "local-cache-reused" for e in rep["entries"]),
        str(rep["entries"]),
    )

    parser = argparse.ArgumentParser(prog="cli")
    sub = parser.add_subparsers(dest="command", required=True)
    pipeline.add_video_parser(sub)
    opt_in = parser.parse_args(["video", "director", "--input", "x.json", "--render", "--keep-assets"])
    default = parser.parse_args(["video", "director", "--input", "x.json", "--render"])
    check("cache: CLI 提供 --keep-assets 逃生门", getattr(opt_in, "keep_assets", False) is True, str(opt_in))
    check("cache: 默认渲染前清空缓存", getattr(default, "keep_assets", False) is False, str(default))



def test_shot_visual_diversity() -> None:
    """8) 六镜视觉唯一性：逐镜检索词 / 文生图提示词 / 随机种子 / 素材路径必须全部不同。"""
    text = (
        "凌晨两点的冰箱第三次自己亮起。"
        "她发现里面冻着一封写给未来的信。"
        "信上说：别怕，你正在成为你想成为的人。"
        "窗外的城市灯火一盏盏熄灭。"
        "她把信贴在胸口，决定明天就出发。"
        "清晨第一班地铁载着她驶向未知。"
    )
    sb = director_adapter.text_to_storyboard(
        text, shot_count=6, target_duration=15.0, provider="offline", visual_mapper=_mapper
    )
    scenes = sb["scenes"]
    check("diversity: 六镜剧本产出 6 个镜头", len(scenes) == 6, str(len(scenes)))

    keywords = [tuple(s.get("search_keywords") or []) for s in scenes]
    check(
        "diversity: 逐镜 search_keywords 互不相同",
        len(set(keywords)) == len(keywords),
        str([list(k) for k in keywords]),
    )
    prompts = [pipeline._comfyui_image_prompt(s) for s in scenes]
    check("diversity: 逐镜文生图提示词互不相同", len(set(prompts)) == len(prompts), str(prompts))

    seeds: list[int] = []
    outputs: list[str] = []

    def _div_probe(prompt, out_path, seed=0):
        seeds.append(seed)
        outputs.append(Path(out_path).name)
        return _fake_frame(prompt, out_path, seed=seed)

    div_cache = WORK / "diversity_cache"
    div_cache.mkdir(parents=True, exist_ok=True)
    sb2 = director_adapter.text_to_storyboard(
        text, shot_count=6, target_duration=15.0, provider="offline", visual_mapper=_mapper
    )
    staged = pipeline.stage_assets(
        sb2,
        use_network=False,
        cache_dir=div_cache,
        use_comfyui=True,
        image_generator=_div_probe,
    )
    check("diversity: 逐镜种子互不相同", len(set(seeds)) == 6, str(seeds))
    check(
        "diversity: 种子 = 随机基数 + 镜序",
        sorted(seeds) == list(range(min(seeds), min(seeds) + 6)),
        str(seeds),
    )
    check("diversity: 逐镜输出文件互不相同", len(set(outputs)) == 6, str(outputs))

    sources = [Path(str(s.get("source") or "")).name for s in staged["scenes"]]
    expected = [f"comfyui_shot_{i:03d}.png" for i in range(6)]
    check(
        "diversity: 场景 i 引用第 i 张图（不串用 0 号画面）",
        sources == expected,
        str(sources),
    )


def main() -> int:
    try:
        test_text_to_shots()
        test_narration_track()
        test_stock_fetch()
        test_asset_priority()
        test_render_robustness()
        test_text_to_preview_480()
        test_asset_distinctness()
        test_shot_visual_diversity()
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
