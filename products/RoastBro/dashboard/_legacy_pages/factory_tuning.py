"""Factory Tuning — 工厂参数微调面板"""
import streamlit as st
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parent.parent.parent

def render():
    st.header("🎛 Factory Tuning")
    st.caption("脚本风格 · 剪辑节奏 · 语速 · SEO · 合规 · 自动抓取")

    sys.path.insert(0, str(ROOT))
    try:
        from orchestrator.factory_controller import FactoryController
        ctrl = FactoryController()
    except Exception:
        st.warning("Factory controller not available")
        return

    cfg = ctrl.get_config()

    st.subheader("✍️ Script Weights")
    cfg["cn_script_weight"] = st.slider("CN Script Weight", 0.0, 1.0, cfg["cn_script_weight"])
    cfg["en_script_weight"] = st.slider("EN Script Weight", 0.0, 1.0, cfg["en_script_weight"])

    st.divider()
    st.subheader("🎨 Creator Distillation Weights")
    cfg["creator_structure_weight"] = st.slider("Structure Weight", 0.0, 1.0, cfg["creator_structure_weight"])
    cfg["creator_emotion_weight"] = st.slider("Emotion Weight", 0.0, 1.0, cfg["creator_emotion_weight"])
    cfg["creator_pacing_weight"] = st.slider("Pacing Weight", 0.0, 1.0, cfg["creator_pacing_weight"])

    st.divider()
    st.subheader("🎬 Editing & Voice")
    cfg["editing_pacing"] = st.selectbox("Editing Pace", ["slow", "medium", "fast"], index=["slow", "medium", "fast"].index(cfg["editing_pacing"]))
    cfg["voice_speed"] = st.slider("Voice Speed", 0.5, 2.0, cfg["voice_speed"])
    cfg["subtitle_density"] = st.slider("Subtitle Density", 0.0, 1.0, cfg["subtitle_density"])

    st.divider()
    st.subheader("🔍 SEO & Compliance")
    cfg["seo_intensity"] = st.slider("SEO Intensity", 0.0, 1.0, cfg["seo_intensity"])
    cfg["compliance_strictness"] = st.selectbox("Compliance Strictness", ["loose", "standard", "strict"], index=["loose", "standard", "strict"].index(cfg["compliance_strictness"]))

    st.divider()
    st.subheader("🤖 AutoRun Settings")
    cfg["auto_fetch_interval"] = st.number_input("Fetch Interval (min)", 5, 480, cfg["auto_fetch_interval"])
    cfg["auto_fetch_source"] = st.selectbox("Fetch Source", ["cn", "en", "both"], index=["cn", "en", "both"].index(cfg["auto_fetch_source"]))
    cfg["daily_production_limit"] = st.number_input("Daily Limit", 1, 100, cfg["daily_production_limit"])

    if st.button("💾 Save Configuration", type="primary", use_container_width=True):
        ctrl.update_config(cfg)
        st.success("Configuration saved!")
