"""
Hunting Zone — 一键审批生产决策中心
=====================================
【狩猎】→【审批】→【一键生产】单线决策看板。

读取候选池视频，展示：
    - 🔗 视频链接
    - 🎯 槽点总结（信号词高亮）
    - 📊 预估吐槽值 (1-100)
    - ✍️ 文案摘要（自动生成）
    - 【🚀 批准生产】按钮 → 推入流水线

Usage:
    from dashboard.pages.hunting_zone import render
    render()
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import os
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any

import streamlit as st

ROOT = Path(__file__).resolve().parent.parent.parent
ORCHESTRATOR_PATH = ROOT / "orchestrator.py"
sys.path.insert(0, str(ROOT))

logger = logging.getLogger(__name__)

# ── 候选池路径 ────────────────────────────────────────────────
CANDIDATE_PATHS = [
    ROOT / "data" / "autoscout" / "candidate_pool.json",   # 主路径
    ROOT / "output" / "cache" / "candidates.json",          # 兼容旧路径
]


def _load_candidates() -> List[Dict[str, Any]]:
    """从候选池加载视频数据（尝试多个路径）"""
    for path in CANDIDATE_PATHS:
        if path.exists():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, list):
                    return data
            except (json.JSONDecodeError, Exception):
                continue
    return []


def _generate_roast_summary(candidate: Dict[str, Any]) -> str:
    """
    从候选数据生成槽点总结。

    基于 signal_matches 中的信号词分类生成可读的槽点摘要。
    格式: "检测到 X 类槽点信号: [信号1], [信号2]..."
    """
    signals = candidate.get("signal_matches", {})
    if signals and isinstance(signals, dict):
        parts = []
        label_map = {
            "cringe": "😬 尴尬行为",
            "fail": "💀 翻车现场",
            "wtf": "🤯 迷惑行为",
            "logic": "🧠 逻辑漏洞",
            "overconfidence": "😎 过度自信",
        }
        for category, words in signals.items():
            label = label_map.get(category, category)
            words_str = ", ".join(f"`{w}`" for w in words[:3])
            parts.append(f"{label}({words_str})")
        if parts:
            return " | ".join(parts)

    # 回退: 从标题关键词推断
    title = candidate.get("title", "").lower()
    hints = []
    if any(w in title for w in ["fail", "翻车", "gone wrong"]):
        hints.append("💀 翻车现场")
    if any(w in title for w in ["cringe", "尴尬", "embarrassing"]):
        hints.append("😬 尴尬行为")
    if any(w in title for w in ["wtf", "what", "离谱"]):
        hints.append("🤯 迷惑行为")
    if hints:
        return " | ".join(hints)
    return "📌 常规内容（需人工判断）"


def _generate_script_preview(candidate: Dict[str, Any]) -> str:
    """
    从候选数据生成文案摘要预览。

    基于标题、描述、信号词和互动数据，
    模拟一段简短的反讽文案开头。
    """
    title = candidate.get("title", "")
    author = candidate.get("author", "这位老哥")
    likes = candidate.get("likes", 0)
    score = candidate.get("roast_potential", 0)
    signals = candidate.get("signal_matches", {})

    # 构建文案开头
    lines = []

    # 开场白
    if score >= 70:
        lines.append(f"🔥 **爆款预警** · {author} 的最新力作，槽点密度爆表！")
    elif score >= 50:
        lines.append(f"⚡ **有内味了** · {author} 这次又整了什么新活？")
    elif score >= 30:
        lines.append(f"📌 **可以一看** · {author} 的视频，槽点有待开发")
    else:
        lines.append(f"🔍 **待观察** · {author} 的内容，看看有没有发挥空间")

    # 槽点提示
    if signals:
        all_signals = []
        for words in signals.values():
            all_signals.extend(words)
        if all_signals:
            top_signals = [s for s in all_signals[:5] if len(s) > 2]
            if top_signals:
                lines.append(f"🎯 **关键信号**: {' · '.join(top_signals[:5])}")

    # 互动数据
    if likes > 0:
        lines.append(f"📊 **{likes:,}** 人点赞了这条视频，说明确实有看点")

    # 标题引用
    if title:
        short_title = title[:60] + ("..." if len(title) > 60 else "")
        lines.append(f"💬 **原视频**: 「{short_title}」")

    # 签名
    lines.append("---")
    lines.append("*🤖 RoastBro AI 侦察兵 · 自动生成文案预览*")

    return "\n\n".join(lines)


# ── Session State ──────────────────────────────────────────────

_KEY_CANDIDATES = "hz_candidates"
_KEY_APPROVED = "hz_approved"
_KEY_PRODUCED = "hz_produced"


def _init_state():
    if _KEY_CANDIDATES not in st.session_state:
        st.session_state[_KEY_CANDIDATES] = _load_candidates()
    if _KEY_APPROVED not in st.session_state:
        st.session_state[_KEY_APPROVED] = set()
    if _KEY_PRODUCED not in st.session_state:
        st.session_state[_KEY_PRODUCED] = set()


# ── Render ─────────────────────────────────────────────────────

def render():
    """渲染狩猎决策看板"""
    _init_state()

    st.header("🎯 狩猎审批中心")
    st.caption("【狩猎】→【审批】→【一键生产】单线决策链 · 选中有槽点的视频，一键推入流水线")

    candidates = st.session_state[_KEY_CANDIDATES]
    approved_set = st.session_state[_KEY_APPROVED]
    produced_set = st.session_state[_KEY_PRODUCED]

    # ── 顶部操作栏 ──
    col1, col2, col3, col4 = st.columns([2, 2, 2, 3])

    with col1:
        sort_by = st.selectbox(
            "📊 排序方式",
            ["吐槽值 ↓", "吐槽值 ↑", "互动率 ↓", "点赞数 ↓"],
            index=0,
            key="hz_sort",
        )

    with col2:
        filter_high = st.checkbox("🔥 仅 High_Potential", value=False, key="hz_filter_high")

    with col3:
        filter_trending = st.checkbox("📈 仅 Trending", value=False, key="hz_filter_trending")

    with col4:
        st.markdown("### 　")
        if st.button("🔄 刷新候选池", use_container_width=True, key="hz_refresh"):
            st.session_state[_KEY_CANDIDATES] = _load_candidates()
            st.rerun()

    # ── 筛选 & 排序 ──
    filtered = list(candidates)

    if filter_high:
        filtered = [c for c in filtered if c.get("high_potential", False)]
    if filter_trending:
        filtered = [c for c in filtered if c.get("is_trending", False)]

    if sort_by == "吐槽值 ↓":
        filtered.sort(key=lambda c: c.get("roast_potential", 0), reverse=True)
    elif sort_by == "吐槽值 ↑":
        filtered.sort(key=lambda c: c.get("roast_potential", 0))
    elif sort_by == "互动率 ↓":
        filtered.sort(key=lambda c: c.get("engagement_rate", 0), reverse=True)
    elif sort_by == "点赞数 ↓":
        filtered.sort(key=lambda c: c.get("likes", 0), reverse=True)

    # ── 批量操作 ──
    st.divider()
    batch_col1, batch_col2, batch_col3 = st.columns([2, 2, 5])
    with batch_col1:
        batch_targets = [
            c for c in filtered
            if c.get("url") not in produced_set
        ]
        if st.button(
            f"🚀 批量批准生产 ({len(batch_targets)} 个)",
            type="primary",
            use_container_width=True,
            disabled=len(batch_targets) == 0,
            key="hz_batch_approve",
        ):
            _batch_produce(batch_targets)
            st.rerun()

    with batch_col2:
        approved_count = sum(1 for c in filtered if c.get("url") in approved_set)
        st.metric("✅ 已批准", approved_count, help="标记为批准等待生产")

    with batch_col3:
        if st.button("🧹 清空已生产记录", use_container_width=True, key="hz_clear_produced"):
            st.session_state[_KEY_PRODUCED] = set()
            st.session_state[_KEY_APPROVED] = set()
            st.rerun()

    # ── 统计信息 ──
    st.info(
        f"📊 候选池共 **{len(candidates)}** 个视频 | "
        f"当前筛选 **{len(filtered)}** 个 | "
        f"已生产 **{len(produced_set)}** 个"
    )

    if not filtered:
        st.info("📭 暂无匹配的候选视频 — 前往「爆款狩猎区」执行狩猎扫描")
        return

    # ── 渲染视频卡片 ──
    for i, c in enumerate(filtered):
        _render_decision_card(i, c, approved_set, produced_set)


def _download_to_preview(url: str) -> bool:
    """
    调用 orchestrator --mode download 将视频下载到 preview 区。
    下载成功后提示用户前往首页查看。

    Args:
        url: TikTok 视频 URL

    Returns:
        bool: 下载是否成功
    """
    try:
        cmd = [
            sys.executable,
            str(ORCHESTRATOR_PATH),
            "--mode", "download",
            "--url", url,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)

        if result.returncode == 0:
            st.success("✅ 视频已存入预览库！请前往【🏠 首页：指挥台】查看本地高清预览")
            return True
        else:
            st.error(f"❌ 下载失败: {result.stderr[:200]}")
            return False
    except subprocess.TimeoutExpired:
        st.error("❌ 下载超时，请稍后重试")
        return False
    except Exception as e:
        st.error(f"❌ 下载异常: {e}")
        return False


def _render_decision_card(
    index: int,
    candidate: Dict[str, Any],
    approved_set: set,
    produced_set: set,
):
    """渲染单个审批决策卡片"""
    url = candidate.get("url", "")
    title = candidate.get("title", "Untitled")
    author = candidate.get("author", "unknown")
    video_id = candidate.get("video_id", "")
    score = candidate.get("roast_potential", 0)
    high = candidate.get("high_potential", False)
    trending = candidate.get("is_trending", False)
    likes = candidate.get("likes", 0)
    comments = candidate.get("comments", 0)
    shares = candidate.get("shares", 0)
    views = candidate.get("views", 0)
    eng_rate = candidate.get("engagement_rate", 0)
    signal_count = candidate.get("signal_count", 0)

    is_approved = url in approved_set
    is_produced = url in produced_set

    # 状态标记
    if is_produced:
        status_badge = "✅ **已生产**"
        border_color = "#00cc66"
    elif is_approved:
        status_badge = "⏳ **已批准·待生产**"
        border_color = "#ff9900"
    elif high:
        status_badge = "🔥 **High Potential**"
        border_color = "#ff4444"
    elif trending:
        status_badge = "📈 **Trending**"
        border_color = "#4488ff"
    else:
        status_badge = "📌 常规"
        border_color = "#666666"

    # 生成槽点总结
    roast_summary = _generate_roast_summary(candidate)
    script_preview = _generate_script_preview(candidate)

    with st.container(border=True):
        # ── 头部: 状态 + 标题 ──
        st.markdown(f"### #{index + 1} {status_badge}")
        st.markdown(f"**{title}**")
        st.caption(f"👤 {author}  🆔 `{video_id[:12] if video_id else 'N/A'}`")

        # ── 核心指标行 ──
        metric_cols = st.columns(5)
        with metric_cols[0]:
            st.metric("🎯 吐槽值", f"{score:.0f}", delta="🔥 爆款" if score >= 70 else "⚡ 潜力" if score >= 50 else "📌")
        with metric_cols[1]:
            st.metric("❤️ 点赞", f"{likes:,}" if likes else "0")
        with metric_cols[2]:
            st.metric("💬 评论", f"{comments:,}" if comments else "0")
        with metric_cols[3]:
            st.metric("📈 互动率", f"{eng_rate:.2%}" if eng_rate else "0%")
        with metric_cols[4]:
            st.metric("🔍 信号词", signal_count)

        # ── 槽点总结 ──
        with st.expander("🎯 槽点总结", expanded=True):
            st.markdown(roast_summary)

        # ── 文案摘要预览 ──
        with st.expander("✍️ 文案摘要预览", expanded=False):
            st.markdown(script_preview)

        # ── 🔗 视频链接（显式展示） ──
        st.markdown("### 🔗 视频链接")
        if url:
            # 可点击链接 + 一键复制
            url_col1, url_col2 = st.columns([6, 1])
            with url_col1:
                st.markdown(f"🔵 **[点击打开原视频]({url})**")
                st.caption(f"`{url}`")
            with url_col2:
                st.code(url, language="")
        else:
            st.caption("（无链接）")

        st.markdown("&nbsp;")  # 空行分隔

        # ── 四按钮操作面板 ──
        cols = st.columns([1, 1, 1, 1])
        with cols[0]:
            st.link_button("🌐 预览原视频", url if url else "https://www.tiktok.com",
                            disabled=not url, key=f"hz_link_{index}_{video_id or index}")
        with cols[1]:
            if st.button("📥 下载并预览", key=f"hz_dl_{index}_{video_id or index}"):
                # 1. 检查 pending_review 目录是否存在
                from pathlib import Path as _Path
                _pending_dir = _Path(__file__).resolve().parent.parent.parent / "output" / "pending_review"
                st.write(f"📂 检查目录: `{_pending_dir}` → **{'✅ 存在' if _pending_dir.exists() else '❌ 不存在，正在创建...'}**")
                _pending_dir.mkdir(parents=True, exist_ok=True)
                st.write(f"📂 目录状态: `{_pending_dir}` → **✅ 已就绪**")

                # 2. 执行下载（显示实时日志）
                import subprocess as _sp
                _cmd = [
                    sys.executable,
                    str(_Path(__file__).resolve().parent.parent.parent / "orchestrator.py"),
                    "--mode", "download",
                    "--url", url,
                ]
                st.code(f"$ {' '.join(_cmd)}", language="bash")

                # 3. 用 spinner 包裹下载过程
                with st.spinner("⏳ 正在后台无痕下载中..."):
                    _result = _sp.run(
                        _cmd,
                        capture_output=True,
                        text=True,
                        encoding="utf-8",  # 🛡️ 避免 GBK 解码崩溃
                        errors="replace",  # 🛡️ 无法解码的字符用 � 替换
                        timeout=120,
                    )

                # 4. 显示完整日志
                st.text_area("📋 下载日志 (stdout)", value=_result.stdout or "(空)", height=150)
                if _result.stderr:
                    st.text_area("📋 下载日志 (stderr)", value=_result.stderr, height=100)

                # 5. 检查结果
                _rc = _result.returncode
                st.write(f"🔚 退出代码: `{_rc}`")
                if _rc == 0:
                    st.success(f"✅ 下载成功！视频已存入 `{_pending_dir}`")
                    _files = list(_pending_dir.glob("*.mp4"))
                    st.write(f"📦 当前预览区文件数: {len(_files)}")
                    # 🏠 自动切换到首页指挥台 — 播放器会立刻出现
                    st.session_state.nav_radio = 0
                else:
                    st.error(f"❌ 下载失败，错误代码: {_rc}")
                    if "login" in (_result.stderr or "").lower() or "blocked" in (_result.stderr or "").lower():
                        st.warning("⛔ 该视频需要登录或已被屏蔽，已自动跳过并记入 error_log.json")
                st.rerun()
        with cols[2]:
            if st.button("🚀 批准生产", key=f"hz_prod_{index}_{video_id or index}", type="primary"):
                _produce_single(candidate)
                st.rerun()
        with cols[3]:
            if st.button("📋 仅标记批准", key=f"hz_mark_{index}_{video_id or index}"):
                approved_set.add(url)
                st.session_state[_KEY_APPROVED] = approved_set
                st.success("✅ 已标记为批准")
                st.rerun()

    st.divider()


# ── 生产逻辑 ──────────────────────────────────────────────────

def _produce_single(candidate: Dict[str, Any]) -> bool:
    """
    将单个候选视频推入生产流水线。

    流程:
        1. 推入 AutoHunter 生产队列 (production_queue.json)
        2. 标记为已确认 (confirmed)
        3. 记录已生产状态
    """
    url = candidate.get("url", "")
    if not url:
        st.error("❌ 无效视频链接")
        return False

    try:
        # 导入 AutoHunter
        from scrapers.auto_hunter import AutoHunter, HuntedVideo

        hunter = AutoHunter()
        video = HuntedVideo(
            url=url,
            title=candidate.get("title", ""),
            video_id=candidate.get("video_id", ""),
            author=candidate.get("author", ""),
            platform=candidate.get("platform", "tiktok"),
            roast_score=candidate.get("roast_potential", 0),
        )

        # 推入队列
        asyncio.run(hunter.push_to_queue([video]))

        # 标记已确认
        hunter.confirm_video(url)

        # 记录已生产
        st.session_state[_KEY_PRODUCED].add(url)
        st.session_state[_KEY_APPROVED].discard(url)

        st.success(f"🚀 **{candidate.get('title', 'Untitled')[:40]}** 已加入生产流水线！")
        return True

    except Exception as e:
        st.error(f"❌ 生产失败: {e}")
        logger.error(f"Production failed for {url}: {e}")
        return False


def _batch_produce(candidates: List[Dict[str, Any]]):
    """批量生产多个视频"""
    success = 0
    fail = 0
    for c in candidates:
        if _produce_single(c):
            success += 1
        else:
            fail += 1
    if success > 0:
        st.success(f"✅ 批量生产完成: {success} 个成功" +
                   (f", {fail} 个失败" if fail else ""))
    else:
        st.error("❌ 批量生产失败")


# ── 快捷入口 ──────────────────────────────────────────────────

def get_stats() -> Dict[str, Any]:
    """获取狩猎区统计信息（供外部调用）"""
    candidates = _load_candidates()
    return {
        "total": len(candidates),
        "high_potential": sum(1 for c in candidates if c.get("high_potential")),
        "trending": sum(1 for c in candidates if c.get("is_trending")),
        "avg_score": (
            sum(c.get("roast_potential", 0) for c in candidates) / len(candidates)
            if candidates else 0
        ),
    }
