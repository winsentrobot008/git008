"""Factory Status — 工厂状态监控面板"""
import streamlit as st
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parent.parent.parent

def render():
    st.header("🏭 Factory Status")
    st.caption("实时监控 · 暂停/恢复/停止 · 双语进度 · 今日产量")

    sys.path.insert(0, str(ROOT))
    try:
        from orchestrator.factory_controller import FactoryController
        ctrl = FactoryController()
    except Exception:
        st.warning("Factory controller not available")
        return

    status = ctrl.status

    # State
    state_colors = {"running": "🟢", "paused": "🟡", "idle": "⚪", "stopping": "🔴"}
    st.markdown(f"## {state_colors.get(status.state.value, '⚪')} State: `{status.state.value.upper()}`")

    cols = st.columns(5)
    with cols[0]: st.metric("Videos Today", status.videos_today)
    with cols[1]: st.metric("Drafts Today", status.drafts_today)
    with cols[2]: st.metric("Published Today", status.published_today)
    with cols[3]: st.metric("Queue", status.queue_length)
    with cols[4]: st.metric("Step", f"{status.current_step}/9")

    st.divider()

    # Progress bars
    st.subheader("📊 Bilingual Pipeline Progress")
    st.markdown("**🇨🇳 CN**")
    st.progress(status.cn_progress)
    st.markdown("**🌍 EN**")
    st.progress(status.en_progress)

    st.divider()

    # Control buttons
    st.subheader("🎮 Factory Controls")
    col1, col2, col3, col4, col5 = st.columns(5)
    with col1:
        if st.button("⏸ Pause", use_container_width=True):
            ctrl.pause(); st.rerun()
    with col2:
        if st.button("▶ Resume", type="primary", use_container_width=True):
            ctrl.resume(); st.rerun()
    with col3:
        if st.button("⏹ Stop", use_container_width=True):
            ctrl.stop_task(); st.rerun()
    with col4:
        if st.button("🔄 Restart", use_container_width=True):
            ctrl.restart_pipeline(); st.rerun()
    with col5:
        if st.button("🧹 Clear Queue", use_container_width=True):
            ctrl.clear_queue(); st.rerun()
