"""AutoHunter Dashboard — 爆款狩猎区 + 今日热点吐槽榜

显示今日已识别的爆款槽点视频，老哥点击"确认"即可让工厂开工。
新增「今日热点吐槽榜」展示全天候侦察兵自动扫描的候选视频池。
"""

from __future__ import annotations

import json
import sys
import os
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any

import streamlit as st

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT))

from scrapers.auto_hunter import AutoHunter, HuntedVideo
from scrapers.auto_scout import AutoScout, ScoutedVideo
from analyzer.scout_analyzer import ScoutAnalyzer, ScoutAnalysisResult
from tasks.scheduler_service import (
    ScoutScheduler,
    get_candidate_pool,
    start_scout_scheduler,
    get_scout_scheduler,
    run_scout_cycle,
)


# ── Session State Keys ──────────────────────────────────────────

_KEY_HUNTER = "ah_hunter"
_KEY_LAST_HUNT = "ah_last_hunt"
_KEY_RANKED = "ah_ranked"
_KEY_SCHEDULER = "ah_scheduler"

# Scout 巡航状态
_KEY_SCOUT = "ah_scout"
_KEY_SCOUT_SCHEDULER = "ah_scout_scheduler"
_KEY_CANDIDATES = "ah_candidates"
_KEY_LAST_SCOUT = "ah_last_scout"


def _get_hunter() -> AutoHunter:
    if _KEY_HUNTER not in st.session_state:
        st.session_state[_KEY_HUNTER] = AutoHunter()
    return st.session_state[_KEY_HUNTER]


def _try_start_scheduler():
    """尝试启动后台调度器（静默）"""
    try:
        from tasks.daily_task import start_scheduler
        sched = start_scheduler()
        st.session_state[_KEY_SCHEDULER] = sched
    except Exception:
        pass


def _get_scout() -> AutoScout:
    if _KEY_SCOUT not in st.session_state:
        st.session_state[_KEY_SCOUT] = AutoScout()
    return st.session_state[_KEY_SCOUT]


def _try_start_scout_scheduler():
    """尝试启动全天候巡航调度器（静默）"""
    try:
        sched = start_scout_scheduler(interval_hours=4)
        st.session_state[_KEY_SCOUT_SCHEDULER] = sched
    except Exception:
        pass


# ── Render ──────────────────────────────────────────────────────

def render():
    st.header("🔥 爆款狩猎区")
    st.caption("全自动情报侦察兵 · 每日扫描 TikTok 热榜 · 识别高吐槽潜力视频")

    hunter = _get_hunter()

    # ── 顶部操作栏 ──
    col1, col2, col3, col4 = st.columns([2, 2, 2, 3])

    with col1:
        tag = st.selectbox(
            "🎯 狩猎标签",
            ["fail", "cringe", "wtf", "funny", "gonewrong", " embarrassing"],
            index=0,
            key="ah_tag",
        )

    with col2:
        limit = st.number_input("📊 抓取数量", min_value=5, max_value=50, value=10, step=5, key="ah_limit")

    with col3:
        threshold = st.slider(
            "🎚️ 评分门槛", min_value=0, max_value=100, value=30, step=5,
            help="仅展示高于此评分的视频",
            key="ah_threshold",
        )

    with col4:
        st.markdown("### 　")
        if st.button("🚀 立即狩猎", type="primary", use_container_width=True):
            with st.spinner("🕵️ 侦察兵正在扫描 TikTok 热榜..."):
                try:
                    import asyncio
                    urls = asyncio.run(hunter.fetch_trending_urls(tag=tag.strip(), limit=int(limit)))
                    if urls:
                        ranked = asyncio.run(hunter.rank_potentials(urls))
                        st.session_state[_KEY_RANKED] = ranked
                        st.session_state[_KEY_LAST_HUNT] = datetime.now().isoformat()
                        st.rerun()
                    else:
                        st.warning("未找到相关视频，试试其他标签")
                except Exception as e:
                    st.error(f"狩猎失败: {e}")

    st.divider()

    # ── 显示上次狩猎时间 ──
    last_hunt = st.session_state.get(_KEY_LAST_HUNT)
    if last_hunt:
        st.caption(f"🕒 上次狩猎: {last_hunt[:19]}")
    else:
        st.caption("🕒 尚未执行狩猎 — 点击「立即狩猎」开始扫描")

    # ── 分栏: 今日热点吐槽榜 | 狩猎结果 | 生产队列 ──
    tab_candidates, tab_results, tab_queue, tab_settings = st.tabs([
        "📊 今日热点吐槽榜",
        "🎯 狩猎结果",
        "🏭 待确认队列",
        "⚙️ 调度设置",
    ])

    # ── Tab 0: 今日热点吐槽榜 ────────────────────────
    with tab_candidates:
        _render_candidate_board()

    # ── Tab 1: 狩猎结果 ────────────────────────────
    with tab_results:
        ranked = st.session_state.get(_KEY_RANKED)
        if not ranked:
            st.info("👆 点击「立即狩猎」开始扫描 TikTok 热门视频")
        else:
            st.success(f"✅ 本次狩猎发现 **{len(ranked)}** 个候选视频")

            # 按评分过滤
            filtered = [v for v in ranked if v.roast_score >= threshold]

            if not filtered:
                st.info(f"📭 没有评分 ≥ {threshold} 的视频")
            else:
                for i, v in enumerate(filtered):
                    _render_video_card(i, v, hunter)

    # ── Tab 2: 生产队列 ────────────────────────────
    with tab_queue:
        queue = hunter.get_queue()
        if not queue:
            st.info("📭 生产队列为空 — 狩猎后高分视频会自动出现在这里")

            # 手动触发狩猎
            if st.button("🔫 一键狩猎并推入队列", type="primary"):
                with st.spinner("🕵️ 全自动狩猎中..."):
                    try:
                        import asyncio
                        all_urls = []
                        seen = set()
                        for t in ["fail", "cringe", "wtf", "funny"]:
                            urls = asyncio.run(hunter.fetch_trending_urls(tag=t, limit=5))
                            for u in urls:
                                url = u.get("url", "")
                                if url and url not in seen:
                                    all_urls.append(u)
                                    seen.add(url)
                        if all_urls:
                            ranked = asyncio.run(hunter.rank_potentials(all_urls))
                            high_score = [v for v in ranked if v.roast_score >= 30.0]
                            pushed = asyncio.run(hunter.push_to_queue(high_score[:5]))
                            st.success(f"✅ 推入 {pushed} 个视频到生产队列")
                            st.rerun()
                    except Exception as e:
                        st.error(f"狩猎失败: {e}")
        else:
            confirmed_count = sum(1 for q in queue if q.get("confirmed"))
            st.success(f"📦 队列中共 **{len(queue)}** 个视频（已确认 **{confirmed_count}** 个）")

            for i, item in enumerate(queue):
                with st.container(border=True):
                    cols = st.columns([3, 1, 1, 1])
                    with cols[0]:
                        st.markdown(f"**{item.get('title', 'Untitled')}**")
                        st.caption(
                            f"👤 {item.get('author', 'unknown')}  "
                            f"🎯 评分: {item.get('roast_score', 0):.1f}  "
                            f"🕒 {item.get('hunted_at', '')[:16]}"
                        )
                    with cols[1]:
                        st.markdown(f"`{item.get('video_id', '')[:8]}...`")
                    with cols[2]:
                        status = "✅ 已确认" if item.get("confirmed") else "⏳ 待确认"
                        st.markdown(f"**{status}**")
                    with cols[3]:
                        if not item.get("confirmed"):
                            if st.button(
                                "✅ 确认开工",
                                key=f"confirm_{i}_{item.get('video_id', i)}",
                                use_container_width=True,
                            ):
                                hunter.confirm_video(item["url"])
                                st.success("✅ 已确认，工厂即将开工！")
                                st.rerun()
                        else:
                            st.button(
                                "🏭 生产中",
                                disabled=True,
                                key=f"prod_{i}_{item.get('video_id', i)}",
                                use_container_width=True,
                            )

            st.divider()
            if st.button("🧹 清空已确认项", type="secondary"):
                confirmed_urls = {q["url"] for q in queue if q.get("confirmed")}
                remaining = [q for q in queue if q["url"] not in confirmed_urls]
                queue_path = Path("data/autohunter") / "production_queue.json"
                queue_path.write_text(
                    json.dumps(remaining, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                st.success(f"已移除 {len(confirmed_urls)} 个已确认视频")
                st.rerun()

    # ── Tab 3: 调度设置 ────────────────────────────
    with tab_settings:
        st.subheader("🤖 每日狩猎调度 (00:00)")
        st.caption("后台每日 0 点自动执行狩猎，无需手动操作")

        _try_start_scheduler()
        sched = st.session_state.get(_KEY_SCHEDULER)

        col_a, col_b = st.columns(2)
        with col_a:
            if sched and sched.is_running:
                st.success("🟢 每日调度器运行中")
                if st.button("⏹️ 停止每日调度", use_container_width=True):
                    sched.stop()
                    st.rerun()
            else:
                st.warning("🔴 每日调度器未运行")
                if st.button("▶️ 启动每日调度", type="primary", use_container_width=True):
                    _try_start_scheduler()
                    st.rerun()

        with col_b:
            if sched and sched.last_report:
                report = sched.last_report
                st.metric("上次狩猎数", report.get("hunted", 0))
                st.metric("推入队列", report.get("pushed", 0))
                st.metric("最高评分", f'{report.get("top_score", 0):.1f}')
                if "timestamp" in report:
                    st.caption(f"执行时间: {report['timestamp'][:19]}")
            else:
                st.info("尚无狩猎记录 — 调度器将在下一个 0 点自动执行")

        st.divider()

        # ── 全天候巡航调度 ──
        st.subheader("🛰️ 全天候巡航调度 (24/7)")
        st.caption("每 4 小时自动执行 Scout → Analyze → Queue 链路")

        _try_start_scout_scheduler()
        scout_sched = st.session_state.get(_KEY_SCOUT_SCHEDULER)

        col_sa, col_sb = st.columns(2)
        with col_sa:
            if scout_sched and scout_sched.is_running:
                st.success("🟢 巡航调度器运行中")
                col_s1, col_s2 = st.columns(2)
                with col_s1:
                    if st.button("⏹️ 停止巡航", use_container_width=True):
                        scout_sched.stop()
                        st.rerun()
                with col_s2:
                    if st.button("🔄 立即巡航", use_container_width=True):
                        with st.spinner("🛰️ 执行一次完整巡航链路..."):
                            try:
                                report = run_scout_cycle()
                                st.session_state[_KEY_CANDIDATES] = get_candidate_pool()
                                st.session_state[_KEY_LAST_SCOUT] = datetime.now().isoformat()
                                st.success(f"✅ 巡航完成: {report.high_potential_count} High_Potential, {report.pushed_count} 推入队列")
                                st.rerun()
                            except Exception as e:
                                st.error(f"巡航失败: {e}")
            else:
                st.warning("🔴 巡航调度器未运行")
                if st.button("▶️ 启动巡航", type="primary", use_container_width=True):
                    _try_start_scout_scheduler()
                    st.rerun()

        with col_sb:
            if scout_sched:
                st.metric("巡航周期数", scout_sched.cycle_count)
                if scout_sched.last_report:
                    r = scout_sched.last_report
                    st.metric("High_Potential", r.high_potential_count)
                    st.metric("推入队列", r.pushed_count)
                    if r.errors:
                        st.caption(f"⚠️ {len(r.errors)} 个错误")
                if st.session_state.get(_KEY_LAST_SCOUT):
                    st.caption(f"上次巡航: {st.session_state[_KEY_LAST_SCOUT][:19]}")
            else:
                st.info("巡航调度器未初始化")

        st.divider()
        st.subheader("⚙️ 狩猎参数")
        st.caption("修改后对下次狩猎生效")

        col_c, col_d = st.columns(2)
        with col_c:
            tags_str = st.text_input(
                "标签列表（逗号分隔）",
                value="fail, cringe, wtf, funny, gonewrong",
                key="ah_tags_config",
            )
        with col_d:
            score_floor = st.number_input(
                "最低评分门槛",
                min_value=0, max_value=100, value=30, step=5,
                key="ah_floor_config",
            )

        if st.button("💾 保存配置", type="secondary"):
            st.success("配置已保存（下次狩猎生效）")
            st.session_state["ah_saved_tags"] = tags_str
            st.session_state["ah_saved_floor"] = score_floor


# ── 视频卡片渲染 ──────────────────────────────────────────────

def _render_video_card(index: int, video: HuntedVideo, hunter: AutoHunter):
    """渲染单个视频情报卡片"""
    thr = st.session_state.get("ah_threshold", 30)
    with st.container(border=True):
        cols = st.columns([4, 1, 1])

        with cols[0]:
            st.markdown(f"**#{index + 1}** — {video.title or 'Untitled'}")
            st.caption(
                f"👤 {video.author or 'unknown'}  "
                f"🆔 `{video.video_id or 'N/A'}`  "
                f"🌐 {video.platform}"
            )
            if video.url:
                st.markdown(f"🔗 [{video.url[:60]}...]({video.url})")

        with cols[1]:
            score = video.roast_score
            if score >= 60:
                st.metric("🎯 吐槽分", f"{score:.0f}", delta="🔥 爆款")
            elif score >= 40:
                st.metric("🎯 吐槽分", f"{score:.0f}", delta="⚡ 潜力")
            elif score >= thr:
                st.metric("🎯 吐槽分", f"{score:.0f}", delta="📌 一般")
            else:
                st.metric("🎯 吐槽分", f"{score:.0f}")

        with cols[2]:
            if st.button(
                "✅ 确认",
                key=f"confirm_result_{index}_{video.video_id or index}",
                use_container_width=True,
                type="primary" if score >= 40 else "secondary",
            ):
                ok = hunter.confirm_video(video.url)
                if ok:
                    st.success("已确认！推入工厂队列 🏭")
                    st.rerun()
                else:
                    # 如果不在队列中，直接推到队列
                    import asyncio
                    asyncio.run(hunter.push_to_queue([video]))
                    hunter.confirm_video(video.url)
                    st.success("已加入队列并确认！")
                    st.rerun()


# ── 今日热点吐槽榜 ──────────────────────────────────────────────

def _render_candidate_board():
    """
    渲染「今日热点吐槽榜」候选看板。

    从 candidate_pool.json 读取全天候侦察兵自动扫描的视频，
    按槽点潜力分降序排列，配有"批量一键生产"按钮。
    """
    st.subheader("📊 今日热点吐槽榜")
    st.caption("🛰️ 全天候 AI 侦察兵自动扫描 · 每 4 小时更新一次 · 仅展示 High_Potential 视频")

    # 尝试从 session 读取候选池，否则重新加载
    candidates = st.session_state.get(_KEY_CANDIDATES)
    if candidates is None:
        candidates = get_candidate_pool()
        st.session_state[_KEY_CANDIDATES] = candidates

    # ── 顶部操作栏 ──
    col1, col2, col3, col4 = st.columns([2, 2, 2, 3])

    with col1:
        filter_high_only = st.checkbox("🔥 仅 High_Potential", value=True, key="cb_filter_high")

    with col2:
        filter_trending = st.checkbox("📈 仅 Trending", value=False, key="cb_filter_trending")

    with col3:
        sort_by = st.selectbox(
            "排序方式",
            ["roast_potential", "engagement_rate", "views", "likes"],
            index=0,
            key="cb_sort",
        )

    with col4:
        st.markdown("### 　")
        if st.button(
            "🛰️ 立即执行巡航扫描",
            type="primary",
            use_container_width=True,
            key="cb_manual_scout",
        ):
            with st.spinner("🛰️ 全天候侦察兵正在扫描..."):
                try:
                    report = run_scout_cycle()
                    candidates = get_candidate_pool()
                    st.session_state[_KEY_CANDIDATES] = candidates
                    st.session_state[_KEY_LAST_SCOUT] = datetime.now().isoformat()
                    st.success(
                        f"✅ 巡航完成！扫描 {report.total_videos} 个视频, "
                        f"{report.trending_count} trending, "
                        f"{report.high_potential_count} high_potential"
                    )
                    st.rerun()
                except Exception as e:
                    st.error(f"巡航失败: {e}")

    if st.session_state.get(_KEY_LAST_SCOUT):
        st.caption(f"🕒 上次巡航: {st.session_state[_KEY_LAST_SCOUT][:19]}")
    else:
        st.caption("🕒 尚未执行巡航 — 点击「立即执行巡航扫描」或等待自动调度")

    st.divider()

    # ── 筛选 & 排序 ──
    if not candidates:
        st.info("📭 候选池为空 — 点击上方按钮执行一次巡航扫描，或等待自动调度器运行")
        return

    # 应用筛选
    filtered = list(candidates)
    if filter_high_only:
        filtered = [c for c in filtered if c.get("high_potential")]
    if filter_trending:
        filtered = [c for c in filtered if c.get("is_trending")]

    if not filtered:
        st.info("📭 没有匹配筛选条件的候选视频")
        return

    # 排序
    reverse = True
    if sort_by == "roast_potential":
        filtered.sort(key=lambda c: c.get("roast_potential", 0), reverse=reverse)
    elif sort_by == "engagement_rate":
        filtered.sort(key=lambda c: c.get("engagement_rate", 0), reverse=reverse)
    elif sort_by == "views":
        filtered.sort(key=lambda c: c.get("views", 0), reverse=reverse)
    elif sort_by == "likes":
        filtered.sort(key=lambda c: c.get("likes", 0), reverse=reverse)

    # ── 批量操作按钮 ──
    st.success(f"📊 共 **{len(filtered)}** 个候选视频")

    batch_col1, batch_col2, batch_col3 = st.columns([2, 2, 5])
    batch_selected = []

    with batch_col1:
        if st.button(
            "🏭 批量一键生产",
            type="primary",
            use_container_width=True,
            key="cb_batch_produce",
            help="将所有 High_Potential 候选视频批量推入生产队列",
        ):
            hunter_batch = _get_hunter()
            import asyncio

            # 只选 high_potential 且尚未进入队列的
            existing_queue = {q["url"] for q in hunter_batch.get_queue()}
            to_push = [
                c for c in filtered
                if c.get("high_potential") and c["url"] not in existing_queue
            ]

            if not to_push:
                st.warning("所有 High_Potential 视频已在队列中")
            else:
                from scrapers.auto_hunter import HuntedVideo
                queue_items = [
                    HuntedVideo(
                        url=c["url"],
                        title=c.get("title", ""),
                        video_id=c.get("video_id", ""),
                        author=c.get("author", ""),
                        platform=c.get("platform", "tiktok"),
                        roast_score=c.get("roast_potential", 0),
                    )
                    for c in to_push
                ]
                pushed = asyncio.run(hunter_batch.push_to_queue(queue_items))
                st.success(f"✅ 批量推入 {pushed} 个视频到生产队列！")
                st.rerun()

    with batch_col2:
        if st.button(
            "🔄 刷新候选池",
            use_container_width=True,
            key="cb_refresh",
        ):
            candidates = get_candidate_pool()
            st.session_state[_KEY_CANDIDATES] = candidates
            st.rerun()

    with batch_col3:
        st.caption("选择要批量生产的视频（默认全选 High_Potential）")

    st.divider()

    # ── 渲染候选视频列表 ──
    for i, c in enumerate(filtered):
        _render_candidate_card(i, c)


def _render_candidate_card(index: int, candidate: Dict[str, Any]):
    """渲染单个候选视频卡片"""
    with st.container(border=True):
        cols = st.columns([4, 1.5, 1.5, 1.5, 1])

        with cols[0]:
            # 标题 + 标签
            title = candidate.get("title", "Untitled")
            tags = candidate.get("tags", [])
            tag_badges = " ".join(f"`#{t}`" for t in tags[:3])
            st.markdown(f"**#{index + 1}** — {title}")
            st.caption(
                f"👤 {candidate.get('author', 'unknown')}  "
                f"🆔 `{candidate.get('video_id', '')[:10]}...`  "
                f"{tag_badges}"
            )
            if candidate.get("url"):
                st.markdown(f"🔗 [{candidate['url'][:50]}...]({candidate['url']})")

        with cols[1]:
            # 槽点潜力分
            score = candidate.get("roast_potential", 0)
            high = candidate.get("high_potential", False)
            if high:
                st.metric("🔥 潜力分", f"{score:.0f}", delta="High")
            elif score >= 40:
                st.metric("⚡ 潜力分", f"{score:.0f}", delta="Medium")
            else:
                st.metric("📌 潜力分", f"{score:.0f}")

        with cols[2]:
            # 互动数据
            likes = candidate.get("likes", 0)
            views = candidate.get("views", 0)
            eng_rate = candidate.get("engagement_rate", 0)
            st.metric("❤️ 点赞", f"{likes:,}" if likes else "0")
            st.caption(f"互动率: {eng_rate:.2%}" if eng_rate else "")

        with cols[3]:
            # Trending 标记 + 信号数
            is_trending = candidate.get("is_trending", False)
            signal_count = candidate.get("signal_count", 0)
            trend_icon = "📈 Trending" if is_trending else ""
            st.markdown(f"**{trend_icon}**" if trend_icon else "**—**")
            st.caption(f"信号词: {signal_count}" if signal_count else "")

        with cols[4]:
            # 操作按钮
            is_trending_flag = candidate.get("is_trending", False)
            btn_type = "primary" if is_trending_flag else "secondary"
            btn_label = "🏭 生产" if is_trending_flag else "📦 加入队列"

            if st.button(
                btn_label,
                key=f"cb_produce_{index}_{candidate.get('video_id', index)}",
                use_container_width=True,
                type=btn_type,
            ):
                hunter = _get_hunter()
                existing_queue = {q["url"] for q in hunter.get_queue()}
                if candidate["url"] not in existing_queue:
                    from scrapers.auto_hunter import HuntedVideo
                    item = HuntedVideo(
                        url=candidate["url"],
                        title=candidate.get("title", ""),
                        video_id=candidate.get("video_id", ""),
                        author=candidate.get("author", ""),
                        platform=candidate.get("platform", "tiktok"),
                        roast_score=candidate.get("roast_potential", 0),
                    )
                    import asyncio
                    asyncio.run(hunter.push_to_queue([item]))
                    hunter.confirm_video(candidate["url"])
                    st.success("✅ 已推入生产队列！")
                else:
                    hunter.confirm_video(candidate["url"])
                    st.success("✅ 已在队列中，已确认！")
                st.rerun()
