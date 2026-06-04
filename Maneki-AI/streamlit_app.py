import streamlit as st
from github_issue import create_issue

st.title("Maneki-AI 招财猫情报局")

tasks = [
    "AI 视频生成 出海",
    "AI 塔罗 占卜",
    "AI 跨境电商 爆款"
]

for task in tasks:
    st.write(f"模拟结果: {task}")
    if st.button(f"批准开发: {task}"):
        status, result = create_issue(
            title=f"批准开发：{task}",
            body=f"由 Maneki-AI 招财猫情报局批准，自动创建任务。"
        )

        # ✅ 调试输出：显示状态码和返回内容
        st.write("GitHub 返回状态码:", status)
        st.write("GitHub 返回内容:", result)

        if status == 201:
            st.success(f"Issue 已成功创建：{task}")
        else:
            st.error(f"创建 Issue 失败，请检查返回内容。")
