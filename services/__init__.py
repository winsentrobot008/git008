"""GIT008 服务层（分层执行 Tiered Execution）。

services/
  crawler/         网络数据感知层（bb-browser 适配器 + 流行文案/热点 JSON 提取）
  gui_automation/  桌面 GUI 兜底层（Computer Use 控制 + 后台/锁屏状态监测）
  pipeline/        Fetch → Process → Publish 三步骤编排（接入 008-video-factory）
  config.py        统一配置（config.toml + 环境变量覆盖）
"""

__version__ = "0.1.0"
