"""OpenRouter（Chat Completions）配置与调用层。

配置源：``config/config.toml`` 的 ``[llm]`` 段 + ``config/models.json`` 模型目录。

- ``provider = "openrouter"``、``wire_api = "chat_completions"``；
- 密钥只从环境变量 ``OPENROUTER_API_KEY`` 读取（不触碰 .env 黑名单文件）；
- 模型目录面向界面下拉菜单：``list_models_menu()`` 输出
  ``[{"value": ..., "label": "OpenRouter · 模型名（免费）"}]``；
- 调用走 OpenAI 兼容 ``/chat/completions``，请求体极小（决策输出 max_tokens 受限）。
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
CONFIG_FILE = REPO_ROOT / "config" / "config.toml"
MODELS_FILE = REPO_ROOT / "config" / "models.json"

try:  # Python 3.11+
    import tomllib
except ModuleNotFoundError:  # pragma: no cover
    tomllib = None  # type: ignore[assignment]


class LLMConfigError(Exception):
    """LLM 配置或调用错误（消息不含密钥）。"""


@dataclass
class LLMSettings:
    provider: str = "openrouter"
    wire_api: str = "chat_completions"
    base_url: str = "https://openrouter.ai/api/v1"
    models_file: str = "config/models.json"
    default_model: str = "google/gemini-2.0-flash-exp:free"
    free_only: bool = True
    timeout: int = 120
    max_tokens: int = 4096
    temperature: float = 0.2


def load_llm_config() -> LLMSettings:
    """读取 config/config.toml [llm]；缺失/损坏回退默认值并可用环境变量覆盖。"""
    settings = LLMSettings()
    if CONFIG_FILE.exists() and tomllib is not None:
        try:
            data = tomllib.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            llm = data.get("llm") or {}
            for key in ("provider", "wire_api", "base_url", "models_file", "default_model"):
                if llm.get(key):
                    setattr(settings, key, str(llm[key]))
            if "free_only" in llm:
                settings.free_only = bool(llm["free_only"])
            if llm.get("timeout"):
                settings.timeout = int(llm["timeout"])
            if llm.get("max_tokens"):
                settings.max_tokens = int(llm["max_tokens"])
            if llm.get("temperature") is not None:
                settings.temperature = float(llm["temperature"])
        except Exception as exc:  # noqa: BLE001 - 配置损坏不影响启动
            settings._load_error = f"{type(exc).__name__}: {exc}"  # type: ignore[attr-defined]
    # 环境变量覆盖（与 .env.example 同名）
    settings.provider = os.environ.get("LLM_PROVIDER") or settings.provider
    settings.base_url = os.environ.get("OPENROUTER_BASE_URL") or settings.base_url
    settings.default_model = os.environ.get("MODEL_NAME") or settings.default_model
    return settings


def load_models() -> list[dict[str, Any]]:
    """读取 config/models.json 模型目录（界面下拉菜单的数据源）。"""
    path = Path(MODELS_FILE)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []
    models = data.get("models")
    if not isinstance(models, list):
        return []
    return [m for m in models if isinstance(m, dict) and m.get("id")]


def get_model(model_id: str | None = None) -> dict[str, Any] | None:
    """按 id 查找模型；未指定时返回默认模型。"""
    models = load_models()
    target = model_id or load_llm_config().default_model
    for model in models:
        if model["id"] == target:
            return model
    return None


def resolve_model(model_id: str | None = None) -> str:
    """解析最终模型 id：校验存在性与免费档约束，非法时回退默认免费模型。"""
    settings = load_llm_config()
    requested = model_id or settings.default_model
    model = get_model(requested)
    if model is None:
        if settings.free_only and ":free" not in requested:
            raise LLMConfigError(
                f"free_only=true 仅允许 :free 模型，收到 {requested!r}；"
                "请从 config/models.json 或 --model 选择免费档"
            )
        return requested  # 未收录但显式指定：仍放行（用户显式意图）
    if settings.free_only and ":free" not in model.get("id", ""):
        raise LLMConfigError(f"模型 {model.get('id')} 非免费档（free_only=true）")
    return model["id"]


def list_models_menu() -> list[dict[str, str]]:
    """界面下拉菜单可识别的模型选项（value=模型 id，label=可读名称）。"""
    menu: list[dict[str, str]] = []
    for model in load_models():
        pricing = model.get("pricing", "?")
        pricing_label = "免费" if str(pricing).lower() in {"free", "0", "0.0"} else str(pricing)
        label = (
            f"{model.get('provider', '?')} · {model.get('name', model['id'])}"
            f"（{pricing_label}）"
        )
        menu.append({"value": model["id"], "label": label})
    return menu


def _strip_json_fences(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        start = 1 if lines[0].startswith("```") else 0
        end = -1 if lines[-1].strip().startswith("```") else len(lines)
        text = "\n".join(lines[start:end]).strip()
    return text


class OpenRouterClient:
    """OpenAI 兼容 Chat Completions 客户端（requests 优先，urllib 兜底）。"""

    def __init__(
        self,
        settings: LLMSettings | None = None,
        *,
        model: str | None = None,
        api_key: str | None = None,
    ) -> None:
        self.settings = settings or load_llm_config()
        self.model = resolve_model(model)
        self.api_key = (api_key or os.environ.get("OPENROUTER_API_KEY", "")).strip()
        self.endpoint = f"{self.settings.base_url.rstrip('/')}/chat/completions"

    def is_configured(self) -> bool:
        return bool(self.api_key)

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        if not self.is_configured():
            raise LLMConfigError(
                "OPENROUTER_API_KEY 未配置（请在环境变量/.env 中填写）"
            )
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://github.com/winsentrobot008/git008",
            "X-Title": "GIT008 Root Factory",
        }
        try:
            import requests
        except ImportError:  # 零依赖兜底
            return self._post_urllib(payload)
        try:
            resp = requests.post(
                self.endpoint,
                headers=headers,
                json=payload,
                timeout=self.settings.timeout,
            )
        except Exception as exc:  # noqa: BLE001
            raise LLMConfigError(f"OpenRouter 请求失败：{type(exc).__name__}: {exc}") from exc
        if resp.status_code != 200:
            raise LLMConfigError(
                f"OpenRouter HTTP {resp.status_code}: {resp.text[:300]}"
            )
        return resp.json()

    def _post_urllib(self, payload: dict[str, Any]) -> dict[str, Any]:
        import urllib.request

        req = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://github.com/winsentrobot008/git008",
                "X-Title": "GIT008 Root Factory",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=self.settings.timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            raise LLMConfigError(f"OpenRouter 请求失败：{type(exc).__name__}: {exc}") from exc

    def chat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        """发送 Chat Completions 请求并返回文本内容。"""
        if self.settings.wire_api != "chat_completions":
            raise LLMConfigError(f"不支持的 wire_api：{self.settings.wire_api}")
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": self.settings.temperature if temperature is None else temperature,
            "max_tokens": self.settings.max_tokens if max_tokens is None else max_tokens,
        }
        data = self._post(payload)
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMConfigError(f"OpenRouter 返回结构异常：{str(data)[:300]}") from exc
        return str(content)

    def chat_structured(
        self,
        prompt: str,
        system: str | None = None,
        *,
        max_tokens: int = 512,
    ) -> dict[str, Any]:
        """要求模型返回 JSON 并解析为 dict（容忍 markdown 代码围栏）。"""
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append(
            {
                "role": "user",
                "content": prompt
                + "\n\nYou MUST respond with valid JSON only. No markdown, no code fences.",
            }
        )
        raw = self.chat(messages, max_tokens=max_tokens)
        try:
            return json.loads(_strip_json_fences(raw))
        except json.JSONDecodeError as exc:
            raise LLMConfigError(
                f"模型返回非法 JSON：{exc}\n原始内容：{raw[:400]}"
            ) from exc


__all__ = [
    "LLMSettings",
    "LLMConfigError",
    "OpenRouterClient",
    "load_llm_config",
    "load_models",
    "get_model",
    "resolve_model",
    "list_models_menu",
]
