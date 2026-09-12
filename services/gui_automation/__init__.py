"""桌面 GUI 兜底与后处理层：Computer Use 系统控制 + 后台/锁屏状态监测。

能力：
  - 模拟鼠标键盘（pyautogui / PowerShell 零依赖兜底 / 外接 MCP 插件三后端）；
  - 无人值守（Unattended）/ 锁屏状态检测，默认拒绝实际操作，仅允许状态监测；
  - 所有动作失败自动降级并落盘 FALLBACK 日志。
"""

from services.gui_automation.computer_use import ComputerUseController
from services.gui_automation.monitor import SessionMonitor, SessionState

__all__ = ["ComputerUseController", "SessionMonitor", "SessionState"]
