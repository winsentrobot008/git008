"""master_pipeline：规则分发 / LLM 分发回退 / 闭环执行 / 模型菜单。"""

from __future__ import annotations

import io
import os
import sys
import unittest
from contextlib import redirect_stdout
from unittest import mock

import master_pipeline as mp


class DispatchTests(unittest.TestCase):
    def test_gui_keywords(self):
        d = mp.rule_based_dispatch("用剪映打开草稿并导出")
        self.assertEqual(d["action"], "gui")

    def test_render_keywords(self):
        d = mp.rule_based_dispatch("生成一条 CalorieAI 广告视频")
        self.assertEqual(d["action"], "render")

    def test_default_fetch(self):
        d = mp.rule_based_dispatch("今天的热点话题")
        self.assertEqual(d["action"], "fetch")

    def test_llm_dispatch_offline_is_none(self):
        client = mock.Mock()
        self.assertIsNone(mp.llm_dispatch(client, "任务", offline=True))

    def test_llm_dispatch_invalid_action_falls_back(self):
        client = mock.Mock()
        client.is_configured.return_value = True
        client.chat_structured.return_value = {"action": "hack"}
        with mock.patch("sys.stderr", new=io.StringIO()):
            self.assertIsNone(mp.llm_dispatch(client, "任务", offline=False))


class MasterPipelineTests(unittest.TestCase):
    def test_list_models(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = mp.main(["--list-models"])
        self.assertEqual(code, 0)
        data = __import__("json").loads(buf.getvalue())
        self.assertEqual(data["provider"], "openrouter")
        self.assertEqual(len(data["models"]), 2)

    def test_offline_fetch_closed_loop(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = mp.main(["--offline", "--task", "抓取知乎热榜文案"])
        self.assertEqual(code, 0)
        report = __import__("json").loads(buf.getvalue())
        self.assertEqual(report["dispatch"]["action"], "fetch")
        self.assertEqual(report["dispatch"]["source"], "rules")
        self.assertTrue(report["steps"][0]["ok"])
        self.assertTrue(report["fallback_used"])

    def test_offline_render_with_mocked_render(self):
        fake_report = {
            "ok": True,
            "steps": [{"step": "process", "ok": True}],
            "artifacts": ["C:/videos/out.mp4"],
        }
        buf = io.StringIO()
        with mock.patch.object(mp, "_render_video", return_value=fake_report), redirect_stdout(buf):
            code = mp.main(["--offline", "--task", "渲染一条 CalorieAI 视频"])
        self.assertEqual(code, 0)
        report = __import__("json").loads(buf.getvalue())
        self.assertEqual(report["dispatch"]["action"], "render")
        self.assertEqual(report["artifact"], "C:/videos/out.mp4")

    def test_offline_gui_dry_run(self):
        os.environ["COMPUTER_USE_ENABLED"] = "true"
        self.addCleanup(os.environ.pop, "COMPUTER_USE_ENABLED", None)
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = mp.main(["--offline", "--dry-run", "--task", "用剪映打开草稿并导出"])
        self.assertEqual(code, 0)
        report = __import__("json").loads(buf.getvalue())
        self.assertEqual(report["dispatch"]["action"], "gui")
        self.assertTrue(all(s["ok"] for s in report["steps"]))


if __name__ == "__main__":
    unittest.main()
