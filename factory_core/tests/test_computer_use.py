"""factory_core.computer_use：Computer Use 封装透传。"""

from __future__ import annotations

import unittest

from factory_core.computer_use import ComputerUse


class FakeController:
    def health(self):
        return {"enabled": True, "session": {"unattended": False}}

    def session_status(self):
        return {"interactive": True, "locked": False}

    def run_script(self, script):
        return [type("R", (), {"to_dict": lambda self: {"ok": True, "action": s.get("action")}, "ok": True, "error": None})() for s in script]

    def screenshot(self, path):
        return type("R", (), {"to_dict": lambda self: {"ok": True}, "ok": True})()

    def run_app(self, command):
        return type("R", (), {"to_dict": lambda self: {"ok": True}, "ok": True})()


class ComputerUseTests(unittest.TestCase):
    def setUp(self):
        self.cu = ComputerUse(controller=FakeController())

    def test_health_and_status_passthrough(self):
        self.assertTrue(self.cu.health()["enabled"])
        self.assertTrue(self.cu.status()["interactive"])

    def test_execute_script_passthrough(self):
        results = self.cu.execute_script(
            [{"action": "click", "args": {"x": 1, "y": 2}}]
        )
        self.assertTrue(all(r["ok"] for r in results))
        self.assertEqual(results[0]["action"], "click")

    def test_screenshot_and_run_app(self):
        self.assertTrue(self.cu.screenshot("runtime_data/gui/x.png")["ok"])
        self.assertTrue(self.cu.run_app(["notepad.exe"])["ok"])


if __name__ == "__main__":
    unittest.main()
