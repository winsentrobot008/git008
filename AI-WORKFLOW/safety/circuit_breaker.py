"""
CircuitBreaker — 防火墙部门断路器
基于 Cline-anti-freeze 防卡死协议实现：

规则 1：超时熔断 — 任何操作 120 秒未返回则中断
规则 2：循环检测 — 连续 3 次相同错误/空结果则停止重试
规则 3：上下文保护 — N/A（Python 进程级）
规则 4：心跳检查 — 每 5 步输出 [治理心跳]
规则 5：异常退出 — 60 秒无有效输出则终止

安全规范：纯 Python 实现，无外部依赖。
"""

from __future__ import annotations

import time
import logging
import threading
from typing import Any, Callable

logger = logging.getLogger(__name__)


class CircuitBreaker:
    """防卡死断路器 — 包裹任何函数调用，提供超时/重试/心跳保护。

    配置（从 Cline-anti-freeze/.clinerules 提取）：
        timeout: 120s
        max_retries: 3
        deadlock_timeout: 60s
        heartbeat_interval: 5
    """

    def __init__(
        self,
        timeout: float = 120.0,
        max_retries: int = 3,
        deadlock_timeout: float = 60.0,
        heartbeat_interval: int = 5,
    ):
        self.timeout = timeout
        self.max_retries = max_retries
        self.deadlock_timeout = deadlock_timeout
        self.heartbeat_interval = heartbeat_interval

        # State tracking for loop detection (Rule 2)
        self._error_history: list[str] = []
        self._step_counter: int = 0
        self._last_activity: float = time.time()

        # Retry counter for Grip integration
        self._retry_counter: dict[str, int] = {}

    # ── Public API ──────────────────────────────────────────────────────

    def get_retry_count(self, func_key: str) -> int:
        """Get current retry count for a given operation.

        Used by GripVerifier to enforce max_auto_correct_retries.
        """
        return self._retry_counter.get(func_key, 0)

    def run_with_protection(
        self,
        func: Callable[..., Any],
        *args: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Run a function with full anti-freeze protection.

        Wraps the function with:
        - Timeout protection (Rule 1)
        - Retry with loop detection (Rule 2)
        - Heartbeat logging (Rule 4)
        - Deadlock detection (Rule 5)

        Returns:
            Dict with status "success" or "CIRCUIT_OPEN" plus result or error.
        """
        self._step_counter += 1

        # Track retry count for Grip integration
        func_key = func.__name__ if hasattr(func, '__name__') else str(id(func))

        # Heartbeat (Rule 4)
        if self._step_counter % self.heartbeat_interval == 0:
            logger.info("[Safety] [治理心跳] 运行中")

        last_error = None
        last_error_key = ""

        for attempt in range(1, self.max_retries + 1):
            self._retry_counter[func_key] = attempt
            try:
                result = self._call_with_timeout(func, *args, **kwargs)
                self._last_activity = time.time()
                self._error_history = []  # Reset on success
                return result
            except TimeoutError as e:
                last_error = str(e)
                last_error_key = f"timeout:{type(e).__name__}"
                logger.warning(
                    f"[Safety] Timeout (attempt {attempt}/{self.max_retries}): {e}"
                )
            except Exception as e:
                last_error = str(e)
                last_error_key = f"error:{type(e).__name__}:{str(e)[:50]}"
                logger.warning(
                    f"[Safety] Error (attempt {attempt}/{self.max_retries}): {e}"
                )

                # Loop detection (Rule 2)
                if not self._check_loop_detection(last_error_key):
                    logger.error(
                        f"[Safety] CIRCUIT OPEN - Loop detected: "
                        f"'{last_error_key}' repeated {self.max_retries} times"
                    )
                    self._retry_counter.pop(func_key, None)
                    return {
                        "status": "CIRCUIT_OPEN",
                        "error": f"Loop detected after {attempt} retries: {last_error}",
                    }

        # All retries exhausted
        self._retry_counter.pop(func_key, None)
        logger.error(
            f"[Safety] CIRCUIT OPEN - All {self.max_retries} retries exhausted: "
            f"{last_error}"
        )
        return {
            "status": "CIRCUIT_OPEN",
            "error": f"All {self.max_retries} retries failed: {last_error}",
        }

    # ── Internal ────────────────────────────────────────────────────────

    def _call_with_timeout(
        self,
        func: Callable[..., Any],
        *args: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Execute a function in a thread with a timeout guard.

        Deadlock detection (Rule 5): If no activity for 60s, raises TimeoutError.
        """
        result_holder: dict[str, Any] = {}
        exception_holder: dict[str, Exception] = {}

        def _runner() -> None:
            """Thread target: execute the function and capture result/exception."""
            try:
                self._last_activity = time.time()
                result_holder["value"] = func(*args, **kwargs)
                self._last_activity = time.time()
            except Exception as e:
                exception_holder["error"] = e

        thread = threading.Thread(target=_runner, daemon=True)
        thread.start()

        start_time = time.time()

        while thread.is_alive():
            elapsed = time.time() - start_time

            # Rule 1: Single-call timeout
            if elapsed > self.timeout:
                # Cannot kill thread in Python, but we mark it as timed out
                raise TimeoutError(
                    f"Operation timed out after {self.timeout}s "
                    f"(limit: {self.timeout}s)"
                )

            # Rule 5: Deadlock check (no activity for deadlock_timeout seconds)
            if time.time() - self._last_activity > self.deadlock_timeout:
                raise TimeoutError(
                    f"Deadlock detected: no activity for "
                    f"{self.deadlock_timeout}s"
                )

            thread.join(timeout=0.1)

            # Heartbeat within long-running calls
            if int(elapsed) > 0 and int(elapsed) % 30 == 0:
                logger.debug(
                    f"[Safety] Waiting... {int(elapsed)}s elapsed"
                )

        if "error" in exception_holder:
            raise exception_holder["error"]

        if "value" in result_holder:
            return result_holder["value"]

        raise TimeoutError("Operation completed but returned no result")

    def _check_loop_detection(self, error_key: str) -> bool:
        """Check for repeated errors (Rule 2: loop detection).

        Returns True if the call can be retried, False if circuit should open.
        """
        self._error_history.append(error_key)

        # Keep only last max_retries entries
        if len(self._error_history) > self.max_retries:
            self._error_history = self._error_history[-self.max_retries:]

        # Check if last max_retries are all the same error
        if len(self._error_history) >= self.max_retries:
            if len(set(self._error_history[-self.max_retries:])) == 1:
                return False  # Circuit open — stop retrying

        return True  # Can retry

    @property
    def status(self) -> dict[str, Any]:
        """Return current breaker status."""
        return {
            "step_counter": self._step_counter,
            "error_history": self._error_history[-5:],
            "last_activity_ago": round(time.time() - self._last_activity, 1),
            "heartbeat_interval": self.heartbeat_interval,
            "max_retries": self.max_retries,
            "timeout": self.timeout,
        }