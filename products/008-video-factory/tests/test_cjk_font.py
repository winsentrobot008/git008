"""FFmpeg drawtext CJK 字体回归（无需 pytest，直接 python 运行）。

    python products/008-video-factory/tests/test_cjk_font.py

背景：drawtext 不会自动做 CJK 字形回退。字体若只含拉丁字形，中文会被渲染成
tofu 方框（□□□□）。本测试锁定三件事：
  1. 字体候选表优先 CJK、且首个命中候选不是纯拉丁字体；
  2. drawtext 过滤串显式携带 fontfile；
  3. 实际渲染出的中文是真实字形——顺序不同的汉字必须产生不同位图
     （tofu 方框彼此相同，位图会完全一致，因此该断言能精确排除 tofu）。
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

PRODUCT_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PRODUCT_ROOT.parents[1]
for entry in (str(PRODUCT_ROOT), str(REPO_ROOT)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

if hasattr(sys.stdout, "reconfigure"):  # Windows 控制台默认 cp1252/cp936
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from modules.video_factory import preview  # noqa: E402

RESULTS: list[tuple[str, bool, str]] = []
SKIPPED: list[tuple[str, str]] = []

ZH_A = "\u4e2d\u6587\u6d4b\u8bd5"   # 中文测试
ZH_B = "\u6d4b\u8bd5\u4e2d\u6587"   # 测试中文（同字集、顺序不同）

CJK_HINTS = ("msyh", "simhei", "simsun", "deng", "notosanscjk", "pingfang",
             "sourcehansans", "wqy", "hei")
LATIN_ONLY_HINTS = ("arial", "segoeui", "dejavu", "liberationsans", "helvetica",
                    "tahoma", "calibri")


def check(name: str, condition: bool, detail: str = "") -> None:
    RESULTS.append((name, bool(condition), detail))


def skip(name: str, reason: str) -> None:
    SKIPPED.append((name, reason))


def _is_cjk_font(name: str) -> bool:
    low = str(name).lower()
    return any(hint in low for hint in CJK_HINTS)


def _is_latin_only_font(name: str) -> bool:
    low = str(name).lower()
    return any(hint in low for hint in LATIN_ONLY_HINTS)


def _first_existing(candidates: list[str]) -> str | None:
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    return None


def _ffmpeg() -> str | None:
    return shutil.which("ffmpeg")


def _render(tmp: Path, font_ref: str, text: str, out_name: str) -> Path:
    """用 preview._drawtext 构造 filter，在工作目录内真实渲染一帧 PNG。"""
    txt = tmp / (out_name + ".txt")
    txt.write_text(text, encoding="utf-8")
    vf = preview._drawtext(txt.name, fontsize=64, fontfile=font_ref)
    subprocess.run(
        [_ffmpeg(), "-y", "-v", "error", "-f", "lavfi", "-i", "color=black:s=520x140",
         "-vf", vf, "-frames:v", "1", out_name],
        cwd=tmp, check=True, capture_output=True,
    )
    return tmp / out_name


def _gray(png: Path) -> bytes:
    proc = subprocess.run(
        [_ffmpeg(), "-v", "error", "-i", str(png), "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, check=True,
    )
    return proc.stdout


def _ink(data: bytes) -> int:
    return sum(1 for byte in data if byte > 128)


def _diff(a: bytes, b: bytes) -> int:
    return sum(1 for x, y in zip(a, b) if abs(x - y) > 32)


def test_font_candidates_prefer_cjk() -> None:
    for target, candidates in preview._FONT_SOURCES.items():
        cjk_idx = [i for i, c in enumerate(candidates) if _is_cjk_font(c)]
        latin_idx = [i for i, c in enumerate(candidates) if _is_latin_only_font(c)]
        check(f"static: {target} 候选表含 CJK 字体", bool(cjk_idx), str(candidates))
        if cjk_idx and latin_idx:
            check(
                f"static: {target} CJK 候选排在纯拉丁之前",
                min(cjk_idx) < min(latin_idx),
                f"cjk={cjk_idx} latin={latin_idx}",
            )
        chosen = _first_existing(candidates)
        if chosen is None:
            skip(f"static: {target} 首个命中候选为 CJK", "本机无任何命中字体")
        else:
            check(f"static: {target} 首个命中候选为 CJK 字体", _is_cjk_font(chosen), chosen)


def test_drawtext_emits_fontfile() -> None:
    default_filter = preview._drawtext("t.txt", fontsize=40)
    check(
        "drawtext: 默认显式引用 font_bold.ttf",
        f"fontfile={preview._FONT_BOLD}" in default_filter,
        default_filter,
    )
    custom_filter = preview._drawtext("t.txt", fontsize=40, fontfile=preview._FONT_REGULAR)
    check(
        "drawtext: 可显式指定 fontfile",
        f"fontfile={preview._FONT_REGULAR}" in custom_filter,
        custom_filter,
    )


def test_staged_font_renders_real_cjk() -> None:
    if not _ffmpeg():
        skip("e2e: 渲染真实汉字字形", "ffmpeg 不在 PATH")
        return
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        preview._stage_fonts(tmp)
        staged = sorted(p.name for p in tmp.iterdir())
        check("stage: font_bold.ttf 已落盘", (tmp / preview._FONT_BOLD).exists(), str(staged))
        check("stage: font_regular.ttf 已落盘", (tmp / preview._FONT_REGULAR).exists(), str(staged))

        data_a = _gray(_render(tmp, preview._FONT_BOLD, ZH_A, "a.png"))
        data_b = _gray(_render(tmp, preview._FONT_BOLD, ZH_B, "b.png"))
        ink = _ink(data_a)
        check("e2e: 中文渲染出可见字形（非空白）", ink > 0, f"ink={ink}")
        check(
            "e2e: 顺序不同的汉字位图不同（排除 tofu 方框）",
            _diff(data_a, data_b) > 0,
            f"diff={_diff(data_a, data_b)}",
        )


def test_cjk_font_beats_latin_only() -> None:
    if not _ffmpeg():
        skip("e2e: CJK 字体 vs 纯拉丁兜底", "ffmpeg 不在 PATH")
        return
    latin = _first_existing(
        [c for c in preview._FONT_SOURCES[preview._FONT_BOLD] if _is_latin_only_font(c)]
    )
    if not latin:
        skip("e2e: CJK 字体 vs 纯拉丁兜底", "本机无纯拉丁候选字体")
        return
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        preview._stage_fonts(tmp)
        shutil.copy2(latin, tmp / "latin_only.ttf")
        cjk_data = _gray(_render(tmp, preview._FONT_BOLD, ZH_A, "cjk.png"))
        latin_data = _gray(_render(tmp, "latin_only.ttf", ZH_A, "latin.png"))
        check(
            "e2e: CJK 字体墨迹多于纯拉丁兜底",
            _ink(cjk_data) > _ink(latin_data),
            f"cjk={_ink(cjk_data)} latin={_ink(latin_data)} ({Path(latin).name})",
        )
        check(
            "e2e: 中文在 CJK 字体下的位图与纯拉丁兜底不同",
            _diff(cjk_data, latin_data) > 0,
            f"diff={_diff(cjk_data, latin_data)}",
        )


LONG_CJK_TITLE = "这是一个非常长的中文标题用来测试自动换行是否生效"  # 24 个全角字符


def _render_filter(tmp: Path, vf: str, width: int, height: int, out_name: str) -> bytes:
    """在纯黑画布上套用 filter 链渲一帧，返回灰度裸数据。"""
    subprocess.run(
        [_ffmpeg(), "-y", "-v", "error", "-f", "lavfi",
         "-i", f"color=black:s={width}x{height}", "-vf", vf, "-frames:v", "1", out_name],
        cwd=tmp, check=True, capture_output=True,
    )
    proc = subprocess.run(
        [_ffmpeg(), "-v", "error", "-i", str(tmp / out_name),
         "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, check=True,
    )
    return proc.stdout


def _edge_ink(data: bytes, width: int, height: int, margin: int = 2) -> int:
    """统计最外圈 margin 像素内的墨迹数：>0 说明文字被裁切。"""
    edges = 0
    for y in range(height):
        row = y * width
        for x in list(range(margin)) + list(range(width - margin, width)):
            if data[row + x] > 40:
                edges += 1
    for y in list(range(margin)) + list(range(height - margin, height)):
        row = y * width
        for x in range(width):
            if data[row + x] > 40:
                edges += 1
    return edges


def test_long_cjk_title_wraps_within_width() -> None:
    """长中文标题必须折行，且每行全角字形数不超过画面可容纳上限。"""
    for width, height in ((480, 854), (1080, 1920)):
        fontsize = max(28, round(110 * (height / 1920)))
        max_width = max(120, round(width * 0.85))
        lines = preview._wrap_text(
            LONG_CJK_TITLE, fontsize=fontsize, max_width=max_width
        ).split("\n")
        check(f"wrap: {width}px 长标题折成多行", len(lines) > 1, f"lines={len(lines)}")
        limit = max_width / fontsize  # 全角字形 ≈ 1 em，据此推算每行上限
        widest = max(
            sum(1 for ch in ln if unicodedata.east_asian_width(ch) in ("W", "F"))
            for ln in lines
        )
        check(
            f"wrap: {width}px 每行全角字数不超上限",
            widest <= limit,
            f"widest={widest} limit={limit:.1f}",
        )


def test_long_cjk_title_not_clipped() -> None:
    """端到端：长中文标题渲染后不得触碰画面边缘（触碰即被裁切）。"""
    if not _ffmpeg():
        skip("e2e: 长中文标题未被裁切", "ffmpeg 不在 PATH")
        return
    for width, height in ((480, 854), (1080, 1920)):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            preview._stage_fonts(tmp)
            scene = {"text": LONG_CJK_TITLE, "duration_s": 1.0, "style": {}}
            layers = preview._scene_text_layers(scene, tmp, 0, width=width, height=height)
            data = _render_filter(tmp, ",".join(layers), width, height, "frame.png")
            check(
                f"e2e: {width}px 长标题渲染成功",
                len(data) == width * height,
                f"bytes={len(data)}",
            )
            edges = _edge_ink(data, width, height)
            check(f"e2e: {width}px 长标题未被裁切", edges == 0, f"edge_ink={edges}")


def test_latin_wrapping_keeps_words_intact() -> None:
    """拉丁文本仍按词断行，不得把单词从中间切开。"""
    sentence = "this is a fairly long english title for the preview frame"
    wrapped = preview._wrap_text(sentence, fontsize=49, max_width=408)
    check("wrap: 拉丁句子折成多行", len(wrapped.split("\n")) > 1, wrapped)
    check(
        "wrap: 拉丁单词未被从中间切开",
        set(sentence.split()) == set(wrapped.replace("\n", " ").split()),
        wrapped.replace("\n", "|"),
    )


def _run(fn, label: str) -> None:
    try:
        fn()
    except Exception as exc:  # noqa: BLE001
        check(label, False, f"异常: {exc!r}")


def main() -> int:
    _run(test_font_candidates_prefer_cjk, "test_font_candidates_prefer_cjk 执行异常")
    _run(test_drawtext_emits_fontfile, "test_drawtext_emits_fontfile 执行异常")
    _run(test_staged_font_renders_real_cjk, "test_staged_font_renders_real_cjk 执行异常")
    _run(test_cjk_font_beats_latin_only, "test_cjk_font_beats_latin_only 执行异常")
    _run(test_long_cjk_title_wraps_within_width, "test_long_cjk_title_wraps_within_width 执行异常")
    _run(test_long_cjk_title_not_clipped, "test_long_cjk_title_not_clipped 执行异常")
    _run(test_latin_wrapping_keeps_words_intact, "test_latin_wrapping_keeps_words_intact 执行异常")

    failed = 0
    for name, ok, detail in RESULTS:
        mark = "PASS" if ok else "FAIL"
        suffix = f"  <- {detail}" if (detail and not ok) else ""
        print(f"[{mark}] {name}{suffix}")
        failed += 0 if ok else 1
    for name, reason in SKIPPED:
        print(f"[SKIP] {name}  <- {reason}")
    print(f"\n{len(RESULTS) - failed}/{len(RESULTS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
