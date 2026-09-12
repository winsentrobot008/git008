"""统一多 Provider LLM 路由（OpenAI 兼容接口）。

通过根目录 ``.env`` 中的 ``LLM_PROVIDER`` / ``MODEL_NAME`` 变量，在
DeepSeek、OpenRouter、硅基流动（SiliconFlow）、Google AI Studio（Gemini）、
Groq、Ollama 本地模型之间秒级切换；所有渠道统一走标准 OpenAI SDK
（``from openai import OpenAI``）。

用法::

    from src.core.llm_client import LLMClient, get_llm_config

    client = LLMClient()                  # 按 LLM_PROVIDER 自动路由
    client = LLMClient("siliconflow")     # 显式指定 provider
    print(client.diagnostics())           # 初始化诊断（active provider / model）
    reply = client.chat("写一段旁白", system="你是短视频编剧")

``MODEL_NAME`` 优先于旧变量 ``LLM_MODEL`` 作为模型覆盖；两者都未设置时
回退到 provider 的默认模型映射。
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

# GIT008 仓库根（根级 .env 所在目录）
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_ENV_PATH = _PROJECT_ROOT / ".env"

# .env.example 里的占位 Key —— 命中视为“未配置真实密钥”
_PLACEHOLDER_KEYS = {
    "YOUR_KEY_HERE",
    "your_key_here",
    "your_deepseek_key_here",
    "sk-or-v1-your_openrouter_key_here",
    "your_openrouter_key_here",
    "your_siliconflow_key_here",
    "sk-your_siliconflow_key_here",
    "AIzaSy_your_gemini_key",
    "your_gemini_key_here",
    "gsk_your_groq_key",
    "your_groq_key_here",
}


PROVIDERS: dict[str, dict[str, str]] = {
    "deepseek": {
        "key_env": "DEEPSEEK_API_KEY",
        "base_url_env": "DEEPSEEK_BASE_URL",
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
        "label": "DeepSeek",
        "needs_key": "1",
    },
    "openrouter": {
        "key_env": "OPENROUTER_API_KEY",
        "base_url_env": "OPENROUTER_BASE_URL",
        "base_url": "https://openrouter.ai/api/v1",
        "model": "deepseek/deepseek-chat",
        "label": "OpenRouter",
        "needs_key": "1",
    },
    "siliconflow": {
        "key_env": "SILICONFLOW_API_KEY",
        "base_url_env": "SILICONFLOW_BASE_URL",
        "base_url": "https://api.siliconflow.cn/v1",
        "model": "Qwen/Qwen2.5-Coder-32B-Instruct",
        "label": "SiliconFlow",
        "needs_key": "1",
    },
    "gemini": {
        "key_env": "GEMINI_API_KEY",
        "base_url_env": "GEMINI_BASE_URL",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "model": "gemini-2.0-flash",
        "label": "Gemini",
        "needs_key": "1",
    },
    "groq": {
        "key_env": "GROQ_API_KEY",
        "base_url_env": "GROQ_BASE_URL",
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.3-70b-versatile",
        "label": "Groq",
        "needs_key": "1",
    },
    "ollama": {
        "key_env": "OLLAMA_API_KEY",
        "base_url_env": "OLLAMA_BASE_URL",
        "base_url": "http://localhost:11434/v1",
        "model": "qwen2.5-coder:14b",
        "label": "Ollama",
        "needs_key": "0",  # 本地模型：OpenAI SDK 需要占位 key
    },
}

LLM_PROVIDER_OPTIONS: tuple[str, ...] = tuple(PROVIDERS)


class LLMConfigError(Exception):
    """LLM 配置或调用错误（消息已脱敏，不含密钥）。"""


def _read_env_value(key: str) -> str | None:
    """按 环境变量 → 根 .env 顺序读取配置值（兼容 UTF-8 BOM）。"""
    value = os.environ.get(key)
    if value:
        return value
    if not _ENV_PATH.exists():
        return None
    try:
        for line in _ENV_PATH.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, _, raw = line.partition("=")
            if name.strip() == key:
                value = raw.strip().strip("\"'").split("#", 1)[0].strip()
                return value or None
    except OSError:
        return None
    return None


def resolve_provider() -> str:
    """按 ``LLM_PROVIDER`` 解析当前 provider（默认 deepseek）。"""
    provider = (_read_env_value("LLM_PROVIDER") or "deepseek").strip().lower()
    if provider not in PROVIDERS:
        provider = "deepseek"
    return provider


def get_provider_spec(provider: str) -> dict[str, str]:
    """按 provider 名取路由表条目；未知 provider 抛出可读错误。"""
    provider = provider.strip().lower()
    spec = PROVIDERS.get(provider)
    if spec is None:
        raise LLMConfigError(
            f"未知 LLM provider：{provider!r}。"
            f"可选值：{' | '.join(LLM_PROVIDER_OPTIONS)}"
            "（在 .env 中通过 LLM_PROVIDER 指定）。"
        )
    return spec


def get_llm_config(provider: str | None = None) -> dict[str, Any]:
    """解析 provider 对应的 ``(api_key, base_url, default_model)`` 配置。

    Args:
        provider: 显式 provider 名；缺省按 ``LLM_PROVIDER`` 自动路由。

    Returns:
        含 ``provider / label / api_key / base_url / model`` 等字段的配置字典。
        模型解析顺序：``MODEL_NAME`` → ``LLM_MODEL`` → provider 默认模型。
    """
    provider = (provider or resolve_provider()).strip().lower()
    spec = get_provider_spec(provider)
    api_key = _read_env_value(spec["key_env"])
    base_url = (_read_env_value(spec["base_url_env"]) or spec["base_url"]).rstrip("/")
    model = (
        _read_env_value("MODEL_NAME")
        or _read_env_value("LLM_MODEL")
        or spec["model"]
    )
    return {
        "provider": provider,
        "label": spec["label"],
        "key_env": spec["key_env"],
        "base_url_env": spec["base_url_env"],
        "api_key": api_key,
        "base_url": base_url,
        "default_model": spec["model"],
        "model": model,
        "needs_key": spec["needs_key"] == "1",
        "key_configured": _is_real_key(api_key),
    }


def _is_real_key(api_key: str | None) -> bool:
    """判断 Key 是否已填写（非空且非占位符）。"""
    return bool(api_key and api_key.strip() not in _PLACEHOLDER_KEYS)


def _normalize_base_url(base_url: str) -> str:
    """归一化 Base URL：去掉末尾斜杠与误贴的 /chat/completions 路径。"""
    url = base_url.strip().rstrip("/")
    if url.endswith("/chat/completions"):
        url = url[: -len("/chat/completions")]
    return url


def _sdk_version() -> str:
    try:
        import openai

        return getattr(openai, "__version__", "unknown")
    except Exception:
        return "not-installed"


def _redact(message: str) -> str:
    """把消息里可能出现的真实 Key 替换为 [redacted]。"""
    for spec in PROVIDERS.values():
        key = _read_env_value(spec["key_env"])
        if key:
            message = message.replace(key, "[redacted]")
    return message


def safe_error(exc: Exception) -> str:
    """返回脱敏后的错误消息（避免 API Key 泄漏进日志）。"""
    return _redact(str(exc))


class LLMClient:
    """统一 LLM 客户端（OpenAI SDK，兼容全部已映射 provider）。

    兼容旧 API：``provider_label`` / ``api_key`` / ``base_url`` / ``MODEL`` /
    ``API_URL`` 属性与 ``is_available()`` / ``chat()`` / ``chat_structured()``
    方法与旧 ``deepseek_client.DeepSeekClient`` 保持一致。
    """

    def __init__(self, provider: str | None = None, *, require_key: bool = True):
        self.provider = (provider or resolve_provider()).strip().lower()
        spec = get_provider_spec(self.provider)
        self.provider_label = spec["label"]
        self.needs_key = spec["needs_key"] == "1"
        self.key_env = spec["key_env"]
        self.base_url_env = spec["base_url_env"]
        self.api_key = _read_env_value(spec["key_env"])
        self.base_url = _normalize_base_url(
            _read_env_value(spec["base_url_env"]) or spec["base_url"]
        )
        self.API_URL = f"{self.base_url}/chat/completions"
        self.default_model = spec["model"]
        self.MODEL = (
            _read_env_value("MODEL_NAME")
            or _read_env_value("LLM_MODEL")
            or self.default_model
        )
        self._client: Any | None = None

        if require_key and self.needs_key and not self.is_available():
            raise LLMConfigError(
                f"{self.provider_label} API Key 未配置"
                f"（请在根目录 .env 中填写 {self.key_env}=<你的密钥>，"
                "或切换 LLM_PROVIDER 到其它渠道）。"
            )

    # ------------------------------------------------------------------
    # 初始化 / 诊断
    # ------------------------------------------------------------------

    def is_available(self) -> bool:
        """当前 provider 是否已配置真实 API Key（Ollama 视为可用）。"""
        if not self.needs_key:
            return True
        return _is_real_key(self.api_key)

    def _openai_client(self) -> Any:
        if self._client is None:
            try:
                from openai import OpenAI
            except ImportError as exc:
                raise LLMConfigError(
                    "未安装 openai SDK，请先执行："
                    "pip install \"openai>=1.0\""
                ) from exc
            self._client = OpenAI(
                api_key=self.api_key or "ollama",
                base_url=self.base_url,
            )
        return self._client

    def diagnostics(self) -> dict[str, Any]:
        """初始化诊断：输出当前激活的 provider 与模型等信息。"""
        model_source = "provider-default"
        if _read_env_value("MODEL_NAME"):
            model_source = "MODEL_NAME"
        elif _read_env_value("LLM_MODEL"):
            model_source = "LLM_MODEL"
        return {
            "provider": self.provider,
            "provider_label": self.provider_label,
            "model": self.MODEL,
            "model_source": model_source,
            "base_url": self.base_url,
            "key_env": self.key_env,
            "key_configured": self.is_available(),
            "needs_key": self.needs_key,
            "sdk": "openai",
            "sdk_version": _sdk_version(),
            "chat_endpoint": self.API_URL,
        }

    # ------------------------------------------------------------------
    # 对话
    # ------------------------------------------------------------------

    def chat(
        self,
        prompt: str,
        system: str | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> str:
        """发送 Chat Completions 请求，返回文本内容。"""
        if not self.is_available():
            raise LLMConfigError(
                f"{self.provider_label} API Key 未配置"
                f"（请在根目录 .env 中填写 {self.key_env}=<你的密钥>）。"
            )
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})
        try:
            response = self._openai_client().chat.completions.create(
                model=self.MODEL,
                messages=messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        except Exception as exc:
            raise LLMConfigError(
                f"{self.provider_label} 调用失败：{safe_error(exc)}"
            ) from exc
        content = getattr(response.choices[0].message, "content", None)
        if content is None:
            raise LLMConfigError(f"{self.provider_label} 返回内容为空。")
        return str(content)

    def chat_structured(
        self,
        prompt: str,
        system: str | None = None,
        temperature: float = 0.7,
    ) -> dict[str, Any]:
        """要求模型返回 JSON 并解析为 dict（容忍 markdown 代码围栏）。"""
        json_system = (system or "") + (
            "\n\nYou MUST respond with valid JSON only. "
            "No markdown, no code fences, no explanation."
        )
        raw = self.chat(
            prompt,
            system=json_system,
            temperature=temperature,
            max_tokens=4096,
        )
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            start = 1 if lines[0].startswith("```") else 0
            end = -1 if lines[-1].strip().startswith("```") else len(lines)
            cleaned = "\n".join(lines[start:end])
        try:
            return json.loads(cleaned.strip())
        except json.JSONDecodeError as exc:
            raise LLMConfigError(
                f"{self.provider_label} 返回非法 JSON：{exc}\n原始内容：{raw[:500]}"
            ) from exc


def diagnose_llm(provider: str | None = None) -> dict[str, Any]:
    """永不抛异常的诊断入口（供 CLI doctor 等场景安全调用）。"""
    try:
        client = LLMClient(provider)
        diag = client.diagnostics()
        diag["ok"] = True
        return diag
    except LLMConfigError as exc:
        result: dict[str, Any] = {
            "ok": False,
            "provider": provider or resolve_provider(),
            "error": safe_error(exc),
        }
        # Key 缺失时仍展示当前激活的模型名 / Base URL，方便初始化诊断
        try:
            cfg = get_llm_config(provider)
            result["provider_label"] = cfg["label"]
            result["model"] = cfg["model"]
            result["model_source"] = (
                "MODEL_NAME"
                if _read_env_value("MODEL_NAME")
                else ("LLM_MODEL" if _read_env_value("LLM_MODEL") else "provider-default")
            )
            result["base_url"] = cfg["base_url"]
            result["key_env"] = cfg["key_env"]
            result["sdk"] = "openai"
            result["sdk_version"] = _sdk_version()
        except Exception:  # noqa: BLE001 —— 诊断入口兜底
            pass
        return result
    except Exception as exc:  # noqa: BLE001 —— 诊断入口兜底
        return {"ok": False, "error": safe_error(exc)}


# ----------------------------------------------------------------------
# 向后兼容别名（旧 deepseek_client.DeepSeekClient / DeepSeekError）
# ----------------------------------------------------------------------
DeepSeekError = LLMConfigError
DeepSeekClient = LLMClient


__all__ = [
    "PROVIDERS",
    "LLM_PROVIDER_OPTIONS",
    "LLMConfigError",
    "DeepSeekError",
    "LLMClient",
    "DeepSeekClient",
    "resolve_provider",
    "get_provider_spec",
    "get_llm_config",
    "diagnose_llm",
    "safe_error",
]
