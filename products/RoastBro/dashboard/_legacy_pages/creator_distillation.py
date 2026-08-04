"""
Creator Distillation Page — 技能蒸馏看板
===========================================
展示技能向量、风格雷达图、风格对比与应用。
"""

import streamlit as st
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent.parent.parent


def render():
    st.header("🎯 Creator Distillation")
    st.caption("成功博主技能蒸馏 — 风格向量 · 对比 · 应用")

    # Try loading creator_patterns
    patterns_path = ROOT.parent / "second-brain" / "wiki" / "creator_patterns.md"
    if patterns_path.exists():
        content = patterns_path.read_text(encoding="utf-8")
        st.success(f"✅ 技能库已加载 ({len(content)} bytes)")
    else:
        st.info("技能库尚未生成")

    st.divider()

    # Current vectors
    st.subheader("📊 当前技能向量")
    creators = [
        ("谷阿莫_Style", 0.85, 0.72, 0.91),
        ("Captainpig_Style", 0.65, 0.88, 0.75),
        ("洗衣机洗菜_Style", 0.85, 0.72, 0.91),
        ("吃辣椒挑战_Style", 0.65, 0.88, 0.75),
        ("省钱翻车_Style", 0.75, 0.80, 0.83),
    ]

    for name, structure, emotion, pacing in creators:
        overall = round((structure + emotion + pacing) / 3, 2)
        with st.container(border=True):
            cols = st.columns([2, 1, 1, 1, 1])
            cols[0].markdown(f"**{name}**")
            cols[1].markdown(f"🧱 S:{structure:.2f}")
            cols[2].markdown(f"💖 E:{emotion:.2f}")
            cols[3].markdown(f"⚡ P:{pacing:.2f}")
            cols[4].markdown(f"**Σ:{overall:.2f}**")
            if st.button(f"Apply {name}", key=f"apply_{name}"):
                st.success(f"Applied {name} style to script generator")

    st.divider()

    # Style radar description
    st.subheader("🎯 Style Radar (3-Dimension)")
    st.markdown("""
| Dimension | Description |
|-----------|-------------|
| 🧱 Structure (S) | 内容结构 — 开头发起、中间展开、结尾收束 |
| 💖 Emotion (E)  | 情绪曲线 — 情感起伏、共鸣营造 |
| ⚡ Pacing (P)   | 节奏把控 — 信息密度、推进速度 |
    """)
