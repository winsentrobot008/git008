# 🏭 Maneki-AI Factory: 全自动智能业务引擎

Maneki-AI 是一个基于"多智能体协作"逻辑构建的**自主业务生产工厂操作系统（AI Factory OS）**。它将复杂的技术架构隐藏在极简的交互界面之下，让每个人都能指挥一支由全球顶级 AI 模型组成的"梦之队"来执行端到端的业务流。

> **版本**: v0.3.0-factory · **架构**: Async AI Factory · **自治度**: 35% Built

---

## 📋 目录

1. [核心经营哲学](#-核心经营哲学)
2. [AI 董事会](#-ai-董事会-多模型架构)
3. [系统架构](#-系统架构)
4. [核心引擎组件](#-核心引擎组件)
5. [商业模式](#-商业模式-收益分成-success-share)
6. [扩展模块](#-扩展模块)
7. [项目结构](#-项目结构)
8. [快速开始](#-快速开始)
9. [开发路线图](#-开发路线图)

---

## 💡 核心经营哲学

**"极简交互，极限执行"**

你无需配置模型参数，无需管理代码环境。只需输入你的商业目标，Maneki-AI 工厂将自动拆解任务、组建 AI 团队、执行逻辑并交付最终成果。

### 核心链路

```
用户 → Maneki-AI → AI 总监 → ECC → OpenClaw / Agent-S
```

| 层级 | 角色 | 职责 |
|------|------|------|
| **用户层** | 任务发布者 | 发布任务、查看状态、干预执行 |
| **Maneki-AI（总部 HQ）** | 控制台 | 用户系统、任务调度、Worker 管理、链路可视化 |
| **AI 总监（AI Director）** | 决策层 | 理解任务、拆解计划、决定执行策略 |
| **ECC（中央神经系统）** | 编排层 | 任务分解、依赖排序、结果验证 |
| **OpenClaw（机械臂）** | 执行层 | CLI 命令、文件操作、代码转换 |
| **Agent-S（侦察兵）** | 外部层 | 网页导航、SaaS 交互、情报收集 |

### 设计原则

- **零基础设施消息总线**：GitHub Issues 作为持久化、可审计、免费的异步消息队列
- **解耦调度与执行**：云端和本地独立运行，互不影响
- **离线韧性**：本地离线时任务自动累积，重连后批量处理
- **自纠正闭环**：失败自动重试、绕行、升级或终止

---

## 🤖 AI 董事会 (多模型架构)

Maneki-AI 动态路由任务，为每一项工作分配最合适的"首席专家"：

| 模型 | 代号 | 职责 |
|------|------|------|
| **Gemini** | 🧠 战略与调度 | 全局统筹，复杂逻辑拆解与状态监控 |
| **DeepSeek** | 🔧 深度逻辑与架构 | 高性能代码开发、架构设计与数学逻辑推演 |
| **豆包/Doubao** | 🎨 创意与本土化 | 中文互联网传播、内容钩子与营销策划 |
| **元宝/Yuanbao** | 🌐 生态整合 | 国内生态交互、社交数据链路整合 |
| **OpenAI/Claude** | 📋 全球通用标准 | 标准化编程架构与复杂逻辑审计支持 |

### 任务路由机制

任务通过标签（tags）自动路由到最合适的 AI 模型：

| 标签 | 路由目标 |
|------|----------|
| `strategy`, `orchestration` | Gemini |
| `code`, `logic` | DeepSeek |
| `creative`, `marketing` | Doubao |
| `social` | Yuanbao |
| `audit`, `standardization` | OpenAI/Claude |

---

## ⚙️ 系统架构

### 双平面架构

Maneki-AI 采用异步的 **"GitHub-Driven Dispatch"** 模型，系统解耦为两个独立平面：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      ASYNC AI FACTORY — TWO PLANES                           │
│                                                                               │
│   🌐 RENDER CLOUD (Issue Dispatcher)                                         │
│   ┌──────────────────────────────────────────┐                               │
│   │  • Streamlit Dashboard (app.py)          │                               │
│   │  • factory_ui.py — UI trigger interface  │                               │
│   │  • github_issue.py — Issue creation API  │                               │
│   │                                          │                               │
│   │  Role: Accept user input, create GitHub  │                               │
│   │  Issues as production orders             │                               │
│   └──────────────────┬───────────────────────┘                               │
│                      │                                                       │
│                      │ POST /repos/DevDirector-Tasks/issues                  │
│                      ▼                                                       │
│              ┌──────────────────┐                                            │
│              │  GitHub Issues   │  Durable, auditable, async message queue   │
│              │  DevDirector-    │                                            │
│              │  Tasks           │                                            │
│              └────────┬─────────┘                                            │
│                       │                                                     │
│                       │ Poll for new Issues                                  │
│                       ▼                                                     │
│   🏭 LOCAL MACHINE (Autonomous Execution Engine)                             │
│   ┌──────────────────────────────────────────┐                               │
│   │  • core/task_listener.py — polls repo    │                               │
│   │  • run_task.py — execution pipeline      │                               │
│   │  • commands.json — task registry         │                               │
│   │  • workshop/ — ECC & OpenClaw engines    │                               │
│   │  • agent_engine/ — Agent-S integration   │                               │
│   │  • clearing_engine/ — Financial settlement│                              │
│   │                                          │                               │
│   │  Role: Detect orders, strategize via     │                               │
│   │  ECC, execute via OpenClaw, scout via    │                               │
│   │  Agent-S, settle via Clearing Engine     │                               │
│   └──────────────────────────────────────────┘                               │
│                                                                               │
│   🔄 The Flow: UI Trigger → GitHub Issue → Poll → Strategize → Execute →     │
│                  Verify → Settle → Log                                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### API 网关端点

| 方法 | 端点 | 来源 | 描述 |
|------|------|------|------|
| POST | `/api/dispatch` | Web UI | 分发任务到 AI 董事会（含风险评估） |
| POST | `/api/task` | n8n/Agent-S | 注入任务到待处理队列（严格验证） |
| POST | `/api/submit-task` | Web UI | 提交任务 → 状态 PENDING |
| GET | `/api/tasks` | Web UI | 列出所有任务及状态 |
| GET | `/api/tasks/{id}` | Web UI | 获取任务详情 + 报告 + 日志 |
| GET | `/api/health` | 任意 | 健康检查 |
| GET | `/` | 浏览器 | HTML 控制中心页面 |

### 关键设计决策

| 决策 | 理由 |
|------|------|
| **GitHub Issues 作为消息总线** | 零基础设施、持久化、可审计、免费 — 无需 RabbitMQ、Redis 或 SQS |
| **解耦调度与执行** | 云端和本地独立运行；各自可独立更新或重启 |
| **离线韧性** | 本地离线时任务累积；重连后批量处理积压任务 |
| **无隧道依赖** | 隧道仅用于实时流和回调，任务调度不依赖隧道 |

---

## 🧠 核心引擎组件

### 1. ECC（Execution Control Core）— 中央神经系统

**文件**: `workshop/ecc_core.py`

ECC 是工厂的**中央神经系统**，编排整个执行生命周期 — 从任务接收到完成。

| 功能 | 描述 |
|------|------|
| **任务分解** | 将高级生产请求分解为结构化、可执行的步骤 |
| **上下文管理** | 跨子任务维护执行上下文，确保连续性和状态感知 |
| **依赖排序** | 管理任务间依赖关系 — 确定执行顺序 |
| **安全编排** | 强制执行操作护栏，验证前置条件，防止不安全执行路径 |
| **策略指导** | 决定**做什么**和**何时做** — 工厂的"大脑" |
| **Success-Share 结算** | 任务完成后自动调用清算引擎进行收益分成 |

### 2. OpenClaw（"龙虾钳"）— 机械臂

**文件**: `workshop/openclaw_core.py`

OpenClaw 是工厂的**机械臂** — 专门与代码库直接交互的代理。

| 功能 | 描述 |
|------|------|
| **CLI 命令生成** | 将战术指令转化为精确的 CLI 命令 |
| **代码库交互** | 读取、写入和修改工作区文件 |
| **输出捕获** | 捕获 stdout、stderr、返回码和执行时间 |
| **任务抓取** | 从执行队列中拉取任务并针对文件系统执行 |
| **流水线执行** | 支持顺序执行命令流水线，失败即停止 |

### 3. Agent-S（"侦察兵/眼睛"）— 浏览器代理

**目录**: `agent_engine/`

Agent-S 是工厂的**侦察兵/眼睛** — 基于浏览器的自主代理。

| 功能 | 描述 |
|------|------|
| **网页导航** | 自主浏览网站、填写表单、从 Web 界面提取数据 |
| **SaaS 交互** | 通过 Web UI 与第三方平台交互（GitHub、Slack、Jira 等） |
| **情报收集** | 侦察外部信息源、监控仪表板、收集信号 |
| **桥接通信** | 通过 agent_engine 桥接队列与 ECC 和 OpenClaw 通信 |
| **外部操作** | 决定**看哪里**和**收集什么** — 工厂的"眼睛" |

### 4. Financial Clearing Engine — 财务清算中枢

**目录**: `clearing_engine/`

内置的 **"Success-Share"** 收益分成机制，自动从净利润中计算服务费用。

| 功能 | 描述 |
|------|------|
| **任务估值** | 基于业务影响对任务进行价值评估 |
| **自动利润分成** | 无需手动计费 — 费用自动计算 |
| **服务层级** | Core (10%) / Premium (20%) / Enterprise (30%) |
| **增长追踪** | 跨周期追踪效率提升和 ROI 变化 |
| **仪表板集成** | Streamlit 仪表板实时展示财务指标 |

### 5. 风险管理系统

**文件**: `risk_manager.py`

| 功能 | 描述 |
|------|------|
| **关键词黑名单** | 阻止危险操作（rm -rf、drop table 等） |
| **金融隔离检查** | 金融交易需要多重签名人工审批 |
| **任务安全评估** | 在分发前对每个任务进行安全评估 |

---

## 💰 商业模式: 收益分成 (Success-Share)

Maneki-AI 采用 **"收益分成"** 模式，将我们的利益与你的盈利能力直接绑定：

- **结果导向**：只有当你的业务产生价值时，我们才获取回报
- **自动分账清算**：内置的"财务清算中枢"会自动从净利润中计算并扣除服务比例
- **共享增长**：效率提升惠及客户和工厂双方

### 服务层级

| 层级 | 费率 | 适用场景 |
|------|------|----------|
| 🔧 **Core** | 10% | 基础任务执行 — 单代理操作 |
| ⚡ **Premium** | 20% | 多代理编排 + 战略规划 |
| 🏭 **Enterprise** | 30% | 全工厂流水线（ECC + OpenClaw + Agent-S） |

---

## 🔌 扩展模块

| 模块 | 路径 | 角色 |
|------|------|------|
| **`app.py`** | `./app.py` | FastAPI 控制中心 — 任务分发 + HTML 界面 |
| **`main.py`** | `./main.py` | 任务分发器 — AI 模型路由矩阵 |
| **`factory_ui.py`** | `./factory_ui.py` | Streamlit 工厂触发界面 |
| **`github_issue.py`** | `./github_issue.py` | GitHub API 客户端 — 创建 Issue |
| **`run_task.py`** | `./run_task.py` | 执行流水线 — 读取 commands.json，调度 CLI 命令 |
| **`start_factory.py`** | `./start_factory.py` | 本地工厂编排器 — 启动网关 + 监听器 + 隧道 |
| **`risk_manager.py`** | `./risk_manager.py` | 金融与运营风险断路器 |
| **`streamlit_app.py`** | `./streamlit_app.py` | 招财猫情报局 Streamlit 界面 |
| **`commands.json`** | `./commands.json` | 系统任务注册表 — 映射任务到 CLI 命令 |
| **`workshop/`** | `./workshop/` | 引擎核心 — ECC + OpenClaw + 集成映射 |
| **`agent_engine/`** | `./agent_engine/` | Agent-S 集成层 — 桥接队列、守护进程、工作进程 |
| **`clearing_engine/`** | `./clearing_engine/` | 财务清算引擎 — Success-Share 收益分成 |
| **`core/`** | `./core/` | 基础设施 — API 网关 + 任务监听器 |
| **`analyst/`** | `./analyst/` | 战略分析 — 军师智能体 |
| **`radar/`** | `./radar/` | 信号扫描 — Tavily 搜索 + 数据融合 |
| **`warroom/`** | `./warroom/` | 报告生成 — 情报简报生成器 |
| **`agents/`** | `./agents/` | AI 总监编排 — 任务队列处理 |
| **`scripts/`** | `./scripts/` | 工具脚本 — 隧道、部署、测试 |

---

## 📁 项目结构

```
Maneki-AI/
├── app.py                      # FastAPI 云端控制中心（Render 入口）
├── main.py                     # 任务分发器（AI 模型路由矩阵）
├── factory_ui.py               # Streamlit 工厂触发界面
├── github_issue.py             # GitHub API 客户端（Issue 创建）
├── run_task.py                 # 执行流水线（commands.json → subprocess）
├── start_factory.py            # 本地工厂编排器
├── streamlit_app.py            # 招财猫情报局 Streamlit 界面
├── risk_manager.py             # 金融与运营风险断路器
├── commands.json               # 系统任务注册表
├── render.yaml                 # Render 部署配置
├── requirements.txt            # Python 依赖
├── runtime.txt                 # Python 运行时版本
├── .env.example                # 环境变量模板
├── .clinerules                 # Cline 代理操作规则
│
├── workshop/                   # 引擎核心
│   ├── ecc_core.py             # ECC — 中央神经系统
│   ├── openclaw_core.py        # OpenClaw — 机械臂
│   └── factory_integration_map.json  # 依赖映射图
│
├── clearing_engine/            # 财务清算引擎
│   ├── __init__.py
│   ├── core.py                 # FinancialClearingEngine 核心
│   ├── models.py               # 数据模型（TaskValuation, ProfitSplit 等）
│   ├── tracker.py              # 价值追踪器
│   └── dashboard.py            # Streamlit 仪表板组件
│
├── agent_engine/               # Agent-S — 侦察兵/眼睛
│   ├── bridge.py               # 代理间桥接队列
│   ├── cline_daemon.py         # Agent-S 守护进程
│   ├── cline_worker.py         # Agent-S 工作进程
│   └── safety/                 # 浏览器安全协议
│
├── core/                       # 基础设施
│   ├── api_gateway.py          # HTTP API 网关（端口 8000）
│   └── task_listener.py        # 任务队列轮询器与执行器
│
├── analyst/                    # 战略分析
│   ├── __init__.py
│   ├── base.py                 # 基础智能体抽象类
│   └── strategist_agent.py     # 军师智能体
│
├── radar/                      # 信号扫描
│   ├── __init__.py
│   ├── tavily_client.py        # Tavily 搜索客户端
│   └── synthesizer.py          # 多源数据融合
│
├── warroom/                    # 报告生成
│   ├── __init__.py
│   └── report_generator.py     # 情报简报生成器
│
├── agents/                     # AI 总监编排
│   └── orchestrator.py         # 任务队列处理编排器
│
├── scripts/                    # 工具脚本
│   ├── start_tunnel.py         # localtunnel 隧道
│   ├── trigger_deploy.py       # Render 部署钩子触发
│   ├── example_worker.py       # 示例工作进程
│   └── test_factory_startup.py # 启动测试套件
│
├── task_queue/                 # 任务生命周期
│   ├── pending/                # 待处理任务
│   ├── processing/             # 处理中任务
│   └── completed/              # 已完成任务
│
├── logs/                       # 执行日志
├── config/                     # 应用配置
│   ├── env.template
│   └── settings.yaml           # 系统设置（关键词、阈值、数据源）
├── state/                      # 代理状态持久化
├── docs/                       # 文档
│   ├── PROJECT_OVERVIEW.md     # 项目说明书
│   └── WEB_ARCHITECTURE.md     # Web 前端架构文档
├── deliveries/                 # 任务交付物
├── reports/                    # 情报简报输出
├── templates/                  # HTML 模板
│   └── index.html              # 控制中心 HTML 页面
└── inject_button.ps1           # PowerShell 注入脚本
```

---

## 🚀 快速开始

### 前置条件

- Python 3.12+
- Node.js（用于 `npx localtunnel`）
- GitHub 账号，需 `GITHUB_TOKEN`（gist + repo:issues 权限）

### 设置

```bash
git clone https://github.com/winsentrobot008/Maneki-AI.git
cd Maneki-AI
pip install -r requirements.txt
cp .env.example .env
# 编辑 .env，填入 GITHUB_TOKEN 和 MANEKI_TUNNEL_GIST_ID
```

### 启动工厂

```bash
python start_factory.py
```

启动 API 网关（端口 8000）、任务监听器和本地隧道。

### 本地运行任务

```bash
python run_task.py <task_name> --log
```

可用任务：`deploy`、`build`、`test`、`start`、`analyze`、`scan`、`report`、`orchestrate`、`bridge`、`worker`、`settle`、`report-success`、`metrics`

### 打开仪表板

访问 **[https://maneki-ai.onrender.com/](https://maneki-ai.onrender.com/)** 调度生产订单。

### 必需的环境变量

| 变量 | 必需 | 用途 |
|------|------|------|
| `GITHUB_TOKEN` | ✅ **是** | GitHub PAT，需 `gist` 和 `repo:issues` 权限 |
| `MANEKI_TUNNEL_GIST_ID` | ✅ **是** | 隧道 URL 公告板的私有 Gist ID |
| `MANEKI_ENABLE_TUNNEL` | ❌ 否 | 设为 `0` 禁用隧道（默认：`1`） |
| `MANEKI_TUNNEL_PORT` | ❌ 否 | 隧道本地端口（默认：`8000`） |
| `API_GATEWAY_URL` | ❌ 否 | 静态回退隧道 URL |
| `TAVILY_API_KEY` | ❌ 否 | Tavily 搜索 API 密钥 |
| `N8N_CALLBACK_URL` | ❌ 否 | n8n 出站回调 URL |

---

## 🗺️ 开发路线图

### 阶段 1（当前）：Messenger-Agent（MSSAGENT 本地实现）
- [x] ECC 核心引擎 — 任务分解与编排
- [x] OpenClaw 核心引擎 — CLI 命令生成与执行
- [x] Agent-S 集成 — 桥接队列与浏览器自动化
- [x] API 网关 — HTTP 端点用于任务注入
- [x] 任务监听器 — 轮询待处理队列并执行
- [x] Web 仪表板 — Streamlit 前端用于任务调度
- [x] 隧道服务 — localtunnel 用于云端

### 阶段 2：Success-Share 财务清算
- [x] Financial Clearing Engine — 自动收益分成
- [x] 服务层级 — Core / Premium / Enterprise
- [x] 增长追踪 — 跨周期效率对比
- [x] 仪表板集成 — Streamlit 财务仪表板

### 阶段 3：战略分析与情报
- [x] 军师智能体 — 战略分析与推荐
- [x] Tavily 搜索集成 — 外部信号扫描
- [x] 多源数据融合 — 情报合成
- [x] 报告生成 — 情报简报输出

### 阶段 4：生产就绪
- [ ] 完整测试套件覆盖
- [ ] 错误处理与恢复机制增强
- [ ] 多用户支持
- [ ] 任务优先级调度
- [ ] 实时 WebSocket 通知

---

## 🌟 终极使命: 自动化普遍基本收入 (UBI)

Maneki-AI 工厂的建立基于一个信念：AI 驱动的生产力应当服务于全人类。

通过自动化复杂的业务生产，我们降低了创造经济价值的门槛。我们的终极目标是将过剩的生产力收益汇聚成一个可持续的生态系统，作为实现自动化 **普遍基本收入 (UBI)** 的技术原型。我们正在构建一个"工厂负责劳作，人类负责繁荣"的未来。
