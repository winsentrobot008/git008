# 🏭 Maneki-AI 系统架构报告 — 面向 Gemini 战略分析

> **生成时间**: 2026-06-05  
> **版本**: v0.4.0-live  
> **目标读者**: Gemini（战略与调度模型）  
> **用途**: 供 Gemini 全面理解 Maneki-AI 工厂操作系统的技术架构、数据流和集成点，以支持全局统筹、复杂逻辑拆解、状态监控与战略决策。

---

## 1. 执行摘要

Maneki-AI 是一个**多智能体自主业务生产工厂操作系统 (AI Factory OS)**，核心理念是"极简交互，极限执行"。用户输入商业目标，系统自动拆解任务、组建 AI 团队、执行逻辑并交付最终成果。

系统采用**双平面异步架构**：云端 Render（Issue 分发器）+ 本地执行引擎（自主执行），通过 GitHub Issues 作为持久化消息队列实现解耦。

当前自治度约 **35%**，已完成 ECC 编排、OpenClaw 执行、Agent-S 集成、财务清算引擎、军师智能体等核心模块。

---

## 2. 系统全景架构 — 双平面模型

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    MANEKI-AI ASYNC AI FACTORY                           │
│                       Two-Plane Architecture                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  🌐 PLANE 1: RENDER CLOUD (Issue Dispatcher & Web UI)                  │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │  FastAPI (app.py) :8000                                     │       │
│  │  ├── GET /factory       → 工厂首页 HTML                     │       │
│  │  ├── GET /live          → 实时工厂 WebSocket 页面           │       │
│  │  ├── POST /api/router   → 接收目标，生成 task_id，写 pending│       │
│  │  ├── POST /api/dispatch → AI 董事会路由（含风险评估）       │       │
│  │  ├── GET /api/tasks/:id → 任务详情 + 日志                  │       │
│  │  ├── GET /api/board     → AI 董事会状态                    │       │
│  │  ├── GET /api/settlement→ Success-Share 收益分成数据       │       │
│  │  ├── GET /api/stats     → 工厂统计                         │       │
│  │  ├── WS /ws             → WebSocket 实时生产流             │       │
│  │  ├── POST /api/broadcast→ 内部广播（供 ECC/OpenClaw 调用）│       │
│  │  └── Streamlit (streamlit_app.py / factory_ui.py)          │       │
│  │                                                             │       │
│  │  github_issue.py → GitHub Issues API 客户端                │       │
│  └──────────────────────────┬──────────────────────────────────┘       │
│                             │                                           │
│                             │ POST Issues to DevDirector-Tasks repo     │
│                             ▼                                           │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  GITHUB ISSUES (DevDirector-Tasks)                           │      │
│  │  • 持久化消息队列 • 可审计 • 零基础设施 • 免费               │      │
│  └──────────────────────────┬───────────────────────────────────┘      │
│                             │                                           │
│                             │ Poll for new Issues                       │
│                             ▼                                           │
│  🏭 PLANE 2: LOCAL MACHINE (Autonomous Execution Engine)               │
│  ┌─────────────────────────────────────────────────────────────┐       │
│  │  start_factory.py — 本地工厂编排器                          │       │
│  │  core/task_listener.py — 任务轮询器 (5s interval)           │       │
│  │    ├── Phase 1: RiskManager 安全检查                         │       │
│  │    ├── Phase 2: HQCommander 生成执行计划 (Claude API)       │       │
│  │    ├── Phase 3: WorkerExecutor + CircuitBreaker 执行        │       │
│  │    └── 写入日志 → N8N 回调                                  │       │
│  │                                                              │       │
│  │  workshop/ecc_core.py — ECC 中央神经系统                    │       │
│  │    ├── decompose() → 拆解任务为结构化步骤                    │       │
│  │    ├── orchestrate() → 全流程编排 + WebSocket 广播          │       │
│  │    └── Financial Clearing Engine 集成 (Success-Share)       │       │
│  │                                                              │       │
│  │  workshop/openclaw_core.py — OpenClaw 机械臂                │       │
│  │    ├── generate_command() → 映射动作到 CLI 命令              │       │
│  │    ├── execute() → subprocess 执行 + stdout/stderr 捕获     │       │
│  │    └── run_pipeline() → 顺序流水线（失败即停）              │       │
│  │                                                              │       │
│  │  agent_engine/ — Agent-S 侦察兵                              │       │
│  │    ├── bridge.py → Flask :5005 代理间桥接队列               │       │
│  │    ├── cline_daemon.py → 守护进程                            │       │
│  │    └── cline_worker.py → 浏览器自动化工作进程               │       │
│  │                                                              │       │
│  │  clearing_engine/ — 财务清算引擎                             │       │
│  │    ├── core.py → FinancialClearingEngine                     │       │
│  │    ├── models.py → TaskValuation, ProfitSplit, ServiceFee    │       │
│  │    ├── tracker.py → ValueTracker                             │       │
│  │    └── dashboard.py → Streamlit 仪表板                       │       │
│  │                                                              │       │
│  │  risk_manager.py — 风险断路器                                │       │
│  │    ├── 关键词黑名单 (rm -rf, drop table 等)                  │       │
│  │    └── 金融操作隔离 (需多重签名审批)                         │       │
│  └─────────────────────────────────────────────────────────────┘       │
│                                                                         │
│  🔄 完整流程:                                                           │
│  UI Trigger → GitHub Issue → Poll → Risk Check → HQ Plan →             │
│  CircuitBreaker → Worker Execute → ECC Orchestrate →                  │
│  Clearing Engine Settle → Log → N8N Callback                            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. 核心组件深度解析

### 3.1 FastAPI 控制中心 (`app.py`) — 云端入口

| 维度 | 描述 |
|------|------|
| **框架** | FastAPI (Python)，部署于 Render Cloud |
| **端口** | 8000 (HTTP) + WebSocket |
| **模板引擎** | Jinja2Templates（懒加载，fallback HTML 保证基座可用） |
| **静态文件** | /static → frontend/ 目录 |
| **生命周期** | `@asynccontextmanager lifespan`：启动时 spawn daemon 线程运行 `task_listener` |
| **WebSocket** | ConnectionManager 管理所有 WS 连接，支持 broadcast |

**关键路由矩阵**:
| 方法 | 端点 | 核心逻辑 | 集成点 |
|------|------|----------|--------|
| GET | `/` | 302 → `/factory` | — |
| GET | `/factory` | 返回内联 FACTORY_HOME_HTML | — |
| GET | `/live` | 读取 maneki_live.html 或 fallback | — |
| GET | `/task_detail` | 返回内联 TASK_DETAIL_HTML | — |
| POST | `/api/router` | 生成 FAC-{8位hex}，写 pending/ 目录 JSON | → task_listener 轮询 |
| POST | `/api/dispatch` | RiskManager.evaluate_task() → TaskDispatcher.route_task() | → main.py |
| GET | `/api/tasks/{id}` | 遍历 pending/processing/completed 查找任务 JSON + 日志 | — |
| GET | `/api/board` | 返回 `_board_state` 5 个模型的状态 | ECC orchestrate() 更新 |
| GET | `/api/settlement` | 聚合 board 数据 + 尝试加载 ClearingEngine 指标 | — |
| GET | `/api/stats` | 统计所有队列任务 + board 数据 | — |
| WS | `/ws` | ConnectionManager，支持 ping/pong、task_submitted、subscribe | ECC 通过 /api/broadcast 注入事件 |
| POST | `/api/broadcast` | 广播消息到所有 WS 客户端 | ECC/OpenClaw/TaskListener 内部调用 |

**全局状态 — `_board_state`**:
```python
{
    "deepseek": {"name": "DeepSeek",  "icon": "🔧", "role": "深度逻辑与架构",
                 "status": "idle", "tasks": 0, "completed": 0, "failed": 0,
                 "revenue": 0.0, "success_rate": 0},
    "gemini":   {"name": "Gemini",    "icon": "🧠", "role": "战略与调度",
                 ...},
    "doubao":   {"name": "Doubao",    "icon": "🎨", "role": "创意与本土化",
                 ...},
    "openai":   {"name": "OpenAI",    "icon": "📋", "role": "全球通用标准",
                 ...},
    "yuanbao":  {"name": "Yuanbao",   "icon": "🌐", "role": "生态整合",
                 ...},
}
```
该状态由 `update_board_member(model_key, **kwargs)` 函数在 ECC 任务完成时动态更新，并通过 `/api/board` 暴露给前端。

---

### 3.2 TaskDispatcher — AI 董事会路由矩阵 (`main.py`)

| 维度 | 描述 |
|------|------|
| **类** | `TaskDispatcher` |
| **枚举** | `AIModel`: GEMINI / DEEPSEEK / DOUBAO / YUANBAO / OPENAI |
| **数据类** | `Task(task_id, description, tags)` |
| **核心方法** | `route_task(task) → AIModel` |

**路由规则表**:
| 标签 (tag) | 目标模型 | 职责 |
|------------|----------|------|
| `strategy`, `orchestration` | GEMINI | 全局统筹，复杂逻辑拆解与状态监控 |
| `code`, `logic` | DEEPSEEK | 高性能代码开发、架构设计与数学逻辑推演 |
| `creative`, `marketing` | DOUBAO | 中文互联网传播、内容钩子与营销策划 |
| `social` | YUANBAO | 国内生态交互、社交数据链路整合 |
| `audit`, `standardization` | OPENAI | 标准化编程架构与复杂逻辑审计支持 |
| *(default / no match)* | GEMINI | 默认由 Gemini 作为战略调度器处理 |

**路由逻辑**:
1. 遍历 `task.tags` 列表
2. 对每个 tag，查找 `self.routing_rules` 字典匹配（大小写不敏感）
3. 首个匹配即返回
4. 无匹配 → 默认路由到 GEMINI

---

### 3.3 ECC Engine — 中央神经系统 (`workshop/ecc_core.py`)

| 维度 | 描述 |
|------|------|
| **类** | `ECCEngine` |
| **角色** | 任务拆解、上下文管理、依赖排序、编排执行、结算触发 |
| **核心方法** | `orchestrate(task_description, task_value, task_category, task_costs, time_saved, service_tier, task_id, model_key) → dict` |

**`orchestrate()` 执行流程**:

```
Step 1: _broadcast_event("task_started")      → WebSocket 通知前端
Step 2: decompose(task_description)           → 拆解为 analyze/plan/execute/verify 四步
Step 3: _broadcast_event("ecc_decompose")     → WebSocket 通知步骤数
Step 4: build_context(steps)                  → 构建执行上下文
Step 5: for each step:
          _broadcast_event("agent_thinking")  → 实时思考日志
          run_step(step)                     → 执行单步
Step 6: 如果 task_value > 0 且 Clearing Engine 可用:
          clearing_engine.process_completed_task()  → Success-Share 结算
Step 7: _broadcast_event("settlement")        → WebSocket 通知结算
Step 8: _broadcast_event("task_completed")    → WebSocket 通知完成
Step 9: update_board_member()                 → 更新 AI 董事会状态
          ├── completed += 1
          ├── revenue += task_value
          ├── success_rate 重新计算
          └── status = "idle"
```

**Financial Clearing Engine 集成**:
- 构造函数中 `enable_clearing` 开关控制
- 按需 fallback：如果 Clearing Engine 不可用，简单 10% 服务费计算
- `get_success_metrics()` — 获取聚合指标
- `generate_report(period)` — 生成月/季报

**WebSocket 广播机制**:
- 通过 `_broadcast_event()` 内部调用 `http://localhost:8000/api/broadcast`
- 使用 httpx 客户端，2 秒超时，best-effort（失败不阻塞执行）

---

### 3.4 OpenClaw Executor — 机械臂 (`workshop/openclaw_core.py`)

| 维度 | 描述 |
|------|------|
| **类** | `OpenClawExecutor` |
| **角色** | CLI 命令生成、subprocess 执行、输出捕获 |
| **核心方法** | `generate_command(action, target)`, `execute(command, cwd)`, `run_pipeline(commands[])` |

**命令映射表**:
| 动作 | CLI 命令 |
|------|----------|
| `deploy` | `python scripts/trigger_deploy.py` |
| `build` | `python app.py` |
| `test` | `python -m pytest agent_engine/tests/` |
| `start` | `python start_factory.py` |
| `analyze` | `python analyst/strategist_agent.py` |
| `scan` | `python radar/tavily_client.py` |
| `report` | `python warroom/report_generator.py` |

**执行特性**:
- `subprocess.run()` with `shell=True`, `capture_output=True`, `text=True`
- 默认超时 300 秒
- 返回结构化结果: command, returncode, stdout, stderr, success, timestamp
- `run_pipeline()` 顺序执行，遇到失败立即停止

---

### 3.5 Task Listener — 任务轮询器 (`core/task_listener.py`)

| 维度 | 描述 |
|------|------|
| **角色** | 本地执行引擎的入口，持续轮询 pending 队列 |
| **轮询间隔** | 5 秒 |
| **队列目录** | `task_queue/pending/` → `processing/` → `completed/` |

**完整执行管道 (Phase 5)**:

```
发现任务文件 (pending/*.json)
    │
    ▼
move_file → processing/
    │
    ▼
parse_task(processing_path)
    │
    ▼
Phase 1: RiskManager.evaluate_task(goal)
    ├── 如果 blocked → 写日志 → 状态报告 → N8N 回调 → move to completed/
    └── 如果 safe → 继续
    │
    ▼
Phase 2: HQCommander.generate_plan(goal)     ← Claude API
    ├── 生成执行计划（task_id, steps, status）
    └── 如果 error → 写日志 → 失败报告 → move to completed/
    │
    ▼
Phase 3: WorkerExecutor + CircuitBreaker     ← DeepSeek API
    ├── CircuitBreaker: 安全熔断保护
    ├── WorkerExecutor.execute_plan(plan)
    └── 返回结果 (status, steps_completed, steps_total, aggregate_output)
    │
    ▼
write_task_log(task_id, log_lines)
    │
    ▼
write_status_report(task_id, SUCCESS/PARTIAL/FAILED)
    │
    ▼
send_callback(task_id) → N8N_CALLBACK_URL (如果配置)
    │
    ▼
move_file → completed/
```

**回调机制**:
- 环境变量 `N8N_CALLBACK_URL` 配置
- 使用 `urllib.request` 发送 JSON POST
- 10 秒超时

---

### 3.6 Agent-S Bridge — 代理间桥接 (`agent_engine/bridge.py`)

| 维度 | 描述 |
|------|------|
| **框架** | Flask |
| **端口** | 5005 |
| **数据存储** | 文件系统 JSON (`bridge_queue.json`, `bridge_results.json`) |

**端点**:
| 方法 | 端点 | 功能 |
|------|------|------|
| POST | `/send` | 将任务 payload 追加到 bridge_queue.json |
| POST | `/results` | 将执行结果追加到 bridge_results.json |
| GET | `/queue` | 读取当前队列 |

这是 Agent-S (浏览器代理) 与 ECC/OpenClaw 之间的通信桥梁。Agent-S 通过此桥接队列接收导航/交互任务，并通过 `/results` 回传情报收集结果。

---

### 3.7 Financial Clearing Engine — 财务清算引擎 (`clearing_engine/core.py`)

| 维度 | 描述 |
|------|------|
| **类** | `FinancialClearingEngine` |
| **业务模型** | Success-Share 收益分成 |
| **核心流程** | valuate → settle → track → report |

**服务层级 (ServiceTier)**:
| 层级 | 费率 | 适用场景 |
|------|------|----------|
| CORE | 10% | 基础任务执行 — 单代理操作 |
| PREMIUM | 20% | 多代理编排 + 战略规划 |
| ENTERPRISE | 30% | 全工厂流水线 (ECC + OpenClaw + Agent-S) |

**核心数据模型** (`models.py`):
- `TaskValuation`: 任务估值 (estimated_value, actual_value, cost_incurred, time_saved_hours, quality_score, ROI)
- `ProfitSplit`: 利润分成 (gross_value, net_profit, service_charge, client_share, factory_share)
- `ServiceFee`: 服务费结构 (percentage, tier)
- `SuccessMetrics`: 聚合指标 (total_value_generated, total_costs, total_fees, total_client_savings, avg_roi, success_rate)
- `GrowthRecord`: 跨周期增长记录

**主要 API**:
- `process_completed_task(task_id, category, estimated_value, ...)` — 一站式处理
- `get_metrics_dict()` — 获取仪表板数据（含格式化 display 字典）
- `generate_period_report(period)` — 生成月/季报（含环比增长）
- `cli_report(period)` — CLI 接口

**ECC 集成点**:
- ECC.orchestrate() 在任务完成后自动调用 `process_completed_task()`
- 按需 fallback：如果 Clearing Engine 导入失败，使用简单 10% 费率

---

### 3.8 RiskManager — 风险断路器 (`risk_manager.py`)

| 维度 | 描述 |
|------|------|
| **类** | `RiskManager` |
| **方法** | `evaluate_task(task_description) → (bool, str)` |

**安全规则**:
1. **关键词黑名单**: 阻截 `rm -rf`, `drop table`, `private_key`, `transfer_all`
2. **金融隔离**: 包含 `transfer` 或 `pay` 关键词 → 要求多重签名人工审批
3. **默认**: 通过 → `(True, "Task Passed Risk Assessment.")`

**调用点**:
- `app.py` → `POST /api/dispatch` → `risk_manager.evaluate_task()`
- `core/task_listener.py` → `process_task()` Phase 1

---

### 3.9 扩展模块一览

| 模块 | 路径 | 角色 | 状态 |
|------|------|------|------|
| **军师智能体** | `analyst/strategist_agent.py` | 战略分析与推荐 | ✅ 已实现 |
| **Tavily 搜索** | `radar/tavily_client.py` | 外部信号扫描 | ✅ 已实现 |
| **多源融合** | `radar/synthesizer.py` | 情报合成 | ✅ 已实现 |
| **报告生成** | `warroom/report_generator.py` | 情报简报输出 | ✅ 已实现 |
| **HQ 指挥官** | `hq/commander.py` | Claude API 生成执行计划 | ✅ 已实现 |
| **熔断器** | `safety/circuit_breaker.py` | 安全熔断保护 | ✅ 已实现 |
| **Worker 执行器** | `worker/executor.py` | DeepSeek API 执行 | ✅ 已实现 |
| **AI 总监编排** | `agents/orchestrator.py` | 任务队列处理编排 | ✅ 已实现 |
| **Streamlit 仪表板** | `streamlit_app.py` | 招财猫情报局 | ✅ 已实现 |
| **工厂 UI** | `factory_ui.py` | Streamlit 工厂触发界面 | ✅ 已实现 |
| **部署钩子** | `scripts/trigger_deploy.py` | Render 部署触发 | ✅ 已实现 |
| **隧道服务** | `scripts/start_tunnel.py` | localtunnel 内网穿透 | ✅ 已实现 |

---

## 4. 数据流与任务生命周期

### 4.1 任务完整生命周期

```
┌──────────────────────────────────────────────────────────────────┐
│                      TASK LIFECYCLE                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [CREATED]                                                       │
│     │  用户通过 Factory UI 提交商业目标                          │
│     │  POST /api/router → 生成 FAC-XXXXXXXX                      │
│     │  写入 task_queue/pending/task_{id}.json                    │
│     ▼                                                            │
│  [PENDING]                                                       │
│     │  task_listener 轮询发现（5s 间隔）                         │
│     ▼                                                            │
│  [PROCESSING]                                                    │
│     │  move → task_queue/processing/                             │
│     │  Phase 1: RiskManager 安全检查                             │
│     │  Phase 2: HQCommander 生成计划 (Claude)                    │
│     │  Phase 3: WorkerExecutor 执行 (DeepSeek + CircuitBreaker)  │
│     │  ECC.orchestrate() 编排                                    │
│     │  ClearingEngine 结算 (Success-Share)                       │
│     ▼                                                            │
│  [COMPLETED]                                                     │
│     │  move → task_queue/completed/                              │
│     │  写入 logs/task_{id}.log                                   │
│     │  写入 logs/task_{id}_report.json                           │
│     │  N8N 回调 (如配置)                                         │
│     │  WebSocket 广播最终状态                                    │
│     ▼                                                            │
│  [ARCHIVED]                                                      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 任务 JSON 格式

```json
{
  "task_id": "FAC-A1B2C3D4",
  "status": "PENDING",
  "parameters": {
    "script_name": "factory_goal",
    "goal": "帮我设计一个 AI 视频出海的推广方案"
  },
  "result_log": null,
  "created_at": "2026-06-05T05:00:00Z",
  "updated_at": "2026-06-05T05:00:00Z"
}
```

---

## 5. AI 董事会多模型路由机制

### 5.1 路由决策树

```
                    输入: Task(description, tags)
                               │
                               ▼
                    ┌─────────────────────┐
                    │ RiskManager         │
                    │ evaluate_task()     │
                    └──────┬──────────────┘
                           │
                    ┌──────▼──────┐
                    │ is_safe?    │
                    └──────┬──────┘
                      No   │   Yes
                    ┌──────▼──────┐
                    │ BLOCKED     │     ┌─────────────────────┐
                    │ return 403  │     │ TaskDispatcher      │
                    └─────────────┘     │ route_task()        │
                                        └──────┬──────────────┘
                                               │
                                       遍历 tags 匹配路由规则
                                               │
                              ┌────────────────┼────────────────┐
                              ▼                ▼                ▼
                         strategy/       code/logic        creative/
                        orchestration       → DEEPSEEK    marketing
                          → GEMINI                        → DOUBAO
                              │                │                │
                              ▼                ▼                ▼
                        social          audit/           (no match)
                        → YUANBAO     standardization     → GEMINI
                                      → OPENAI           (default)
```

### 5.2 各模型角色矩阵

| 模型 | 代号 | 角色 | 适用场景 | 优势领域 |
|------|------|------|----------|----------|
| **Gemini** | 🧠 战略调度 | 全局统筹、拆解、监控 | 多步复杂任务、跨模型编排 | 长上下文、结构化推理 |
| **DeepSeek** | 🔧 逻辑引擎 | 代码生成、架构设计 | 高性能后端、算法优化 | 代码生成能力、数学推理 |
| **Doubao** | 🎨 创意引擎 | 本土化内容创作 | 中文营销、社交媒体 | 中文创意、文化理解 |
| **Yuanbao** | 🌐 生态整合 | 社交数据链路 | 国内平台交互 | 生态系统集成 |
| **OpenAI/Claude** | 📋 标准审计 | 标准化编码、审计 | 合规检查、代码审查 | 通用规范、审计能力 |

---

## 6. 部署架构

### 6.1 Render Cloud (Plane 1)

```
Render Cloud
├── FastAPI (app.py) :8000
│   ├── 入口: uvicorn app:app --host 0.0.0.0 --port $PORT
│   ├── 配置: render.yaml
│   ├── 运行时: runtime.txt (Python 3.12+)
│   └── 依赖: requirements.txt
├── Streamlit (streamlit_app.py / factory_ui.py)
└── GitHub Issues (DevDirector-Tasks)
    └── 作为持久化消息总线
```

### 6.2 Local Machine (Plane 2)

```
Local Machine (Windows/Linux/Mac)
├── start_factory.py           ← 一站式启动器
│   ├── API Gateway :8000
│   ├── Task Listener (daemon thread)
│   └── Tunnel (localtunnel)
├── workshop/                  ← 引擎核心
│   ├── ecc_core.py
│   └── openclaw_core.py
├── agent_engine/              ← Agent-S
│   └── bridge.py :5005
├── clearing_engine/           ← 财务清算
└── task_queue/
    ├── pending/
    ├── processing/
    └── completed/
```

### 6.3 环境变量

| 变量 | 必需 | 用途 |
|------|------|------|
| `GITHUB_TOKEN` | ✅ | GitHub PAT (gist + repo:issues) |
| `MANEKI_TUNNEL_GIST_ID` | ✅ | 隧道 URL 公告板 Gist ID |
| `MANEKI_ENABLE_TUNNEL` | ❌ | 禁用隧道 (默认 1) |
| `MANEKI_TUNNEL_PORT` | ❌ | 隧道端口 (默认 8000) |
| `API_GATEWAY_URL` | ❌ | 静态回退 URL |
| `TAVILY_API_KEY` | ❌ | Tavily 搜索 API |
| `N8N_CALLBACK_URL` | ❌ | n8n 回调 URL |
| `PORT` | ❌ | HTTP 端口 (默认 8000) |

---

## 7. 关键技术决策与设计模式

| 决策 | 理由 | 利弊 |
|------|------|------|
| **GitHub Issues 作为消息总线** | 零基础设施、持久化、可审计、免费 | ✅ 无需 RabbitMQ/Redis/SQS<br>⚠️ API 限流风险 |
| **双平面解耦** | 云端和本地独立运行、独立更新 | ✅ 容错性强<br>⚠️ 调试复杂度增加 |
| **离线韧性** | 离线时任务累积，重连后批量处理 | ✅ 本地开发友好<br>⚠️ 积压可能导致延迟 |
| **文件系统任务队列** | pending/ → processing/ → completed/ 目录 | ✅ 简单直观<br>⚠️ 无并发锁机制 |
| **WebSocket 实时流** | ConnectionManager + broadcast | ✅ 实时反馈<br>⚠️ 仅内存状态，重启丢失 |
| **懒加载服务** | 首个 API 调用时初始化 Dispatcher/RiskManager | ✅ 避免导入时崩溃 |
| **Best-effort 广播** | WebSocket 广播失败不阻塞执行 | ✅ 核心任务不受影响 |
| **多模型标签路由** | 基于 tags 自动匹配模型 | ✅ 灵活可扩展<br>⚠️ 需手动标记任务 |

---

## 8. 技术栈总览

| 层级 | 技术 |
|------|------|
| **Web 框架** | FastAPI (app.py), Flask (bridge.py) |
| **ASGI 服务器** | Uvicorn |
| **前端** | 内联 HTML/CSS/JS + Jinja2 + Streamlit |
| **任务调度** | 文件系统队列 + 线程轮询 |
| **消息总线** | GitHub Issues API |
| **实时通信** | WebSocket (FastAPI native) |
| **AI 模型** | Gemini, DeepSeek, Doubao, Yuanbao, OpenAI/Claude |
| **内网穿透** | localtunnel (npx) |
| **部署** | Render Cloud + 本地机器 |
| **数据持久化** | JSON 文件系统 + GitHub Issues |
| **搜索** | Tavily API |
| **回调** | N8N Webhook |

---

## 9. 当前状态与路线图

### 9.1 已完成 (阶段 1-3)

- [x] ECC 核心引擎 — 任务分解与编排
- [x] OpenClaw 核心引擎 — CLI 命令生成与执行
- [x] Agent-S 集成 — 桥接队列与浏览器自动化
- [x] API 网关 — HTTP 端点 + WebSocket 实时流
- [x] 任务监听器 — 轮询队列 + HQ- Worker-Safety 三阶段执行
- [x] Web 仪表板 — 工厂首页 + 实时工厂 + 任务详情
- [x] 隧道服务 — localtunnel 内网穿透
- [x] Financial Clearing Engine — Success-Share 自动收益分成
- [x] 服务层级 — Core / Premium / Enterprise
- [x] 增长追踪 — 跨周期效率对比
- [x] 军师智能体 — 战略分析与推荐
- [x] Tavily 搜索集成 — 外部信号扫描
- [x] 多源数据融合 — 情报合成
- [x] 报告生成 — 情报简报输出

### 9.2 待完成 (阶段 4: 生产就绪)

- [ ] 完整测试套件覆盖
- [ ] 错误处理与恢复机制增强
- [ ] 多用户支持
- [ ] 任务优先级调度
- [ ] 实时 WebSocket 通知 (增强)
- [ ] 并发任务锁机制 (文件系统队列)
- [ ] GitHub API 限流处理

---

## 10. 集成点总结 — 供 Gemini 调度参考

作为战略调度器，Gemini 需要关注以下关键集成点：

| 集成点 | 文件 | 接口 | Gemini 角色 |
|--------|------|------|-------------|
| **任务路由** | `main.py` | `TaskDispatcher.route_task()` | `strategy` / `orchestration` 标签自动路由到 Gemini |
| **AI 董事会状态** | `app.py` | `_board_state` / `update_board_member()` | 由 ECC 在任务完成后更新 Gemini 的 completed/revenue/success_rate |
| **ECC 编排** | `workshop/ecc_core.py` | `ECCEngine.orchestrate(model_key="gemini")` | 当任务分配给 Gemini 时，ECC 以 gemini 身份执行编排 |
| **WebSocket 事件** | `app.py` | `WS /ws` → `task_submitted` | 如果 task_submitted 未指定 model，按 task_id hash 自动分配 |
| **策略分析** | `analyst/strategist_agent.py` | CLI: `python analyst/strategist_agent.py` | Gemini 可通过 OpenClaw 触发军师智能体 |
| **报告生成** | `warroom/report_generator.py` | CLI: `python warroom/report_generator.py` | Gemini 可触发情报简报生成 |
| **信号扫描** | `radar/tavily_client.py` | CLI: `python radar/tavily_client.py` | Gemini 可触发外部情报扫描 |

---

## 11. 附录：关键文件路径索引

```
Maneki-AI/
├── app.py                     # FastAPI 控制中心 — 云端入口 (751 行)
├── main.py                    # TaskDispatcher — AI 模型路由矩阵 (70 行)
├── risk_manager.py            # RiskManager — 风险断路器 (20 行)
├── commands.json              # 系统任务注册表 — 13 个注册任务
├── start_factory.py           # 本地工厂编排器
├── run_task.py                # 执行流水线
├── github_issue.py            # GitHub Issues API 客户端
├── render.yaml                # Render 部署配置
├── requirements.txt           # Python 依赖
├── runtime.txt                # Python 版本
├── .env.example               # 环境变量模板
├── workshop/
│   ├── ecc_core.py            # ECC Engine — 中央神经系统 (245 行)
│   ├── openclaw_core.py       # OpenClaw Executor — 机械臂 (84 行)
│   └── factory_integration_map.json
├── clearing_engine/
│   ├── core.py                # FinancialClearingEngine (330 行)
│   ├── models.py              # 数据模型
│   ├── tracker.py             # ValueTracker
│   └── dashboard.py           # Streamlit 仪表板组件
├── agent_engine/
│   ├── bridge.py              # Flask 桥接服务器 :5005 (49 行)
│   ├── cline_daemon.py        # Agent-S 守护进程
│   └── cline_worker.py        # Agent-S 工作进程
├── core/
│   ├── api_gateway.py         # HTTP API 网关
│   └── task_listener.py       # 任务队列轮询器 (251 行)
├── analyst/
│   ├── base.py                # 基础智能体抽象类
│   └── strategist_agent.py    # 军师智能体
├── radar/
│   ├── tavily_client.py       # Tavily 搜索客户端
│   └── synthesizer.py         # 多源数据融合
├── warroom/
│   └── report_generator.py    # 情报简报生成器
├── agents/
│   └── orchestrator.py        # AI 总监编排器
├── hq/
│   └── commander.py           # HQ 指挥官 (Claude API)
├── safety/
│   └── circuit_breaker.py     # 安全熔断器
├── worker/
│   └── executor.py            # Worker 执行器 (DeepSeek API)
├── task_queue/
│   ├── pending/               # 待处理
│   ├── processing/            # 处理中
│   └── completed/             # 已完成
├── logs/                      # 执行日志
├── config/
│   └── settings.yaml          # 系统设置
├── reports/                   # 情报简报输出
├── templates/
│   └── index.html             # 控制中心 HTML
├── frontend/                  # 静态资源 (CSS/JS)
└── scripts/
    ├── start_tunnel.py        # localtunnel 隧道
    ├── trigger_deploy.py      # Render 部署钩子
    └── test_factory_startup.py # 启动测试
```

---

> **报告结束**  
> *Maneki-AI Architecture Report for Gemini — 供战略调度与全局统筹参考*