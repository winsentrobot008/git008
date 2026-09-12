"""Computer Use 桌面自动化控制器。

后端（auto 自动选择，逐级降级）：
  1. pyautogui     本机已装；鼠标/键盘/截图一体
  2. powershell    Windows 零依赖兜底（user32 + WScript.Shell SendKeys + GDI 截图）
  3. mcp           外接 Computer Use MCP 插件（COMPUTER_USE_MCP_BIN，JSON-RPC stdio）

安全策略：
  - enabled=False → 任何动作直接跳过并记录 skip 日志（总开关）；
  - dry_run=True → 只记录动作不注入输入（健康检查 / CI 默认）；
  - 锁屏/断开/非交互会话 → 默认拒绝实际操作（allow_unattended=True 才放行），
    但状态监测（health/status）始终可用。
"""

from __future__ import annotations

import base64
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

from services.common.logging import get_logger, log_fallback
from services.common.results import CommandResult, fail_result, ok_result
from services.config import ComputerUseSettings
from services.gui_automation.monitor import SessionMonitor

logger = get_logger("gui_automation.computer_use")


class _Backend:
    """后端抽象：每个动作返回 (ok, data, error)。"""

    name = "base"

    def health(self) -> dict[str, Any]:
        raise NotImplementedError

    def mouse_move(self, x: int, y: int) -> tuple[bool, Any, str | None]:
        raise NotImplementedError

    def click(self, x: int, y: int, button: str = "left") -> tuple[bool, Any, str | None]:
        raise NotImplementedError

    def type_text(self, text: str) -> tuple[bool, Any, str | None]:
        raise NotImplementedError

    def key_press(self, keys: list[str]) -> tuple[bool, Any, str | None]:
        raise NotImplementedError

    def screenshot(self, path: Path) -> tuple[bool, Any, str | None]:
        raise NotImplementedError

    def activate_window(self, title: str) -> tuple[bool, Any, str | None]:
        return False, None, "backend 不支持窗口激活"

    def run_app(self, command: list[str]) -> tuple[bool, Any, str | None]:
        raise NotImplementedError


class PyAutoGuiBackend(_Backend):
    name = "pyautogui"

    def __init__(self, allow_unattended: bool = False) -> None:
        self._pg = None
        self._allow_unattended = allow_unattended

    def _mod(self):
        if self._pg is None:
            import pyautogui  # 延迟导入：健康检查无副作用

            pyautogui.FAILSAFE = not self._allow_unattended
            self._pg = pyautogui
        return self._pg

    def health(self) -> dict[str, Any]:
        try:
            pg = self._mod()
            w, h = pg.size()
            return {"ok": True, "screen": f"{w}x{h}", "backend": self.name}
        except Exception as exc:
            return {"ok": False, "error": str(exc), "backend": self.name}

    def mouse_move(self, x: int, y: int):
        self._mod().moveTo(int(x), int(y), duration=0.1)
        return True, {"x": int(x), "y": int(y)}, None

    def click(self, x: int, y: int, button: str = "left"):
        pg = self._mod()
        pg.moveTo(int(x), int(y), duration=0.1)
        pg.click(button=button)
        return True, {"x": int(x), "y": int(y), "button": button}, None

    def type_text(self, text: str):
        self._mod().write(str(text), interval=0.01)
        return True, {"chars": len(str(text))}, None

    def key_press(self, keys: list[str]):
        self._mod().hotkey(*keys)
        return True, {"keys": keys}, None

    def screenshot(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._mod().screenshot(str(path))
        return True, {"path": str(path)}, None

    def activate_window(self, title: str):
        try:
            import ctypes

            user32 = ctypes.windll.user32
            target = title.lower()
            found = False

            def enum_cb(hwnd, _):
                nonlocal found
                if user32.IsWindowVisible(hwnd):
                    buf = ctypes.create_unicode_buffer(512)
                    user32.GetWindowTextW(hwnd, buf, 512)
                    if target in buf.value.lower():
                        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
                        user32.SetForegroundWindow(hwnd)
                        found = True
                return True

            WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
            user32.EnumWindows(WNDENUMPROC(enum_cb), 0)
            return found, {"title": title}, None if found else f"未找到窗口: {title}"
        except Exception as exc:
            return False, None, str(exc)

    def run_app(self, command: list[str]):
        flags = 0
        if os.name == "nt":
            flags = subprocess.CREATE_NO_WINDOW
        proc = subprocess.Popen(command, creationflags=flags)
        return True, {"pid": proc.pid, "command": command}, None


class PowerShellBackend(_Backend):
    """Windows 零依赖兜底：通过 powershell -EncodedCommand 调用 user32/SendKeys。"""

    name = "powershell"

    def __init__(self) -> None:
        self._ps = shutil.which("powershell.exe") or "powershell.exe"

    @staticmethod
    def _b64(script: str) -> str:
        return base64.b64encode(script.encode("utf-16-le")).decode("ascii")

    def _run(self, script: str, timeout: int = 30) -> tuple[int, str, str]:
        try:
            proc = subprocess.run(
                [self._ps, "-NoProfile", "-NonInteractive", "-EncodedCommand", self._b64(script)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                check=False,
            )
            return proc.returncode, proc.stdout or "", proc.stderr or ""
        except (OSError, subprocess.TimeoutExpired) as exc:
            return -1, "", f"{type(exc).__name__}: {exc}"

    def health(self) -> dict[str, Any]:
        code, out, err = self._run(
            "Add-Type -AssemblyName System.Windows.Forms; "
            "$s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; "
            "Write-Output ('{0}x{1}' -f $s.Width,$s.Height)"
        )
        if code != 0:
            return {"ok": False, "error": err.strip()[:200], "backend": self.name}
        return {"ok": True, "screen": out.strip(), "backend": self.name}

    def mouse_move(self, x: int, y: int):
        # 仅定义类型并调用 SetCursorPos（编译验证即返回；健康检查不注入输入）
        code, out, err = self._run(
            "Add-Type @'\n"
            "using System.Runtime.InteropServices;\n"
            "public class Native {\n"
            '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);\n'
            '  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, System.UIntPtr dwExtraInfo);\n'
            "}\n"
            "'@\n"
            f"[Native]::SetCursorPos({int(x)},{int(y)})"
        )
        return code == 0, {"x": int(x), "y": int(y)}, err.strip() or None

    def click(self, x: int, y: int, button: str = "left"):
        # MOUSEEVENTF_LEFTDOWN=0x0002 LEFTUP=0x0004 RIGHTDOWN=0x0008 RIGHTUP=0x0010
        down = "0x0008" if button == "right" else "0x0002"
        up = "0x0010" if button == "right" else "0x0004"
        script = (
            "Add-Type @'\n"
            "using System.Runtime.InteropServices;\n"
            "public class Native {\n"
            '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);\n'
            '  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, System.UIntPtr dwExtraInfo);\n'
            "}\n"
            "'@\n"
            f"[Native]::SetCursorPos({int(x)},{int(y)});"
            f"[Native]::mouse_event({down},0,0,0,[System.UIntPtr]::Zero);"
            "Start-Sleep -Milliseconds 40;"
            f"[Native]::mouse_event({up},0,0,0,[System.UIntPtr]::Zero)"
        )
        code, out, err = self._run(script)
        return code == 0, {"x": int(x), "y": int(y), "button": button}, err.strip() or None

    @staticmethod
    def _sendkeys_escape(text: str) -> str:
        special = set("+^%~(){}[]")
        out: list[str] = []
        for ch in text:
            out.append("{" + ch + "}" if ch in special else ch)
        return "".join(out)

    def type_text(self, text: str):
        escaped = self._sendkeys_escape(str(text))
        code, out, err = self._run(
            "$w=New-Object -ComObject WScript.Shell; "
            f"$w.SendKeys('{escaped}')"
        )
        return code == 0, {"chars": len(str(text))}, err.strip() or None

    def key_press(self, keys: list[str]):
        map_key = {
            "enter": "{ENTER}", "tab": "{TAB}", "esc": "{ESC}",
            "backspace": "{BACKSPACE}", "delete": "{DELETE}",
            "up": "{UP}", "down": "{DOWN}", "left": "{LEFT}", "right": "{RIGHT}",
            "home": "{HOME}", "end": "{END}", "ctrl": "^", "shift": "+", "alt": "%",
        }
        seq = "".join(map_key.get(k.lower(), k))
        code, out, err = self._run(
            "$w=New-Object -ComObject WScript.Shell; "
            f"$w.SendKeys('{seq}')"
        )
        return code == 0, {"keys": keys}, err.strip() or None

    def screenshot(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        safe = str(path).replace("'", "''")
        script = (
            "Add-Type -AssemblyName System.Drawing;"
            "$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;"
            "$bmp=New-Object System.Drawing.Bitmap $b.Width,$b.Height;"
            "$g=[System.Drawing.Graphics]::FromImage($bmp);"
            "$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size);"
            f"$bmp.Save('{safe}',[System.Drawing.Imaging.ImageFormat]::Png);"
            "$g.Dispose();$bmp.Dispose()"
        )
        code, out, err = self._run(script)
        return code == 0, {"path": str(path)}, err.strip() or None

    def run_app(self, command: list[str]):
        try:
            proc = subprocess.Popen(command, creationflags=subprocess.CREATE_NO_WINDOW)
            return True, {"pid": proc.pid, "command": command}, None
        except (OSError, ValueError) as exc:
            return False, None, str(exc)


class MCPBackend(_Backend):
    """外接 Computer Use MCP 插件（JSON-RPC stdio）适配壳。

    约定：COMPUTER_USE_MCP_BIN 指向支持 MCP tools 的插件可执行文件
    （tools: mouse_move / click / type / screenshot），以 stdio JSON-RPC 通信。
    """

    name = "mcp"

    def __init__(self, mcp_bin: str | None) -> None:
        self.mcp_bin = mcp_bin
        self._proc: subprocess.Popen | None = None

    def health(self) -> dict[str, Any]:
        if not self.mcp_bin or not Path(self.mcp_bin).exists():
            return {
                "ok": False,
                "backend": self.name,
                "error": f"COMPUTER_USE_MCP_BIN 未配置或不存在: {self.mcp_bin}",
            }
        return {"ok": True, "backend": self.name, "bin": self.mcp_bin}

    def _call(self, tool: str, args: dict[str, Any]) -> tuple[bool, Any, str | None]:
        if not self.mcp_bin:
            return False, None, "MCP 插件未配置"
        # 最小 JSON-RPC 请求；未握手成功时返回明确错误，由上层降级到下一后端
        return False, None, (
            "MCP 插件需要先完成 initialize/initializeResult 握手，"
            "当前适配壳仅提供接口占位（建议使用 pyautogui/powershell 后端）"
        )

    def mouse_move(self, x: int, y: int):
        return self._call("mouse_move", {"x": int(x), "y": int(y)})

    def click(self, x: int, y: int, button: str = "left"):
        return self._call("click", {"x": int(x), "y": int(y), "button": button})

    def type_text(self, text: str):
        return self._call("type", {"text": str(text)})

    def key_press(self, keys: list[str]):
        return self._call("key", {"keys": keys})

    def screenshot(self, path: Path):
        return self._call("screenshot", {"path": str(path)})

    def run_app(self, command: list[str]):
        return self._call("run_app", {"command": command})


def build_backends(settings: ComputerUseSettings) -> list[_Backend]:
    """按配置构造后端链（auto 时按优先级降级）。"""
    order = settings.backend.split(",") if settings.backend != "auto" else ["pyautogui", "powershell", "mcp"]
    backends: list[_Backend] = []
    for name in order:
        name = name.strip().lower()
        if name == "pyautogui":
            backends.append(PyAutoGuiBackend(allow_unattended=settings.allow_unattended))
        elif name == "powershell":
            backends.append(PowerShellBackend())
        elif name == "mcp":
            backends.append(MCPBackend(settings.mcp_bin))
    return backends


class ComputerUseController:
    """Computer Use 控制器：统一入口 + 会话守卫 + 后端降级。"""

    def __init__(self, settings: ComputerUseSettings | None = None, backends: list[_Backend] | None = None) -> None:
        self.settings = settings or ComputerUseSettings()
        self.backends = backends or build_backends(self.settings)
        self.monitor = SessionMonitor()

    # ------------------------------------------------------------------
    def health(self) -> dict[str, Any]:
        session = self.monitor.current_state()
        backends = []
        for b in self.backends:
            health = b.health()
            health["unattended_blocked"] = (
                session.unattended
                and not self.settings.allow_unattended
                and b.name != "powershell"  # 仅提示，不决定后端选择
            )
            backends.append(health)
        return {
            "enabled": self.settings.enabled,
            "dry_run": self.settings.dry_run,
            "allow_unattended": self.settings.allow_unattended,
            "session": session.to_dict(),
            "backends": backends,
            "screen": next((b.get("screen") for b in backends if b.get("ok")), None),
        }

    def session_status(self) -> dict[str, Any]:
        return self.monitor.current_state().to_dict()

    # ------------------------------------------------------------------
    def _guard(self, action: str) -> CommandResult | None:
        """会话守卫：禁用 / dry-run / 无人值守 三类拦截返回结构化结果。"""
        if not self.settings.enabled:
            return fail_result(
                "Computer Use 总开关已关闭（COMPUTER_USE_ENABLED=false）",
                fallback="skip",
            )
        session = self.monitor.current_state()
        if session.unattended and not self.settings.allow_unattended:
            return fail_result(
                f"无人值守会话（interactive={session.interactive}, locked={session.locked}, "
                f"disconnected={session.disconnected}），已拒绝实际注入；"
                f"设置 COMPUTER_USE_ALLOW_UNATTENDED=true 可强制放行",
                fallback="unattended-blocked",
            )
        if self.settings.dry_run:
            logger.info("[dry-run] 动作已记录（未注入输入）：%s", action)
            return ok_result({"action": action, "dry_run": True})
        return None

    def _execute(self, action: str, fn: Callable[[_Backend], tuple[bool, Any, str | None]]) -> CommandResult:
        guard = self._guard(action)
        if guard is not None:
            return guard
        started = time.time()
        errors: list[str] = []
        for idx, backend in enumerate(self.backends):
            try:
                ok, data, err = fn(backend)
            except Exception as exc:  # noqa: BLE001 - 后端异常统一降级
                ok, data, err = False, None, f"{type(exc).__name__}: {exc}"
            if ok:
                return CommandResult(
                    ok=True,
                    data=data,
                    duration_ms=int((time.time() - started) * 1000),
                )
            errors.append(f"{backend.name}: {err or 'unknown'}")
            if idx + 1 < len(self.backends):
                log_fallback(
                    logger,
                    module="gui_automation",
                    reason=f"backend-{backend.name}-failed",
                    detail=f"action={action} err={err}",
                    fallback=self.backends[idx + 1].name,
                )
        return fail_result(
            f"action={action} 全部后端失败：{' | '.join(errors)}",
            fallback="none",
        )

    # ------------------------------------------------------------------
    # 对外动作
    # ------------------------------------------------------------------
    def mouse_move(self, x: int, y: int) -> CommandResult:
        return self._execute(f"mouse_move({x},{y})", lambda b: b.mouse_move(x, y))

    def click(self, x: int, y: int, button: str = "left") -> CommandResult:
        return self._execute(f"click({x},{y},{button})", lambda b: b.click(x, y, button))

    def type_text(self, text: str) -> CommandResult:
        return self._execute(f"type_text(len={len(text)})", lambda b: b.type_text(text))

    def key_press(self, keys: list[str]) -> CommandResult:
        return self._execute(f"key_press({keys})", lambda b: b.key_press(keys))

    def screenshot(self, path: str | Path) -> CommandResult:
        out = Path(path)
        return self._execute(f"screenshot({out})", lambda b: b.screenshot(out))

    def activate_window(self, title: str) -> CommandResult:
        return self._execute(f"activate_window({title})", lambda b: b.activate_window(title))

    def run_app(self, command: list[str]) -> CommandResult:
        return self._execute(f"run_app({command})", lambda b: b.run_app(command))

    def run_script(self, script: list[dict[str, Any]]) -> list[CommandResult]:
        """按 JSON 动作脚本顺序执行（publish 步骤的桌面交互回放）。"""
        results: list[CommandResult] = []
        for step in script:
            action = step.get("action")
            args = step.get("args") or {}
            if action == "mouse_move":
                results.append(self.mouse_move(int(args["x"]), int(args["y"])))
            elif action == "click":
                results.append(self.click(int(args["x"]), int(args["y"]), str(args.get("button", "left"))))
            elif action == "type":
                results.append(self.type_text(str(args["text"])))
            elif action == "key":
                results.append(self.key_press(list(args.get("keys", []))))
            elif action == "screenshot":
                results.append(self.screenshot(str(args["path"])))
            elif action == "activate_window":
                results.append(self.activate_window(str(args["title"])))
            elif action == "run_app":
                results.append(self.run_app(list(args.get("command", []))))
            else:
                results.append(fail_result(f"未知动作: {action}", fallback="skip"))
        return results


__all__ = [
    "ComputerUseController",
    "PyAutoGuiBackend",
    "PowerShellBackend",
    "MCPBackend",
    "build_backends",
]
