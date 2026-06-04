import os
import requests


def create_issue(title: str, body: str):
    """
    在 GitHub 仓库 winsentrobot008/DevDirector-Tasks 中创建 Issue
    """
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN 环境变量未设置")

    repo = "winsentrobot008/DevDirector-Tasks"
    url = f"https://api.github.com/repos/{repo}/issues"

    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github+json",
    }

    data = {
        "title": title,
        "body": body,
    }

    resp = requests.post(url, headers=headers, json=data)
    return resp.status_code, resp.json()
