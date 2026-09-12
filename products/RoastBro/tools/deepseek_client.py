"""LLM 客户端（统一多 Provider 路由）。

本模块从 GIT008 根级 ``src/core/llm_client.py`` 复用统一路由实现，支持
DeepSeek / OpenRouter / SiliconFlow / Gemini / Groq / Ollama 六个渠道，
全部走标准 OpenAI SDK（``from openai import OpenAI``），配置统一读取根目录
``.env``：

- ``LLM_PROVIDER``（默认 deepseek）→ 选择渠道
- ``MODEL_NAME`` / ``LLM_MODEL``   → 可选，覆盖渠道默认模型

Usage:
    from tools.deepseek_client import DeepSeekClient
    client = DeepSeekClient()               # 按 LLM_PROVIDER 自动路由
    client = DeepSeekClient("openrouter")   # 显式指定 provider
    response = client.chat("Write a script about AI", system="You are a script writer")
"""

from __future__ import annotations

import sys
from pathlib import Path

# GIT008 仓库根（根级 .env 与 src/core/llm_client.py）
_GIT008_ROOT = Path(__file__).resolve().parents[3]
if str(_GIT008_ROOT) not in sys.path:
    sys.path.insert(0, str(_GIT008_ROOT))

from src.core.llm_client import (  # noqa: E402
    LLMConfigError as DeepSeekError,
    LLMClient as DeepSeekClient,
    PROVIDERS,
    _read_env_value,
    get_llm_config,
    get_provider_spec,
    resolve_provider,
    safe_error,
)

__all__ = [
    "PROVIDERS",
    "DeepSeekError",
    "DeepSeekClient",
    "resolve_provider",
    "get_provider_spec",
    "get_llm_config",
    "safe_error",
]
