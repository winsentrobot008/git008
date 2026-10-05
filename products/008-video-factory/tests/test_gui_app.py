"""Streamlit 界面联调自检（AppTest 真实执行 gui.py，无需浏览器）。

    python products/008-video-factory/tests/test_gui_app.py
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

from streamlit.testing.v1 import AppTest  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(condition), detail))


def _click(at: AppTest, label: str, timeout: int = 300) -> AppTest:
    target = next((b for b in at.button if label in b.label), None)
    if target is None:
        raise AssertionError(f"未找到按钮：{label}")
    return target.click().run(timeout=timeout)


def main() -> int:
    at = AppTest.from_file(str(PRODUCT_ROOT / "gui.py"), default_timeout=300)
    at.run()
    check("gui: 首次渲染无异常", not at.exception, str(at.exception))
    check("gui: 短剧专区已挂载", any("短剧" in h.value for h in at.header), str([h.value for h in at.header]))
    check("gui: 存在生成导演分镜按钮", any("生成导演分镜" in b.label for b in at.button))

    # 侧边栏 Node 选项：必须带"不可用"标记，选中后给友好提示而不是未捕获异常
    import shutil  # noqa: PLC0415

    node_label = "完整管线 (需 Node.js 环境 - 当前不可用)"
    node_radio = next(
        (r for r in at.sidebar.radio if node_label in [str(o) for o in r.options]), None
    )
    check("gui: 侧边栏 Node 选项已标记不可用", node_radio is not None, str([r.options for r in at.sidebar.radio]))
    if node_radio is not None:
        at = node_radio.set_value(node_label).run()
        check("gui: 选中 Node 选项无未捕获异常", not at.exception, str(at.exception))
        warnings = [w.value for w in at.warning]
        if shutil.which("node") is None:
            check("gui: 选中 Node 选项展示友好提示", any("Node.js" in w for w in warnings), str(warnings))
        at = at.sidebar.radio[0].set_value("分镜预览（FFmpeg，快）").run()
        check("gui: 可切回 Python 预览模式", not at.exception, str(at.exception))

    at = _click(at, "生成导演分镜")
    result = at.session_state.get("drama_result")
    check("gui: 创意→分镜生成成功", bool(result), str(at.exception))
    if result:
        meta = result["storyboard"]["director_meta"]
        check("gui: 分镜通过导演规范", not meta["violations"], str(meta["violations"]))
        check("gui: 编辑器已回填分镜", "shots" in (at.session_state.get("drama_editor") or ""))
    check("gui: 生成后无异常", not at.exception, str(at.exception))

    at = _click(at, "渲染导演分镜")
    report = at.session_state.get("drama_report")
    check("gui: 渲染无异常", not at.exception, str(at.exception))
    check("gui: 渲染产出报告", bool(report), str(at.exception))
    if report:
        check("gui: 渲染后端已标注", bool(report.get("backend")), str(report.get("backend")))
        check("gui: ffprobe 质检通过", report.get("inspect_ok") is True, str(report.get("checks")))
        out = report.get("output")
        check("gui: 成片存在", bool(out) and Path(out).exists(), str(out))
        cover = (report.get("cover") or {}).get("output")
        check("gui: 封面存在", bool(cover) and Path(cover).exists(), str(cover))

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