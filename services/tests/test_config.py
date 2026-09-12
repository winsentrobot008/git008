"""config.py：config.toml 解析 + 环境变量覆盖 + 相对路径锚定。"""

from __future__ import annotations

import os
import unittest
from pathlib import Path

from services.config import load_config
from services.tests._util import TempScope


class ConfigTests(unittest.TestCase):
    def test_defaults_without_file(self):
        scope = TempScope()
        self.addCleanup(scope.cleanup)
        cfg = load_config(scope.path("missing.toml"))
        self.assertIsNone(cfg.source_file)
        self.assertFalse(cfg.computer_use.enabled)
        self.assertEqual(cfg.bb_browser.daemon_port, 19824)
        self.assertEqual(cfg.pipeline.default_product, "calorieai")

    def test_toml_parse_and_relative_resolution(self):
        scope = TempScope()
        self.addCleanup(scope.cleanup)
        cfg_path = scope.path("config.toml")
        cfg_path.write_text(
            """
[integrations.bb_browser]
bin = "C:/tools/bb-browser.cmd"
daemon_port = 19999

[integrations.computer_use]
enabled = true
backend = "pyautogui"
allow_unattended = true

[pipeline]
default_product = "petai"
work_dir = "relative/work"
""",
            encoding="utf-8",
        )
        cfg = load_config(cfg_path, use_env=False)
        self.assertEqual(cfg.bb_browser.bin, "C:/tools/bb-browser.cmd")
        self.assertEqual(cfg.bb_browser.daemon_port, 19999)
        self.assertTrue(cfg.computer_use.enabled)
        self.assertTrue(cfg.computer_use.allow_unattended)
        self.assertEqual(cfg.pipeline.default_product, "petai")
        self.assertTrue(Path(cfg.pipeline.work_dir).is_absolute())

    def test_env_override(self):
        scope = TempScope()
        self.addCleanup(scope.cleanup)
        os.environ["COMPUTER_USE_ENABLED"] = "true"
        os.environ["BB_BROWSER_DAEMON_PORT"] = "12345"
        os.environ["COMPUTER_USE_BACKEND"] = "powershell"
        try:
            cfg = load_config(scope.path("missing.toml"), use_env=True)
            self.assertTrue(cfg.computer_use.enabled)
            self.assertEqual(cfg.bb_browser.daemon_port, 12345)
            self.assertEqual(cfg.computer_use.backend, "powershell")
        finally:
            for key in ("COMPUTER_USE_ENABLED", "BB_BROWSER_DAEMON_PORT", "COMPUTER_USE_BACKEND"):
                os.environ.pop(key, None)

    def test_invalid_toml_falls_back(self):
        scope = TempScope()
        self.addCleanup(scope.cleanup)
        cfg_path = scope.path("config.toml")
        cfg_path.write_text("[[[broken", encoding="utf-8")
        cfg = load_config(cfg_path, use_env=False)
        self.assertTrue(hasattr(cfg, "_load_error"))
        self.assertIsNone(cfg.source_file)


if __name__ == "__main__":
    unittest.main()
