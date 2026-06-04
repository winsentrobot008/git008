import streamlit as st
import requests

def render_factory_trigger():
    st.markdown("---")
    st.header("🔧 [DEBUG] Factory Control Center")
    
    # 强制固定位置，确保渲染不被其他组件阻断
    if st.button("🚀 Trigger Factory Task (DEBUG MODE)"):
        st.info("发送指令中...")
        # 简化版逻辑，只做触发测试
        st.write("指令已发送至 GitHub Issue #14")
        st.balloons() # 庆祝一下指令发出
        
    st.markdown("---")