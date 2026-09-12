"""结构化执行结果：所有服务层接口统一返回 CommandResult / StepReport。"""

from __future__ import annotations

import time
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class CommandResult:
    ok: bool
    data: Any = None
    error: str | None = None
    fallback: str | None = None      # 使用的回退通道（如 local-template / powershell）
    raw: str | None = None           # 底层原始输出（截断保存，便于审计）
    duration_ms: int = 0
    started_at: str = field(default_factory=lambda: time.strftime("%Y-%m-%dT%H:%M:%S"))

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class StepReport:
    """流水线单步骤报告（Fetch / Process / Publish 各自一份）。"""

    step: str
    ok: bool
    fallback: str | None = None
    detail: dict[str, Any] = field(default_factory=dict)
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def ok_result(
    data: Any = None,
    *,
    raw: str | None = None,
    duration_ms: int = 0,
) -> CommandResult:
    return CommandResult(ok=True, data=data, raw=raw, duration_ms=duration_ms)


def fail_result(
    error: str,
    *,
    fallback: str | None = None,
    raw: str | None = None,
    duration_ms: int = 0,
) -> CommandResult:
    return CommandResult(
        ok=False,
        error=error,
        fallback=fallback,
        raw=raw,
        duration_ms=duration_ms,
    )


__all__ = ["CommandResult", "StepReport", "ok_result", "fail_result"]
