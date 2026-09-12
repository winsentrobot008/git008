"""服务层公共组件：日志回退、结构化结果。"""

from services.common.logging import get_logger, log_fallback
from services.common.results import CommandResult, StepReport, fail_result, ok_result

__all__ = [
    "get_logger",
    "log_fallback",
    "CommandResult",
    "StepReport",
    "ok_result",
    "fail_result",
]
