"""
Pending Review — 本地下载预览审批中心
======================================
显示 output/pending_review/ 目录下等待审批的视频文件。

流程：
    1. 用户触发下载（从狩猎区或输入 URL）→ 视频存入 pending_review/
    2. 此页面展示所有待审视频，带本地播放器
    3. 【🚀 批准开工】→ 触发 orchestrator.run_from_local() 执行后续流水线
    4. 【❌ 直接删除】→ 删除视频文件和审批标记

Usage:
    from dashboard.pages.pending_review import render
    render()
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

import streamlit as st

logger = logging.getLogger(__name__)

# ── 路径常量 ──────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent.parent
PENDING_DIR = ROOT / "output" / "pending_review"
ORCHESTRATOR_PATH = ROOT / "orchestrator.py"


# ── 状态键 ────────────────────────────────────────────────
_KEY_VIDEOS = "pr_videos"
_KEY_PRODUCING = "pr_producing"
_KEY_PRODUCED = "pr_produced"


# ── 数据模型 ──────────────────────────────────────────────

@st.cache_data(ttl=5)
def _scan_pending_videos() -> List[Dict[str, Any]]:
    """
    扫描 output/pending_review/ 目录下的视频文件。
    读取对应的 .approval.json 和 .json 元数据。

    Returns:
        List[Dict]: 每个视频的信息字典
    """
    if not PENDING_DIR.exists():
        return []

    videos = []
    for f in sorted(PENDING_DIR.glob("*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True):
        video_info = {
            "path": str(f),
            "name": f.name,
            "size_mb": f.stat().st_size / (1024 * 1024),
            "modified": datetime.fromtimestamp(f.stat().st_mtime),
        }

        # 读取审批标记
        approval_file = f.with_suffix(".approval.json")
        if approval_file.exists():
            try:
                approval_data = json.loads(approval_file.read_text(encoding="utf-8"))
                video_info["status"] = approval_data.get("status", "pending")
                video_info["title"] = approval_data.get("title", f.stem)
                video_info["author"] = approval_data.get("author", "")
                video_info["original_url"] = approval_data.get("original_url", "")
                video_info["approved_at"] = approval_data.get("approved_at", "")
            except Exception:
                video_info["status"] = "pending"
                video_info["title"] = f.stem
                video_info["author"] = ""
                video_info["original_url"] = ""
        else:
            video_info["status"] = "pending"
            video_info["title"] = f.stem

        # 读取元数据 JSON
        meta_file = f.with_suffix(".json")
        if meta_file.exists():
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
                video_info.setdefault("title", meta.get("title", f.stem))
                video_info["author"] = video_info.get("author") or meta.get("uploader", "")
                video_info["duration"] = meta.get("duration", 0)
                video_info["like_count"] = meta.get("like_count", 0)
                video_info["view_count"] = meta.get("view_count", 0)
            except Exception:
                pass

        videos.append(video_info)

    return videos


def _init_state():
    """初始化 session state"""
    if _KEY_VIDEOS not in st.session_state:
        st.session_state[_KEY_VIDEOS] = _scan_pending_videos()
    if _KEY_PRODUCING not in st.session_state:
        st.session_state[_KEY_PRODUCING] = set()
    if _KEY_PRODUCED not in st.session_state:
        st.session_state[_KEY_PRODUCED] = set()


def _approve_video(video_path: str) -> bool:
    """
    批准单个视频开工 — 触发 orchestrator 执行剩余流水线。

    Args:
        video_path: 视频文件的完整路径

    Returns:
        bool: 是否成功触发流水线
    """
    logger.info(f"🚀 Approving video: {video_path}")

    try:
        # 调用 orchestrator 的 approve 模式
        cmd = [
            sys.executable,
            str(ORCHESTRATOR_PATH),
            "--mode", "approve",
            "--video", video_path,
        ]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=600,  # 10 分钟超时（流水线可能较长）
        )

        if result.returncode == 0:
            logger.info(f"  ✅ Pipeline completed for {video_path}")
            return True
        else:
            logger.error(f"  ❌ Pipeline failed: {result.stderr[:300]}")
            return False

    except subprocess.TimeoutExpired:
        logger.error(f"  ❌ Pipeline timed out for {video_path}")
        return False
    except Exception as e:
        logger.error(f"  ❌ Error approving {video_path}: {e}")
        return False


def _delete_video(video_path: str) -> bool:
    """
    删除视频文件及其关联的元数据和审批标记。

    Args:
        video_path: 视频文件路径

    Returns:
        bool: 是否成功删除
    """
    path = Path(video_path)
    if not path.exists():
        return False

    try:
        # 删除视频文件
        path.unlink(missing_ok=True)

        # 删除关联的 .approval.json
        approval_file = path.with_suffix(".approval.json")
        if approval_file.exists():
            approval_file.unlink(missing_ok=True)

        # 删除关联的 .json 元数据
        meta_file = path.with_suffix(".json")
        if meta_file.exists():
            meta_file.unlink(missing_ok=True)

        logger.info(f"  🗑️ Deleted: {path.name}")
        return True
    except Exception as e:
        logger.error(f"  ❌ Delete failed: {e}")
        return False


# ── 状态徽章 ─────────────────────────────────────────────

def _status_badge(status: str) -> str:
    """返回状态对应的 emoji 徽章"""
    badges = {
        "pending": "⏳ 待审批",
        "approved": "✅ 已批准",
        "producing": "🔄 生产中",
        "produced": "🎉 已完成",
        "rejected": "❌ 已否决",
    }
    return badges.get(status, f"❓ {status}")


# ── 渲染 ─────────────────────────────────────────────────

def render():
    """渲染待审预览区页面"""
    _init_state()

    st.header("📥 待审预览区")
    st.caption("下载 → 本地预览 → 人工审批 → 自动生产 · 坚决保护主号安全")

    st.markdown("""
    <div style="background: linear-gradient(135deg, #1a1a2e, #16213e);
                padding: 1.5rem; border-radius: 10px; border-left: 4px solid #4ecdc4;">
        <p style="margin: 0; color: #ccc;">
            🛡️ <b>零登录安全策略</b>：视频下载后先在此处供人工审核，确认内容无误再批准进入流水线。<br>
            遇到登录弹窗的视频会被自动跳过并记入 <code>error_log.json</code>。
        </p>
    </div>
    """, unsafe_allow_html=True)

    st.divider()

    # ── 刷新按钮 + 统计 ──
    col_stats1, col_stats2, col_stats3, col_stats4 = st.columns(4)

    with col_stats1:
        videos = st.session_state[_KEY_VIDEOS]
        pending_count = sum(1 for v in videos if v.get("status", "pending") == "pending")
        st.metric("⏳ 待审批", pending_count)

    with col_stats2:
        approved_count = sum(1 for v in videos if v.get("status") == "approved")
        st.metric("✅ 已批准", approved_count)

    with col_stats3:
        total_size = sum(v.get("size_mb", 0) for v in videos)
        st.metric("📦 总大小", f"{total_size:.1f} MB")

    with col_stats4:
        if st.button("🔄 刷新列表", use_container_width=True, key="pr_refresh"):
            st.session_state[_KEY_VIDEOS] = _scan_pending_videos()
            st.rerun()

    # ── 批量操作 ──
    st.divider()
    batch_col1, batch_col2, batch_col3 = st.columns([2, 2, 5])

    with batch_col1:
        pending_videos = [v for v in videos if v.get("status", "pending") == "pending"]
        if st.button(
            f"🚀 批量批准开工 ({len(pending_videos)} 个)",
            type="primary",
            use_container_width=True,
            disabled=len(pending_videos) == 0,
            key="pr_batch_approve",
        ):
            producing_set = set()
            for v in pending_videos:
                vpath = v.get("path", "")
                if vpath:
                    producing_set.add(vpath)
            st.session_state[_KEY_PRODUCING] = producing_set
            st.rerun()

    with batch_col2:
        with st.popover("🗑️ 批量删除", use_container_width=True):
            st.warning(f"确认删除全部 {len(pending_videos)} 个待审视频？")
            col_yes, col_no = st.columns(2)
            with col_yes:
                if st.button("✅ 确认删除", type="primary", use_container_width=True,
                             key="pr_batch_delete_yes"):
                    deleted = 0
                    for v in pending_videos:
                        if _delete_video(v.get("path", "")):
                            deleted += 1
                    st.session_state[_KEY_VIDEOS] = _scan_pending_videos()
                    st.success(f"🗑️ 已删除 {deleted} 个视频")
                    time.sleep(0.3)
                    st.rerun()
            with col_no:
                if st.button("❌ 取消", use_container_width=True, key="pr_batch_delete_no"):
                    st.rerun()

    with batch_col3:
        # ── URL 快速下载 ──
        with st.expander("🔗 快速下载视频到预览区", expanded=False):
            url_input = st.text_input(
                "TikTok 视频 URL",
                placeholder="https://www.tiktok.com/@username/video/123456...",
                key="pr_quick_url",
            )
            if st.button("📥 下载到预览区", type="secondary", use_container_width=True,
                         disabled=not url_input, key="pr_quick_dl"):
                with st.spinner("正在下载视频..."):
                    cmd = [
                        sys.executable,
                        str(ORCHESTRATOR_PATH),
                        "--mode", "download",
                        "--url", url_input,
                    ]
                    dl_result = subprocess.run(
                        cmd, capture_output=True, text=True, timeout=120,
                    )
                    if dl_result.returncode == 0:
                        st.success("✅ 视频已下载至本地预览区！")
                        st.session_state[_KEY_VIDEOS] = _scan_pending_videos()
                        time.sleep(0.5)
                        st.rerun()
                    else:
                        st.error(f"❌ 下载失败: {dl_result.stderr[:200]}")

    st.divider()

    # ── 视频卡片列表 ──
    if not videos:
        st.info("📭 暂无待审视频 — 前往「爆款狩猎区」或在上方输入 URL 下载视频")
        st.markdown("""
        ### 🚀 使用流程
        1. **🎯 狩猎视频** — 在「爆款狩猎区」或「狩猎审批中心」选择视频
        2. **📥 下载到本地** — 视频自动下载到 `output/pending_review/`
        3. **👀 预览审核** — 在此页面用播放器检查视频内容
        4. **🚀 批准开工** — 确认无误后点击批准，触发分析→剪辑→配音流水线
        """)
        return

    for i, v in enumerate(videos):
        _render_video_card(i, v)


def _render_video_card(index: int, video: Dict[str, Any]):
    """渲染单个视频审批卡片"""
    vpath = video.get("path", "")
    vname = video.get("name", "Unknown")
    title = video.get("title", vname)
    author = video.get("author", "")
    status = video.get("status", "pending")
    size_mb = video.get("size_mb", 0)
    modified = video.get("modified", datetime.now())
    original_url = video.get("original_url", "")
    duration = video.get("duration", 0)
    like_count = video.get("like_count", 0)
    view_count = video.get("view_count", 0)

    is_pending = status == "pending"
    is_approved = status == "approved"
    is_producing = vpath in st.session_state.get(_KEY_PRODUCING, set())
    is_produced = vpath in st.session_state.get(_KEY_PRODUCED, set())

    with st.container(border=True):
        # ── 头部信息 ──
        header_cols = st.columns([3, 1, 1])
        with header_cols[0]:
            st.markdown(f"### 🎬 {title[:60]}")
            if author:
                st.caption(f"👤 {author}")
            st.caption(f"📁 `{vname}`")
        with header_cols[1]:
            if is_producing:
                st.markdown(f"#### 🔄 **生产中...**")
            elif is_produced:
                st.markdown(f"#### 🎉 **已完成**")
            else:
                st.markdown(f"#### {_status_badge(status)}")
        with header_cols[2]:
            st.caption(f"📏 {size_mb:.1f} MB")
            st.caption(f"🕒 {modified.strftime('%m-%d %H:%M')}")
            if duration:
                st.caption(f"⏱️ {duration}s")

        # ── 视频播放器 ──
        try:
            with open(vpath, "rb") as f:
                video_bytes = f.read()
            st.video(video_bytes)
        except Exception as e:
            st.error(f"无法加载视频: {e}")

        # ── 元数据行 ──
        meta_cols = st.columns(4)
        with meta_cols[0]:
            if like_count:
                st.metric("❤️ 点赞", f"{like_count:,}")
        with meta_cols[1]:
            if view_count:
                st.metric("👁️ 播放", f"{view_count:,}")
        with meta_cols[2]:
            st.metric("📦 大小", f"{size_mb:.1f} MB")
        with meta_cols[3]:
            if original_url:
                st.markdown(f"🔗 [原链接]({original_url})")

        # ── 操作按钮 ──
        st.divider()
        action_cols = st.columns([2, 2, 2, 3])

        with action_cols[0]:
            # 【🚀 批准开工】— 仅对待审视频可用
            if is_producing:
                st.info("🔄 正在生产中...")
            elif is_produced:
                st.success("🎉 已完成")
            elif is_pending:
                if st.button(
                    "🚀 批准开工",
                    type="primary",
                    use_container_width=True,
                    key=f"pr_approve_{index}_{vname}",
                ):
                    with st.spinner("🚀 正在执行流水线（分析→槽点→脚本→剪辑→配音）..."):
                        success = _approve_video(vpath)
                        if success:
                            st.session_state[_KEY_PRODUCED].add(vpath)
                            st.session_state[_KEY_VIDEOS] = _scan_pending_videos()
                            st.success("✅ 流水线执行完成！")
                            time.sleep(0.5)
                            st.rerun()
                        else:
                            st.error("❌ 流水线执行失败，请查看日志")
            else:
                st.button(
                    "✅ 已批准",
                    disabled=True,
                    use_container_width=True,
                    key=f"pr_already_{index}_{vname}",
                )

        with action_cols[1]:
            # 【❌ 直接删除】
            del_confirm_key = f"pr_del_confirm_{index}_{vname}"
            if del_confirm_key not in st.session_state:
                st.session_state[del_confirm_key] = False

            if st.session_state[del_confirm_key]:
                st.warning("确认删除？")
                col_dy, col_dn = st.columns(2)
                with col_dy:
                    if st.button("✅ 确认", key=f"pr_del_yes_{index}", type="primary",
                                 use_container_width=True):
                        if _delete_video(vpath):
                            st.success(f"🗑️ 已删除")
                            st.session_state[_KEY_VIDEOS] = _scan_pending_videos()
                            st.session_state[del_confirm_key] = False
                            time.sleep(0.3)
                            st.rerun()
                with col_dn:
                    if st.button("❌ 取消", key=f"pr_del_no_{index}",
                                 use_container_width=True):
                        st.session_state[del_confirm_key] = False
                        st.rerun()
            else:
                if st.button(
                    "❌ 直接删除",
                    type="secondary",
                    use_container_width=True,
                    key=f"pr_delete_{index}_{vname}",
                ):
                    st.session_state[del_confirm_key] = True
                    st.rerun()

        with action_cols[2]:
            # 预览审批历史
            if is_approved and video.get("approved_at"):
                st.caption(f"✅ 批准时间: {video['approved_at'][:16]}")

        with action_cols[3]:
            # 状态提示
            if is_pending:
                st.info("💡 预览视频内容后点击「批准开工」触发流水线")
            elif is_producing:
                st.warning("⏳ 流水线执行中，请勿关闭页面")
            elif is_produced:
                st.success("🎉 视频已生产完成")

    st.divider()


# ── 快捷统计 ─────────────────────────────────────────────

def get_stats() -> Dict[str, Any]:
    """获取待审区统计信息（供外部调用）"""
    videos = _scan_pending_videos()
    return {
        "total": len(videos),
        "pending": sum(1 for v in videos if v.get("status", "pending") == "pending"),
        "approved": sum(1 for v in videos if v.get("status") == "approved"),
        "total_size_mb": round(sum(v.get("size_mb", 0) for v in videos), 1),
    }
