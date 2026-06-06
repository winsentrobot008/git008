"""
github_issue.py — Maneki-AI GitHub Issue 双向通信模块

提供完整的 GitHub Issues 作为异步消息总线的读写能力：

  - create_issue(title, body)         → 创建 Issue（云端写入）
  - list_open_issues(repo)             → 列出所有 Open 状态 Issue（本地读取）
  - close_issue_with_comment(number, comment, repo) → 关闭 Issue 并回贴交付物（本地回写）
  - add_issue_comment(number, comment, repo)        → 向 Issue 添加 Comment
  - get_issue(number, repo)            → 获取单个 Issue 详情

安全规范：GITHUB_TOKEN 通过 os.getenv 读取，API 调用均包含超时控制。
"""

import os
import json
import logging
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

logger = logging.getLogger(__name__)

GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
API_BASE = "https://api.github.com"
DEFAULT_REPO = "winsentrobot008/DevDirector-Tasks"
USER_AGENT = "Maneki-AI/1.0"

# GitHub API rate limit tracking (shared across all functions)
_rate_limit_remaining = 5000
_rate_limit_reset = 0


def _headers() -> dict:
    """Return HTTP headers for GitHub API calls."""
    h = {
        "Accept": "application/vnd.github+json",
        "User-Agent": USER_AGENT,
    }
    if GITHUB_TOKEN:
        h["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return h


def _parse_rate_limit(response_headers: dict) -> None:
    """Parse X-RateLimit-* headers to track API quota."""
    global _rate_limit_remaining, _rate_limit_reset
    try:
        _rate_limit_remaining = int(response_headers.get("X-RateLimit-Remaining", 5000))
        import time
        _rate_limit_reset = int(response_headers.get("X-RateLimit-Reset", int(time.time() + 3600)))
    except (ValueError, TypeError):
        pass


def get_rate_limit_status() -> dict:
    """Get current GitHub API rate limit status."""
    import time
    return {
        "remaining": _rate_limit_remaining,
        "reset_at": _rate_limit_reset,
        "reset_in_seconds": max(0, _rate_limit_reset - int(time.time())),
        "is_exhausted": _rate_limit_remaining <= 1,
    }


def create_issue(title: str, body: str, repo: str = DEFAULT_REPO) -> tuple:
    """
    在 GitHub 仓库中创建 Issue。

    Args:
        title: Issue 标题
        body: Issue 正文（Markdown 格式）
        repo: 仓库 (owner/repo)

    Returns:
        (status_code, response_json)
    """
    if not GITHUB_TOKEN:
        raise RuntimeError("GITHUB_TOKEN 环境变量未设置")

    url = f"{API_BASE}/repos/{repo}/issues"

    data = {
        "title": title,
        "body": body,
    }

    try:
        req = Request(url, data=json.dumps(data).encode("utf-8"), headers=_headers(), method="POST")
        resp = urlopen(req, timeout=15)
        _parse_rate_limit(dict(resp.headers))
        resp_data = json.loads(resp.read().decode("utf-8"))
        resp.close()
        return resp.status, resp_data
    except HTTPError as e:
        logger.error(f"[github_issue] create_issue HTTP {e.code}: {e.reason}")
        return e.code, {"error": str(e.reason)}
    except URLError as e:
        logger.error(f"[github_issue] create_issue URLError: {e.reason}")
        return 0, {"error": str(e.reason)}
    except Exception as e:
        logger.error(f"[github_issue] create_issue error: {e}")
        return 0, {"error": str(e)}


def list_open_issues(repo: str = DEFAULT_REPO, labels: str = None) -> list[dict]:
    """
    列出仓库中所有 Open 状态的 Issue。

    这是本地工厂 task_listener 获取远程任务的**核心入口**：
    每隔轮询周期调用一次，检索 Open Issue 并喂入 HQ-Worker-Safety 生产线。

    Args:
        repo: 仓库 (owner/repo)
        labels: 可选，过滤指定 label 的 Issue（如 "factory-task"）

    Returns:
        Issue 对象列表，每个包含 number, title, body, labels, created_at 等字段。
    """
    if not GITHUB_TOKEN:
        logger.warning("[github_issue] GITHUB_TOKEN not set; skipping Issue poll.")
        return []

    url = f"{API_BASE}/repos/{repo}/issues?state=open&per_page=10"
    if labels:
        url += f"&labels={labels}"

    try:
        req = Request(url, headers=_headers(), method="GET")
        resp = urlopen(req, timeout=15)
        _parse_rate_limit(dict(resp.headers))
        raw = resp.read().decode("utf-8")
        resp.close()
        issues = json.loads(raw)
        logger.info(f"[github_issue] list_open_issues: found {len(issues)} open issues")
        return issues
    except HTTPError as e:
        logger.error(f"[github_issue] list_open_issues HTTP {e.code}: {e.reason}")
        return []
    except URLError as e:
        logger.error(f"[github_issue] list_open_issues URLError: {e.reason}")
        return []
    except Exception as e:
        logger.error(f"[github_issue] list_open_issues error: {e}")
        return []


def get_issue(issue_number: int, repo: str = DEFAULT_REPO) -> dict | None:
    """
    获取单个 Issue 的完整详情。

    Args:
        issue_number: Issue 编号
        repo: 仓库 (owner/repo)

    Returns:
        Issue 对象字典，或 None
    """
    if not GITHUB_TOKEN:
        return None

    url = f"{API_BASE}/repos/{repo}/issues/{issue_number}"

    try:
        req = Request(url, headers=_headers(), method="GET")
        resp = urlopen(req, timeout=15)
        _parse_rate_limit(dict(resp.headers))
        raw = resp.read().decode("utf-8")
        resp.close()
        return json.loads(raw)
    except Exception as e:
        logger.error(f"[github_issue] get_issue #{issue_number} error: {e}")
        return None


def add_issue_comment(issue_number: int, comment: str, repo: str = DEFAULT_REPO) -> tuple:
    """
    向指定 Issue 添加 Comment。

    用于在任务执行过程中或完成后，将日志/交付物路径回贴到 Issue 下方。

    Args:
        issue_number: Issue 编号
        comment: Comment 正文（Markdown 格式）
        repo: 仓库 (owner/repo)

    Returns:
        (status_code, response_json)
    """
    if not GITHUB_TOKEN:
        logger.warning("[github_issue] GITHUB_TOKEN not set; cannot add comment.")
        return 0, {"error": "GITHUB_TOKEN not set"}

    url = f"{API_BASE}/repos/{repo}/issues/{issue_number}/comments"

    data = {"body": comment}

    try:
        req = Request(url, data=json.dumps(data).encode("utf-8"), headers=_headers(), method="POST")
        resp = urlopen(req, timeout=15)
        _parse_rate_limit(dict(resp.headers))
        resp_data = json.loads(resp.read().decode("utf-8"))
        resp.close()
        logger.info(f"[github_issue] add_comment to #{issue_number}: HTTP {resp.status}")
        return resp.status, resp_data
    except HTTPError as e:
        logger.error(f"[github_issue] add_comment #{issue_number} HTTP {e.code}: {e.reason}")
        return e.code, {"error": str(e.reason)}
    except Exception as e:
        logger.error(f"[github_issue] add_comment #{issue_number} error: {e}")
        return 0, {"error": str(e)}


def close_issue(issue_number: int, repo: str = DEFAULT_REPO) -> tuple:
    """
    关闭指定的 Issue（将 state 从 Open 变更为 Closed）。

    Args:
        issue_number: Issue 编号
        repo: 仓库 (owner/repo)

    Returns:
        (status_code, response_json)
    """
    if not GITHUB_TOKEN:
        logger.warning("[github_issue] GITHUB_TOKEN not set; cannot close issue.")
        return 0, {"error": "GITHUB_TOKEN not set"}

    url = f"{API_BASE}/repos/{repo}/issues/{issue_number}"

    data = {"state": "closed"}

    try:
        req = Request(url, data=json.dumps(data).encode("utf-8"), headers=_headers(), method="PATCH")
        resp = urlopen(req, timeout=15)
        _parse_rate_limit(dict(resp.headers))
        resp_data = json.loads(resp.read().decode("utf-8"))
        resp.close()
        logger.info(f"[github_issue] close_issue #{issue_number}: HTTP {resp.status}")
        return resp.status, resp_data
    except HTTPError as e:
        logger.error(f"[github_issue] close_issue #{issue_number} HTTP {e.code}: {e.reason}")
        return e.code, {"error": str(e.reason)}
    except Exception as e:
        logger.error(f"[github_issue] close_issue #{issue_number} error: {e}")
        return 0, {"error": str(e)}


def close_issue_with_comment(issue_number: int, comment: str, repo: str = DEFAULT_REPO) -> dict:
    """
    一站式操作：添加 Comment → 关闭 Issue。

    这是本地工厂在任务执行完成后的**核心回写入口**：
    1. 将交付物摘要/日志以 Comment 形式回贴
    2. 将 Issue 状态变更为 Closed

    Args:
        issue_number: Issue 编号
        comment: Comment 正文（应包含交付物路径、执行日志摘要等）
        repo: 仓库 (owner/repo)

    Returns:
        {"status": "ok"/"partial"/"error", "comment_status": ..., "close_status": ...}
    """
    result = {"status": "error", "comment_status": None, "close_status": None}

    # Step 1: Add comment with delivery info
    comment_code, comment_resp = add_issue_comment(issue_number, comment, repo)
    result["comment_status"] = comment_code
    result["comment_response"] = comment_resp

    if comment_code not in (200, 201):
        logger.warning(f"[github_issue] close_issue_with_comment: comment failed (HTTP {comment_code}), still closing...")
        result["status"] = "partial"

    # Step 2: Close the issue
    close_code, close_resp = close_issue(issue_number, repo)
    result["close_status"] = close_code
    result["close_response"] = close_resp

    if close_code in (200, 201):
        if result["status"] != "partial":
            result["status"] = "ok"
        logger.info(f"[github_issue] ✅ Issue #{issue_number} closed with delivery comment")
    else:
        result["status"] = "error"
        logger.error(f"[github_issue] ❌ Failed to close Issue #{issue_number} (HTTP {close_code})")

    return result


def issue_body_to_goal(issue_body: str) -> str:
    """
    从 Issue Body 中提取商业目标（Goal）。

    支持两种格式：
      1. Markdown 第一行以 # 开头 → 提取标题后内容
      2. 纯文本 → 直接作为 Goal

    Args:
        issue_body: Issue Body 原文

    Returns:
        提取的 goal 字符串
    """
    if not issue_body or not issue_body.strip():
        return ""

    lines = issue_body.strip().split("\n")

    # Strip Markdown heading markers and leading/trailing whitespace
    goal = lines[0].strip()
    if goal.startswith("#"):
        # Remove leading # characters and whitespace
        goal = goal.lstrip("#").strip()

    # If the first line is too short, use the entire body
    if len(goal) < 5 and len(lines) > 1:
        goal = issue_body.strip()[:500]

    return goal


# ── CLI 测试接口 ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    if not GITHUB_TOKEN:
        print("❌ GITHUB_TOKEN 环境变量未设置。请在 .env 中配置后重试。")
        sys.exit(1)

    if len(sys.argv) < 2:
        print("Usage: python github_issue.py <command> [args...]")
        print("Commands:")
        print("  list                          — 列出所有 Open Issue")
        print("  create <title> <body>         — 创建新 Issue")
        print("  close <issue_number> <comment> — 关闭 Issue 并回贴 Comment")
        sys.exit(0)

    cmd = sys.argv[1]

    if cmd == "list":
        issues = list_open_issues()
        print(f"\n📋 共 {len(issues)} 个 Open Issue:\n")
        for iss in issues:
            labels = [l["name"] for l in iss.get("labels", [])]
            print(f"  #{iss['number']:5d}  [{', '.join(labels) or '无标签'}]  {iss['title'][:80]}")
        rl = get_rate_limit_status()
        print(f"\n⏱️  API 余量: {rl['remaining']} 次, 重置倒计时: {rl['reset_in_seconds']}s")

    elif cmd == "create":
        if len(sys.argv) < 4:
            print("Usage: python github_issue.py create <title> <body>")
            sys.exit(1)
        title = sys.argv[2]
        body = sys.argv[3]
        code, data = create_issue(title, body)
        print(f"HTTP {code}: {json.dumps(data, indent=2, ensure_ascii=False)}")

    elif cmd == "close":
        if len(sys.argv) < 4:
            print("Usage: python github_issue.py close <issue_number> <comment>")
            sys.exit(1)
        number = int(sys.argv[2])
        comment = sys.argv[3]
        result = close_issue_with_comment(number, comment)
        print(json.dumps(result, indent=2, ensure_ascii=False))

    else:
        print(f"❌ 未知命令: {cmd}")
        sys.exit(1)