"""GIT008 服务层统一配置加载。

优先级（高 → 低）：
  1. 环境变量（BB_BROWSER_* / COMPUTER_USE_* / PIPELINE_*）
  2. 仓库根 config.toml（[integrations] / [pipeline]）
  3. 内置默认值（零依赖可运行）

约定：.env 属于治理黑名单敏感文件，服务层只读取 config.toml 与环境变量；
敏感密钥由用户在 .env / 环境变量中自行注入（本模块不触碰 .env）。
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:  # Python 3.11+
    import tomllib
except ModuleNotFoundError:  # pragma: no cover - Python 3.10 兜底
    tomllib = None  # type: ignore[assignment]

REPO_ROOT = Path(__file__).resolve().parents[1]
CONFIG_FILE = REPO_ROOT / "config" / "config.toml"
LEGACY_CONFIG_FILE = REPO_ROOT / "config.toml"  # 兼容旧根配置路径


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass
class BbBrowserSettings:
    """bb-browser 适配器配置（网络数据感知层）。"""

    bin: str | None = None          # 可执行路径；None = 自动发现（PATH / npm 全局 shim）
    daemon_host: str = "127.0.0.1"  # daemon 监听地址
    daemon_port: int = 19824        # daemon 默认端口
    auto_start_daemon: bool = True  # 未运行时自动拉起 daemon
    timeout: int = 45               # 单次 CLI 调用超时（秒）
    openclaw_fallback: bool = False  # CLI/daemon 失败后尝试 --openclaw
    data_dir: str = "runtime_data/crawler"  # JSON 清单落盘目录（相对仓库根）

    @property
    def daemon_url(self) -> str:
        return f"http://{self.daemon_host}:{self.daemon_port}"


@dataclass
class ComputerUseSettings:
    """Computer Use 桌面自动化配置（GUI 兜底层）。"""

    enabled: bool = False           # 总开关：False 时任何桌面操作直接跳过并记日志
    backend: str = "auto"           # auto | pyautogui | powershell | mcp
    allow_unattended: bool = False  # 允许锁屏/断开会话下执行（默认拒绝，仅状态监测）
    dry_run: bool = False           # 只记录动作不真正控制鼠标键盘（CI/健康检查）
    mcp_bin: str | None = None      # 外接 Computer Use MCP 插件可执行文件（JSON-RPC stdio）
    screenshot_dir: str = "runtime_data/gui"  # 截图/证据落盘目录（相对仓库根）
    action_timeout: int = 30        # 单个动作超时（秒）
    key_delay_ms: int = 50          # 按键间隔（毫秒，防输入过快丢失）


@dataclass
class PipelineSettings:
    """Fetch → Process → Publish 编排配置。"""

    video_factory_dir: str = "products/008-video-factory"  # 相对仓库根
    node_bin: str | None = None      # None = 自动发现 PATH 中的 node
    work_dir: str = "runtime_data/pipeline"  # 批次配置/报告落盘目录
    default_product: str = "calorieai"
    default_target: str = "calorie-ai"
    mock_voice: bool = False         # Edge-TTS 不可用时是否强制正弦占位音
    no_pexels: bool = True           # 默认不联网抓真人素材（素材由 crawler 提供）


@dataclass
class ServiceConfig:
    bb_browser: BbBrowserSettings = field(default_factory=BbBrowserSettings)
    computer_use: ComputerUseSettings = field(default_factory=ComputerUseSettings)
    pipeline: PipelineSettings = field(default_factory=PipelineSettings)
    source_file: Path | None = None


_ENV_MAP = {
    "BB_BROWSER_BIN": ("bb_browser", "bin"),
    "BB_BROWSER_DAEMON_HOST": ("bb_browser", "daemon_host"),
    "BB_BROWSER_DAEMON_PORT": ("bb_browser", "daemon_port"),
    "BB_BROWSER_AUTO_START_DAEMON": ("bb_browser", "auto_start_daemon"),
    "BB_BROWSER_TIMEOUT": ("bb_browser", "timeout"),
    "BB_BROWSER_OPENCLAW_FALLBACK": ("bb_browser", "openclaw_fallback"),
    "COMPUTER_USE_ENABLED": ("computer_use", "enabled"),
    "COMPUTER_USE_BACKEND": ("computer_use", "backend"),
    "COMPUTER_USE_ALLOW_UNATTENDED": ("computer_use", "allow_unattended"),
    "COMPUTER_USE_DRY_RUN": ("computer_use", "dry_run"),
    "COMPUTER_USE_MCP_BIN": ("computer_use", "mcp_bin"),
    "PIPELINE_VIDEO_FACTORY_DIR": ("pipeline", "video_factory_dir"),
    "PIPELINE_NODE_BIN": ("pipeline", "node_bin"),
    "PIPELINE_MOCK_VOICE": ("pipeline", "mock_voice"),
    "PIPELINE_NO_PEXELS": ("pipeline", "no_pexels"),
}


def _coerce(section: str, key: str, value: Any, current: Any) -> Any:
    if isinstance(current, bool):
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "on"}
    if isinstance(current, int):
        try:
            return int(value)
        except (TypeError, ValueError):
            return current
    return value


def load_config(path: Path | None = None, *, use_env: bool = True) -> ServiceConfig:
    """加载 config.toml + 环境变量覆盖，任何异常都回退默认值（不阻断调用方）。"""
    cfg = ServiceConfig()
    if path is not None:
        cfg_path = Path(path)
    else:
        cfg_path = CONFIG_FILE if CONFIG_FILE.exists() else LEGACY_CONFIG_FILE

    if cfg_path.exists() and tomllib is not None:
        try:
            data = tomllib.loads(cfg_path.read_text(encoding="utf-8"))
            integrations = data.get("integrations") or {}
            bb = integrations.get("bb_browser") or {}
            cu = integrations.get("computer_use") or {}
            pipe = data.get("pipeline") or {}
            for key, value in (bb or {}).items():
                setattr(cfg.bb_browser, key, _coerce("bb_browser", key, value, getattr(cfg.bb_browser, key)))
            for key, value in (cu or {}).items():
                setattr(cfg.computer_use, key, _coerce("computer_use", key, value, getattr(cfg.computer_use, key)))
            for key, value in (pipe or {}).items():
                setattr(cfg.pipeline, key, _coerce("pipeline", key, value, getattr(cfg.pipeline, key)))
            cfg.source_file = cfg_path
        except Exception as exc:  # 配置损坏不影响启动
            cfg.source_file = None
            cfg._load_error = f"{type(exc).__name__}: {exc}"  # type: ignore[attr-defined]

    if use_env:
        for env_name, (section, attr) in _ENV_MAP.items():
            if env_name not in os.environ:
                continue
            section_obj = getattr(cfg, section)
            current = getattr(section_obj, attr)
            setattr(section_obj, attr, _coerce(section, attr, os.environ[env_name], current))

    # 相对路径统一锚定仓库根
    for sec, attr in (
        (cfg.bb_browser, "data_dir"),
        (cfg.computer_use, "screenshot_dir"),
        (cfg.pipeline, "video_factory_dir"),
        (cfg.pipeline, "work_dir"),
    ):
        raw = getattr(sec, attr)
        p = Path(raw)
        if not p.is_absolute():
            setattr(sec, attr, str((REPO_ROOT / p).resolve()))
    return cfg


def repo_root() -> Path:
    return REPO_ROOT


__all__ = [
    "REPO_ROOT",
    "CONFIG_FILE",
    "LEGACY_CONFIG_FILE",
    "ServiceConfig",
    "BbBrowserSettings",
    "ComputerUseSettings",
    "PipelineSettings",
    "load_config",
    "repo_root",
]
