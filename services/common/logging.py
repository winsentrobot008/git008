"""统一日志与回退（Fallback）日志器。

所有接口失败必须走 log_fallback()，落盘 runtime_data/logs/integration_fallback.log，
保证「接口失败时提供明确的错误回退日志」这一交付要求可审计。
"""

from __future__ import annotations

import logging
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FALLBACK_LOG = REPO_ROOT / "runtime_data" / "logs" / "integration_fallback.log"

_FALLBACK_HANDLER: logging.Handler | None = None


def _ensure_fallback_handler() -> None:
    global _FALLBACK_HANDLER
    if _FALLBACK_HANDLER is not None:
        return
    try:
        FALLBACK_LOG.parent.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(FALLBACK_LOG, encoding="utf-8")
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
        )
        _FALLBACK_HANDLER = handler
        logging.getLogger("services.fallback").addHandler(handler)
    except OSError:
        _FALLBACK_HANDLER = None


def get_logger(name: str) -> logging.Logger:
    """返回带统一格式的 logger；日志同时镜像到 stdout（控制台可读）。"""
    logger = logging.getLogger(f"services.{name}")
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter("[%(name)s] %(message)s"))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False
    return logger


def log_fallback(
    logger: logging.Logger,
    *,
    module: str,
    reason: str,
    detail: str = "",
    fallback: str = "local-template",
) -> None:
    """记录一次明确回退：控制台 INFO + 落盘 integration_fallback.log。"""
    _ensure_fallback_handler()
    message = (
        f"FALLBACK module={module} reason={reason} fallback={fallback}"
        + (f" detail={detail[:400]}" if detail else "")
        + f" ts={time.strftime('%Y-%m-%dT%H:%M:%S')}"
    )
    logger.warning(message)
    logging.getLogger("services.fallback").warning(
        f"FALLBACK module={module} reason={reason} fallback={fallback}"
        + (f" detail={detail[:400]}" if detail else "")
    )


__all__ = ["FALLBACK_LOG", "get_logger", "log_fallback"]
