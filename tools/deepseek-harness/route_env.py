#!/usr/bin/env python3
"""deepseek-harness 统一路由配置（端点 / 密钥 / 模型 / DSH_HOME）。

分工（重要，勿混用）：
  - `config/route.env` —— 路由配置的唯一来源，由 AIFactoryPanel 自动同步本地/云端。
  - `.env`             —— 只允许「非 bootstrap」键（例如 WEBUI_*）。

为什么路由不写在 `.env`：dsh 启动时会校验任何被发现目录下的 `.env`，
拒绝其中的 bootstrap 键（`DSH_` 前缀、`DEEPSEEK_BASE_URL`、`PATH`、代理变量等），
因为这些键决定进程如何启动、代码与指令从哪里加载、以及流量走向。
端点必须由「启动它的进程环境」注入。因此本模块负责把 `config/route.env`
翻译成子进程环境变量（见 `child_env()`）。

读取优先级：进程环境变量 > config/route.env > .env(安全键) > 内置默认值。
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ROUTE_FILE = ROOT / "config" / "route.env"
SAFE_ENV_FILE = ROOT / ".env"

DEFAULT_BASE_URL = "http://127.0.0.1:8001/v1"
DEFAULT_API_KEY = "local"
DEFAULT_MODEL = "local"
DEFAULT_DSH_HOME = str(ROOT / "config" / "dsh-home")

# route.env 键名 -> 逻辑名
ROUTE_KEYS = {
    "DEEPSEEK_BASE_URL": "base_url",
    "DEEPSEEK_API_KEY": "api_key",
    "DEEPSEEK_CLOUD_API_KEY": "cloud_api_key",
    "DSH_MODEL": "model",
    "DSH_HOME": "dsh_home",
}
# 逻辑名 -> 子进程环境变量名（端点只能经由此通道注入 dsh）
CHILD_ENV_KEYS = {
    "base_url": "DEEPSEEK_BASE_URL",
    "api_key": "DEEPSEEK_API_KEY",
    "model": "DSH_MODEL",
    "dsh_home": "DSH_HOME",
}


def parse_env_file(path: Path) -> dict[str, str]:
    """解析 KEY=VALUE 文本；文件不存在时返回空表。"""
    if not path.is_file():
        return {}
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key:
            values[key] = value.strip().strip('"').strip("'")
    return values


def read_route() -> dict[str, str]:
    """返回当前生效的路由（已套用优先级）。"""
    route_file = parse_env_file(ROUTE_FILE)
    safe_file = parse_env_file(SAFE_ENV_FILE)

    def pick(logical: str, *aliases: str, default: str = "") -> str:
        for name in (f"DSH_API_{logical.upper()}",) + aliases:
            value = os.environ.get(name, "").strip()
            if value:
                return value
        for name in aliases:
            value = route_file.get(name, "").strip()
            if value:
                return value
        for name in aliases:
            value = safe_file.get(name, "").strip()
            if value:
                return value
        return default

    base_url = pick("base", "DEEPSEEK_BASE_URL", "DSH_API_BASE", default=DEFAULT_BASE_URL).rstrip("/")
    return {
        "base_url": base_url,
        "api_key": pick("key", "DEEPSEEK_API_KEY", "DSH_API_KEY", default=DEFAULT_API_KEY),
        "cloud_api_key": route_file.get("DEEPSEEK_CLOUD_API_KEY", "").strip(),
        "model": (
            os.environ.get("DSH_MODEL", "").strip()
            or route_file.get("DSH_MODEL", "").strip()
            or DEFAULT_MODEL
        ),
        "dsh_home": (
            os.environ.get("DSH_HOME", "").strip()
            or route_file.get("DSH_HOME", "").strip()
            or DEFAULT_DSH_HOME
        ),
    }


def is_local(base_url: str) -> bool:
    return "127.0.0.1" in base_url or "localhost" in base_url


def child_env(route: dict[str, str] | None = None) -> dict[str, str]:
    """把路由翻译成 dsh / SDK 子进程需要的环境变量。"""
    route = route or read_route()
    return {name: route[key] for key, name in CHILD_ENV_KEYS.items() if route.get(key)}


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass
    route = read_route()
    mode = "本地网关" if is_local(route["base_url"]) else "云端 API"
    print(f"模式      : {mode}")
    print(f"端点      : {route['base_url']}")
    print(f"模型      : {route['model']}")
    print(f"密钥      : {'已注入(%d 字符)' % len(route['api_key']) if route['api_key'] else '(空)'}")
    print(f"云端备份键: {'有' if route['cloud_api_key'] else '(空)'}")
    print(f"DSH_HOME  : {route['dsh_home']}")
    print(f"路由文件  : {ROUTE_FILE}（存在：{ROUTE_FILE.is_file()}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())