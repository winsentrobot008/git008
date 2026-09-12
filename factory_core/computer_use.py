"""GUI 兜底控制层：封装 Computer Use 插件接口。

复用 services.gui_automation：三后端降级（pyautogui → powershell → MCP）、
后台/锁屏（Unelevated / Unattended）状态监测与安全守卫全部沿用。
"""

from __future__ import annotations

from typing import Any

from services.config import ComputerUseSettings, load_config
from services.gui_automation.computer_use import ComputerUseController


class ComputerUse:
    """Computer Use 统一入口（thin wrapper，逻辑复用 services.gui_automation）。"""

    def __init__(
        self,
        settings: ComputerUseSettings | None = None,
        controller: ComputerUseController | None = None,
    ) -> None:
        self.settings = settings or load_config().computer_use
        self.controller = controller or ComputerUseController(self.settings)

    def health(self) -> dict[str, Any]:
        """后端健康 + 会话状态（无副作用）。"""
        return self.controller.health()

    def status(self) -> dict[str, Any]:
        """锁屏 / 无人值守状态。"""
        return self.controller.session_status()

    def execute_script(self, script: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """执行桌面动作脚本（click/type/key/screenshot/run_app…）。"""
        return [r.to_dict() for r in self.controller.run_script(script)]

    def screenshot(self, path: str) -> dict[str, Any]:
        return self.controller.screenshot(path).to_dict()

    def run_app(self, command: list[str]) -> dict[str, Any]:
        return self.controller.run_app(command).to_dict()


__all__ = ["ComputerUse"]
