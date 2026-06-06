# Governance Dashboard Startup Log
**Timestamp**: 2026-06-05 12:29:30 UTC+2

## 强制进程检查
- 结果: 无 governance_ui.py 进程运行 — 无需 kill

## 端口排查
- 8501: 未占用 ✅
- 8502: 备用（无须切换）

## 启动执行
- 命令: `python Cline-anti-freeze/governance_ui.py --webview-mode --project-name="Maneki-AI"`
- 结果: ✅ 启动成功

### 运行组件
| 组件 | 端口 | 状态 |
|------|------|------|
| Streamlit UI | 8501 | ✅ |
| WebSocket Server | 8769 | ✅ |
| WebView HTTP API | 8599 | ✅ |

### 终端输出摘要
```
[governance_ui] WebSocket 服务器已启动 ws://localhost:8769
[governance_ui] Streamlit UI 启动: http://localhost:8501
[governance_ui] 首次启动检测 -> 强制弹出 UI 面板
[webview] WebView 面板 HTTP 服务: http://127.0.0.1:8599
Uvicorn server started on 0.0.0.0:8501
```

## 视觉弹窗
- 命令: `code --open-url http://localhost:8501`
- 结果: ✅ Simple Browser 调用已执行

## 最终状态
UI 面板应已自动弹出在 VS Code 编辑器视窗中。如需手动访问: http://localhost:8501