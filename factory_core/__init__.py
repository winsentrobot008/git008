"""GIT008 根工厂核心模块。

factory_core/
  llm.py           OpenRouter（Chat Completions）配置与调用 + config/models.json 模型目录
  web_browser.py   轻量网页感知层（bb-browser → 结构化 JSON，低 Token）
  computer_use.py  GUI 兜底控制层（Computer Use 插件封装，支持后台/锁屏状态监测）
"""

from factory_core.llm import (
    LLMSettings,
    OpenRouterClient,
    get_model,
    list_models_menu,
    load_llm_config,
    load_models,
    resolve_model,
)

__all__ = [
    "LLMSettings",
    "OpenRouterClient",
    "load_llm_config",
    "load_models",
    "list_models_menu",
    "get_model",
    "resolve_model",
]
