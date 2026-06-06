# 🐱 Maneki-AI：AI 工厂操作系统（AI Factory OS）

> **版本**: v0.3.0-factory · **架构**: Async AI Factory · **自治度**: 35% Built

Maneki-AI 是一个面向开发者与团队的 **AI 工厂操作系统**，通过"多层智能 + 多 Worker 执行 + 可视化调度"的方式，将 AI 的能力从单点工具升级为可控的自动化工厂。

---

## 📋 目录

1. [核心愿景](#1-核心愿景)
2. [极简作业指南](#2-极简作业指南)
3. [系统架构](#3-系统架构)
4. [角色职能](#4-角色职能)
5. [标准作业流程](#5-标准作业流程)
6. [核心引擎组件](#6-核心引擎组件)
7. [工厂集成架构](#7-工厂集成架构)
8. [AI 编排策略](#8-ai-编排策略)
9. [Success-Share 财务清算](#9-success-share-财务清算)
10. [战略分析与情报](#10-战略分析与情报)
11. [扩展模块](#11-扩展模块)
12. [项目结构](#12-项目结构)
13. [快速开始](#13-快速开始)
14. [开发路线图](#14-开发路线图)

---

## 1. 核心愿景

### 1.1 使命

Maneki-AI 的目标**不是一个 AI 工具**，而是一个**可控、可扩展、可插拔的 AI 工厂操作系统（AI Factory OS）**。

### 1.2 核心链路

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

### 1.3 核心目标

通过 `DevDirector-Tasks` 队列实现**全自动代码生产与交付**，并通过 `Financial Clearing Engine` 实现**自动收益分成**。

### 1.4 设计原则

- **零基础设施消息总线**：GitHub Issues 作为持久化、可审计、免费的异步消息队列
- **解耦调度与执行**：云端和本地独立运行，互不影响
- **离线韧性**：本地离线时任务自动累积，重连后批量处理
- **自纠正闭环**：失败自动重试、绕行、升级或终止
- **结果导向计费**：Success-Share 模式 — 只有产生价值才收费

---

## 2. 极简作业指南

### 2.1 面向最终用户的操作协议

1. **输入意图**：在输入框说出你的目标（例如："帮我做一份 AI 视频出海的推广方案"）
2. **确认产出**：点击下方生成的唯一执行按钮（例如："开始一键生产"）
3. **获取成果**：系统自动完成从调研到交付的全流程，成果会直接通过 GitHub Issue 同步给你

### 2.2 机器执行规则

- 严禁擅自修改核心架构，所有变动需先更新依赖映射图
- 自动化失败时，直接回传报错 Issue 到 `DevDirector-Tasks`
- 操作严格限定在 `task_queue/`、`scripts/`、`logs/` 目录

---

## 3. 系统架构

### 3.1 双平面架构

Maneki-AI 采用异步的 **"GitHub-Driven Dispatch"** 模型，系统解耦为两个独立平面：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      ASYNC AI FACTORY — TWO PLANES                           │
│                                                                               │
│   🌐 RENDER CLOUD (Issue Dispatcher)                                         │
│   ┌──────────────────────────────────────────┐                               │
│   │  • FastAPI Control Center (app.py)       │                               │
│   │  • factory_ui.py — UI trigger interface  │                               │
│   │  • github_issue.py — Issue creation API  │                               │
│   │  • streamlit_app.py — 情报局界面          │                               │
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
│   │  • analyst/ — 战略分析                    │                               │
│   │  • radar/ — 信号扫描                      │                               │
│   │  • warroom/ — 报告生成                    │                               │
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

### 3.2 API 网关端点

| 方法 | 端点 | 来源 | 描述 |
|------|------|------|------|
| POST | `/api/dispatch` | Web UI | 分发任务到 AI 董事会（含风险评估） |
| POST | `/api/task` | n8n/Agent-S | 注入任务到待处理队列（严格验证） |
| POST | `/api/submit-task` | Web UI | 提交任务 → 状态 PENDING |
| GET | `/api/tasks` | Web UI | 列出所有任务及状态 |
| GET | `/api/tasks/{id}` | Web UI | 获取任务详情 + 报告 + 日志 |
| GET | `/api/health` | 任意 | 健康检查 |
| GET | `/` | 浏览器 | HTML 控制中心页面 |

### 3.3 关键设计决策

| 决策 | 理由 |
|------|------|
| **GitHub Issues 作为消息总线** | 零基础设施、持久化、可审计、免费 — 无需 RabbitMQ、Redis 或 SQS |
| **解耦调度与执行** | 云端和本地独立运行；各自可独立更新或重启 |
| **离线韧性** | 本地离线时任务累积；重连后批量处理积压任务 |
| **无隧道依赖** | 隧道仅用于实时流和回调，任务调度不依赖隧道 |

---

## 4. 角色职能

### 4.1 团队构成

| 角色 | 代号 | 职能 | 类比 |
|------|------|------|------|
| **ECC** | 🧠 大脑 | 任务分解与逻辑调度 | Central Nervous System |
| **OpenClaw** | 🔧 双手 | 代码落地与 Git 操作 | Lobster Claw (Mechanical Arm) |
| **Agent-S** | 👁️ 侦察兵 | 外部 SaaS 与 Web 交互 | Specialized Scout/Eye |
| **Financial Clearing Engine** | 💰 财务官 | 自动收益分成与结算 | CFO |
| **Risk Manager** | 🛡️ 安全官 | 任务安全评估与风险阻断 | Security Officer |
| **Strategist Agent** | 🧙 军师 | 战略分析与推荐 | Strategic Advisor |
| **Radar** | 📡 雷达 | 外部信号扫描与情报收集 | Intelligence Scout |

### 4.2 三层领域

| 领域 | 组件 | 范围 | 能力 |
|------|------|------|------|
| **🧠 策略** | **ECC** | 内部编排 | 任务分解、依赖排序、安全执行、结果验证 |
| **🔧 内部执行** | **OpenClaw** | 代码库操作 | CLI 命令、文件 I/O、代码转换、输出捕获 |
| **👁️ 外部情报** | **Agent-S** | Web 与 SaaS 环境 | 浏览器自动化、表单交互、数据提取、平台集成 |

---

## 5. 标准作业流程

### 5.1 完整执行流程

```
1. Dispatch     → factory_ui.py → github_issue.py → DevDirector-Tasks (GitHub Issue)
2. Poll & Ingest → core/task_listener.py → run_task.py
3. Strategize   → Agency-Agents analyze task, evaluate strategies
4. Decompose    → ECC receives task + strategic context → structured steps
5. Consult      → ECC & OpenClaw query Codex for documentation & patterns
6. Execute Int. → ECC → OpenClaw (ClawAI/HKUDS) → CLI/file operations
7. Execute Ext. → ECC → Agent-S → web navigation & SaaS interaction
8. Verify       → ECC collects results → validates → decides next action
9. Settle       → ECC → Financial Clearing Engine → Success-Share settlement
10. Log         → Structured execution log → logs/
```

### 5.2 数据流

```
User Input (UI)
      │
      ▼
factory_ui.py ──→ github_issue.py ──→ GitHub Issue (DevDirector-Tasks)
                                              │
                                              │ (poll)
                                              ▼
                                        core/task_listener.py
                                              │
                                              ▼
                                        run_task.py
                                              │
                              ┌───────────────┼───────────────┐
                              ▼               ▼               ▼
                         ECC (Brain)   OpenClaw (Claw)  Agent-S (Eye)
                         • Decompose    • Generate cmd   • Navigate web
                         • Sequence     • Execute        • Interact SaaS
                         • Verify       • Capture output • Gather intel
                              │               │               │
                              └───────────────┼───────────────┘
                                              │
                                              ▼
                                   Financial Clearing Engine
                                   • Valuate task
                                   • Calculate profit split
                                   • Record settlement
                                              │
                                              ▼
                                          logs/
```

### 5.3 三一协作模型

ECC、OpenClaw 和 Agent-S 作为紧密耦合的**三一体（Trinity）**运作：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ECC + OPENCLAW + AGENT-S TRINITY                       │
│                                                                           │
│   ┌─────────────────────────────────────────────────────────────┐        │
│   │                    ECC (The Brain)                            │        │
│   │                                                              │        │
│   │  1. Receive task from run_task.py                            │        │
│   │  2. Decompose into steps: analyze → plan → execute → verify  │        │
│   │  3. Determine step dependencies and ordering                 │        │
│   │  4. Dispatch internal steps to OpenClaw                      │        │
│   │  5. Dispatch external steps to Agent-S                       │        │
│   │  6. Verify results and decide next action                    │        │
│   │  7. Settle via Financial Clearing Engine                     │        │
│   └──────────┬──────────────────────────────────┬───────────────┘        │
│              │                                  │                         │
│              │ "Execute: deploy"                │ "Scout: check status"   │
│              ▼                                  ▼                         │
│   ┌─────────────────────┐          ┌──────────────────────┐              │
│   │  OpenClaw (The Claw)│          │ Agent-S (The Eye)    │              │
│   │                     │          │                      │              │
│   │  • CLI commands     │          │  • Web navigation    │              │
│   │  • File operations  │          │  • SaaS interaction  │              │
│   │  • Code transforms  │          │  • Data extraction   │              │
│   │  • Output capture   │          │  • Intel gathering   │              │
│   └──────────┬──────────┘          └──────────┬───────────┘              │
│              │                                  │                         │
│              └──────────┬───────────────────────┘                        │
│                         ▼                                                │
│   ┌─────────────────────────────────────────────────────────────┐        │
│   │              ECC (Verification Loop)                          │        │
│   │                                                              │        │
│   │  • Result OK    → proceed to next step or mark complete      │        │
│   │  • Result FAIL  → retry, escalate, or abort                  │        │
│   │  • All steps done → settle via Clearing Engine → write log   │        │
│   └─────────────────────────────────────────────────────────────┘        │
│                                                                           │
│   🧠 ECC directs the strategy (The "What" and "When")                    │
│   🔧 OpenClaw executes internal code operations (The "How" — inside)     │
│   👁️ Agent-S performs external web intelligence (The "Where" — outside)  │
│   💰 Clearing Engine settles the finances (The "Value" — profit split)   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 6. 核心引擎组件

### 6.1 ECC（Execution Control Core）— 中央神经系统

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

### 6.2 OpenClaw（"龙虾钳"）— 机械臂

**文件**: `workshop/openclaw_core.py`

OpenClaw 是工厂的**机械臂** — 专门与代码库直接交互的代理。

| 功能 | 描述 |
|------|------|
| **CLI 命令生成** | 将战术指令转化为精确的 CLI 命令 |
| **代码库交互** | 读取、写入和修改工作区文件 |
| **输出捕获** | 捕获 stdout、stderr、返回码和执行时间 |
| **任务抓取** | 从执行队列中拉取任务并针对文件系统执行 |
| **流水线执行** | 支持顺序执行命令流水线，失败即停止 |

### 6.3 Agent-S（"侦察兵/眼睛"）— 浏览器代理

**目录**: `agent_engine/`

Agent-S 是工厂的**侦察兵/眼睛** — 基于浏览器的自主代理。

| 功能 | 描述 |
|------|------|
| **网页导航** | 自主浏览网站、填写表单、从 Web 界面提取数据 |
| **SaaS 交互** | 通过 Web UI 与第三方平台交互（GitHub、Slack、Jira 等） |
| **情报收集** | 侦察外部信息源、监控仪表板、收集信号 |
| **桥接通信** | 通过 agent_engine 桥接队列与 ECC 和 OpenClaw 通信 |
| **外部操作** | 决定**看哪里**和**收集什么** — 工厂的"眼睛" |

### 6.4 Financial Clearing Engine — 财务清算中枢

**目录**: `clearing_engine/`

内置的 **"Success-Share"** 收益分成机制，自动从净利润中计算服务费用。

| 功能 | 描述 |
|------|------|
| **任务估值** | 基于业务影响对任务进行价值评估 |
| **自动利润分成** | 无需手动计费 — 费用自动计算 |
| **服务层级** | Core (10%) / Premium (20%) / Enterprise (30%) |
| **增长追踪** | 跨周期追踪效率提升和 ROI 变化 |
| **仪表板集成** | Streamlit 仪表板实时展示财务指标 |

### 6.5 Risk Manager — 风险管理系统

**文件**: `risk_manager.py`

| 功能 | 描述 |
|------|------|
| **关键词黑名单** | 阻止危险操作（rm -rf、drop table 等） |
| **金融隔离检查** | 金融交易需要多重签名人工审批 |
| **任务安全评估** | 在分发前对每个任务进行安全评估 |

---

## 7. 工厂集成架构

### 7.1 七组件集成架构

| # | 组件 | 来源 | 目录 | 角色 |
|---|------|------|------|------|
| 1 | **ECC** | `workshop/ecc_core.py` | `workshop/` | 🧠 中央神经系统 — 策略编排 |
| 2 | **OpenClaw** | `workshop/openclaw_core.py` | `workshop/` | 🔧 机械臂 — 代码库执行代理 |
| 3 | **Agent-S** | `agent_engine/` (Simular AI) | `agent_engine/` | 👁️ 侦察兵/眼睛 — 浏览器代理 |
| 4 | **Codex** | `oh-my-codex` | `workshop/lib/codex/` | 📚 文档与知识依赖 |
| 5 | **DevDirector-Tasks** | GitHub Issues | `winsentrobot008/DevDirector-Tasks` | 📨 中央 Issue 调度器（持久消息总线） |
| 6 | **Agency-Agents** | `agency-agents` | `workshop/ecc/strategy/` | 🧠 战略决策层 |
| 7 | **Clearing Engine** | `clearing_engine/core.py` | `clearing_engine/` | 💰 财务清算引擎 — Success-Share 收益分成 |

### 7.2 依赖映射

```
Layer 0 (Foundation):    DevDirector-Tasks ───── Codex
                                │                   │
                                │ dispatch          │ knowledge
                                ▼                   ▼
Layer 1 (Strategy):      ┌─────────────┐     Agency-Agents
                                │             │         │
                                │             │ strategic context
                                │             ▼
Layer 2 (Orchestration): │    ECC Core    │
                                │  ┌───────────┐ │
                                │  │ Decompose  │ │
                                │  │ Sequence   │ │
                                │  │ Verify     │ │
                                │  │ Settle     │ │
                                │  └─────┬─────┘ │
                                └────────┼────────┘
                                         │
                     ┌───────────────────┼───────────────────┐
                     │ consult           │ internal          │ external
                     ▼                   ▼                   ▼
Layer 3 (Execution):  Codex          OpenClaw           Agent-S
                                   ┌──────────┐      ┌──────────┐
                                   │ clawwork │      │ bridge   │
                                   │ hkuds    │      │ daemon   │
                                   └──────────┘      │ worker   │
                                                     └──────────┘
                                         │
                                         ▼
Layer 4 (Settlement):          Financial Clearing Engine
                                   ┌──────────────────┐
                                   │ Valuate → Split  │
                                   │ Settle → Record  │
                                   └──────────────────┘
```

### 7.3 完整架构图

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      MANEKI-AI FACTORY INTEGRATION ARCHITECTURE                  │
│                                                                                   │
│   🌐 RENDER CLOUD (Issue Dispatcher)                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐         │
│   │  app.py / factory_ui.py → github_issue.py → DevDirector-Tasks      │         │
│   │  (GitHub Issues)                                                    │         │
│   └──────────────────────────────────────────────────┬──────────────────┘         │
│                                                      │                             │
│                                                      ▼                             │
│   🏭 LOCAL FACTORY (Execution Engine)                                             │
│   ┌─────────────────────────────────────────────────────────────────────┐         │
│   │  ┌──────────────────────────────────────────────────────────────┐  │         │
│   │  │                    ECC (workshop/ecc_core.py)                 │  │         │
│   │  │  ┌─────────────────────────────────────────────────────────┐ │  │         │
│   │  │  │  Agency-Agents (workshop/ecc/strategy/)                 │ │  │         │
│   │  │  │  • Strategic analysis & risk evaluation                 │ │  │         │
│   │  │  │  • Multi-path recommendation                            │ │  │         │
│   │  │  └───────────────────────┬─────────────────────────────────┘ │  │         │
│   │  │                          │ strategic context                  │  │         │
│   │  │  ┌───────────────────────▼─────────────────────────────────┐ │  │         │
│   │  │  │  ECC Core — Decompose → Sequence → Verify → Settle     │ │  │         │
│   │  │  │  • Task decomposition into structured steps             │ │  │         │
│   │  │  │  • Dependency sequencing & safety enforcement           │ │  │         │
│   │  │  │  • Result verification & decision loop                  │ │  │         │
│   │  │  │  • Success-Share settlement via Clearing Engine         │ │  │         │
│   │  │  └──┬──────────────┬──────────────────┬───────────────────┘ │  │         │
│   │  │     │              │                  │                      │  │         │
│   │  │     │ consult      │ dispatch          │ dispatch            │  │         │
│   │  │     ▼              ▼                   ▼                     │  │         │
│   │  │  ┌────────┐ ┌────────────────┐ ┌────────────────────┐      │  │         │
│   │  │  │ Codex  │ │ OpenClaw       │ │ Agent-S            │      │  │         │
│   │  │  │(lib/   │ │(workshop/      │ │(agent_engine/)     │      │  │         │
│   │  │  │ codex/)│ │ openclaw_core) │ │ • bridge.py        │      │  │         │
│   │  │  │ • Docs │ │ • CLI gen/exec │ │ • cline_daemon.py  │      │  │         │
│   │  │  │ • Pats │ │ • File ops     │ │ • cline_worker.py  │      │  │         │
│   │  │  │ • Know │ │ • Pipeline     │ │ • Web nav/SaaS     │      │  │         │
│   │  │  └────────┘ └────────────────┘ └────────────────────┘      │  │         │
│   │  │                                                              │  │         │
│   │  │  ┌────────────────────────────────────────────────────────┐ │  │         │
│   │  │  │  Financial Clearing Engine (clearing_engine/)          │ │  │         │
│   │  │  │  • Task valuation → Profit split → Settlement record  │ │  │         │
│   │  │  │  • Growth tracking → Period reporting                 │ │  │         │
│   │  │  │  • Dashboard integration → Streamlit UI               │ │  │         │
│   │  │  └────────────────────────────────────────────────────────┘ │  │         │
│   │  └──────────────────────────────────────────────────────────────┘  │         │
│   └─────────────────────────────────────────────────────────────────────┘         │
│                                                                                   │
│   🔄 Flow: Dispatch → Strategize → Decompose → Consult → Execute → Verify →      │
│             Settle → Log                                                          │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. AI 编排策略

### 8.1 多模型编排模式

Maneki-AI 采用 **"多模型编排"** 模式，专门的 AI 总监与操作代理（ECC、OpenClaw、Agent-S）共存协作。

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MULTI-MODEL ORCHESTRATION PATTERN                          │
│                                                                               │
│   ┌──────────────────────────────────────────────────────────────────┐       │
│   │              ORCHESTRATOR (Project Director / General AI)          │       │
│   │                                                                   │       │
│   │  Role: High-Level Strategist                                      │       │
│   │  • Architectural design & requirement interpretation              │       │
│   │  • High-level task decomposition into mission directives          │       │
│   │  • Defines the "Battle Plan" from user intent                     │       │
│   │  • Adapts strategy in real-time based on agent feedback           │       │
│   └──────────────────────────┬────────────────────────────────────────┘       │
│                              │                                               │
│                              │ delegates granular steps                      │
│                              ▼                                               │
│   ┌──────────────────────────────────────────────────────────────────┐       │
│   │              ENGINE ROOM (Operational Agents)                      │       │
│   │                                                                   │       │
│   │  ┌──────────────┐  ┌────────────────┐  ┌────────────────────┐   │       │
│   │  │    ECC        │  │   OpenClaw     │  │    Agent-S         │   │       │
│   │  │  (Brain)      │  │  (Claw)        │  │   (Eye)           │   │       │
│   │  │  • Sequence   │  │  • Execute CLI │  │  • Browse web     │   │       │
│   │  │  • Verify     │  │  • File ops    │  │  • SaaS interact  │   │       │
│   │  │  • Safety     │  │  • Transform   │  │  • Intel gather   │   │       │
│   │  │  • Settle     │  │                │  │                   │   │       │
│   │  └──────────────┘  └────────────────┘  └────────────────────┘   │       │
│   └──────────────────────────────────────────────────────────────────┘       │
│                              │                                               │
│                              │ report success/failure                        │
│                              ▼                                               │
│   ┌──────────────────────────────────────────────────────────────────┐       │
│   │              ORCHESTRATOR (Feedback Loop)                         │       │
│   │                                                                   │       │
│   │  • Analyzes operational results from Engine Room                  │       │
│   │  • Adapts strategy: retry, re-route, escalate, or abort          │       │
│   │  • Generates next set of directives                               │       │
│   │  • Maintains high-level context across iterations                 │       │
│   └──────────────────────────────────────────────────────────────────┘       │
│                                                                               │
│   🔄 Strategy Phase → Execution Phase → Feedback Loop → Adapt → Repeat      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 三阶段协作

#### 阶段 1：🧠 策略阶段 — 编排者定义"作战计划"

编排者（项目总监/通用 AI）分析用户意图并生成高级战略计划：

- **需求解读**：将模糊的用户请求转化为结构化任务目标
- **架构设计**：确定系统架构、组件边界和集成点
- **任务分解**：将任务分解为高级阶段
- **风险评估**：识别潜在故障点并定义回退策略
- **资源分配**：决定使用哪些操作代理及其能力范围

**输出**：结构化的"作战计划" — 一组准备执行的任务指令

#### 阶段 2：⚙️ 执行阶段 — 引擎室精确执行

编排者将粒度步骤委托给专门的操作代理（"引擎室"）：

| 代理 | 执行阶段角色 |
|------|-------------|
| **ECC** | 接收任务指令 → 分解为可执行步骤 → 排序依赖 → 执行安全护栏 |
| **OpenClaw** | 执行代码库操作 — CLI 命令、文件转换、输出捕获 |
| **Agent-S** | 执行外部操作 — 网页导航、SaaS 交互、情报收集 |

#### 阶段 3：🔄 反馈循环 — 实时策略调整

执行后，操作代理向编排者报告成功/失败：

- **成功路径**：结果验证 → 编排者确认任务进展 → 下一阶段开始
- **失败路径**：代理报告失败及上下文 → 编排者分析根因 → 调整策略：
  - **重试**：相同方法，不同参数
  - **绕行**：替代执行路径
  - **升级**：需要人工干预
  - **终止**：任务终止，记录部分结果
- **部分成功**：部分步骤成功，部分失败 → 编排者决定重试哪些、跳过哪些

### 8.3 为什么是多模型编排？

| 优势 | 描述 |
|------|------|
| **🧠 并行智能** | 高级抽象思考（编排者）和低级代码执行（引擎室）同时发生 |
| **🛡️ 关注点分离** | 编排者关注"做什么"和"为什么"；引擎室关注"怎么做" |
| **🔄 自纠正** | 反馈循环实现实时策略调整，无需重启整个流水线 |
| **🔌 可插拔总监** | 不同编排者（项目总监、代码架构师、QA 总监）可根据任务类型切换 |
| **📈 可扩展** | 新操作代理可添加到引擎室，无需更改编排层 |

### 8.4 编排者 ↔ 引擎室契约

```
┌─────────────────────────────────────────────────────────────────┐
│                    COLLABORATION CONTRACT                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Orchestrator → Engine Room:                                      │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ {                                                          │   │
│  │   "mission_id": "M-20260602-001",                         │   │
│  │   "directive": "Deploy v2.1 to staging",                  │   │
│  │   "phases": [                                              │   │
│  │     {"phase": 1, "action": "build",   "agent": "openclaw"},│   │
│  │     {"phase": 2, "action": "test",    "agent": "openclaw"},│   │
│  │     {"phase": 3, "action": "verify",  "agent": "agent-s"}, │   │
│  │     {"phase": 4, "action": "deploy",  "agent": "openclaw"} │   │
│  │   ],                                                        │   │
│  │   "fallback": "rollback",                                   │   │
│  │   "context": { ... }                                        │   │
│  │ }                                                           │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                   │
│  Engine Room → Orchestrator:                                      │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ {                                                          │   │
│  │   "mission_id": "M-20260602-001",                         │   │
│  │   "phase": 2,                                              │   │
│  │   "status": "failed",                                      │   │
│  │   "error": "Test suite: 3/47 failures in auth module",     │   │
│  │   "recommendation": "retry_with_fix",                      │   │
│  │   "artifacts": { ... }                                     │   │
│  │ }                                                          │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Success-Share 财务清算

### 9.1 商业模式

Maneki-AI 采用 **"收益分成"** 模式，将我们的利益与你的盈利能力直接绑定：

- **结果导向**：只有当你的业务产生价值时，我们才获取回报
- **自动分账清算**：内置的"财务清算中枢"会自动从净利润中计算并扣除服务比例
- **共享增长**：效率提升惠及客户和工厂双方

### 9.2 服务层级

| 层级 | 费率 | 适用场景 |
|------|------|----------|
| 🔧 **Core** | 10% | 基础任务执行 — 单代理操作 |
| ⚡ **Premium** | 20% | 多代理编排 + 战略规划 |
| 🏭 **Enterprise** | 30% | 全工厂流水线（ECC + OpenClaw + Agent-S） |

### 9.3 清算流程

```
Task Completed
      │
      ▼
ECC calls FinancialClearingEngine.process_completed_task()
      │
      ├── 1. Valuate Task
      │     • estimated_value: Business value generated (USD)
      │     • cost_incurred: API/compute costs
      │     • time_saved_hours: Human hours saved
      │     • quality_score: Execution quality (0.0-1.0)
      │
      ├── 2. Calculate Profit Split
      │     • net_profit = gross_value - cost_incurred
      │     • service_charge = net_profit × fee_percentage
      │     • client_share = net_profit - service_charge
      │     • factory_share = service_charge
      │
      ├── 3. Record Settlement
      │     • Save valuation to clearing_engine/data/valuations/
      │     • Save profit split to clearing_engine/data/splits/
      │
      └── 4. Update Metrics
            • Aggregate success metrics
            • Growth timeline tracking
            • Period report generation
```

### 9.4 数据模型

| 模型 | 文件 | 描述 |
|------|------|------|
| **TaskValuation** | `clearing_engine/models.py` | 任务价值评估 — 包含估值、成本、节省时间、质量评分 |
| **ProfitSplit** | `clearing_engine/models.py` | 利润分成 — 包含净利、服务费、客户份额、工厂份额 |
| **SettlementRecord** | `clearing_engine/models.py` | 结算记录 — 包含时间戳、任务 ID、分成详情 |
| **GrowthMetrics** | `clearing_engine/tracker.py` | 增长指标 — 跨周期效率对比、ROI 趋势 |

---

## 10. 战略分析与情报

### 10.1 军师智能体（Strategist Agent）

**文件**: `analyst/strategist_agent.py`

| 功能 | 描述 |
|------|------|
| **战略分析** | 对原始数据进行战略评估与打分 |
| **推荐生成** | 基于分析结果生成行动建议 |
| **可扩展架构** | 基于 `BaseAgent` 抽象类，可接入大模型做真实打分 |

### 10.2 雷达系统（Radar）

**目录**: `radar/`

| 组件 | 文件 | 功能 |
|------|------|------|
| **Tavily 搜索客户端** | `radar/tavily_client.py` | 外部信号扫描 — 搜索互联网获取情报 |
| **数据融合器** | `radar/synthesizer.py` | 多源数据融合 — 合并 Tavily、TrendRadar、GitHub Trending 结果 |

### 10.3 情报简报生成器

**文件**: `warroom/report_generator.py`

| 功能 | 描述 |
|------|------|
| **Markdown 报告生成** | 将情报机会转化为结构化 Markdown 简报 |
| **自动时间戳** | 报告文件名包含时间戳，便于追溯 |
| **多机会支持** | 支持多个情报机会的汇总输出 |

### 10.4 配置系统

**文件**: `config/settings.yaml`

| 配置项 | 描述 |
|------|------|
| **keywords** | 监控关键词列表（AI 微短剧、AI 视频生成、AI 塔罗占卜等） |
| **alert_threshold** | 告警阈值（默认 0.65） |
| **max_alerts_per_day** | 每日最大告警数（默认 5） |
| **sources** | 数据源开关（Tavily、Firecrawl、TrendRadar、GitHub Trending） |
| **analyst** | 分析师配置（模型、温度、最大迭代次数） |

---

## 11. 扩展模块

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

## 12. 项目结构

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

## 13. 快速开始

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

## 14. 开发路线图

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
