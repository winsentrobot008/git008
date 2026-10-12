"""Agent-Reach 语义词典桥（无副作用加载器）。

历史实现把仓库 ``scripts/`` 目录插进 ``sys.path`` 再 ``import agent_reach_bridge``；
于是 ``scripts/server.py`` 顶掉了同名 ``server`` 包（pytest 收集期
``from server import pipeline_runner`` 直接 ImportError），``scripts/`` 下任何模块名
都可能遮蔽同名标准库/项目模块。

这里改为按文件路径加载，模块只注册在私有名下，**绝不污染 sys.path**；
加载结果进程内缓存，加载失败按「词典不可用」优雅降级。
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Optional

from src.core.paths import REPO_ROOT

__all__ = ["MODULE_NAME", "bridge_path", "load_bridge", "bridge_function"]

#: 私有模块名：与 ``agent_reach_bridge`` 区分，避免与 scripts/ 下的同名顶层模块互踩。
MODULE_NAME = "git008_agent_reach_bridge"

_BRIDGE = REPO_ROOT / "scripts" / "agent_reach_bridge.py"
_loaded = False
_module: Optional[Any] = None


def bridge_path() -> Path:
    """语义词典源文件路径（scripts/agent_reach_bridge.py）。"""
    return _BRIDGE


def load_bridge() -> Optional[Any]:
    """加载语义词典模块；文件缺失或执行失败返回 None（由调用方降级）。"""
    global _loaded, _module
    if _loaded:
        return _module
    _loaded = True
    path = bridge_path()
    if not path.is_file():
        return None
    sys.modules.pop(MODULE_NAME, None)
    try:
        spec = importlib.util.spec_from_file_location(MODULE_NAME, path)
        if spec is None or spec.loader is None:
            return None
        module = importlib.util.module_from_spec(spec)
        sys.modules[MODULE_NAME] = module
        spec.loader.exec_module(module)
    except Exception:  # noqa: BLE001 - 词典可选，任何加载异常都退化为「不可用」
        sys.modules.pop(MODULE_NAME, None)
        _module = None
        return None
    _module = module
    return _module


def bridge_function(name: str) -> Optional[Any]:
    """取词典模块内的公开函数（模块不可用/函数缺失返回 None）。"""
    module = load_bridge()
    return getattr(module, name, None) if module is not None else None
