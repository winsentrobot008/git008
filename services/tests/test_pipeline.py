"""pipeline：Fetch → Process → Publish 编排与回退语义。"""

from __future__ import annotations

import unittest
from unittest import mock

from services.config import load_config
from services.pipeline.factory_pipeline import run_pipeline
from services.tests._util import TempScope


def fake_fetch(**kwargs):
    return {
        "source": "local-template",
        "items": [{"title": "t", "content": "c", "url": ""}],
        "fallback": "local-template",
        "manifest_path": "/tmp/fake.json",
    }


def fake_render_ok(*args, **kwargs):
    return True, {"exit": 0, "artifact": "C:/videos/out.mp4", "tail": "[done] C:/videos/out.mp4"}, "[done] C:/videos/out.mp4"


def fake_render_fail(*args, **kwargs):
    return False, {"exit": 1, "artifact": None, "tail": "boom"}, "boom"


class FakeGuiResult:
    ok = True
    error = None

    def to_dict(self):
        return {"ok": self.ok, "error": self.error}


class PipelineTests(unittest.TestCase):
    def test_ok_flow_with_skip_publish(self):
        scope = TempScope()
        self.addCleanup(scope.cleanup)
        cfg = load_config()
        cfg.pipeline.work_dir = str(scope.base)
        with mock.patch("services.pipeline.factory_pipeline.load_config", return_value=cfg):
            report = run_pipeline(
                offline=True,
                fetch_fn=fake_fetch,
                render_fn=fake_render_ok,
                gui_script=None,
            )
        self.assertTrue(report.ok)
        steps = {s["step"]: s for s in report.steps}
        self.assertTrue(steps["fetch"]["ok"])
        self.assertEqual(steps["fetch"]["fallback"], "local-template")
        self.assertTrue(steps["process"]["ok"])
        self.assertEqual(steps["publish"]["fallback"], "skip")
        self.assertEqual(report.artifacts, ["C:/videos/out.mp4"])
        self.assertTrue(report.fallback_used)

    def test_render_failure_marks_manual_fallback(self):
        scope = TempScope()
        self.addCleanup(scope.cleanup)
        cfg = load_config()
        cfg.pipeline.work_dir = str(scope.base)
        with mock.patch("services.pipeline.factory_pipeline.load_config", return_value=cfg):
            report = run_pipeline(
                offline=True,
                fetch_fn=fake_fetch,
                render_fn=fake_render_fail,
            )
        self.assertFalse(report.ok)
        steps = {s["step"]: s for s in report.steps}
        self.assertEqual(steps["process"]["fallback"], "manual")
        self.assertIsNone(steps["process"]["detail"]["artifact"])

    def test_gui_publish_with_fake_controller(self):
        from services.gui_automation.computer_use import ComputerUseController

        cfg = load_config()
        cfg.computer_use.enabled = True
        scope = TempScope()
        self.addCleanup(scope.cleanup)
        cfg.pipeline.work_dir = str(scope.base)
        ctrl = ComputerUseController(cfg.computer_use)
        ctrl.run_script = lambda script: [FakeGuiResult() for _ in script]
        with mock.patch("services.pipeline.factory_pipeline.load_config", return_value=cfg):
            report = run_pipeline(
                offline=True,
                fetch_fn=fake_fetch,
                render_fn=fake_render_ok,
                gui_script=[{"action": "click", "args": {"x": 1, "y": 2}}],
                gui_controller=ctrl,
            )
        steps = {s["step"]: s for s in report.steps}
        self.assertTrue(steps["publish"]["ok"])
        self.assertIsNone(steps["publish"]["fallback"])

    def test_gui_disabled_skips(self):
        cfg = load_config()
        cfg.computer_use.enabled = False
        scope = TempScope()
        self.addCleanup(scope.cleanup)
        cfg.pipeline.work_dir = str(scope.base)
        with mock.patch("services.pipeline.factory_pipeline.load_config", return_value=cfg):
            report = run_pipeline(
                offline=True,
                fetch_fn=fake_fetch,
                render_fn=fake_render_ok,
                gui_script=[{"action": "click", "args": {"x": 1, "y": 2}}],
            )
        steps = {s["step"]: s for s in report.steps}
        self.assertTrue(steps["publish"]["ok"])
        self.assertEqual(steps["publish"]["fallback"], "skip")


if __name__ == "__main__":
    unittest.main()
