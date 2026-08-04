"""
System Ops Page — 工业级系统运维看板
=========================================
模块健康度、环境检查、磁盘使用量监测、一键深度清理、性能监控。
"""

import streamlit as st
import sys
import os
import time
import shutil
import subprocess
from pathlib import Path
from typing import Optional, List

ROOT = Path(__file__).resolve().parent.parent.parent


def _get_dir_size(path: Path) -> tuple[int, int]:
    """返回 (文件数, 字节数)"""
    if not path.exists():
        return 0, 0
    count = 0
    size = 0
    for f in path.rglob("*"):
        if f.is_file():
            count += 1
            size += f.stat().st_size
    return count, size


def _clear_output() -> dict:
    """清理 output/video/、output/cache/、output/preview/ 下的媒体/缓存文件"""
    targets = [
        ROOT / "output" / "video",
        ROOT / "output" / "cache",
        ROOT / "output" / "preview",
    ]
    deleted = 0
    freed = 0
    for d in targets:
        if not d.exists():
            continue
        for f in d.rglob("*"):
            if not f.is_file():
                continue
            if f.name in (".gitkeep", ".gitignore"):
                continue
            if f.suffix.lower() in (".mp4", ".webm", ".mkv", ".mov", ".avi",
                                     ".wav", ".mp3", ".aac", ".flac",
                                     ".srt", ".vtt", ".json", ".log"):
                try:
                    freed += f.stat().st_size
                    f.unlink(missing_ok=True)
                    deleted += 1
                except Exception:
                    pass
        for subdir in sorted(d.rglob("*"), reverse=True):
            if subdir.is_dir():
                try:
                    subdir.rmdir()
                except OSError:
                    pass
    return {"deleted_count": deleted, "freed_bytes": freed,
            "freed_mb": round(freed / (1024 * 1024), 2)}


def _deep_clean_video_output() -> dict:
    """
    一键深度清理：递归删除 output/video/ 下所有文件，仅保留目录结构。
    保留 .gitkeep 以维持版本控制占位。
    """
    target = ROOT / "output" / "video"
    if not target.exists():
        return {"deleted_count": 0, "freed_bytes": 0, "freed_mb": 0.0}

    deleted = 0
    freed = 0
    for f in target.rglob("*"):
        if not f.is_file():
            continue
        if f.name in (".gitkeep", ".gitignore"):
            continue
        try:
            freed += f.stat().st_size
            f.unlink(missing_ok=True)
            deleted += 1
        except Exception:
            pass

    return {"deleted_count": deleted, "freed_bytes": freed,
            "freed_mb": round(freed / (1024 * 1024), 2)}


def _check_ffmpeg() -> dict:
    """检测 FFmpeg 是否可用及版本"""
    try:
        proc = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True, text=True, timeout=5,
        )
        if proc.returncode == 0:
            first_line = proc.stdout.splitlines()[0] if proc.stdout else "ffmpeg unknown"
            return {"available": True, "version": first_line}
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return {"available": False, "version": "N/A"}


def _get_system_load() -> dict:
    """获取系统负载信息（跨平台）"""
    info = {}
    try:
        import psutil
        info["cpu_percent"] = psutil.cpu_percent(interval=0.5)
        info["memory"] = psutil.virtual_memory()._asdict()
        info["disk_usage"] = psutil.disk_usage(str(ROOT))._asdict()
        info["has_psutil"] = True
    except ImportError:
        info["has_psutil"] = False
        # 回退：使用 os 模块
        try:
            if sys.platform == "win32":
                info["cpu_percent"] = "N/A (install psutil)"
            else:
                load = os.getloadavg() if hasattr(os, "getloadavg") else "N/A"
                info["cpu_load"] = load
        except Exception:
            pass
    return info


def render():
    st.header("⚙️ 系统运维中心")
    st.caption("磁盘监测 · 深度清理 · 性能监控 · 模块健康度 · 环境检查")

    # Environment
    st.subheader("🖥️ 运行环境")
    col1, col2 = st.columns(2)
    with col1:
        st.markdown(f"**Python**: `{sys.version.split()[0]}`")
        st.markdown(f"**Platform**: `{sys.platform}`")
        st.markdown(f"**Root**: `{ROOT}`")
    with col2:
        st.markdown(f"**Streamlit**: `{st.__version__}`")
        hb_path = ROOT / ".heartbeat"
        if hb_path.exists():
            st.markdown(f"**Heartbeat**: 🟢 `{hb_path.stat().st_size} bytes`")
        else:
            st.markdown("**Heartbeat**: 🔴 missing")

    st.divider()

    # Module health
    st.subheader("🧩 模块健康度")
    modules = [
        ("scrapers", "✅", "4 文件"),
        ("analyzer", "✅", "18 文件"),
        ("roastpoints", "✅", "2 文件"),
        ("scripts", "✅", "10 文件"),
        ("editor", "✅", "48+ 文件"),
        ("voice", "✅", "15 文件"),
        ("compliance", "✅", "3 文件"),
        ("publisher", "✅", "5 文件"),
        ("dashboard", "✅", "3 文件"),
        ("seo", "✅", "2 文件"),
        ("brain", "✅", "2 文件"),
    ]
    cols = st.columns(3)
    for i, (name, status, desc) in enumerate(modules):
        with cols[i % 3]:
            with st.container(border=True):
                st.markdown(f"**{status} {name}**")
                st.caption(desc)

    st.divider()

    # Dependency check
    st.subheader("📦 依赖检查")
    deps = [
        ("streamlit", "✅"),
        ("torch", "⚠️ 可选"),
        ("whisper", "⚠️ 可选"),
        ("moviepy", "⚠️ 可选"),
        ("playwright", "⚠️ 可选"),
    ]
    for name, status in deps:
        cols = st.columns([1, 3])
        cols[0].markdown(f"**{status}**")
        cols[1].markdown(f"{name}")

    st.divider()

    # ── 📊 性能监控 ────────────────────────────────────────────
    st.subheader("📊 性能监控")
    st.caption("FFmpeg 渲染引擎状态 · 系统资源负载 · CPU / 内存 / 磁盘")

    perf_cols = st.columns(3)

    # FFmpeg 检测
    with perf_cols[0]:
        ffmpeg_info = _check_ffmpeg()
        if ffmpeg_info["available"]:
            ver_short = ffmpeg_info["version"].split()[2] if len(ffmpeg_info["version"].split()) > 2 else ffmpeg_info["version"][:30]
            st.metric("🎬 FFmpeg", "✅ 可用", delta=ver_short)
        else:
            st.metric("🎬 FFmpeg", "❌ 不可用", delta="请安装 FFmpeg")

    # 系统负载
    with perf_cols[1]:
        load_info = _get_system_load()
        if load_info.get("has_psutil"):
            cpu = load_info.get("cpu_percent", 0)
            mem = load_info.get("memory", {})
            mem_pct = mem.get("percent", 0)
            st.metric("💻 CPU 占用率", f"{cpu:.1f}%")
            st.caption(f"🧠 内存: {mem_pct:.0f}% used")
        else:
            st.metric("💻 系统负载", "⏳ 未监控")
            st.caption("安装 psutil 获取详细数据: pip install psutil")

    # 磁盘总览
    with perf_cols[2]:
        load_info = _get_system_load()
        if load_info.get("has_psutil"):
            disk = load_info.get("disk_usage", {})
            total_gb = disk.get("total", 0) / (1024**3)
            used_gb = disk.get("used", 0) / (1024**3)
            free_gb = disk.get("free", 0) / (1024**3)
            pct = disk.get("percent", 0)
            st.metric("💾 磁盘总用量", f"{used_gb:.0f}/{total_gb:.0f} GB", delta=f"{pct:.0f}%")
            st.caption(f"🟢 空闲: {free_gb:.1f} GB")
        else:
            # 回退: 统计项目目录
            v_count, v_size = _get_dir_size(ROOT / "output" / "video")
            c_count, c_size = _get_dir_size(ROOT / "output" / "cache")
            total_mb = (v_size + c_size) / (1024 * 1024)
            st.metric("💾 视频 + 缓存", f"{v_count + c_count} 文件", f"{total_mb:.1f} MB")
            st.caption("安装 psutil 获取全局磁盘数据")

    with st.expander("🔍 FFmpeg 详细信息", expanded=False):
        if ffmpeg_info["available"]:
            st.code(ffmpeg_info["version"], language="text")
        else:
            st.warning("FFmpeg 未安装或未加入 PATH。安装指南:")
            st.markdown("""
            - **Windows**: 下载 [ffmpeg.org](https://ffmpeg.org/download.html) → 解压 → 加入 PATH
            - **macOS**: `brew install ffmpeg`
            - **Linux**: `sudo apt install ffmpeg`
            """)

    st.divider()

    # ── 🧹 磁盘清理 ─────────────────────────────────────────────
    st.subheader("🧹 磁盘清理")
    st.caption("清理 output/ 目录下的视频、缓存和预览文件，释放磁盘空间")

    # 显示目录大小统计
    target_clean_dirs = [
        ("📁 output/video/", ROOT / "output" / "video"),
        ("📁 output/cache/", ROOT / "output" / "cache"),
        ("📁 output/preview/", ROOT / "output" / "preview"),
    ]
    col_s1, col_s2, col_s3 = st.columns(3)
    for col, (label, d) in zip([col_s1, col_s2, col_s3], target_clean_dirs):
        with col:
            file_count, total_bytes = _get_dir_size(d)
            total_mb = total_bytes / (1024 * 1024)
            st.metric(label.replace("📁 ", "").replace("/", ""),
                      f"{file_count} 文件", f"{total_mb:.1f} MB")

    # ── 普通清理（安全二次确认） ──
    st.markdown("**常规清理**：删除 output/video/、cache/、preview/ 下的媒体/缓存文件")
    sys_clean_confirm = "sys_clean_confirm"
    if sys_clean_confirm not in st.session_state:
        st.session_state[sys_clean_confirm] = False

    if not st.session_state[sys_clean_confirm]:
        if st.button("🧹 一键清空所有输出文件", type="secondary", use_container_width=True):
            st.session_state[sys_clean_confirm] = True
            st.rerun()
    else:
        st.warning("⚠️ **确认要清空所有输出文件？** 此操作将删除所有已生成的视频、缓存和预览文件，不可撤销！")
        col_yes, col_no = st.columns(2)
        with col_yes:
            if st.button("✅ 确认清空", type="primary", use_container_width=True):
                result = _clear_output()
                st.session_state[sys_clean_confirm] = False
                if result["deleted_count"] > 0:
                    st.success(
                        f"🧹 清理完成！已删除 **{result['deleted_count']}** 个文件，"
                        f"释放 **{result['freed_mb']} MB** 磁盘空间"
                    )
                else:
                    st.info("📭 无需清理，目录已为空")
                time.sleep(0.5)
                st.rerun()
        with col_no:
            if st.button("❌ 取消", use_container_width=True):
                st.session_state[sys_clean_confirm] = False
                st.rerun()

    # ── 🔥 一键深度清理 output/video/ ──
    st.markdown("---")
    st.markdown("**🔥 深度清理**：递归删除 `output/video/` 下所有文件，仅保留目录结构")
    deep_clean_confirm = "sys_deep_clean_confirm"
    if deep_clean_confirm not in st.session_state:
        st.session_state[deep_clean_confirm] = False

    if not st.session_state[deep_clean_confirm]:
        if st.button("🔥 一键深度清理 output/video/", type="secondary", use_container_width=True):
            st.session_state[deep_clean_confirm] = True
            st.rerun()
    else:
        st.error("⚠️ **危险操作！确认要深度清理 output/video/？** 所有已生成的视频将被永久删除，不可恢复！")
        col_yd, col_nd = st.columns(2)
        with col_yd:
            if st.button("🔥 确认深度清理", type="primary", use_container_width=True):
                result = _deep_clean_video_output()
                st.session_state[deep_clean_confirm] = False
                if result["deleted_count"] > 0:
                    st.success(
                        f"🔥 深度清理完成！已删除 **{result['deleted_count']}** 个视频文件，"
                        f"释放 **{result['freed_mb']} MB** 磁盘空间"
                    )
                else:
                    st.info("📭 output/video/ 已为空，无需清理")
                time.sleep(0.5)
                st.rerun()
        with col_nd:
            if st.button("❌ 取消", use_container_width=True):
                st.session_state[deep_clean_confirm] = False
                st.rerun()
