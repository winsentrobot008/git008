"""创意桥梁 + 渲染后端自检（无需 pytest，直接 python 运行）。

    python products/008-video-factory/tests/test_idea_to_drama_bridge.py
"""

from __future__ import annotations

import sys
from pathlib import Path

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PRODUCT_ROOT.parents[1]
for entry in (str(PRODUCT_ROOT), str(REPO_ROOT)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from modules.video_factory import idea_to_drama_bridge as bridge  # noqa: E402
from modules.video_factory import render_backend  # noqa: E402
from modules.video_factory.storyboard import validate_storyboard  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(condition), detail))


class StubClient:
    """返回固定 payload 的假 LLM 客户端。"""

    def __init__(self, payload: dict):
        self.payload = payload
        self.calls: list[str] = []

    def chat_structured(self, prompt, system=None, temperature=0.7):
        self.calls.append(prompt)
        return self.payload


BROKEN_SCRIPT = {
    "title": "broken",
    "characters": [{"id": "lin", "name": "林岚", "locked": True}],  # 缺 ref
    "shots": [
        {"id": "s1-01", "scene": "s1", "kind": "hook", "text": "开场", "camera": {"side": "left"}},
        {"id": "s1-02", "scene": "s1", "kind": "text", "text": "转折", "camera": {"side": "right"}},
        {"id": "s1-03", "scene": "s1", "kind": "cta", "text": "结尾", "characters": ["lin"], "camera": {"side": "right"}},
    ],
}


def test_offline_draft_valid() -> None:
    result = bridge.idea_to_drama(
        "凌晨两点的冰箱自己亮起。她决定打开它。门后是十年后的自己。",
        provider="offline",
        target_duration=12,
        shot_count=5,
    )
    sb = result["storyboard"]
    validate_storyboard(sb)
    check("bridge: 离线草稿合法", result["source"] == "offline", result["source"])
    check("bridge: 镜头数", sb["director_meta"]["shot_count"] == 5, str(sb["director_meta"]["shot_count"]))
    check("bridge: 无轴线违规", not sb["director_meta"]["violations"], str(sb["director_meta"]["violations"]))
    check("bridge: 时长贴近目标", abs(sb["director_meta"]["duration_seconds"] - 12) < 1.2, str(sb["director_meta"]["duration_seconds"]))
    check(
        "bridge: 视觉词已英文化",
        all(q.isascii() for s in sb["scenes"] for q in s["asset_queries"]),
        str([s["asset_queries"] for s in sb["scenes"]][:2]),
    )
    check("bridge: 标题去标点", result["director_script"]["title"] == "凌晨两点的冰箱自己亮起", result["director_script"]["title"])


def test_repair_loop_deterministic() -> None:
    # LLM 每次都返回同一个破损稿 → 确定性修复必须兜底
    client = StubClient(BROKEN_SCRIPT)
    result = bridge.idea_to_drama(
        "修复测试",
        client=client,
        prefer_llm=True,
        max_repairs=1,
        locked_assets={"characters": [{"id": "lin", "name": "林岚", "locked": True}]},
    )
    check("repair: 触发了重试", result["repair_attempts"] >= 1, str(result["repair_attempts"]))
    check("repair: 记录了报错", any("校验失败" in r for r in result["repairs"]), str(result["repairs"]))
    check("repair: 解除无效锁定", any("解除资产锁定" in r for r in result["repairs"]), str(result["repairs"]))
    check("repair: 拉回轴线", any("拉回轴线同侧" in r for r in result["repairs"]), str(result["repairs"]))
    check("repair: 最终通过校验", result["storyboard"]["director_meta"]["shot_count"] == 3)


def test_normalize_script() -> None:
    script = {
        "shots": [
            {"id": "a", "scene": "s1", "camera": {"side": "left"}},
            {"id": "b", "scene": "s1", "camera": {"side": "right"}},
            {"id": "c", "scene": "s1", "camera": {"side": "neutral"}},
            {"id": "d", "scene": "s1", "camera": {"side": "right"}},
        ],
        "characters": [{"id": "x", "locked": True}],
    }
    _, notes = bridge.normalize_script(script)
    sides = [s["camera"]["side"] for s in script["shots"]]
    check("normalize: 越轴被拉回", sides == ["left", "left", "neutral", "right"], str(sides))
    check("normalize: 中性镜头后允许新侧", sides[3] == "right")
    check("normalize: 解锁缺 ref 资产", script["characters"][0]["locked"] is False)
    check("normalize: 记录修复说明", len(notes) >= 2, str(notes))


def test_from_topic_data() -> None:
    topic = {
        "text": "Rust 1.90 发布，编译器更快了。社区讨论热烈。",
        "visual_keywords": ["microchip", "coding"],
        "source": "rss",
    }
    result = bridge.from_topic_data(topic, provider="offline", shot_count=4, target_duration=10)
    check("topic: 来源标注", result["storyboard"]["title"].startswith("rss"), result["storyboard"]["title"])
    check("topic: 首镜复用视觉词", result["storyboard"]["scenes"][0]["asset_queries"][0] == "microchip")
    check("topic: 生成合法分镜", result["storyboard"]["director_meta"]["shot_count"] == 4)


def test_empty_idea_rejected() -> None:
    try:
        bridge.idea_to_drama("   ", provider="offline")
        check("bridge: 空创意被拒绝", False, "未抛 BridgeError")
    except bridge.BridgeError:
        check("bridge: 空创意被拒绝", True)


def test_backend_routing() -> None:
    explicit = render_backend.resolve_backend("ffmpeg")
    check("backend: 显式 ffmpeg", explicit["backend"] == "ffmpeg" and "显式" in explicit["reason"])
    auto = render_backend.resolve_backend("auto")
    check("backend: auto 有决策", auto["backend"] in ("comfyui", "ffmpeg"), auto["backend"])
    if not auto["comfyui"]["available"]:
        check("backend: 离线降级原因可读", bool(auto["reason"]), auto["reason"])
    probe = render_backend.probe_comfyui(timeout=0.5)
    check("backend: 心跳探测不抛异常", isinstance(probe["available"], bool))
    try:
        render_backend.run_comfyui_svd({"scenes": []}, out_dir=PRODUCT_ROOT / "work" / "probe")
        check("backend: 无图片输入时报错", False, "未抛 RuntimeError")
    except RuntimeError as exc:
        check("backend: 无图片输入时报错", "图片素材" in str(exc), str(exc))
    try:
        render_backend.resolve_backend("bogus")
        check("backend: 非法后端被拒绝", False)
    except ValueError:
        check("backend: 非法后端被拒绝", True)


def main() -> int:
    for fn in (
        test_offline_draft_valid,
        test_repair_loop_deterministic,
        test_normalize_script,
        test_from_topic_data,
        test_empty_idea_rejected,
        test_backend_routing,
    ):
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - 自检需完整报告
            check(f"{fn.__name__}: 未预期异常", False, f"{type(exc).__name__}: {exc}")

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