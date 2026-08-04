"""Reports View — 日报/周报可视化页面"""
import streamlit as st
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parent.parent.parent.parent

def render():
    st.header("📈 Reports")
    st.caption("Daily · Weekly 自动生成报告")

    sys.path.insert(0, str(ROOT))
    from reports.daily_report import generate as daily
    from reports.weekly_report import generate as weekly

    tab1, tab2 = st.tabs(["📅 Daily Report", "📆 Weekly Report"])
    with tab1:
        st.markdown(daily())
    with tab2:
        st.markdown(weekly())
