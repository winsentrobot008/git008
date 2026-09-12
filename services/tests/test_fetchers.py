"""fetchers：离线回退 / 站点归一化 / 批次配置生成。"""

from __future__ import annotations

import unittest
from pathlib import Path

from services.common.results import ok_result, fail_result
from services.crawler.fetchers import (
    build_batch_config,
    fetch_viral_copy,
    load_offline_template,
)
from services.tests._util import TempScope


class FakeClient:
    def __init__(self, rows=None, failures=None):
        self.rows = rows or []
        self.failures = failures or []
        self.calls = []

    @property
    def available(self):
        return True

    def run_site(self, adapter, args=(), jq=None, limit=None):
        self.calls.append(adapter)
        if adapter in self.failures:
            return fail_result("mock failure", fallback="local-template")
        return ok_result(self.rows, raw="[]")


class FetcherTests(unittest.TestCase):
    def test_offline_template_fallback(self):
        scope = TempScope()
        self.addCleanup(scope.cleanup)
        manifest = fetch_viral_copy(offline=True, output_dir=str(scope.base))
        scope.track(manifest["manifest_path"])
        self.assertEqual(manifest["fallback"], "local-template")
        self.assertTrue(manifest["items"])
        self.assertTrue(Path(manifest["manifest_path"]).exists())

    def test_online_normalization_and_cap(self):
        rows = [
            {"title": "第一条", "url": "https://x/1", "likeCount": 10},
            {"title": "第二条", "url": "https://x/2", "ups": 5},
            {"title": "第三条", "url": "https://x/3", "numComments": 2},
            {"title": "第四条", "url": "https://x/4", "play": 100},
            {"title": "第五条", "url": "https://x/5"},
        ]
        client = FakeClient(rows=rows)
        scope = TempScope()
        self.addCleanup(scope.cleanup)
        manifest = fetch_viral_copy(
            client,
            sources=(("zhihu/hot", "", None),),
            max_items=4,
            output_dir=str(scope.base),
        )
        scope.track(manifest["manifest_path"])
        self.assertEqual(len(manifest["items"]), 4)
        self.assertEqual(manifest["items"][0]["platform"], "zhihu")
        self.assertEqual(manifest["items"][0]["engagement"]["likes"], 10)

    def test_all_sites_fail_falls_back(self):
        client = FakeClient(failures=["zhihu/hot", "twitter/search"])
        scope = TempScope()
        self.addCleanup(scope.cleanup)
        manifest = fetch_viral_copy(
            client,
            sources=(("zhihu/hot", "", None), ("twitter/search", "", None)),
            output_dir=str(scope.base),
        )
        scope.track(manifest["manifest_path"])
        self.assertEqual(manifest["fallback"], "local-template")
        self.assertTrue(manifest["items"])
        self.assertEqual(len(manifest["failures"]), 2)

    def test_build_batch_config_dedupe_and_defaults(self):
        manifest = {
            "items": [
                {"title": "A", "content": "第一句文案"},
                {"title": "A", "content": "第一句文案"},  # 重复
                {"title": "B", "content": "第二句文案"},
            ]
        }
        cfg = build_batch_config(manifest, lang="zh")
        self.assertEqual(cfg["product"], "calorieai")
        self.assertEqual(cfg["jobs"][0]["resolution"], "1080x1920")
        self.assertEqual(len(cfg["hooks"][0]["lines"]), 2)
        self.assertTrue(all(line["text"] for line in cfg["hooks"][0]["lines"]))

        empty = build_batch_config({"items": []})
        self.assertEqual(len(empty["hooks"][0]["lines"]), 4)

    def test_template_loader(self):
        data = load_offline_template()
        self.assertIn("items", data)


if __name__ == "__main__":
    unittest.main()
