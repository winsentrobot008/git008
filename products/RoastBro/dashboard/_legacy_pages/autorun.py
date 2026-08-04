"""
AutoRun Control Panel — 全自动生产控制面板
=============================================
AutoRun™ 启动/停止 · 草稿审核 · 日报/周报 · 生产统计
"""

import streamlit as st
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent.parent

def render():
    st.header("🤖 AutoRun™ Control Panel")
    st.caption("24 小时自动生产 · CEO 审核发布 · 日报/周报自动生成")

    # Load engine
    sys.path.insert(0, str(ROOT))
    try:
        from orchestrator.autorun import AutoRunEngine
        engine = AutoRunEngine()
    except Exception as e:
        st.error(f"AutoRun engine failed to load: {e}")
        return

    col1, col2, col3, col4 = st.columns(4)
    stats = engine.get_stats()
    with col1:
        st.metric("Total Runs", stats["total_runs"])
    with col2:
        st.metric("Drafts", stats["total_drafts"])
    with col3:
        st.metric("Approved", stats["approved"])
    with col4:
        st.metric("Pending", stats["pending"])

    st.divider()

    # Start/Stop
    col_a, col_b = st.columns(2)
    with col_a:
        if st.button("▶️ Start AutoRun", type="primary", use_container_width=True,
                     disabled=engine.is_running):
            engine.start(interval_minutes=60)
            st.success("AutoRun started — running every 60 minutes")
            st.rerun()
    with col_b:
        if st.button("⏹️ Stop AutoRun", use_container_width=True,
                     disabled=not engine.is_running):
            engine.stop()
            st.warning("AutoRun stopped")
            st.rerun()

    st.divider()

    # Manual trigger
    if st.button("⚡ Run Once Now", use_container_width=True):
        draft = engine.run_once()
        st.success(f"Draft created: {draft.id}")
        st.rerun()

    st.divider()

    # Pending drafts with approve/reject
    st.subheader("📋 Pending Drafts — CEO Review Required")
    drafts = engine.get_pending_drafts()
    if drafts:
        for d in drafts:
            with st.container(border=True):
                cols = st.columns([3, 1, 1, 1])
                cols[0].markdown(f"**{d.title}**")
                cols[0].caption(f"🆔 {d.id} · {d.source_platform}")
                cols[1].markdown(f"CN SEO: {d.cn_seo_score}/100")
                cols[2].markdown(f"EN SEO: {d.en_seo_score}/100")
                cols[3].markdown(f"🛡️ {d.cn_compliance}")
                col_x, col_y, _ = st.columns([1, 1, 4])
                with col_x:
                    if st.button("✅ Approve", key=f"app_{d.id}", type="primary"):
                        engine.approve_draft(d.id)
                        st.success(f"Approved: {d.id}")
                        st.rerun()
                with col_y:
                    if st.button("❌ Reject", key=f"rej_{d.id}"):
                        engine.reject_draft(d.id)
                        st.warning(f"Rejected: {d.id}")
                        st.rerun()
    else:
        st.info("No pending drafts — AutoRun will create them automatically")

    st.divider()

    # Report generation
    st.subheader("📊 Auto Report")
    col_r1, col_r2 = st.columns(2)
    with col_r1:
        if st.button("📅 Generate Daily Report", use_container_width=True):
            report = engine.generate_report("daily")
            st.markdown(report)
    with col_r2:
        if st.button("📆 Generate Weekly Report", use_container_width=True):
            report = engine.generate_report("weekly")
            st.markdown(report)
