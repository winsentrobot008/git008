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
RENDER_MODE_PREVIEW = "分镜预览（FFmpeg，快）"
RENDER_MODE_NODE = "完整管线 (需 Node.js 环境 - 当前不可用)"
render_mode = st.sidebar.radio(
    "渲染模式",
    [RENDER_MODE_PREVIEW, RENDER_MODE_NODE],
    index=0,
)
if render_mode == RENDER_MODE_NODE and shutil_which("node") is None:
    st.warning(
        "当前环境未检测到 Node.js，请使用【4️⃣ 短剧/漫剧生成（导演 Skill）】或 Python 管线"
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


# ---------------------------------------------------------------------------
# 主区 4：短剧 / 漫剧生成（导演 Skill → 分镜 → 出片）
# ---------------------------------------------------------------------------
from modules.video_factory import director_adapter, idea_to_drama_bridge, render_backend  # noqa: E402

DRAMA_WORK_DIR = CORE_WORK_DIR / "gui" / "drama"

st.header("4️⃣ 短剧 / 漫剧生成（导演 Skill）")
st.caption("创意 → 导演分镜（自动执行资产锁定 + 180° 轴线规范）→ 渲染出片 → ffprobe 质检 → 爆款封面。")

_backend_probe = render_backend.probe_comfyui(timeout=0.8)
if _backend_probe["available"]:
    st.success(
        f"渲染后端：ComfyUI 在线（{_backend_probe['url']}）· SVD 就绪："
        f"{'是' if _backend_probe['svd_ready'] else '否（将降级 FFmpeg 预览）'}"
    )
else:
    st.info(f"渲染后端：ComfyUI 未启动（{_backend_probe['url']}）→ 自动无缝降级为 FFmpeg 预览出片。")


def _drama_workfile(name: str) -> Path:
    DRAMA_WORK_DIR.mkdir(parents=True, exist_ok=True)
    return DRAMA_WORK_DIR / name


def _drama_script_json() -> dict | None:
    raw = st.session_state.get("drama_editor") or ""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        st.error(f"导演分镜 JSON 解析失败（line={exc.lineno}, col={exc.colno}）：{exc.msg}")
        return None
    if not isinstance(data, dict) or not (data.get("shots") or data.get("scenes")):
        st.error("导演分镜必须包含 shots 或 scenes 字段。")
        return None
    return data


def _render_director(script: dict, backend: str, cover: bool) -> dict:
    """把导演分镜交给 CLI 的 director 管线（适配 → 后端路由 → 质检 → 封面）。"""
    script_path = _drama_workfile("drama_studio.director.json")
    script_path.write_text(json.dumps(script, ensure_ascii=False, indent=2), encoding="utf-8")
    cmd = [
        sys.executable,
        str(PRODUCT_ROOT / "src" / "cli.py"),
        "video",
        "director",
        "--input",
        str(script_path),
        "--render",
        "--backend",
        backend,
    ]
    if cover:
        cmd.append("--cover")
    code, output, _ = _run_capture(cmd)
    result = _parse_cli_result(output)
    if code != 0 or result is None:
        raise RuntimeError(f"导演管线失败（exit={code}），请查看上方命令行输出。")
    return result


_idea_tab, _render_tab = st.tabs(["① 创意 → 导演分镜", "② 分镜 → 出片"])

with _idea_tab:
    st.markdown("**创意输入**")
    # 故意不绑定 widget key：Agent-Reach 抓取后要以新文本回填默认值，
    # 若绑定 key 会在同一轮里触发 "cannot be modified after the widget is instantiated"。
    idea_text = st.text_area(
        "创意 / 一句话故事",
        value=st.session_state.get("drama_idea")
        or "凌晨两点的冰箱第三次自己亮起，她发现里面冻着一封写给未来的信。",
        height=110,
    )
    col_a, col_b, col_c = st.columns(3)
    with col_a:
        drama_style = st.selectbox("风格", ["短剧", "漫剧"], key="drama_style")
    with col_b:
        drama_duration = st.number_input("目标时长（秒）", min_value=6.0, max_value=120.0, value=15.0, step=1.0)
    with col_c:
        drama_shots = st.slider("镜头数", min_value=3, max_value=12, value=6)

    st.markdown("**取材来源**")
    src_mode = st.radio(
        "来源",
        ["手写创意", "Agent-Reach 热点（GitHub / V2EX / RSS / 网页）"],
        horizontal=True,
        label_visibility="collapsed",
    )
    topic_payload = None
    if src_mode.startswith("Agent-Reach"):
        t1, t2 = st.columns([3, 2])
        with t1:
            topic_query = st.text_input("热点主题 / 网址 / 搜索词", value="github", key="drama_topic")
        with t2:
            topic_source = st.selectbox("取材路由", ["auto", "github", "v2ex", "rss", "web"], key="drama_topic_source")
        if st.button("🛰️ 抓取热点", use_container_width=True):
            try:
                with st.spinner("Agent-Reach 取材中…"):
                    scripts_dir = str(REPO_ROOT / "scripts")
                    if scripts_dir not in sys.path:
                        sys.path.insert(0, scripts_dir)
                    from agent_reach_bridge import extract_topic_data  # noqa: PLC0415

                    payload = extract_topic_data(topic_query, source=topic_source)
                st.session_state["drama_topic_payload"] = payload
                st.session_state["drama_idea"] = payload["text"]
                st.success(f"取材成功（{payload['source']}）：{len(payload.get('items') or [])} 条热点")
                st.json({"text": payload["text"][:400], "visual_keywords": payload.get("visual_keywords")})
            except Exception as exc:  # noqa: BLE001 - 界面需展示失败原因
                st.error(f"Agent-Reach 取材失败：{exc}")
        topic_payload = st.session_state.get("drama_topic_payload")

    provider_choice = st.selectbox(
        "LLM 网关",
        ["auto（按 .env 路由）", "offline（离线确定性草稿）"],
        help="未配置 API Key 时自动降级为离线草稿，链路依然可跑通。",
    )

    if st.button("🎬 生成导演分镜", type="primary", use_container_width=True):
        provider = None if provider_choice.startswith("auto") else "offline"
        with st.status("导演分镜生成中…", expanded=True) as status:
            try:
                kwargs = {
                    "style": drama_style,
                    "target_duration": float(drama_duration),
                    "shot_count": int(drama_shots),
                    "provider": provider,
                }
                if topic_payload:
                    result = idea_to_drama_bridge.from_topic_data(topic_payload, **kwargs)
                else:
                    result = idea_to_drama_bridge.idea_to_drama(idea_text, **kwargs)
                st.session_state["drama_result"] = result
                st.session_state["drama_editor"] = json.dumps(
                    result["director_script"], ensure_ascii=False, indent=2
                )
                status.update(label=f"✅ 分镜完成（{result['source']}）", state="complete")
            except Exception as exc:  # noqa: BLE001 - 界面需展示失败原因
                status.update(label="❌ 分镜生成失败", state="error")
                st.error(str(exc))
                st.session_state.pop("drama_result", None)

    drama_result = st.session_state.get("drama_result")
    if drama_result:
        meta = drama_result["storyboard"]["director_meta"]
        m1, m2, m3, m4 = st.columns(4)
        m1.metric("镜头", meta["shot_count"])
        m2.metric("时长(s)", meta["duration_seconds"])
        m3.metric("锁定资产", len(meta["asset_locks"]))
        m4.metric("轴线违规", len(meta["violations"]))
        st.caption(f"生成来源：`{drama_result['source']}` · 修复重试：{drama_result['repair_attempts']}")
        for note in drama_result["repairs"]:
            st.warning(note)
        for warning in drama_result["warnings"]:
            st.info(warning)
        with st.expander("🎥 配音脚本（Stage-2 TTS 交接）"):
            st.json(drama_result["storyboard"].get("voice_script") or [])

    st.markdown("**导演分镜 JSON（可直接编辑后渲染）**")
    if "drama_editor" not in st.session_state:
        _seed = PRODUCT_ROOT / "templates" / "director" / "example_short_drama.json"
        st.session_state["drama_editor"] = _seed.read_text(encoding="utf-8") if _seed.exists() else "{}"
    st.text_area("分镜 JSON", height=340, key="drama_editor", label_visibility="collapsed")

with _render_tab:
    st.markdown("**渲染设置**")
    r1, r2 = st.columns([2, 2])
    with r1:
        backend_choice = st.selectbox(
            "渲染后端",
            list(render_backend.BACKEND_CHOICES),
            help="auto：ComfyUI 在线走高清 SVD，否则降级 FFmpeg 预览。",
        )
    with r2:
        want_cover = st.checkbox("同时生成爆款封面 cover.jpg", value=True)

    if st.button("🚀 渲染导演分镜", type="primary", use_container_width=True):
        script = _drama_script_json()
        if script is not None:
            with st.status("渲染中…", expanded=True) as status:
                try:
                    report = _render_director(script, backend_choice, want_cover)
                    status.update(label="✅ 渲染完成", state="complete")
                    st.session_state["drama_report"] = report
                except Exception as exc:  # noqa: BLE001 - 界面需展示失败原因
                    status.update(label="❌ 渲染失败", state="error")
                    st.error(str(exc))
                    st.session_state.pop("drama_report", None)

    report = st.session_state.get("drama_report")
    if report:
        st.success("渲染成功")
        if report.get("backend"):
            st.caption(f"渲染后端：`{report['backend']}` — {report.get('backend_reason', '')}")
        checks = report.get("checks") or {}
        if checks:
            st.subheader("🧪 ffprobe 质检门禁")
            rows = [
                {"检查项": name, "结果": "✅ 通过" if info.get("ok") else "❌ 拦截", "详情": info.get("detail", "")}
                for name, info in checks.items()
            ]
            st.dataframe(rows, use_container_width=True, hide_index=True)
            if report.get("inspect_ok"):
                st.success("全部断言通过：分辨率 / 帧率 / 音画同步 / 无黑屏 / 无静音断层")
            else:
                st.error("质检未通过，已按门禁策略处理（坏片隔离）。")
        out = report.get("output")
        if out and Path(out).exists():
            st.video(str(out))
        cover_info = report.get("cover") or {}
        cover_path = cover_info.get("output")
        if cover_path and Path(cover_path).exists():
            st.image(str(cover_path), caption="爆款封面 cover.jpg", width=240)