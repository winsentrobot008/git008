"""factory_core.web_browser：bb-browser 结构化抓取与离线回退。"""

from __future__ import annotations

import unittest

from factory_core.web_browser import WebBrowser
from services.common.results import fail_result, ok_result


class FakeClient:
    def __init__(self):
        self.available = True

    def run_site(self, adapter, args=(), jq=None, limit=None):
        return ok_result([{"title": f"{adapter}-t", "url": "https://x/1"}])

    def open(self, url):
        return ok_result({"tabId": "t1"})

    def get_text(self, ref=None, tab=None):
        return ok_result("页面正文")

    def eval_js(self, js, tab=None):
        return ok_result({"payload": 1})

    def health(self):
        return {"available": True}


class WebBrowserTests(unittest.TestCase):
    def test_fetch_structured_normalizes_rows(self):
        browser = WebBrowser(FakeClient())
        result = browser.fetch_structured("zhihu/hot", limit=5)
        self.assertTrue(result["ok"])
        self.assertEqual(result["source"], "bb-browser")
        self.assertEqual(result["items"][0]["title"], "zhihu/hot-t")

    def test_fetch_viral_offline_template(self):
        browser = WebBrowser(FakeClient())
        manifest = browser.fetch_viral(offline=True)
        self.assertEqual(manifest["fallback"], "local-template")
        self.assertTrue(manifest["items"])

    def test_fetch_page_text_and_eval(self):
        browser = WebBrowser(FakeClient())
        page = browser.fetch_page_text("https://example.com")
        self.assertTrue(page["ok"])
        self.assertEqual(page["text"], "页面正文")
        js = browser.eval_js("window.__NUXT__")
        self.assertEqual(js["data"], {"payload": 1})

    def test_failure_returns_fallback(self):
        class BrokenClient(FakeClient):
            def run_site(self, adapter, args=(), jq=None, limit=None):
                return fail_result("boom", fallback="local-template")

        browser = WebBrowser(BrokenClient())
        result = browser.fetch_structured("twitter/search", ["AI"])
        self.assertFalse(result["ok"])
        self.assertEqual(result["fallback"], "local-template")
        self.assertEqual(result["items"], [])


if __name__ == "__main__":
    unittest.main()
