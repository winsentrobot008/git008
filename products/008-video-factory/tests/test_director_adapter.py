"""导演适配器自检（无需 pytest，直接 python 运行）。

    python products/008-video-factory/tests/test_director_adapter.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):  # Windows 控制台默认 cp1252/cp936
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PRODUCT_ROOT.parents[1]
for entry in (str(PRODUCT_ROOT), str(REPO_ROOT)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from modules.video_factory.director_adapter import (  # noqa: E402
    AssetLockError,
    AxisRuleError,
    adapt_director_script,
)
from modules.video_factory.storyboard import validate_storyboard  # noqa: E402

EXAMPLE = PRODUCT_ROOT / "templates" / "director" / "example_short_drama.json"
RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(condition), detail))


def _load_example() -> dict:
    return json.loads(EXAMPLE.read_text(encoding="utf-8"))


def test_happy_path() -> None:
    storyboard = adapt_director_script(_load_example(), strict_axis=True)
    validate_storyboard(storyboard)
    meta = storyboard["director_meta"]
    check("happy: 5 shots", meta["shot_count"] == 5, str(meta["shot_count"]))
    check("happy: 无轴线违规", not meta["violations"], str(meta["violations"]))
    locked = [s for s in storyboard["scenes"] if s.get("_asset_lock")]
    check("happy: 锁定镜头带 source", all(s.get("source") for s in locked), str(len(locked)))
    check("happy: 锁定镜头带 _media_kind", all(s.get("_media_kind") == "video" for s in locked))
    check("happy: asset_locks 记录 >= 3", len(meta["asset_locks"]) >= 3, str(len(meta["asset_locks"])))
    check("happy: voice_script 非空", len(storyboard["voice_script"]) >= 3, str(len(storyboard["voice_script"])))
    starts = [v["start_seconds"] for v in storyboard["voice_script"]]
    check("happy: 配音时间轴单调不减", starts == sorted(starts), str(starts))
    check("happy: 总时长 = 各镜之和", abs(meta["duration_seconds"] - 14.0) < 0.01, str(meta["duration_seconds"]))


def test_asset_lock_violation() -> None:
    script = {
        "title": "lock-violation",
        "characters": [{"id": "lin", "name": "林岚", "locked": True}],
        "shots": [{"id": "a1", "kind": "hook", "text": "测试", "characters": ["lin"]}],
    }
    try:
        adapt_director_script(script)
        check("lock: 缺 ref 被拦截", False, "未抛出 AssetLockError")
    except AssetLockError as exc:
        check("lock: 缺 ref 被拦截", "锁定违规" in str(exc), str(exc))


def test_axis_strict_fails() -> None:
    script = {
        "title": "axis-violation",
        "shots": [
            {"id": "a1", "kind": "hook", "text": "一", "camera": {"side": "left"}},
            {"id": "a2", "kind": "text", "text": "二", "camera": {"side": "right"}},
        ],
    }
    try:
        adapt_director_script(script, strict_axis=True)
        check("axis: strict 越轴报错", False, "未抛出 AxisRuleError")
    except AxisRuleError as exc:
        check("axis: strict 越轴报错", "轴线违规" in str(exc), str(exc))

    soft = adapt_director_script(script, strict_axis=False)
    check("axis: 非 strict 记录违规", len(soft["director_meta"]["violations"]) == 1)
    check("axis: 非 strict 有 warning", bool(soft["director_meta"]["warnings"]))


def test_axis_break_allowed() -> None:
    script = {
        "title": "axis-break",
        "shots": [
            {"id": "a1", "kind": "hook", "text": "一", "camera": {"side": "left"}},
            {"id": "a2", "kind": "text", "text": "二", "camera": {"side": "right", "axis_break": True}},
        ],
    }
    s = adapt_director_script(script, strict_axis=True)
    check("axis: 声明 axis_break 放行", not s["director_meta"]["violations"])


def test_nested_scenes_and_fallback() -> None:
    script = {
        "title": "nested",
        "scenes": [
            {
                "id": "sc1",
                "characters": ["hero"],
                "shots": [
                    {"kind": "hook", "text": "开场", "camera": {"shot_size": "wide"}},
                ],
            },
            {
                "id": "sc2",
                "shots": [
                    {"kind": "unknown_kind_xyz", "text": "", "asset_queries": []},
                ],
            },
        ],
        "characters": [{"id": "hero", "name": "主角", "visual_keywords": ["cyberpunk street"]}],
    }
    s = adapt_director_script(script)
    check("nested: 拍平为 2 镜", len(s["scenes"]) == 2, str(len(s["scenes"])))
    check("nested: 角色视觉词生效", s["scenes"][0]["asset_queries"][0] == "cyberpunk street")
    check(
        "nested: 兜底视觉词",
        s["scenes"][1]["asset_queries"] == ["technology background", "abstract digital network", "modern office laptop"],
        str(s["scenes"][1]["asset_queries"]),
    )


def test_visual_mapper_injection() -> None:
    script = {"title": "mapper", "shots": [{"kind": "hook", "text": "AI 趋势"}]}
    s = adapt_director_script(script, visual_mapper=lambda q, t: ["artificial intelligence", "glowing brain"])
    check("mapper: 注入生效", s["scenes"][0]["asset_queries"][0] == "artificial intelligence")


def main() -> int:
    checks = [
        test_happy_path,
        test_asset_lock_violation,
        test_axis_strict_fails,
        test_axis_break_allowed,
        test_nested_scenes_and_fallback,
        test_visual_mapper_injection,
    ]
    for fn in checks:
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - 自检脚本需完整报告
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