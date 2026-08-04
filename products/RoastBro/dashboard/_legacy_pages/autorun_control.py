"""AutoRun Control — 全自动生产控制面板"""
import streamlit as st
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parent.parent.parent

def render():
    st.header("🔁 AutoRun Control")
    st.caption("AutoRun 开关 · 今日统计 · 队列状态 · 生产控制")

    sys.path.insert(0, str(ROOT))
    try:
        from orchestrator.autorun import AutoRunEngine
        engine = AutoRunEngine()
    except Exception:
        st.warning("AutoRun engine not available")
        return

    stats = engine.get_stats()

    col1, col2, col3, col4 = st.columns(4)
    with col1: st.metric("Total Runs", stats["total_runs"])
    with col2: st.metric("Drafts", stats["total_drafts"])
    with col3: st.metric("Approved", stats["approved"])
    with col4: st.metric("Pending", stats["pending"])

    st.divider()
    st.subheader("🎛 Controls")
    col_a, col_b = st.columns(2)
    with col_a:
        if st.button("▶ Start AutoRun", type="primary", use_container_width=True, disabled=engine.is_running):
            engine.start()
            st.rerun()
    with col_b:
        if st.button("⏹ Stop AutoRun", use_container_width=True, disabled=not engine.is_running):
            engine.stop()
            st.rerun()

    if st.button("⚡ Run Once Now", use_container_width=True):
        engine.run_once()
        st.rerun()

    st.divider()
    st.subheader("📋 Pending Drafts")
    drafts = engine.get_pending_drafts()
    if drafts:
        for d in drafts:
            with st.container(border=True):
                st.markdown(f"**{d.title}** — CN SEO: {d.cn_seo_score} | EN SEO: {d.en_seo_score}")
                if st.button(f"✅ Approve {d.id}", key=f"app_{d.id}"):
                    engine.approve_draft(d.id); st.rerun()
                if st.button(f"❌ Reject {d.id}", key=f"rej_{d.id}"):
                    engine.reject_draft(d.id); st.rerun()
    else:
        st.info("No pending drafts")
