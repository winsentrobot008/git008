"""
Error Log — 登录阻断/抓取失败记录器
=====================================
记录所有因登录要求、认证失败、被屏蔽等原因无法抓取的 URL。

架构：
    log_blocked(url, reason, platform)  → 追加到 error_log.json
    get_blocked(platform=None)           → 读取已记录的被阻断 URL

遵守 Constitution Article 2.2 / 5.4 — 不强制攻破登录屏障。
"""

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

# ── 默认日志路径 ──────────────────────────────────────────────
DEFAULT_LOG_PATH = Path("data/error_log.json")

# ── 登录阻断信号词（yt-dlp / HTTP 返回）───────────────────────
LOGIN_SIGNAL_KEYWORDS = [
    "login", "sign in", "signin", "authentication",
    "auth required", "unauthorized", "forbidden",
    "please log", "need to log", "must log",
    "requires authentication", "requires login",
    "account suspended", "violation", "blocked",
    "rate limit", "too many requests",
    "captcha", "verify",
    "403", "401", "429",
]


def is_login_blocked(error_text: str) -> bool:
    """
    检测错误文本是否包含登录/封禁信号。

    Args:
        error_text: yt-dlp stderr 或 HTTP 错误信息

    Returns:
        bool: True 表示该错误属于登录阻断，不应重试
    """
    if not error_text:
        return False
    lower = error_text.lower()
    return any(kw in lower for kw in LOGIN_SIGNAL_KEYWORDS)


def log_blocked(
    url: str,
    reason: str,
    platform: str = "tiktok",
    log_path: Optional[Path] = None,
) -> None:
    """
    将因登录/封禁被跳过的 URL 记入 error_log.json。

    Args:
        url: 被跳过的视频 URL
        reason: 阻断原因（如 "login_required", "forbidden", "rate_limited"）
        platform: 平台名称
        log_path: 日志路径，默认 data/error_log.json
    """
    if log_path is None:
        log_path = DEFAULT_LOG_PATH

    log_path.parent.mkdir(parents=True, exist_ok=True)

    # 读取已有记录
    records: List[Dict[str, Any]] = []
    if log_path.exists():
        try:
            raw = log_path.read_text(encoding="utf-8")
            if raw.strip():
                records = json.loads(raw)
                if not isinstance(records, list):
                    records = []
        except (json.JSONDecodeError, Exception):
            records = []

    # 去重：同一 URL 只记录一次
    existing_urls = {r.get("url") for r in records}
    if url in existing_urls:
        return

    # 追加新记录
    records.append({
        "url": url,
        "platform": platform,
        "reason": reason,
        "blocked_at": datetime.now().isoformat(),
        "action": "skipped",  # 标记为已跳过，不强制抓取
    })

    log_path.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    logger.info(f"  ⛔ Login-blocked URL logged: {url[:80]}... (reason: {reason})")


def get_blocked(
    platform: Optional[str] = None,
    log_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    """
    读取已记录的被阻断 URL 列表。

    Args:
        platform: 可选，按平台过滤（如 "tiktok"）
        log_path: 日志路径，默认 data/error_log.json

    Returns:
        List[Dict]: 被阻断的 URL 记录列表
    """
    if log_path is None:
        log_path = DEFAULT_LOG_PATH

    if not log_path.exists():
        return []

    try:
        raw = log_path.read_text(encoding="utf-8")
        if not raw.strip():
            return []
        records = json.loads(raw)
        if not isinstance(records, list):
            return []
    except (json.JSONDecodeError, Exception):
        return []

    if platform:
        return [r for r in records if r.get("platform") == platform]
    return records


def count_blocked(platform: Optional[str] = None) -> int:
    """返回被阻断 URL 数量"""
    return len(get_blocked(platform))
