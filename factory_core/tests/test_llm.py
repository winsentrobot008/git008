"""factory_core.llm：config/models.json 目录 + OpenRouter Chat Completions 客户端。"""

from __future__ import annotations

import json
import os
import unittest
from pathlib import Path
from unittest import mock

from factory_core.llm import (
    LLMConfigError,
    OpenRouterClient,
    get_model,
    list_models_menu,
    load_llm_config,
    load_models,
    resolve_model,
)


class LlmConfigTests(unittest.TestCase):
    def test_llm_settings_from_config_toml(self):
        cfg = load_llm_config()
        self.assertEqual(cfg.provider, "openrouter")
        self.assertEqual(cfg.wire_api, "chat_completions")
        self.assertEqual(cfg.default_model, "google/gemini-2.0-flash-exp:free")
        self.assertTrue(cfg.free_only)

    def test_models_catalog_contains_two_free_models(self):
        models = load_models()
        ids = {m["id"] for m in models}
        self.assertIn("google/gemini-2.0-flash-exp:free", ids)
        self.assertIn("deepseek/deepseek-r1:free", ids)
        self.assertTrue(all(":free" in m["id"] for m in models))

    def test_dropdown_menu_shape(self):
        menu = list_models_menu()
        self.assertEqual(len(menu), 2)
        for entry in menu:
            self.assertIn("value", entry)
            self.assertIn("label", entry)
            self.assertIn("免费", entry["label"])

    def test_get_model_and_resolve(self):
        model = get_model("deepseek/deepseek-r1:free")
        self.assertIsNotNone(model)
        self.assertEqual(model["pricing"], "free")
        self.assertEqual(resolve_model("google/gemini-2.0-flash-exp:free"), "google/gemini-2.0-flash-exp:free")
        with self.assertRaises(LLMConfigError):
            resolve_model("anthropic/claude-sonnet-4")  # 非免费档


class OpenRouterClientTests(unittest.TestCase):
    def _client(self) -> OpenRouterClient:
        os.environ["OPENROUTER_API_KEY"] = "sk-or-v1-test"
        self.addCleanup(os.environ.pop, "OPENROUTER_API_KEY", None)
        return OpenRouterClient(model="google/gemini-2.0-flash-exp:free")

    def test_not_configured_without_key(self):
        os.environ.pop("OPENROUTER_API_KEY", None)
        client = OpenRouterClient(model="google/gemini-2.0-flash-exp:free")
        self.assertFalse(client.is_configured())

    def test_chat_structured_posts_chat_completions(self):
        client = self._client()
        fake_response = {
            "choices": [{"message": {"content": '{"action": "fetch"}'}}]
        }
        with mock.patch("requests.post") as post:
            post.return_value.status_code = 200
            post.return_value.json.return_value = fake_response
            result = client.chat_structured("抓取知乎热榜", max_tokens=256)
        self.assertEqual(result, {"action": "fetch"})
        args, kwargs = post.call_args
        self.assertTrue(args[0].endswith("/chat/completions"))
        self.assertEqual(kwargs["json"]["model"], "google/gemini-2.0-flash-exp:free")
        self.assertLessEqual(kwargs["json"]["max_tokens"], 256)

    def test_http_error_raises(self):
        client = self._client()
        with mock.patch("requests.post") as post:
            post.return_value.status_code = 401
            post.return_value.text = "unauthorized"
            with self.assertRaises(LLMConfigError):
                client.chat([{"role": "user", "content": "hi"}])

    def test_invalid_json_from_model_raises(self):
        client = self._client()
        fake_response = {"choices": [{"message": {"content": "not-json"}}]}
        with mock.patch("requests.post") as post:
            post.return_value.status_code = 200
            post.return_value.json.return_value = fake_response
            with self.assertRaises(LLMConfigError):
                client.chat_structured("任务")

    def test_models_file_is_valid_json(self):
        data = json.loads(Path("config/models.json").read_text(encoding="utf-8"))
        self.assertEqual(data["provider"], "openrouter")
        self.assertEqual(data["wire_api"], "chat_completions")


if __name__ == "__main__":
    unittest.main()
