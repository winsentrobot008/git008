import json
import sys

def generate_plan(title, body):
    plan = {
        "task_title": title,
        "task_description": body,
        "steps": [
            "分析 Issue 内容",
            "确定需要修改或新增的文件",
            "生成代码结构",
            "为 Coder 输出明确的开发指令"
        ]
    }
    return plan

if __name__ == "__main__":
    title = sys.argv[1]
    body = sys.argv[2]
    plan = generate_plan(title, body)
    print(json.dumps(plan))
