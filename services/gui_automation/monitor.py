"""后台 / 锁屏（Unelevated / Unattended）会话状态监测。

Windows 实现：
  - OpenInputDesktop + GetUserObjectInformation 判断当前输入桌面是否为
    Default（交互可用）或 Winlogon / Screen-saver（锁屏 / 安全桌面）；
  - qwinsta 判断会话是否断开（Disc）。
非 Windows 退化为 DISPLAY / WAYLAND_DISPLAY 探测，未知时按交互可用处理。
"""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass

from services.common.logging import get_logger

logger = get_logger("gui_automation.monitor")


@dataclass
class SessionState:
    interactive: bool        # 是否存在可交互输入桌面
    locked: bool             # 是否处于锁屏 / 安全桌面
    disconnected: bool       # 会话是否断开（RDP 断开 / 服务会话）
    session_name: str = ""
    detail: str = ""

    @property
    def unattended(self) -> bool:
        """无人值守 = 非交互 或 锁屏 或 断开。"""
        return (not self.interactive) or self.locked or self.disconnected

    def to_dict(self) -> dict:
        return {
            "interactive": self.interactive,
            "locked": self.locked,
            "disconnected": self.disconnected,
            "unattended": self.unattended,
            "session_name": self.session_name,
            "detail": self.detail,
        }


class SessionMonitor:
    """会话状态监测器：只读探测，绝不注入输入。"""

    def __init__(self) -> None:
        self._os = os.name

    def current_state(self) -> SessionState:
        if self._os != "nt":
            return self._posix_state()
        return self._windows_state()

    # ------------------------------------------------------------------
    def _windows_state(self) -> SessionState:
        desktop = self._input_desktop_name()
        disconnected = self._session_disconnected()
        locked = desktop is None or desktop.lower() not in {"default", "default-ime"}
        interactive = desktop is not None and not disconnected
        return SessionState(
            interactive=interactive,
            locked=bool(locked),
            disconnected=disconnected,
            session_name=desktop or "",
            detail=(
                f"desktop={desktop or 'none'}; "
                f"disconnected={disconnected}; os=windows"
            ),
        )

    @staticmethod
    def _input_desktop_name() -> str | None:
        """返回当前输入桌面名；无法获取（无交互桌面）返回 None。"""
        try:
            import ctypes
            from ctypes import wintypes

            DESKTOP_READOBJECTS = 0x0001
            user32 = ctypes.windll.user32
            h_desk = user32.OpenInputDesktop(0, False, DESKTOP_READOBJECTS)
            if not h_desk:
                return None
            try:
                buf = ctypes.create_unicode_buffer(256)
                needed = wintypes.DWORD()
                ok = user32.GetUserObjectInformationW(
                    h_desk,
                    2,  # UOI_NAME
                    buf,
                    ctypes.sizeof(buf),
                    ctypes.byref(needed),
                )
                return buf.value if ok else None
            finally:
                user32.CloseDesktop(h_desk)
        except Exception as exc:  # 非 Windows / 权限受限
            logger.debug("input desktop 探测失败：%s", exc)
            return None

    @staticmethod
    def _session_disconnected() -> bool:
        """qwinsta 解析：Console / 活动会话非 Disc 视为已连接。"""
        try:
            proc = subprocess.run(
                ["qwinsta"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired):
            return False
        text = proc.stdout or ""
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        if not lines:
            return False
        header = lines[0].lower()
        for line in lines[1:]:
            lower = line.lower()
            if "console" in lower or "rdp-tcp" in lower or "active" in lower:
                return "disc" in lower and "active" not in lower
        return "disc" in header

    @staticmethod
    def _posix_state() -> SessionState:
        display = os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")
        interactive = bool(display)
        locked = False
        try:
            proc = subprocess.run(
                ["loginctl", "show-session", "-p", "State"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            state = (proc.stdout or "").strip().split("=")[-1].lower()
            locked = state == "locked"
            if state in {"active", "online", "opening"}:
                interactive = True
        except (OSError, subprocess.TimeoutExpired):
            pass
        return SessionState(
            interactive=interactive,
            locked=locked,
            disconnected=not interactive,
            session_name="",
            detail=f"display={display or 'none'}; os=posix",
        )


__all__ = ["SessionMonitor", "SessionState"]
