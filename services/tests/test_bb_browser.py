"""bb_browser 适配器：输出解析 / 二进制发现 / 失败回退 / Windows shim。"""

from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest import mock

from services.crawler.bb_browser import BbBrowserClient, discover_bin, parse_bb_output
from services.tests._util import TempScope


class ParseOutputTests(unittest.TestCase):
    def test_single_json(self):
        self.assertEqual(parse_bb_output('{"ok": true}'), {"ok": True})

    def test_ndjson(self):
        rows = parse_bb_output('{"a": 1}\n{"a": 2}\n')
        self.assertEqual(rows, [{"a": 1}, {"a": 2}])

    def test_log_wrapped_json(self):
        rows = parse_bb_output('[info] begin\n{"title": "x"}\n[info] end')
        self.assertEqual(rows, {"title": "x"})

    def test_garbage(self):
        self.assertIsNone(parse_bb_output("Daemon not running"))
        self.assertIsNone(parse_bb_output(""))


class DiscoverBinTests(unittest.TestCase):
    @mock.patch("services.crawler.bb_browser.shutil.which", return_value=None)
    def test_missing(self, _which):
        with mock.patch.dict("os.environ", {"APPDATA": "C:/nope"}, clear=False), mock.patch(
            "services.crawler.bb_browser._NPM_GLOBAL_CANDIDATES", ()
        ):
            self.assertIsNone(discover_bin())

    def test_configured_path_exists(self):
        scope = TempScope()
        self.addCleanup(scope.cleanup)
        exe = scope.path("bb-browser.cmd")
        exe.write_text("@echo off", encoding="utf-8")
        self.assertEqual(discover_bin(str(exe)), str(exe.resolve()))


class ClientTests(unittest.TestCase):
    def _fake_proc(self, returncode=0, stdout="", stderr=""):
        return subprocess.CompletedProcess([], returncode, stdout=stdout, stderr=stderr)

    def _client(self, bin_path="C:/tools/bb-browser.cmd") -> BbBrowserClient:
        client = BbBrowserClient()
        client.bin = bin_path
        client.settings.auto_start_daemon = False
        return client

    def test_run_with_cmd_shim(self):
        client = self._client()
        with mock.patch(
            "services.crawler.bb_browser.subprocess.run",
            return_value=self._fake_proc(0, "0.14.2"),
        ) as run:
            result = client._run(["--version"], json_mode=False)
            self.assertTrue(result.ok)
            self.assertEqual(result.data, "0.14.2")
            cmd = run.call_args.args[0]
            self.assertTrue(cmd[0].lower().endswith("cmd.exe"))
            self.assertEqual(cmd[2].lower(), "c:/tools/bb-browser.cmd")

    def test_run_json_parse(self):
        client = self._client()
        with mock.patch(
            "services.crawler.bb_browser.subprocess.run",
            return_value=self._fake_proc(0, '{"title": "hello"}'),
        ):
            result = client.run_site("zhihu/hot", limit=3)
            self.assertTrue(result.ok)
            self.assertEqual(result.data, {"title": "hello"})

    def test_run_failure_fallback(self):
        client = self._client()
        with mock.patch(
            "services.crawler.bb_browser.subprocess.run",
            return_value=self._fake_proc(1, "", "boom"),
        ):
            result = client.run_site("twitter/search", ["AI"])
            self.assertFalse(result.ok)
            self.assertEqual(result.fallback, "local-template")
            self.assertIn("boom", result.raw)

    def test_daemon_auto_start(self):
        client = self._client()
        client.settings.auto_start_daemon = True
        with mock.patch(
            "services.crawler.bb_browser.subprocess.run",
            side_effect=[
                self._fake_proc(1, "Daemon not running"),
                self._fake_proc(0, '{"started": true}'),
                self._fake_proc(0, '{"running": true}'),
            ],
        ) as run:
            result = client.ensure_daemon()
            self.assertTrue(result.ok)
            calls = [c.args[0] for c in run.call_args_list]
            self.assertIn("start", calls[1])

    def test_daemon_status_not_running_is_failure(self):
        client = self._client()
        with mock.patch(
            "services.crawler.bb_browser.subprocess.run",
            return_value=self._fake_proc(0, '{"running": false}'),
        ):
            result = client.daemon_status()
            self.assertFalse(result.ok)
            self.assertEqual(result.fallback, "local-template")


if __name__ == "__main__":
    unittest.main()
