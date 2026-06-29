import json
import sys
import requests
import os

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")

def call_deepseek(prompt):
    url = "https://api.deepseek.com/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}"
    }
    data = {
        "model": "deepseek-chat",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2
    }
    response = requests.post(url, headers=headers, json=data)
    return response.json()["choices"][0]["message"]["content"]

if __name__ == "__main__":
    plan_json = sys.argv[1]
    plan = json.loads(plan_json)

    prompt = f"""
你是一个专业的 AI 程序员，请根据以下任务计划生成代码：

任务标题：{plan['task_title']}
任务描述：{plan['task_description']}
任务步骤：{plan['steps']}

请输出最终代码内容，不要解释。
"""

    code = call_deepseek(prompt)
    print(code)
