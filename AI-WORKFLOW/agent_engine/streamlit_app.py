"""
Agent-S Streamlit Dashboard
多智能体机会分析流 - 可视化控制面板
"""
import streamlit as st
import requests
import json
import os
import time
import subprocess
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

# === Configuration ===
BRIDGE_URL = f"http://{os.getenv('BRIDGE_HOST', '127.0.0.1')}:{os.getenv('BRIDGE_PORT', '5005')}"
API_URL = f"http://{os.getenv('API_HOST', '127.0.0.1')}:{os.getenv('API_PORT', '8000')}"

st.set_page_config(
    page_title="Agent-S Dashboard",
    page_icon="🤖",
    layout="wide",
)

st.title("🤖 Agent-S 多智能体机会分析流")
st.markdown("---")

# === Sidebar ===
with st.sidebar:
    st.header("⚙️ 系统状态")
    
    # Check bridge health
    bridge_ok = False
    try:
        r = requests.get(f"{BRIDGE_URL}/queue", timeout=3)
        if r.status_code == 200:
            bridge_ok = True
            st.success("✅ Bridge 服务运行中")
    except:
        st.error("❌ Bridge 服务未连接")
    
    # Check API health
    api_ok = False
    try:
        r = requests.get(f"{API_URL}/health", timeout=3)
        if r.status_code == 200:
            api_ok = True
            st.success("✅ API 服务运行中")
    except:
        st.warning("⚠️ API 服务未连接")
    
    st.markdown("---")
    st.header("📋 环境配置")
    st.code(f"""
OPENAI_API_BASE: {os.getenv('OPENAI_API_BASE', '未设置')}
AGENT_S_MODE: {os.getenv('AGENT_S_MODE', '未设置')}
BRIDGE_PORT: {os.getenv('BRIDGE_PORT', '5005')}
API_PORT: {os.getenv('API_PORT', '8000')}
    """)
    
    st.markdown("---")
    st.header("🔧 快速操作")
    
    if st.button("🔄 刷新状态", use_container_width=True):
        st.rerun()
    
    if st.button("📤 发送测试任务", use_container_width=True):
        try:
            payload = {"id": "test-streamlit", "type": "code", "payload": "echo AGENT_S_HANDSHAKE"}
            # Try /task first (app.py), then /send (bridge.py)
            for endpoint in ["/task", "/send"]:
                try:
                    r = requests.post(f"{BRIDGE_URL}{endpoint}", json=payload, timeout=5)
                    if r.status_code == 200:
                        st.success(f"任务已发送 via {endpoint}: {r.json()}")
                        break
                except:
                    continue
            else:
                st.error("所有端点均发送失败")
        except Exception as e:
            st.error(f"发送失败: {e}")


# === Main Content ===
col1, col2 = st.columns(2)

with col1:
    st.header("📥 任务队列")
    try:
        r = requests.get(f"{BRIDGE_URL}/queue", timeout=3)
        if r.status_code == 200:
            queue = r.json()
            if queue:
                st.dataframe(queue, use_container_width=True)
            else:
                st.info("队列为空")
    except Exception as e:
        st.error(f"无法获取队列: {e}")

with col2:
    st.header("📤 任务结果")
    results_file = "bridge_results.json"
    if os.path.exists(results_file):
        try:
            with open(results_file, "r", encoding="utf-8") as f:
                results = json.load(f)
            if results:
                st.dataframe(results[-10:], use_container_width=True)
            else:
                st.info("暂无结果")
        except Exception as e:
            st.error(f"读取结果失败: {e}")
    else:
        st.info("结果文件不存在")

st.markdown("---")

# === Multi-Agent Analysis Flow ===
st.header("🧠 多智能体机会分析流")

col3, col4, col5 = st.columns(3)

with col3:
    st.subheader("🔍 S1 - 探索")
    st.caption("探索环境，发现潜在机会")
    if st.button("▶️ 运行 S1 探索", use_container_width=True):
        st.info("S1 探索任务已加入队列")

with col4:
    st.subheader("⚡ S2 - 分析")
    st.caption("深度分析，生成洞察")
    if st.button("▶️ 运行 S2 分析", use_container_width=True):
        st.info("S2 分析任务已加入队列")

with col5:
    st.subheader("🎯 S3 - 执行")
    st.caption("执行行动计划")
    if st.button("▶️ 运行 S3 执行", use_container_width=True):
        st.info("S3 执行任务已加入队列")

st.markdown("---")

# === Log Viewer ===
st.header("📜 运行日志")
log_file = "agent_s_startup.log"
if os.path.exists(log_file):
    with open(log_file, "r", encoding="utf-8") as f:
        logs = f.readlines()
    st.text("".join(logs[-30:]))
else:
    st.info("日志文件不存在")

st.markdown("---")
st.caption(f"Agent-S Dashboard | 最后更新: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
