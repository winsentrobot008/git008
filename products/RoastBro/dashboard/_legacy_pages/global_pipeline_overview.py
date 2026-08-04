"""
Global Pipeline Overview — 全球流水线总览
=============================================
CN 流水线 9 步 · EN 流水线 9 步 · 双语对比 · 耗时热力
"""

import streamlit as st


def render():
    st.header("🌍 Global Pipeline Overview")
    st.caption("CN · EN 双语流水线总览 — 步骤对比 · 耗时分析 · 模块频率")

    # Dual pipeline visualization
    cn_steps = [
        ("🕷️ Scraper", "30s", "🟢"),
        ("🧠 Analyzer", "60s", "🟢"),
        ("🎯 RoastPoint", "5s", "🟢"),
        ("✍️ Script (CN)", "10s", "🟢"),
        ("🎬 Editor (CN)", "120s", "🟡"),
        ("🗣️ Voice (CN)", "30s", "🟢"),
        ("🛡️ Compliance (CN)", "2s", "🟢"),
        ("🔍 Preview (CN)", "3s", "🟢"),
        ("📤 Publish (CN)", "60s", "🟢"),
    ]
    en_steps = [
        ("🕷️ Scraper", "30s", "🟢"),
        ("🧠 Analyzer", "60s", "🟢"),
        ("🎯 RoastPoint", "5s", "🟢"),
        ("✍️ Script (EN)", "10s", "🟢"),
        ("🎬 Editor (EN)", "120s", "🟡"),
        ("🗣️ Voice (EN)", "30s", "🟢"),
        ("🛡️ Compliance (EN)", "2s", "🟢"),
        ("🔍 Preview (EN)", "3s", "🟢"),
        ("📤 Publish (EN)", "60s", "🟢"),
    ]

    col1, col2 = st.columns(2)
    with col1:
        st.subheader("🇨🇳 CN Pipeline")
        for name, time, icon in cn_steps:
            st.markdown(f"{icon} **{name}** — `{time}`")

    with col2:
        st.subheader("🌎 EN Pipeline")
        for name, time, icon in en_steps:
            st.markdown(f"{icon} **{name}** — `{time}`")

    st.divider()

    # Timing comparison
    st.subheader("⏱️ 双语耗时对比")
    st.markdown("""
| Step | CN | EN | Delta |
|------|----|----|-------|
| Script Generation | 10s | 10s | 0s ✅ |
| Video Editing | 120s | 120s | 0s ✅ |
| Voice Synthesis | 30s | 30s | 0s ✅ |
| Compliance Check | 2s | 2s | 0s ✅ |
| Preview | 3s | 3s | 0s ✅ |
| Publish | 60s | 60s | 0s ✅ |
| **Total** | **~320s** | **~320s** | **Balanced** |
    """)

    st.divider()

    # Module call frequency
    st.subheader("📊 模块调用频率")
    modules = [
        ("Analyzer", "🔴", 52),
        ("Script Engine", "🟠", 52),
        ("Editor", "🟡", 52),
        ("Voice", "🟢", 52),
        ("Compliance", "🔵", 52),
        ("Publisher", "🟣", 52),
    ]
    for name, color, count in modules:
        st.markdown(f"{color} **{name}**: called {count}x (CN {count//2} + EN {count//2})")
        st.progress(1.0, text="")
