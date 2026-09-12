"""008 Video Factory — Streamlit 本地操控面板

功能：
  1. 分镜与文案编辑：加载 templates/storyboards 下的 storyboard 模板，
     在线修改 Hook 标题 / 营养数值 / CTA 文案；
  2. 渲染控制：后台执行 `python src/cli.py video render --storyboard ... --preview`，
     实时展示命令行输出与 ffprobe 质检结果；
  3. 媒体预览与管理：播放 output/ 下的 mp4，一键打开本地文件夹。

启动：streamlit run products/008-video-factory/gui.py（或双击根目录 start_gui.bat）
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import streamlit as st

PRODUCT_ROOT = Path(__file__).resolve().parent
REPO_ROOT = PRODUCT_ROOT.parents[1]
for entry in (str(PRODUCT_ROOT), str(REPO_ROOT)):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from src.core.inspector import INSPECTOR_LOG, inspect_video  # noqa: E402
from src.core.paths import OUTPUT_DIR, WORK_DIR as CORE_WORK_DIR  # noqa: E402

STORYBOARDS_DIR = PRODUCT_ROOT / "templates" / "storyboards"
WORK_DIR = CORE_WORK_DIR / "gui"

st.set_page_config(
    page_title="008 Video Factory 操控台",
    page_icon="🎬",
    layout="wide",
    initial_sidebar_state="expanded",
)


def _list_storyboards() -> list[Path]:
    return sorted(STORYBOARDS_DIR.glob("*.json"))


def _load_storyboard(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _save_storyboard(data: dict) -> Path:
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    out = WORK_DIR / "calorie_ai_ad.edited.json"
    out.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return out


def _run_capture(cmd: list[str]) -> tuple[int, str, str]:
    """执行本地命令并实时回流 stdout（供 st.status 展示）。"""
    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NO_WINDOW
    proc = subprocess.Popen(
        cmd,
        cwd=str(REPO_ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=creationflags,
    )
    chunks: list[str] = []
    assert proc.stdout is not None
    for line in proc.stdout:
        chunks.append(line)
        st.code(line.rstrip(), language=None)
    proc.wait()
    return proc.returncode, "".join(chunks), ""


def _parse_cli_result(output: str) -> dict | None:
    start = output.find("{")
    end = output.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        return json.loads(output[start : end + 1])
    except json.JSONDecodeError:
        return None


def _render_video(data: dict) -> dict:
    """执行分镜预览渲染 + ffprobe 质检，返回 CLI 报告与质检报告。"""
    sb_path = _save_storyboard(data)
    cmd = [
        sys.executable,
        str(PRODUCT_ROOT / "src" / "cli.py"),
        "video",
        "render",
        "--storyboard",
        str(sb_path),
        "--preview",
        "--no-network",
    ]
    code, output, _ = _run_capture(cmd)
    result = _parse_cli_result(output)
    if code != 0 or result is None or not result.get("ok"):
        raise RuntimeError(f"渲染流水线失败（exit={code}），请查看上方命令行输出。")

    video_path = Path(result["output"])
    expected = {
        "width": int(result.get("resolution", "480x854").split("x")[0]),
        "height": int(result.get("resolution", "480x854").split("x")[1]),
        "fps": int(result.get("fps") or 24),
    }
    inspection = inspect_video(
        video_path,
        expected=expected,
        require_audio=False,  # 分镜预览为无声合成
        quarantine=False,
    )
    return {**result, "inspector": inspection}


def _render_node() -> dict:
    """完整 Node 管线（旁白 + 素材 + 字幕 + ffprobe 质检门禁）。"""
    node = shutil_which("node")
    if not node:
        raise RuntimeError("node 不可用，无法运行完整流水线。")
    cmd = [
        node,
        str(PRODUCT_ROOT / "src" / "index.mjs"),
        "--target",
        "calorie-ai",
        "--no-pexels",
    ]
    code, output, _ = _run_capture(cmd)
    if code != 0:
        raise RuntimeError(f"Node 渲染失败（exit={code}）。")
    match = None
    for line in reversed(output.splitlines()):
        if "[done]" in line:
            match = line
            break
    return {"mode": "node", "ok": True, "output": match or output[-400:], "inspector": None}


def shutil_which(name: str) -> str | None:
    import shutil

    return shutil.which(name)


# ---------------------------------------------------------------------------
# 侧边栏：模板选择 + 渲染模式
# ---------------------------------------------------------------------------
st.sidebar.title("🎬 008 Video Factory")
st.sidebar.caption("Streamlit 本地操控面板 · ffprobe 质检门禁")

storyboards = _list_storyboards()
if not storyboards:
    st.sidebar.error(f"未找到 storyboard 模板：{STORYBOARDS_DIR}")
    st.stop()

sb_names = {p.name: p for p in storyboards}
sb_name = st.sidebar.selectbox(
    "分镜模板",
    list(sb_names.keys()),
    index=list(sb_names.keys()).index("calorie_ai_ad.json")
    if "calorie_ai_ad.json" in sb_names
    else 0,
)
render_mode = st.sidebar.radio(
    "渲染模式",
    ["分镜预览（FFmpeg，快）", "完整管线（Node，慢）"],
    index=0,
)

sb_data = _load_storyboard(sb_names[sb_name])
scenes = sb_data.get("scenes") or []
hook = next((s for s in scenes if s.get("type") == "hero_title"), {})
nutrition_scene = next((s for s in scenes if (s.get("overlay") or {}).get("kind") == "nutrition"), {})
cta = next((s for s in scenes if s.get("type") == "callout"), {})
nrows = (nutrition_scene.get("overlay") or {}).get("rows") or []

# ---------------------------------------------------------------------------
# 主区 1：分镜与文案编辑
# ---------------------------------------------------------------------------
st.header("1️⃣ 分镜与文案编辑")
st.caption(f"模板：`{sb_name}` — 修改会写入临时副本，原始模板不受影响。")

edited = None
with st.form("editor"):
    c1, c2 = st.columns(2)
    with c1:
        hook_title = st.text_input("Hook 标题", value=hook.get("text", ""))
        hook_subtitle = st.text_input("Hook 副标题", value=hook.get("subtitle", ""))
        hook_tag = st.text_input(
            "Hook 高亮标签（黄底标签）",
            value=(hook.get("style") or {}).get("highlight", ""),
        )
    with c2:
        cta_title = st.text_input("CTA 标题", value=cta.get("text", ""))
        cta_subtitle = st.text_input("CTA 副标题", value=cta.get("subtitle", ""))
        cta_tag = st.text_input(
            "CTA 高亮标签",
            value=(cta.get("style") or {}).get("highlight", ""),
        )

    st.subheader("Instant Macros 营养卡")
    nc1, nc2, nc3 = st.columns(3)
    p_label = nrows[0].get("label", "Protein") if nrows else "Protein"
    p_value = nrows[0].get("value", "24g") if nrows else "24g"
    c_label = nrows[1].get("label", "Carbs") if len(nrows) > 1 else "Carbs"
    c_value = nrows[1].get("value", "38g") if len(nrows) > 1 else "38g"
    f_label = nrows[2].get("label", "Fat") if len(nrows) > 2 else "Fat"
    f_value = nrows[2].get("value", "16g") if len(nrows) > 2 else "16g"
    with nc1:
        st.text_input("营养 1 名称", value=p_label, key="n1_label")
        st.text_input("营养 1 数值", value=p_value, key="n1_value")
    with nc2:
        st.text_input("营养 2 名称", value=c_label, key="n2_label")
        st.text_input("营养 2 数值", value=c_value, key="n2_value")
    with nc3:
        st.text_input("营养 3 名称", value=f_label, key="n3_label")
        st.text_input("营养 3 数值", value=f_value, key="n3_value")

    edited = json.loads(json.dumps(sb_data))
    hook_idx = next(
        (i for i, s in enumerate(edited["scenes"]) if s.get("type") == "hero_title"),
        None,
    )
    cta_idx = next(
        (i for i, s in enumerate(edited["scenes"]) if s.get("type") == "callout"),
        None,
    )
    if hook_title:
        edited["scenes"][hook_idx]["text"] = hook_title
    if hook_subtitle:
        edited["scenes"][hook_idx]["subtitle"] = hook_subtitle
    if hook_tag:
        edited["scenes"][hook_idx].setdefault("style", {})["highlight"] = hook_tag
    for i, scene in enumerate(edited["scenes"]):
        if (scene.get("overlay") or {}).get("kind") == "nutrition":
            rows = [
                {
                    "label": st.session_state.get("n1_label", p_label),
                    "value": st.session_state.get("n1_value", "24g"),
                },
                {
                    "label": st.session_state.get("n2_label", c_label),
                    "value": st.session_state.get("n2_value", "38g"),
                },
                {
                    "label": st.session_state.get("n3_label", f_label),
                    "value": st.session_state.get("n3_value", "16g"),
                },
            ]
            scene["overlay"]["rows"] = rows
            break
    if cta_title:
        edited["scenes"][cta_idx]["text"] = cta_title
    if cta_subtitle:
        edited["scenes"][cta_idx]["subtitle"] = cta_subtitle
    if cta_tag:
        edited["scenes"][cta_idx].setdefault("style", {})["highlight"] = cta_tag
    st.form_submit_button("保存编辑（写入临时副本）", use_container_width=True)

if edited is not None:
    st.session_state["edited_storyboard"] = edited

st.subheader("分镜 JSON 预览")
st.json(st.session_state.get("edited_storyboard", sb_data))

# ---------------------------------------------------------------------------
# 主区 2：渲染控制
# ---------------------------------------------------------------------------
st.header("2️⃣ 渲染控制")
st.caption("点击后后台执行本地流水线，下方实时展示命令行输出与 ffprobe 质检结果。")

if st.button("🚀 一键渲染视频", type="primary", use_container_width=True):
    with st.status("渲染中…", expanded=True) as status:
        try:
            render_data = st.session_state.get("edited_storyboard", sb_data)
            if render_mode.startswith("完整"):
                report = _render_node()
            else:
                report = _render_video(render_data)
            status.update(label="✅ 渲染完成", state="complete")
        except Exception as exc:
            status.update(label="❌ 渲染失败", state="error")
            st.error(str(exc))
            report = None

    if report is not None:
        st.success("渲染成功")
        insp = report.get("inspector")
        if insp:
            st.subheader("🧪 ffprobe 质检报告")
            st.json(insp)
            if insp.get("ok"):
                st.success("全部断言通过：分辨率 / 帧率 / 音画同步 / 无黑屏 / 无静音断层")
            else:
                st.error("质检未通过：" + "；".join(insp.get("issues", [])))
        out = report.get("output")
        if out and Path(out).exists():
            st.video(str(out))
            cover = Path(out).with_name("cover.jpg")
            if cover.exists():
                st.image(str(cover), caption="爆款封面 cover.jpg", width=220)

# ---------------------------------------------------------------------------
# 主区 3：媒体预览与管理
# ---------------------------------------------------------------------------
st.header("3️⃣ 媒体预览与管理")
refresh = st.button("🔄 刷新媒体列表", use_container_width=False)
if refresh:
    st.rerun()

videos = sorted(
    OUTPUT_DIR.glob("*.mp4"),
    key=lambda p: p.stat().st_mtime,
    reverse=True,
) if OUTPUT_DIR.exists() else []

if not videos:
    st.info("output/ 目录暂无视频，先渲染一版吧。")
else:
    st.caption(f"共 {len(videos)} 个成品，位于 `{OUTPUT_DIR}`")
    col_a, col_b = st.columns([3, 2])
    with col_a:
        selected = st.selectbox("选择视频", [p.name for p in videos])
        chosen = next(p for p in videos if p.name == selected)
        st.video(str(chosen))
    with col_b:
        st.markdown("**文件信息**")
        st.write(f"路径：`{chosen.name}`")
        st.write(f"大小：{chosen.stat().st_size / 1024 / 1024:.2f} MB")
        if st.button("📂 打开本地文件夹"):
            if os.name == "nt":
                os.startfile(str(OUTPUT_DIR))  # noqa: S606
            else:
                subprocess.Popen(["xdg-open", str(OUTPUT_DIR)])

# ---------------------------------------------------------------------------
# 质检日志
# ---------------------------------------------------------------------------
st.header("🧾 ffprobe 质检日志")
if INSPECTOR_LOG.exists():
    lines = INSPECTOR_LOG.read_text(encoding="utf-8").splitlines()[-20:]
    st.code("\n".join(lines) if lines else "（暂无记录）", language="json")
else:
    st.info("暂无质检记录。")
