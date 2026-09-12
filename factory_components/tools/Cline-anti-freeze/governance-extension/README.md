# Cline 治理中心 — VS Code 扩展 (v3.0)

原生 VS Code 侧边栏 Webview 治理面板，替代已废弃的 Streamlit 网页端
(`localhost:8501`) 与 iframe 包装层（`governance_ui.py` / `governance_webview.py`）。

## 核心特性

- **零 Python 后端进程**：面板由 VS Code 扩展宿主直接渲染，无 Streamlit、
  无 WebSocket 服务器、无 HTTP 服务、无常驻巡检进程。
- **数据源统一（实时直读）**：面板每 3 秒直接读取
  - `governance_logs/auto_clear_signal.json`（熔断信号）
  - `governance_logs/auto_clear_events.jsonl`（信号事件）
  - `.codex/governance.json`（全局配置 / 阈值 / Auto-Clear 开关）
  - `global_controls.json`（容忍阈值 / 心跳超时等）
  - `fault_blackbox.json`（故障黑盒，健康指数交叉校验）
  - `~/.codex/sessions/**/*.jsonl` 最新会话（Token 大盘）
  - 子项目 `.heartbeat` 文件（健康指数）
  面板底部逐项展示数据源 mtime 与新鲜度，杜绝“显示旧数据”。
- **Token 熔断触发器迁移进扩展**：扩展进程内每轮巡检计算 SOFT(80k/轮数) 与
  CRITICAL(100k) 熔断，状态变化时即时写入信号文件并追加事件；上下文回落后
  自动写入 NONE 清除陈旧信号。
- **控制面板**：Auto-Clear 开关、软/硬阈值、轮数预警、熔断冷却、心跳超时、
  风险阈值、生产暂停/自愈/广播开关，全部直接写入 JSON 配置。
- **强制终止 Agent**：Node 实现（PowerShell 枚举 + taskkill），按需调用，
  无常驻进程。

## 安装

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

安装脚本会把本目录复制到
`%USERPROFILE%\.vscode\extensions\cline-governance.cline-governance-center-3.0.0`
并移除旧的 2.0.0 版本。随后在 VS Code 中执行 `Developer: Reload Window`，
点击左侧 Activity Bar 的 🏛️ 图标打开治理面板。

## 开发调试

在 VS Code 中打开本目录，按 `F5`（Extension Development Host）即可调试。

## 目录结构

```
governance-extension/
├── package.json       # 扩展清单（视图容器 / WebviewView / 命令）
├── extension.js       # 扩展宿主：直读数据源 + 熔断触发器 + 消息同步
├── media/
│   └── governance-icon.svg
└── install.ps1        # 安装 / 升级脚本
```

## 与旧架构的关系

| 组件 | 旧（v2 / Streamlit） | 新（v3 扩展） |
| --- | --- | --- |
| 面板渲染 | Streamlit iframe + HTTP API | 原生 WebviewView |
| 数据通道 | WebSocket 8769 + REST | `postMessage` 直读文件 |
| Token 熔断 | auto_enforce 常驻巡检 | 扩展进程内巡检 |
| 后端进程 | python (Streamlit/WS/UI) ×2 | 无 |
| 数据源 | 旧路径 `git008/Cline-anti-freeze` | 真实路径 `factory_components/tools/Cline-anti-freeze` |
