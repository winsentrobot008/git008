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

from modules.video_factory import director_adapter  # noqa: E402
from modules.video_factory import idea_to_drama_bridge as bridge  # noqa: E402
from modules.video_factory import render_backend  # noqa: E402
from modules.video_factory import semantic_bridge  # noqa: E402
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


def test_offline_draft_prompt_diversity() -> None:
    """离线草稿分镜（Web UI「生成导演分镜」的真实路径）逐镜提示词必须不同。"""
    idea = (
        "凌晨两点的冰箱第三次自己亮起。她发现里面冻着一封写给未来的信。"
        "信上说：别怕，你正在成为你想成为的人。窗外的城市灯火一盏盏熄灭。"
        "她把信贴在胸口，决定明天就出发。清晨第一班地铁载着她驶向未知。"
    )
    result = bridge.idea_to_drama(idea, provider="offline", shot_count=6, target_duration=15.0)
    shots = result["director_script"]["shots"]
    queries = [tuple(s.get("asset_queries") or []) for s in shots]
    check("draft: 产出 6 镜", len(shots) == 6, str(len(shots)))
    check("draft: 逐镜 asset_queries 互不相同", len(set(queries)) == 6, str([list(q) for q in queries]))
    generic = {keyword.lower() for keyword in director_adapter.DEFAULT_VISUAL_FALLBACK}
    check(
        "draft: 不再整片使用通用占位词",
        not any(set(q) <= generic for q in queries),
        str([list(q) for q in queries]),
    )
    scene_queries = [tuple(s["asset_queries"]) for s in result["storyboard"]["scenes"]]
    check(
        "draft: 画布场景逐镜提示词互不相同",
        len(set(scene_queries)) == 6,
        str([list(q) for q in scene_queries]),
    )
    check(
        "draft: 视觉词全英文",
        all(str(item).isascii() for keywords in queries for item in keywords),
        str([list(q) for q in queries]),
    )


def test_emotion_lexicon_is_concrete() -> None:
    """语义词典必须全是具象镜头：禁用 code / keyboard / network 类通用抽象词。"""
    lexicon = semantic_bridge.load_bridge()
    check("lexicon: 语义词典可加载", lexicon is not None, str(semantic_bridge.bridge_path()))
    if lexicon is None:
        return
    _ABSTRACT_VISUAL_BLOCKLIST = lexicon._ABSTRACT_VISUAL_BLOCKLIST
    _CONCRETE_HUMAN_FALLBACK = lexicon._CONCRETE_HUMAN_FALLBACK
    _EMOTION_VISUAL_MAP = lexicon._EMOTION_VISUAL_MAP
    _ZH_EMOTION_VISUAL_MAP = lexicon._ZH_EMOTION_VISUAL_MAP
    is_abstract_visual = lexicon.is_abstract_visual
    semantic_visuals = lexicon.semantic_visuals

    pool = [word for words in _EMOTION_VISUAL_MAP.values() for word in words]
    pool += [word for words in _ZH_EMOTION_VISUAL_MAP.values() for word in words]
    pool += list(_CONCRETE_HUMAN_FALLBACK)
    offenders = sorted({word for word in pool if is_abstract_visual(word)})
    check("lexicon: 无通用/抽象关键词", not offenders, str(offenders))
    check(
        "lexicon: 情绪/行为可映射具象镜头",
        semantic_visuals("焦虑型人格，一遇到压力就想回避，害怕失败。")[:1]
        == ["person walking away down a corridor"],
        str(semantic_visuals("焦虑型人格，一遇到压力就想回避，害怕失败。")),
    )
    check(
        "lexicon: 行为词映射到行动镜头",
        "person lacing running shoes at dawn" in semantic_visuals("先做，再改；先行动，再优化。", limit=24),
        str(semantic_visuals("先做，再改；先行动，再优化。", limit=24)),
    )
    check("lexicon: 禁用词表非空", bool(_ABSTRACT_VISUAL_BLOCKLIST), str(len(_ABSTRACT_VISUAL_BLOCKLIST)))


def main() -> int:
    for fn in (
        test_offline_draft_valid,
        test_repair_loop_deterministic,
        test_normalize_script,
        test_from_topic_data,
        test_empty_idea_rejected,
        test_backend_routing,
        test_offline_draft_prompt_diversity,
        test_emotion_lexicon_is_concrete,
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
