# -*- coding: utf-8 -*-
"""008-video-factory 系统级策略自检（无需 pytest，直接 python 运行）。

覆盖本轮重构的四条主线：
1. 单一样板策略：--samples 收敛、output/ 只留最新 1 份；
2. SD-first 素材工作流：Prompt Engine 语义绑定 + 严格禁用通用视频切片；
3. --text 行首时间码定格分镜时长；--title / --topic 解耦；
4. CLI 契约：--samples / --keep-samples 出现在 director / text / one-click 入口。

    python products/008-video-factory/tests/test_video_factory_policy.py
"""

from __future__ import annotations

import argparse
import io
import os
import shutil
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PRODUCT_ROOT.parents[1]
for entry in (str(PRODUCT_ROOT), str(REPO_ROOT)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from modules.video_factory import (  # noqa: E402
    idea_to_drama_bridge,
    media,
    pipeline,
    storyboard,
    sample_policy,
)
from server import pipeline_runner  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []
WORK = Path(tempfile.mkdtemp(prefix="vf_policy_"))

BEATS = [
    "0-10s 很多焦虑的人，都想学马斯克。但真相是，你和马斯克最大的区别，不是智商，而是处理焦虑的方式。",
    "10-25s 焦虑型人格，一遇到压力就想回避，害怕失败，害怕别人评价。而马斯克呢？他反而主动冲进压力，把危机当成燃料，把失败当成实验数据。",
    "25-35s 同样是不安，一个向内消耗，一个向外创造。所以，别想着变成马斯克，而是学会他的思维方式。",
    '35-50s 第一，把焦虑当成警报，不是判决书。第二，别问"我够不够好"，而是问"问题在哪里，下一步怎么办"。第三，用迭代代替完美。先做，再改；先行动，再优化。',
    "50-60s 记住一句话：焦虑不是你的敌人，停止行动才是。当你把焦虑从精神内耗，变成解决问题的动力，它就会从你的负担，变成你的火箭燃料。",
]


def check(name: str, condition: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(condition), detail))


def _fake_generator(prompt, out_path, seed=0):
    """确定性文生图替身：直接落盘一张非空 PNG 占位（不依赖 ffmpeg/网络）。"""
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_bytes(f"png:{seed}".encode("utf-8"))
    return {"prompt": prompt, "seed": seed, "elapsed_s": 0.0}


# --------------------------------------------------------------------------
# 1) 单一样板策略
# --------------------------------------------------------------------------
def test_single_sample_cap() -> None:
    check("policy: MAX_SAMPLES == 1", sample_policy.MAX_SAMPLES == 1, str(sample_policy.MAX_SAMPLES))
    check("policy: 请求 1 → 1", sample_policy.single_sample_count(1) == 1)
    check("policy: 请求 3 → 收敛为 1", sample_policy.single_sample_count(3) == 1)
    check("policy: 空请求 → 1", sample_policy.single_sample_count(None) == 1)
    check(
        "policy: server 复用同一阈值",
        pipeline_runner.MAX_SAMPLES == sample_policy.MAX_SAMPLES
        and pipeline_runner.single_sample_count(5) == 1,
        str(pipeline_runner.MAX_SAMPLES),
    )


def test_prune_output_samples() -> None:
    out = WORK / "prune_out"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    keep = out / "keep.mp4"
    keep.write_bytes(b"final-cut")
    older = out / "older_sample.mp4"
    older.write_bytes(b"stale")
    legacy_mov = out / "legacy.mov"
    legacy_mov.write_bytes(b"stale")
    stale_cover = out / "cover.jpg"
    stale_cover.write_bytes(b"stale-cover")
    keep_cover = out / "report.txt"  # 非样板扩展名：必须保留
    keep_cover.write_text("keep me", encoding="utf-8")

    removed = sample_policy.prune_output_samples(keep, output_dir=out)
    check("prune: 删掉历史样板", "older_sample.mp4" in removed and "legacy.mov" in removed, str(removed))
    check("prune: 保留本次成片", keep.exists())
    check("prune: 清理无主封面", not stale_cover.exists())
    check("prune: 保留非样板文件", keep_cover.exists())
    check("prune: 目录只剩 1 份成片", len(list(out.glob("*.mp4"))) == 1, str(sorted(p.name for p in out.iterdir())))

    # enabled=False（--keep-samples）时什么都不删
    other = out / "another.mp4"
    other.write_bytes(b"x")
    check("prune: enabled=False 不清理", sample_policy.prune_output_samples(keep, output_dir=out, enabled=False) == [])
    check("prune: enabled=False 保留历史样本", other.exists())

    # 带封面一起保留
    keep2 = out / "keep2.mp4"
    keep2.write_bytes(b"2")
    cover2 = out / "cover.keep.jpg"
    cover2.write_bytes(b"2")
    sample_policy.prune_output_samples(keep2, cover=cover2, output_dir=out)
    check("prune: 成片 + 封面同时保留", keep2.exists() and cover2.exists(), str(sorted(p.name for p in out.iterdir())))


def test_server_prune_binds_output_dir() -> None:
    out = WORK / "server_out"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    (out / "old.mp4").write_bytes(b"old")
    keep = out / "new.mp4"
    keep.write_bytes(b"new")

    real = pipeline_runner.OUTPUT_DIR
    pipeline_runner.OUTPUT_DIR = out
    try:
        removed = pipeline_runner.prune_output_samples(keep)
    finally:
        pipeline_runner.OUTPUT_DIR = real
    check("prune: server 版本只留最新成片", removed == ["old.mp4"] and keep.exists(), str(removed))


def test_keep_samples_env() -> None:
    real = os.environ.get(sample_policy.KEEP_SAMPLES_ENV)
    os.environ[sample_policy.KEEP_SAMPLES_ENV] = "1"
    try:
        check("policy: 环境变量逃生门生效", sample_policy.keep_samples_from_env() is True)
    finally:
        if real is None:
            os.environ.pop(sample_policy.KEEP_SAMPLES_ENV, None)
        else:
            os.environ[sample_policy.KEEP_SAMPLES_ENV] = real
    check("policy: 默认关闭逃生门", sample_policy.keep_samples_from_env() is False)


# --------------------------------------------------------------------------
# 2) Prompt Engine（SD-first 第一步）
# --------------------------------------------------------------------------
def test_prompt_engine_semantic_binding() -> None:
    prompts = [storyboard.build_sd_prompt(beat, index=i) for i, beat in enumerate(BEATS)]
    check("prompt: 逐镜提示词互不相同", len(set(prompts)) == len(prompts), str(prompts))
    check("prompt: 全部为 ASCII（SD1.5 不识别中文）", all(p.isascii() for p in prompts), str(prompts))
    check("prompt: 含画质词", all("cinematic lighting" in p for p in prompts))

    # Beat 1 焦虑 → 具象焦虑镜头；Beat 5 火箭燃料 → 火箭/燃料镜头。
    anxiety = storyboard.build_sd_prompt(BEATS[0], index=0)
    check("prompt: 焦虑 Beat → 具象焦虑主语", "stressed" in anxiety or "anxious" in anxiety, anxiety)
    rocket = storyboard.build_sd_prompt(BEATS[4], index=4)
    check(
        "prompt: 火箭燃料 Beat → 火箭/燃料主语",
        "rocket" in rocket or "booster" in rocket or "jet engine" in rocket,
        rocket,
    )
    check(
        "prompt: 情绪基调来自词典",
        storyboard.sd_semantics(BEATS[0]).get("mood", "").endswith("mood"),
        str(storyboard.sd_semantics(BEATS[0])),
    )

    # 抽象词黑名单：显式传入 generic 主语也必须被剔除。
    polluted = storyboard.build_sd_prompt(
        BEATS[0], subjects=["code", "keyboard on a laptop", "network diagram"], index=0
    )
    check(
        "prompt: 抽象/generic 主语被剔除",
        not any(tok in polluted.lower() for tok in ("code", "keyboard", "network", "laptop")),
        polluted,
    )
    check("prompt: 剔除后回退到语义主语", "stressed" in polluted or "anxious" in polluted, polluted)

    square = storyboard.build_sd_prompt(
        BEATS[0], movement="push_in", aspect=storyboard.aspect_tag(480, 480), index=0
    )
    check("prompt: 画幅 + 运镜标签入词", "1:1" in square and "close-up framing" in square, square)
    check("aspect_tag: 9:16 竖屏", "9:16" in storyboard.aspect_tag(1080, 1920))


def test_validate_storyboard_attaches_sd_prompt() -> None:
    scenes = [
        {"type": "text_card", "text": beat, "script_text": beat, "duration_s": 5} for beat in BEATS
    ]
    data = storyboard.validate_storyboard({"title": "焦虑与马斯克", "width": 480, "height": 480, "scenes": scenes})
    prompts = [s["sd_prompt"] for s in data["scenes"]]
    check("validate: 每镜挂载 sd_prompt", all(prompts), str(prompts))
    check("validate: sd_prompt 逐镜唯一", len(set(prompts)) == len(prompts), str(prompts))
    check("validate: 画幅标签为 1:1", all("1:1" in p for p in prompts), str(prompts))

    prompt = pipeline._comfyui_image_prompt(data["scenes"][0])
    check("pipeline: 文生图提示词优先取 sd_prompt", prompt == prompts[0], prompt[:80])


def test_prompt_engine_binds_fridge_narrative() -> None:
    """灾难回归点：冰箱悬疑文案绝不能被配成火箭 / 写字楼 / 运动鞋。

    「素材与文案脱节」的根因是泛化检索词替文案断言了一个它没说过的主体；本用例
    锁定现在的契约：画面必须来自本镜的具象名词 + 时空，且逐镜不同。
    """
    beats = [
        "凌晨两点的冰箱第三次自己亮起",
        "她发现里面冻着一封写给未来的信",
        "信上说：别怕，你正在成为你想成为的人",
    ]
    prompts = [
        storyboard.build_sd_prompt(beat, index=i, aspect=storyboard.aspect_tag(1080, 1920))
        for i, beat in enumerate(beats)
    ]
    check("fridge: 逐镜提示词互不相同", len(set(prompts)) == len(prompts), str(prompts))
    check(
        "fridge: 首镜落到冰箱画面",
        "refrigerator" in prompts[0].lower() or "fridge" in prompts[0].lower(),
        prompts[0],
    )
    check("fridge: 场景时空写入提示词（凌晨两点）", "two in the morning" in prompts[0], prompts[0])
    off_context = ("rocket", "launch pad", "boardroom", "running shoes", "office")
    check(
        "fridge: 不出现与文案脱节的泛化镜头",
        not any(word in prompt.lower() for prompt in prompts for word in off_context),
        str(prompts),
    )
    check(
        "fridge: 信件 Beat 落到信的画面",
        "letter" in prompts[1].lower() or "envelope" in prompts[1].lower(),
        prompts[1],
    )
    check(
        "fridge: 提示词仍为 ASCII（SD1.5 不识别中文）",
        all(p.isascii() for p in prompts),
        str(prompts),
    )
    # 多主体 Beat：「信 + 出发」两个情节都要进画面，不能只留前半句（情节丢一半）。
    multi = storyboard.build_sd_prompt(
        "她把信贴在胸口，决定明天就出发", index=4, aspect=storyboard.aspect_tag(1080, 1920)
    )
    check(
        "fridge: 多主体 Beat 同时覆盖「信」与「出发」",
        "letter" in multi.lower()
        and any(word in multi.lower() for word in ("suitcase", "bag", "doorway")),
        multi,
    )
    # 长词优先：「冰箱」命中后不得再叠加「冰」的冰晶特写（主体被旁支画面抢走）。
    check(
        "fridge: 长词优先，冰箱 Beat 不混入「冰」特写",
        "ice crystals" not in prompts[0].lower(),
        prompts[0],
    )


def test_semantic_bridge_keeps_sys_path_clean() -> None:
    """语义词典加载绝不污染 sys.path：否则 scripts/server.py 会顶掉同名 server 包。"""
    from modules.video_factory import semantic_bridge

    before = list(sys.path)
    bridge = semantic_bridge.load_bridge()
    check("bridge: 词典可加载", bridge is not None, str(semantic_bridge.bridge_path()))
    check(
        "bridge: sys.path 未被污染",
        list(sys.path) == before,
        str([p for p in sys.path if p not in before]),
    )
    check(
        "bridge: sys.path 不含 scripts 目录",
        not any(str(p).replace("\\", "/").rstrip("/").endswith("/scripts") for p in sys.path),
        str(sys.path[:6]),
    )
    check(
        "bridge: server 仍解析为产品包",
        pipeline_runner.__name__ == "server.pipeline_runner",
        pipeline_runner.__name__,
    )


# --------------------------------------------------------------------------
# 3) SD-first 素材工作流：严格禁视频
# --------------------------------------------------------------------------
def test_video_slices_disabled() -> None:
    cache = WORK / "video_only_cache"
    if cache.exists():
        shutil.rmtree(cache)
    cache.mkdir(parents=True)
    (cache / "anxious-man-alone-at-desk.mp4").write_bytes(b"stock-video")
    scene = {"asset_queries": ["anxious man alone at desk"], "text": ""}

    banned = media.resolve_scene_media_ex(
        scene, cache_dir=cache, use_network=False, allow_cache_reuse=False, allow_video=False
    )
    check("media: allow_video=False 严格禁用视频切片", banned["hit"] is None, str(banned))

    allowed = media.resolve_scene_media_ex(
        scene, cache_dir=cache, use_network=False, allow_cache_reuse=False, allow_video=True
    )
    hit = allowed.get("hit") or {}
    check("media: allow_video=True 仍可用视频（legacy 路径）", hit.get("kind") == "video", str(allowed))


def test_stage_assets_sd_first() -> None:
    cache = WORK / "sd_first_cache"
    if cache.exists():
        shutil.rmtree(cache)
    cache.mkdir(parents=True)
    scenes = [
        {"type": "text_card", "text": beat, "script_text": beat, "duration_s": 5} for beat in BEATS
    ]
    data = storyboard.validate_storyboard({"title": "sd-first", "width": 480, "height": 480, "scenes": scenes})

    out = io.StringIO()
    with redirect_stdout(out):
        staged = pipeline.stage_assets(
            data,
            use_network=False,
            cache_dir=cache,
            use_comfyui=True,
            image_generator=_fake_generator,
        )
    report = staged["staging"]["assets"]
    check("stage: 策略标记为 sd-first", report["policy"] == "sd-first", str(report.get("policy")))
    check("stage: 逐镜都走了本地 SD 出图", report["comfyui_images"] == len(scenes), str(report["comfyui_images"]))
    check("stage: 严格禁视频（stock_video_used=0）", report["stock_video_used"] == 0, str(report["stock_video_used"]))
    check(
        "stage: 每镜 source 指向专属概念图",
        all("comfyui_shot_" in str(s.get("source") or "") for s in staged["scenes"]),
        str([s.get("source") for s in staged["scenes"]]),
    )
    check(
        "stage: 逐镜概念图不重复",
        len({s.get("source") for s in staged["scenes"]}) == len(scenes),
        str([s.get("source") for s in staged["scenes"]]),
    )


# --------------------------------------------------------------------------
# 4) 时间码 / 标题解耦 / CLI 契约
# --------------------------------------------------------------------------
def test_timecode_parsing() -> None:
    parse = idea_to_drama_bridge._parse_time_span
    check("timecode: '0-10s 文案' → 10s", parse("0-10s 正文") == (10.0, "正文"), str(parse("0-10s 正文")))
    check("timecode: '【35-50 秒】' → 15s", parse("【35-50 秒】正文")[0] == 15.0, str(parse("【35-50 秒】正文")))
    check("timecode: 年份区间不算时间码", parse("2020-2021 年的大事")[0] is None, str(parse("2020-2021 年的大事")))
    check("timecode: 无正文不算时间码", parse("10-25s")[0] is None, str(parse("10-25s")))

    draft = idea_to_drama_bridge.offline_draft("\n".join(BEATS), target_duration=60, shot_count=5)
    durations = [shot["duration_s"] for shot in draft["shots"]]
    check("timecode: 5 段 Beat → 5 镜", len(durations) == 5, str(durations))
    check(
        "timecode: 时长按行首时间码定格",
        durations == [10.0, 15.0, 10.0, 15.0, 10.0],
        str(durations),
    )
    check("timecode: 总时长 ≈ 60s", abs(sum(durations) - 60.0) < 0.6, str(sum(durations)))
    check(
        "timecode: 正文不含时间码前缀",
        all(not shot["text"].startswith(("0-", "10-", "25-", "35-", "50-")) for shot in draft["shots"]),
        str([s["text"][:12] for s in draft["shots"]]),
    )


def test_title_topic_decoupled() -> None:
    import run_one_click_video as one_click

    body = "\n".join(BEATS)
    ns = argparse.Namespace(
        text=body,
        topic="焦虑型人格，能不能复制马斯克？",
        title="自定义标题",
        source="auto",
        style="科普",
        duration=60.0,
        shots=5,
        provider=None,
        offline=True,
    )
    script, meta = one_click._build_storyboard(ns)
    check("one-click: --text 驱动分镜（不被 --topic 覆盖）", meta["idea"] == body, str(meta["idea"])[:40])
    check("one-click: --title 优先于 --topic", meta["title"] == "自定义标题", str(meta["title"]))
    check("one-click: 标题落入分镜", script["title"] == "自定义标题", str(script.get("title")))

    ns.title = None
    _, meta2 = one_click._build_storyboard(ns)
    check("one-click: 未给 --title 时取 --topic", meta2["title"] == "焦虑型人格，能不能复制马斯克？", str(meta2["title"]))

    # --topic 只在缺 --text 时用于取材，绝不出现在 idea 里
    check("one-click: idea 始终等于 --text 原文", meta2["idea"] == body and "能不能复制" not in meta2["idea"])


def test_cli_exposes_samples() -> None:
    parser = argparse.ArgumentParser(prog="cli")
    sub = parser.add_subparsers(dest="command", required=True)
    pipeline.add_video_parser(sub)

    director = parser.parse_args(["video", "director", "--input", "x.json"])
    check("cli: director 默认 --samples 1", director.samples == 1, str(director.samples))
    check("cli: director 默认保留策略开启", director.keep_samples is False)

    text = parser.parse_args(["video", "text", "--text", "hi"])
    check("cli: text 默认 --samples 1", text.samples == 1, str(text.samples))

    capped = parser.parse_args(["video", "director", "--input", "x.json", "--samples", "3"])
    check(
        "cli: >1 的 --samples 被收敛并告警",
        pipeline._requested_samples(capped) == 1,
        str(capped.samples),
    )

    import run_one_click_video as one_click

    oc = one_click._build_parser().parse_args(["--topic", "x"])
    check("cli: one-click 暴露 --samples（默认 1）", oc.samples == 1, str(oc.samples))


def main() -> int:
    checks = [
        test_single_sample_cap,
        test_prune_output_samples,
        test_server_prune_binds_output_dir,
        test_keep_samples_env,
        test_prompt_engine_semantic_binding,
        test_validate_storyboard_attaches_sd_prompt,
        test_prompt_engine_binds_fridge_narrative,
        test_semantic_bridge_keeps_sys_path_clean,
        test_video_slices_disabled,
        test_stage_assets_sd_first,
        test_timecode_parsing,
        test_title_topic_decoupled,
        test_cli_exposes_samples,
    ]
    try:
        for fn in checks:
            try:
                fn()
            except Exception as exc:  # noqa: BLE001 - 自检脚本需完整报告
                check(f"{fn.__name__}: 未预期异常", False, f"{type(exc).__name__}: {exc}")
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
