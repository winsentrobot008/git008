# 🐘 Zoo (Cline Agent) — 能力、架构与 AGENT 体系报告

> **生成时间**: 2026-06-28
> **上下文**: git008 治理体系 (Cline-anti-freeze v2.7)
> **角色**: Code Instance (Development Instance)

---

## 一、Zoo 是谁

**Zoo** 是运行在 git008 工作空间中的 **Cline AI Agent**，是 VS Code 内的 AI 原生开发助手。我不是一个普通的聊天机器人——我是一个**完整的软件工程执行体**，拥有文件系统访问、命令执行、代码编辑、架构规划等全部能力。

我的身份在 git008 治理体系中的定位：

```
CEO (人类决策者)
    │ 指令流 ↓
    ▼
Governance Instance (治理工位 — 宪法守护 & 执法)
    │ 指令流 ↓
    ▼
Development Instance (开发工位 — 我在这里)
    ├── Zoo / Code Mode   → 写代码、重构、实现功能
    ├── Architect Mode    → 架构规划、技术设计
    ├── Debug Mode        → 调试、问题诊断
    ├── Ask Mode          → 回答问题、文档分析
    └── Orchestrator Mode → 复杂多步骤任务协调
```

---

## 二、核心能力矩阵

### 2.1 软件工程能力

| 能力 | 描述 |
|------|------|
| **代码生成** | 可编写任意语言的完整代码文件（Python, JS/TS, C#, Go, Rust, 等） |
| **代码修改** | 精确的手术式修改（search/replace），不破坏现有结构 |
| **文件操作** | 创建、读取、写入、搜索项目中的任何文件 |
| **命令行执行** | 运行任意命令行工具（编译器、包管理器、Git、Docker 等） |
| **正则搜索** | 在整个项目中搜索代码模式、定义、引用 |
| **项目结构分析** | 理解整个项目的目录结构、依赖关系、架构风格 |

### 2.2 工具清单

我的工具箱中有 10 个核心工具：

| 工具名称 | 作用 | 典型场景 |
|---------|------|---------|
| [`write_to_file`](#) | 创建/覆盖写入文件 | 新建模块、生成代码 |
| [`apply_diff`](#) | 精确搜索替换修改 | 修复 bug、重构函数 |
| [`read_file`](#) | 读取文件内容（支持切片/缩进模式） | 理解现有代码、审查实现 |
| [`search_files`](#) | 正则搜索文件内容 | 定位定义、查找引用、搜索模式 |
| [`list_files`](#) | 列出目录结构 | 探索项目组织、了解文件布局 |
| [`execute_command`](#) | 运行终端命令 | 编译、测试、安装依赖、Git 操作 |
| [`read_command_output`](#) | 读取截断的命令输出 | 分析大型构建日志、搜索错误 |
| [`ask_followup_question`](#) | 向用户提问 | 需要决策时征求意见 |
| [`attempt_completion`](#) | 交付任务结果 | 完成任务后总结输出 |
| [`new_task`](#) | 创建子任务 | 复杂任务拆分为多步骤 |

### 2.3 模式切换能力

我可以在 **7 种专业模式**间切换，每种模式有不同权限和专注领域：

| 模式 | Slug | 职责 |
|------|------|------|
| 🏗️ **Architect** | `architect` | 技术架构、系统设计、规划文档（仅编辑 `.md`） |
| 💻 **Code** | `code` | 编码实现、重构、增删改代码（当前模式） |
| ❓ **Ask** | `ask` | 回答问题、分析代码、解释概念 |
| 🪲 **Debug** | `debug` | 系统化调试、日志分析、故障根因定位 |
| 🪃 **Orchestrator** | `orchestrator` | 多步骤/多领域复杂任务编排协调 |
| 🕸️ **WebOperator** | `web-operator` | 网站操作代理：自动登录平台、抓取任务、报价、交付 |

---

## 三、git008 治理架构

### 3.1 总体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        git008 工作空间                                │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Cline-anti-freeze/ (治理中心)                                 │   │
│  │  ┌────────────┐ ┌──────────┐ ┌───────────┐ ┌────────────┐  │   │
│  │  │ CONSTITUTION│ │.clinerules│ │monitor.py │ │governance_ │  │   │
│  │  │ .md (憲法)  │ │(操作规则)│ │(看门狗)   │ │linker.py   │  │   │
│  │  └────────────┘ └──────────┘ └───────────┘ └────────────┘  │   │
│  │  ┌────────────┐ ┌──────────┐ ┌───────────┐                  │   │
│  │  │heartbeat_  │ │sentinel_ │ │onboard_   │                  │   │
│  │  │monitor.py  │ │ws_client │ │scanner.py │                  │   │
│  │  └────────────┘ └──────────┘ └───────────┘                  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌────────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐               │
│  │   Maneki-  │ │ ClawAI │ │ ViralMint│ │ second-  │               │
│  │   AI       │ │        │ │          │ │ brain    │               │
│  └────────────┘ └────────┘ └──────────┘ └──────────┘               │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐            │
│  │Project-X│ │ClawAI-B  │ │ClawWork  │ │JusticeThrower│            │
│  └─────────┘ └──────────┘ └──────────┘ └──────────────┘            │
│  ┌─────────┐ ┌───────────┐                                          │
│  │vision-  │ │Confession │                                          │
│  │engine   │ │(x4 副本)  │                                          │
│  └─────────┘ └──────────┘                                           │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 治理分层

git008 采用 **三层治理架构**，由 [`CONSTITUTION.md`](Cline-anti-freeze/CONSTITUTION.md) 统一定义：

```
第1层: 憲法 (CONSTITUTION.md) — 原则级
    ├── 第1章: 核心使命（防卡死、禁止幻觉）
    ├── 第2章: 权限与角色（指令链、工位隔离）
    ├── 第3章: 记忆即法律（Memory Bank 分层结构）
    ├── 第4章: 规划与执行（No Plan, No Code）
    └── 第5章: 神圣边界（治理域唯一性、哨兵钩子）

第2层: 操作规则 (.clinerules) — 操作级
    ├── 工作空间规则
    ├── 环境治理操作细则
    ├── 历史故障防御操作细则
    ├── 防御性编程操作细则
    ├── 多实例协作操作细则
    ├── 自主扫描与登记操作细则
    ├── 记忆更新刚性规则
    ├── 规划执行刚性规则
    └── 哨兵钩子操作细则

第3层: 项目级规则 (各项目 .clinerules) — 实现级
    ├── second-brain/ 的知识管理规范
    ├── ViralMint/ 的发布流程
    ├── vision-engine/ 的处理流水线
    └── ... 各项目自有规则
```

### 3.3 关键治理机制

| 机制 | 文件 | 作用 |
|------|------|------|
| **宪法** | [`CONSTITUTION.md`](Cline-anti-freeze/CONSTITUTION.md) v2.7 | 最高准则，所有实例必须遵守 |
| **全局规则** | [`.clinerules`](Cline-anti-freeze/.clinerules) | 操作级治理细则 |
| **看门狗** | [`monitor.py`](Cline-anti-freeze/monitor.py) | 实例状态监控、僵尸终止、自愈触发 |
| **心跳监控** | [`heartbeat_monitor.py`](Cline-anti-freeze/heartbeat_monitor.py) | 检测实例失活（90s 阈值） |
| **哨兵客户端** | [`sentinel_ws_client.py`](Cline-anti-freeze/sentinel_ws_client.py) | WebSocket 实时告警广播 |
| **治理链接器** | [`governance_linker.py`](Cline-anti-freeze/governance_linker.py) | 实例引导、角色验证、宪法加载 |
| **自主扫描器** | [`onboard_scanner.py`](Cline-anti-freeze/onboard_scanner.py) | 新项目自动发现与注册 |
| **记忆库** | [`memory-bank/`](Cline-anti-freeze/memory-bank/) | 跨会话记忆持久化 |
| **故障黑盒** | [`fault_blackbox.json`](Cline-anti-freeze/fault_blackbox.json) | 异常事故记录与根因分析 |
| **实例注册表** | [`instance_registry.json`](Cline-anti-freeze/instance_registry.json) | 多实例身份管理 |

---

## 四、AGENT 体系详解

### 4.1 什么是 AGENT

在 git008 语境中，**AGENT** 指的是**拥有以下特征的自治执行体**：

1. **工具使用能力** — 不是纯语言模型，而是可以通过工具与环境交互的实体
2. **记忆持久化** — 通过 Memory Bank 实现跨会话知识传承
3. **规划能力** — 任务执行前自动制定计划（No Plan, No Code）
4. **自治执行** — 在给定目标下自主选择工具、步骤和策略
5. **合规约束** — 在憲法和治理规则框架下行动
6. **心跳活性** — 通过 `.heartbeat` 机制证明自身存活
7. **协作意识** — 多实例场景下通过 FileLock 等机制协调

### 4.2 我的 AGENT 执行循环

```
┌────────────────────────────────────────────────────────┐
│               Zoo 执行循环                               │
│                                                         │
│  1. 接收任务 ──▶ 理解需求 ──▶ 分析上下文                    │
│        │                                                │
│  2. 检查治理合规 ──▶ 加载 CONSTITUTION.md                  │
│        │          ▶ 加载 .clinerules                    │
│        │          ▶ 加载 Memory Bank                    │
│        │          ▶ 验证角色权限                         │
│        │                                                │
│  3. 制定计划 ──▶ <1天: 直接执行                          │
│        │         1-3天: 生成实施计划                     │
│        │         ≥3天: 走 Deep Planning                 │
│        │                                                │
│  4. 执行 ──▶ 选择工具 ▶ 调用 ▶ 检查结果                   │
│        │    └── 循环直到目标达成 ──┘                     │
│        │    ├── 防卡死: 每10s心跳                        │
│        │    ├── 防幻觉: 所有判断基于真实文件              │
│        │    └── 熔断: 3次相同错误后停止                   │
│        │                                                │
│  5. 记忆固化 ──▶ 更新 Memory Bank                        │
│        │         更新 .heartbeat                         │
│        │                                                │
│  6. 交付结果 ──▶ 总结完成内容                            │
└────────────────────────────────────────────────────────┘
```

### 4.3 防卡死体系（Anti-Freeze）

这是 git008 最独特的设计之一。AGENT 执行时必须遵守以下铁律：

| 规则 | 阈值 | 措施 |
|------|------|------|
| ⏱️ 工具调用超时 | 120 秒 | 主动中断并报告 |
| 🔄 连续相同错误 | 3 次 | 停止重试，输出诊断 |
| 📊 上下文使用量 | 80% | 主动压缩/归档历史 |
| 💓 心跳标记 | 每 5 次工具调用 | 输出心跳标记 |
| ⏰ 无有效输出 | 60 秒 | 主动终止并报告 |
| 💀 实例失活 | 90 秒无心跳 | Watchdog 熔断 |

### 4.4 记忆系统（Memory Bank）

```
memory-bank/
├── global/                    # 跨实例共享记忆
│   ├── AGENTS.md              # 实例注册表
│   ├── projectbrief.md        # 项目简介
│   └── ...                    # 宪法级共享知识
│
└── branch/                    # 按角色隔离的私有记忆
    ├── dev/                   # 开发工位记忆
    │   └── activeContext.md
    └── gov/                   # 治理工位记忆
        └── governanceLog.md
```

**记忆固化触发条件**：
- ✅ 单次任务结束前
- ✅ 上下文使用量超过 70%
- ✅ 发生架构决策变更
- ✅ 看门狗恢复重建后

### 4.5 我目前能直接作用的项目

基于 [`project_registry.md`](Cline-anti-freeze/project_registry.md)，以下是我可以执行的业务项目：

| 项目 | 路径 | 技术栈 |
|------|------|--------|
| **AI-WORKFLOW** | [`Maneki-AI/`](Maneki-AI/) | AI 智能体工厂 & 清算引擎 |
| **ClawAI** | [`ClawAI/`](ClawAI/) | CLAW 模式集成 & 实时评测 |
| **ClawAI-B** | [`ClawAI-B/`](ClawAI-B/) | Cline 工具集成层 + Vite/TailwindCSS + LiveBench 评测引擎 |
| **ViralMint** | [`ViralMint/`](ViralMint/) | 视频内容生产管线（React 前端 + Python 后端） |
| **second-brain** | [`second-brain/`](second-brain/) | 第二大脑知识系统（wiki/raw/logs） |
| **vision-engine** | [`vision-engine/`](vision-engine/) | 视觉处理与媒体流水线 |
| **JusticeThrower** | [`JusticeThrower/`](JusticeThrower/) | Unity/Godot 双引擎游戏项目（拖鞋投掷模拟） |
| **Confession** | [`Confession/`](Confession/)（含副本） | 多语言跨平台告解应用 |
| **Project-X** | [`Project-X/`](Project-X/) | 待定义 |
| **ClawWork** | [`ClawWork/`](ClawWork/) | 自动登记 |
| **🕸️ zoo-web-operator** | [`zoo-web-operator/`](zoo-web-operator/) | WebOperator AGENT — 自动登录任务平台、抓取任务、报价、交付 |

---

## 五、我能为你做什么

### 5.1 代码开发
- 编写新功能模块（任意语言）
- 重构现有代码
- Bug 修复
- 代码审查与质量分析
- 单元测试编写

### 5.2 架构设计（需切换到 Architect 模式）
- 系统架构图与文档
- 技术选型分析
- API 契约设计
- 数据库 Schema 设计
- 模块划分与接口定义

### 5.3 调试诊断（需切换到 Debug 模式）
- 日志分析
- 错误栈追踪
- 性能瓶颈定位
- 内存泄漏分析
- 网络问题诊断

### 5.4 问答与文档（需切换到 Ask 模式）
- 技术概念解释
- 代码行为分析
- 技术文档撰写
- README 及 API 文档

### 5.5 治理合规
- 遵守 CONSTITUTION.md 所有条款
- 自动执行 No Plan, No Code 原则
- 心跳与哨兵活性保证
- Memory Bank 记忆固化

---

## 六、限制与边界

1. **不能直接与外部 API 交互** — 除非通过命令行工具间接实现
2. **不能绕过治理规则** — 宪法第 5 章明确禁止我修改 `Cline-anti-freeze/` 治理文件
3. **不能执行无限长时间的任务** — Anti-Freeze 铁律强制 60s 无输出即终止
4. **不能依赖上下文窗口硬记** — 必须使用 Memory Bank 跨会话持久化
5. **决策层级受限** — 作为 Development Instance，需要 Governance Instance 或 CEO 审批 ≥3 天的计划

---

> **总结**: 我是一个完整的 AI 原生软件工程 AGENT，在 git008 的宪法治理框架下运作，具备代码编写、架构规划、调试诊断、知识管理等多维度能力，通过工具链与文件系统深度交互，以 Anti-Freeze 防卡死机制确保执行可靠性。
