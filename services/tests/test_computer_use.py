"""Computer Use 控制器：守卫 / dry-run / 后端降级 / 会话拦截。"""

from __future__ import annotations

import unittest
from unittest import mock

from services.config import ComputerUseSettings
from services.gui_automation.computer_use import ComputerUseController
from services.gui_automation.monitor import SessionState


class FakeBackend:
    name = "fake"

    def __init__(self, ok=True, error=None):
        self.ok = ok
        self.error = error
        self.health_ok = True

    def health(self):
        return {"ok": self.health_ok, "backend": self.name, "screen": "1024x768"}

    def mouse_move(self, x, y):
        return (self.ok, {"x": x, "y": y}, self.error)

    def click(self, x, y, button="left"):
        return (self.ok, {}, self.error)

    def type_text(self, text):
        return (self.ok, {"chars": len(text)}, self.error)

    def key_press(self, keys):
        return (self.ok, {"keys": keys}, self.error)

    def screenshot(self, path):
        return (self.ok, {"path": str(path)}, self.error)

    def activate_window(self, title):
        return (self.ok, {}, self.error)

    def run_app(self, command):
        return (self.ok, {}, self.error)


def _controller(settings: ComputerUseSettings, backends=None) -> ComputerUseController:
    ctrl = ComputerUseController(settings, backends=backends or [FakeBackend()])
    return ctrl


class ControllerGuardTests(unittest.TestCase):
    def test_disabled_skips(self):
        ctrl = _controller(ComputerUseSettings(enabled=False, dry_run=False))
        result = ctrl.mouse_move(10, 10)
        self.assertFalse(result.ok)
        self.assertEqual(result.fallback, "skip")

    def test_dry_run_records_only(self):
        ctrl = _controller(ComputerUseSettings(enabled=True, dry_run=True))
        result = ctrl.click(5, 5)
        self.assertTrue(result.ok)
        self.assertEqual(result.data, {"action": "click(5,5,left)", "dry_run": True})

    def test_unattended_blocked_by_default(self):
        ctrl = _controller(ComputerUseSettings(enabled=True, dry_run=False))
        locked = SessionState(interactive=False, locked=True, disconnected=False)
        with mock.patch.object(ctrl.monitor, "current_state", return_value=locked):
            result = ctrl.type_text("secret")
        self.assertFalse(result.ok)
        self.assertEqual(result.fallback, "unattended-blocked")

    def test_unattended_allowed_when_configured(self):
        ctrl = _controller(
            ComputerUseSettings(enabled=True, dry_run=False, allow_unattended=True)
        )
        locked = SessionState(interactive=False, locked=True, disconnected=False)
        with mock.patch.object(ctrl.monitor, "current_state", return_value=locked):
            result = ctrl.type_text("hello")
        self.assertTrue(result.ok)


class BackendFallbackTests(unittest.TestCase):
    def test_falls_back_to_next_backend(self):
        broken = FakeBackend(ok=False, error="boom")
        good = FakeBackend(ok=True)
        ctrl = _controller(ComputerUseSettings(enabled=True, dry_run=False), backends=[broken, good])
        result = ctrl.mouse_move(1, 2)
        self.assertTrue(result.ok)
        self.assertEqual(result.data, {"x": 1, "y": 2})

    def test_all_backends_fail(self):
        broken_a = FakeBackend(ok=False, error="a")
        broken_b = FakeBackend(ok=False, error="b")
        ctrl = _controller(
            ComputerUseSettings(enabled=True, dry_run=False), backends=[broken_a, broken_b]
        )
        result = ctrl.key_press(["ctrl", "s"])
        self.assertFalse(result.ok)
        self.assertIn("a", result.error)
        self.assertIn("b", result.error)

    def test_run_script_unknown_action(self):
        ctrl = _controller(ComputerUseSettings(enabled=True, dry_run=False))
        results = ctrl.run_script([{"action": "nope", "args": {}}])
        self.assertFalse(results[0].ok)


class HealthTests(unittest.TestCase):
    def test_health_shape(self):
        ctrl = _controller(ComputerUseSettings(enabled=True))
        health = ctrl.health()
        self.assertIn("backends", health)
        self.assertIn("session", health)
        self.assertIn("screen", health)

    @unittest.skipUnless(__import__("os").name == "nt", "仅 Windows 验证 PowerShell 后端")
    def test_powershell_add_type_compiles(self):
        from services.gui_automation.computer_use import PowerShellBackend

        backend = PowerShellBackend()
        code, _out, err = backend._run(
            "Add-Type @'\n"
            "using System.Runtime.InteropServices;\n"
            "public class Native {\n"
            '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);\n'
            '  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, System.UIntPtr dwExtraInfo);\n'
            "}\n"
            "'@\n"
            "Write-Output 'OK'"
        )
        self.assertEqual(code, 0, err)


if __name__ == "__main__":
    unittest.main()
