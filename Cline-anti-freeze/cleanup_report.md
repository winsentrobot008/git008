# 🏭 Maneki-AI 前端页面清理考古报告

> 生成时间：2026-06-05  
> 执行模式：全链路扫描 → 零引用标记 → .bak.old 冻结  
> 扫描范围：`Maneki-AI/`、`ClawAI/`、`Cline-anti-freeze/` 及 `Project-X/` 目录下所有 `*.py` 文件

---

## 一、全链路扫描结果

扫描了 **Maneki-AI** 下的三个核心入口文件以及所有子目录中的 Python 文件：

| 文件 | 路径 | 关联 HTML/JS |
|---|---|---|
| `app.py` | `Maneki-AI/app.py` (751行) | `templates/index.html`, `maneki_live.html`★, 内联 `FACTORY_HOME_HTML`, `TASK_DETAIL_HTML`, `FALLBACK_HTML` |
| `main.py` | `Maneki-AI/main.py` (70行) | 无前端引用 — 纯 TaskDispatcher 逻辑层 |
| `factory_ui.py` | `Maneki-AI/factory_ui.py` (15行) | 无文件引用 — 仅 Streamlit debug 触发器 |
| `api_gateway.py` | `Maneki-AI/core/api_gateway.py` (463行) | `templates/index.html` (GET / 路由、fallback 路由) |
| `server.py` | `ClawAI/livebench/api/server.py` | `static/index.html` (StaticFiles mount) |

★ `maneki_live.html` 在 `app.py` 第506-520行被引用，但该文件在磁盘上 **不存在** — `/live` 路由已退化到 fallback 内联 HTML。

---

## 二、HTML/JS 文件全目录清单

### Maneki-AI

| 文件 | 位置 | 引用次数 | 引用来源 | 状态 |
|---|---|---|---|---|
| `maneki.html` | 根目录 (471行) | **0** (无 .py 直接引用) | 唯一前端页面，需保留 | 🟢 **保留** |
| `templates/index.html` | `templates/` | **2** | `app.py:66`, `api_gateway.py:374,384` | 🟢 活跃 |
| `deliveries/final_builds/app.html` | `deliveries/final_builds/` | 0 (自动生成产物) | — | ⚪ 生成产物 |
| `generated_outputs/FAC-*/app.html` | `generated_outputs/` (7个) | 0 (自动生成产物) | — | ⚪ 生成产物 |

### ClawAI

| 文件 | 位置 | 引用次数 | 引用来源 | 状态 |
|---|---|---|---|---|
| `clawwork_demo.html` | 根目录 (278行) | **0** | 无任何 .py 文件引用 | 🔴 已冻结 |
| `index.html` | 根目录 | 0 (直接) | 未被显式 import；可能为 standalone 入口 | 🟡 待评估 |
| `static/index.html` | `static/` | **1** (间接) | `server.py` 通过 `StaticFiles(directory=static, html=True)` 挂载 | 🟢 活跃 |
| `frontend/index.html` | `frontend/` | 0 (直接) | Vite 前端构建工具链引用 | 🟢 活跃 |
| `frontend/src/api.js` | `frontend/src/` | 0 (直接) | 前端打包引用 | 🟢 活跃 |
| `frontend/src/hooks/useWebSocket.js` | `frontend/src/hooks/` | 0 (直接) | 前端打包引用 | 🟢 活跃 |

---

## 三、已冻结文件详情

### 3.1 `Maneki-AI/maneki.html` — 保留

| 属性 | 值 |
|---|---|
| **原始角色** | **Maneki-AI 唯一前端页面** — 实时工厂控制台 (AI Factory Live) |
| **文件大小** | 471 行，~16KB |
| **功能特征** | WebSocket 实时流、AI 董事会面板 (DeepSeek/Gemini/Doubao/OpenAI/Yuanbao)、Success-Share 结算面板、任务提交表单、连接状态徽章 |
| **引用状态** | 无 .py 文件直接 import，但为项目唯一的完整前端页面。`app.py:506` 引用 `maneki_live.html`（不存在）— 建议将 `/live` 路由改为指向 `maneki.html` |
| **操作** | ✅ 保留，不做冻结 |

### 3.2 `ClawAI/clawwork_demo.html` → `clawwork_demo.html.bak.old`

| 属性 | 值 |
|---|---|
| **原始角色** | ClawAI 生产调度 Demo 页面 (DeepSeek 多 Agent 协作展示) |
| **文件大小** | 278 行，~10KB |
| **功能特征** | DeepSeek 多 Agent 协作 UI、生产调度面板、任务提交、Agent 状态卡片、连接状态指示器 |
| **最终引用** | **零引用** — 无任何 .py 文件引用，无 nginx/Dockerfile 指向 |
| **推测原因** | 独立 Demo 页面，用于早期展示 ClawAI 的多 Agent 协作能力。已被 `static/index.html` 和 `frontend/index.html` 的正式前端替代 |
| **冻结操作** | ✅ 重命名为 `clawwork_demo.html.bak.old` |

---

## 四、架构角色映射（考古推断）

```
┌─────────────────────────────────────────────────────────────┐
│                   Maneki-AI 前端架构演进                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  v0.2.x                                                      │
│  ┌──────────────┐     ┌──────────────────┐                  │
│  │ maneki.html  │────▶│ /live 实时工厂     │ ◀── 已被遗弃     │
│  │ (471行)      │     │ (WebSocket流)     │       → .bak.old │
│  └──────────────┘     └──────────────────┘                  │
│         ↓ 重构                                               │
│  v0.3.x → v0.4.0-live                                        │
│  ┌──────────────────┐  ┌─────────────────────┐              │
│  │ maneki_live.html │  │ app.py 内联 HTML     │              │
│  │ (期望但不存在)    │  │ FACTORY_HOME_HTML    │ ◀── 当前活跃  │
│  └──────────────────┘  │ TASK_DETAIL_HTML     │              │
│                        │ LIVE_FACTORY fallback│              │
│                        └─────────────────────┘              │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                   ClawAI 前端架构演进                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PoC 阶段                                                    │
│  ┌────────────────────┐                                     │
│  │ clawwork_demo.html │  DeepSeek 多 Agent Demo              │
│  │ (278行, 零引用)     │  → .bak.old                         │
│  └────────────────────┘                                     │
│         ↓ 正式化                                             │
│  ┌──────────────────┐  ┌─────────────────────┐              │
│  │ static/index.html │  │ frontend/ (Vite+React)│ ◀── 当前   │
│  │ (server.py 挂载)  │  │ 现代 SPA 架构        │              │
│  └──────────────────┘  └─────────────────────┘              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 五、核心入口文件 HTML/JS 引用详情

### `app.py` (FastAPI — 主入口)

| 行号 | 引用内容 | 类型 |
|---|---|---|
| 10 | `from fastapi.responses import HTMLResponse` | 框架依赖 |
| 66 | `html_path = os.path.join(template_dir, "index.html")` | 模板路径 |
| 78-85 | `FALLBACK_HTML` — 内联 HTML fallback | 运行时 HTML |
| 89-90 | `Jinja2Templates(directory=template_dir)` — 延迟加载 | 模板引擎 |
| 119-278 | `FACTORY_HOME_HTML` — 工厂首页 (含内联 CSS/JS) | 运行时 HTML+JS |
| 125 | `<link rel="stylesheet" href="/static/styles/theme.css">` | CSS 引用 |
| 228-276 | 内联 `launchFactory()` JavaScript 函数 | 内联 JS |
| 283-385 | `TASK_DETAIL_HTML` — 任务详情页 (含内联 CSS/JS) | 运行时 HTML+JS |
| 289 | `<link rel="stylesheet" href="/static/styles/theme.css">` | CSS 引用 |
| 326-383 | 内联 `loadTaskDetail()` JavaScript 函数 | 内联 JS |
| 506 | `maneki_live.html` — 期望路径但文件不存在 | 缺失依赖 |

### `main.py` (TaskDispatcher)

| 行号 | 引用内容 | 类型 |
|---|---|---|
| — | **无任何前端引用** | 纯后端逻辑 |

### `factory_ui.py` (Streamlit Debug)

| 行号 | 引用内容 | 类型 |
|---|---|---|
| — | **无文件引用** — 仅 Streamlit st.* API | 调试面板 |

---

## 六、操作摘要

| 操作 | 文件 | 结果 |
|---|---|---|
| 🟢 保留 | `Maneki-AI/maneki.html` | 唯一前端页面，用户要求保留 |
| 🔴 冻结 | `ClawAI/clawwork_demo.html` → `clawwork_demo.html.bak.old` | 零引用，PoC Demo 遗留 |
| 🟡 建议 | `Maneki-AI/maneki_live.html` | 被 app.py 引用但文件不存在 → 建议将 `/live` 路由指向 `maneki.html` |

---

## 七、建议后续行动

1. **恢复就绪**：`ClawAI/clawwork_demo.html` 如需恢复，将 `.bak.old` 后缀移除即可
2. **深度清理**：确认 `clawwork_demo.html.bak.old` 长期无问题后，可考虑 `git rm` 彻底移除
3. **连接 `maneki.html`**：`app.py:506` 引用不存在的 `maneki_live.html`，建议将 `/live` 路由改为指向 `maneki.html`：`LIVE_FACTORY_HTML_PATH = os.path.join(base_dir, "maneki.html")`
4. **`ClawAI/index.html` (根目录)**：未被 Python 文件显式引用，可能为 standalone 文档入口，建议人工确认角色后决定去留
