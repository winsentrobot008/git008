# GIT008 服务层 — bb-browser 网络感知 + Computer Use 桌面自动化

把「结构化网络抓取」与「桌面 GUI 自动化」接入 git008 工厂，形成
**素材搜集 → 视频渲染 → 桌面发布** 的无人值守闭环（Tiered Execution）。

```text
┌────────────────────────── git008 services/ ──────────────────────────┐
│                                                                      │
│  Step 1 Fetch      services/crawler/         bb-browser CLI/daemon    │
│  ┌─────────────┐   ┌──────────────────┐   ┌───────────────────────┐  │
│  │ 登录态 Chrome │──▶│ 站点 adapter      │──▶│ 流行文案/热点 JSON 清单│  │
│  │ Cookie/Session│   │ zhihu/hot 等 103+ │   │ runtime_data/crawler/│  │
│  └─────────────┘   └──────────────────┘   └───────────────────────┘  │
│                                                                      │
│  Step 2 Process    services/pipeline/       008-video-factory        │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │ node src/index.mjs --batch <crawler.json>                     │   │
│  │ Edge-TTS 旁白 → Pexels/录屏素材 → FFmpeg 9:16 合成 → ffprobe 门禁 │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  Step 3 Publish    services/gui_automation/    Computer Use          │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │ pyautogui → powershell → mcp 三后端降级                         │   │
│  │ 后台/锁屏监测：无人值守默认拒绝注入，仅状态监测                    │   │
│  └───────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

## 目录

| 路径 | 职责 |
|------|------|
| `services/crawler/` | bb-browser 适配器 + 多平台文案/热点/素材 JSON 提取（低 Token） |
| `services/gui_automation/` | Computer Use 控制器 + 后台/锁屏（Unelevated/Unattended）状态监测 |
| `services/pipeline/` | Fetch → Process → Publish 三层编排 |
| `services/config.py` | config.toml + 环境变量统一配置 |
| `services/common/` | 回退日志（`runtime_data/logs/integration_fallback.log`）与结构化结果 |
| `scripts/check_integrations.py` | bb-browser / Chrome / 屏幕控制接口健康检查 |

## 配置

新建配置在仓库根 `config/config.toml`（与 `.env.example` 中同名环境变量一一对应）：

```toml
[integrations.bb_browser]
bin = ""                  # 留空自动发现（PATH / npm 全局 shim）
auto_start_daemon = true

[integrations.computer_use]
enabled = false           # 总开关（桌面操作安全默认关闭）
backend = "auto"          # auto | pyautogui | powershell | mcp
allow_unattended = false  # 锁屏/断开会话禁止注入（安全默认）
dry_run = true            # true=只记录动作不注入输入
```

优先级：环境变量 > `config/config.toml` > 内置默认。`.env` 属于治理黑名单敏感文件，
服务层不读取，密钥仍由你自行注入环境变量。

## 快速开始

```bash
# 1) 健康检查（验证 bb-browser 二进制 / Chrome CDP / 屏幕控制接口）
python scripts/check_integrations.py --online

# 2) 抓取流行文案（bb-browser 复用已登录 Chrome）
python -m services.crawler fetch --adapter zhihu/hot --max-items 5
python -m services.crawler fetch --offline          # 无网络回退本地模板

# 3) 抓取并生成视频工厂批次配置
python -m services.crawler build-batch --offline --product calorieai

# 4) 桌面自动化状态 / dry-run 演示（不注入输入）
python -m services.gui_automation health
python -m services.gui_automation demo

# 5) 三层流水线（Fetch → Render → Publish）
python -m services.pipeline --offline --product calorieai
```

## 回退（Fallback）策略

每层失败都有明确回退通道，且全部落盘
`runtime_data/logs/integration_fallback.log`：

| 层 | 失败场景 | 回退通道 |
|----|----------|----------|
| Fetch | bb-browser 未装 / daemon 未起 / 站点失败 | 本地模板 `services/crawler/templates/offline_copy.json` |
| Process | Edge-TTS 不可用 | 正弦占位音（`--mock-voice`） |
| Process | 渲染失败 | `manual`（保留批次配置供人工重跑） |
| Publish | Computer Use 未启用 / 无人值守 | `skip` |
| Publish | 后端全部失败 | 后端逐级降级（pyautogui → powershell → mcp） |

## 无人值守说明

`SessionMonitor` 通过 Windows 输入桌面（`OpenInputDesktop`）与会话状态
（`qwinsta`）判断是否锁屏/断开。无人值守下：

- 状态监测（health / status）始终可用；
- 鼠标键盘注入默认拒绝（`unattended-blocked`），仅当
  `COMPUTER_USE_ALLOW_UNATTENDED=true` 且后端支持时才放行；
- 真正的锁屏注入需要虚拟显示器 / 服务会话等宿主能力，代码只提供守卫与监测。

## 测试

```bash
python -m unittest discover -s services/tests -v
```

覆盖：配置解析、bb-browser 输出解析/回退、抓取归一化、Computer Use 守卫与
后端降级、三层流水线编排。
