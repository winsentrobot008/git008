"""FFmpeg 覆盖写守卫回归（无需 pytest，直接 python 运行）。

    python products/008-video-factory/tests/test_ffmpeg_overwrite_guard.py

背景：render_cover() 曾缺少 -y。当 cover.jpg 已存在时，FFmpeg 会停在
`Overwrite? [y/N]` 交互提示上，直到 120s 超时——表现为"封面导出卡死"。
本测试锁定该回归：所有 FFmpeg 出片参数数组必须显式带 -y。
"""

from __future__ import annotations

import ast
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

from modules.video_factory import preview  # noqa: E402
from src.core import ffmpeg as core_ffmpeg  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []
PREVIEW_SRC = PRODUCT_ROOT / "modules" / "video_factory" / "preview.py"


def check(name: str, condition: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(condition), detail))


def _ffmpeg_calls_missing_y(source_path: Path) -> list[int]:
    """返回 `ffmpeg.run("ffmpeg", [...])` 中参数列表未以 -y 打头的行号。"""
    tree = ast.parse(source_path.read_text(encoding="utf-8"))
    offenders: list[int] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == "run" and len(node.args) >= 2):
            continue
        first, second = node.args[0], node.args[1]
        if not (isinstance(first, ast.Constant) and first.value == "ffmpeg"):
            continue
        if not isinstance(second, ast.List) or not second.elts:
            offenders.append(node.lineno)
            continue
        head = second.elts[0]
        if not (isinstance(head, ast.Constant) and head.value == "-y"):
            offenders.append(node.lineno)
    return offenders


def test_static_preview_calls_all_have_y() -> None:
    offenders = _ffmpeg_calls_missing_y(PREVIEW_SRC)
    check("static: preview.py 全部 ffmpeg.run 带 -y", not offenders, f"缺少 -y 的行号: {offenders}")


def test_render_cover_forces_overwrite() -> None:
    captured: list[list[str]] = []
    original = preview.ffmpeg.run

    def fake_run(cmd, args, **kwargs):  # noqa: ANN001
        captured.append(list(args))
        out = Path(args[-1])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"\xff\xd8\xff\xe0")
        return None

    preview.ffmpeg.run = fake_run
    try:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            video = tmp / "in.mp4"
            video.write_bytes(b"\x00\x00")
            cover = tmp / "cover.jpg"
            cover.write_bytes(b"stale")  # 关键：目标已存在，无 -y 时 FFmpeg 会交互阻塞
            result = preview.render_cover(video, output_path=cover, offset_s=0.5)
    finally:
        preview.ffmpeg.run = original

    args = captured[0] if captured else []
    check("render_cover: 恰好调用一次 ffmpeg", len(captured) == 1, str(len(captured)))
    check("render_cover: 首参数为 -y", bool(args) and args[0] == "-y", str(args[:3]))
    check(
        "render_cover: -y 位于 -i 之前",
        "-y" in args and "-i" in args and args.index("-y") < args.index("-i"),
        str(args),
    )
    check("render_cover: 输出为末参数", bool(args) and args[-1].endswith("cover.jpg"), str(args[-1:]))
    check("render_cover: 返回封面路径", str(result.get("output", "")).endswith("cover.jpg"), str(result))


def test_run_encode_prepends_y() -> None:
    captured: list[list[str]] = []
    originals = (core_ffmpeg.run, core_ffmpeg.ffmpeg_bin, core_ffmpeg.nvenc_enabled)

    def fake_run(binary, args, **kwargs):  # noqa: ANN001
        captured.append(list(args))
        Path(args[-1]).write_bytes(b"")
        return None

    core_ffmpeg.run = fake_run
    core_ffmpeg.ffmpeg_bin = lambda: "ffmpeg"
    core_ffmpeg.nvenc_enabled = lambda: False
    try:
        with tempfile.TemporaryDirectory() as td:
            core_ffmpeg.run_encode(["-i", "in.mp4"], Path(td) / "out.mp4")
    finally:
        core_ffmpeg.run, core_ffmpeg.ffmpeg_bin, core_ffmpeg.nvenc_enabled = originals

    args = captured[0] if captured else []
    check("run_encode: 首参数为 -y", bool(args) and args[0] == "-y", str(args[:3]))


def main() -> int:
    test_static_preview_calls_all_have_y()
    test_render_cover_forces_overwrite()
    test_run_encode_prepends_y()
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
