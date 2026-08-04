"""
Bilingual Matrix — 双语内容矩阵页面
=====================================
CN/EN 内容类型分布、产量对比、增长趋势。
"""

import streamlit as st


def render():
    st.header("🈴 Bilingual Content Matrix")
    st.caption("CN · EN 内容矩阵 — 类型分布 · 产量对比 · 增长趋势")

    # Content type matrix
    st.subheader("📊 内容类型矩阵")
    col1, col2 = st.columns(2)

    with col1:
        st.markdown("### 🇨🇳 CN Content")
        cn_types = [
            ("吐槽 Roast", 12, "🟢"),
            ("离谱 Absurd", 8, "🟢"),
            ("挑战 Challenge", 5, "🟡"),
            ("影视解说 Commentary", 3, "🔵"),
        ]
        for name, count, color in cn_types:
            st.markdown(f"{color} **{name}**: {count} videos")
            st.progress(count / 20, text="")

    with col2:
        st.markdown("### 🌍 EN Content")
        en_types = [
            ("Reaction", 10, "🟢"),
            ("Meme Review", 7, "🟢"),
            ("Commentary", 4, "🟡"),
            ("Challenge", 3, "🔵"),
        ]
        for name, count, color in en_types:
            st.markdown(f"{color} **{name}**: {count} videos")
            st.progress(count / 20, text="")

    st.divider()

    # Performance comparison
    st.subheader("📈 CN vs EN Performance")
    cols = st.columns(3)
    with cols[0]:
        st.metric("Total Videos", "28 CN / 24 EN", "+15% MoM")
    with cols[1]:
        st.metric("Avg SEO Score", "85 CN / 82 EN", "+3 pts")
    with cols[2]:
        st.metric("Compliance Rate", "100% CN / 98% EN", "✅")

    st.divider()

    # Growth trends
    st.subheader("📈 增长趋势")
    st.markdown("""
| Month | CN Videos | EN Videos | Total |
|-------|-----------|-----------|-------|
| Week 1 | 5 | 3 | 8 |
| Week 2 | 8 | 6 | 14 |
| Week 3 | 7 | 8 | 15 |
| Week 4 | 8 | 7 | 15 |
| **Total** | **28** | **24** | **52** |
    """)
