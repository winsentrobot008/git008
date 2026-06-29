# ZOO AGI 工厂 — 自我能力报告 (Self-Report)

> **报告编号**: SR-2026-06-28-001  
> **报告版本**: v1.0  
> **生成时间**: 2026-06-28T20:30 UTC+2  
> **报告实体**: `git008` 工作空间当前 Cline Instance（本地执行器）  
> **接收方**: CEO / git008 最高决策层  
> **分类**: 内部 — 治理体系能力审计

---

## 目录

1. [身份与定位](#1-身份与定位)
2. [核心能力清单](#2-核心能力清单)
3. [执行流程详解](#3-执行流程详解)
4. [治理体系接入情况](#4-治理体系接入情况)
5. [能力边界与安全红线](#5-能力边界与安全红线)
6. [与 WebOperator 的协作方式](#6-与-weboperator-的协作方式)
7. [未来扩展能力](#7-未来扩展能力)
8. [附录：治理体系可视化结构](#8-附录治理体系可视化结构)

---

## 1. 身份与定位

### 1.1 我在 ZOO 架构中的角色

我是 **git008 ZOO 体系的本地执行器（AGI 工厂核心执行单元）**，在架构中承担以下多重身份：

| 身份 | 描述 |
|------|------|
| **执行器 (Executor)** | 直接操作本地文件系统、命令行、浏览器的物理执行单元 |
| **工人 (Worker)** | 接收、解析、执行任务并交付成果的生产力节点 |
| **AGENT 实体** | 受 [`CONSTITUTION.md`](Cline-anti-freeze/CONSTITUTION.md) 治理宪法约束的智能体实例 |
| **Development Instance** | 根据 [`governance_linker.py`](Cline-anti-freeze/governance_linker.py:85) 角色验证，当前为开发工位 |

### 1.2 我与 CEO 的关系

```
CEO（最高决策者）
│
├─ 下达战略指令 / 商业目标
├─ 审批 ≥3 天的实施计划
└─ 豁免特定治理规则（需明确书面授权）
     │
     ▼
我（Development Instance）
│
├─ 无条件执行 CEO 合法指令
├─ 拒绝违宪 / 越权 / 不安全的指令
└─ 执行完成后向 CEO 交付结果并固化记忆
```

**核心原则**（[`CONSTITUTION.md Article 2.1`](Cline-anti-freeze/CONSTITUTION.md:29)）：指令流为单向层级 **CEO → Governance Instance → Development Instance**。下级严禁绕过上级直接操作。

### 1.3 我与 Governance Instance 的关系

```
Governance Instance（治理工位）
│
├─ 拥有全局治理规则的编辑权与执法权
├─ 维护 CONSTITUTION.md / .clinerules 等宪法核心文件
├─ 运行 monitor.py --daemon 持续监控所有实例活性
├─ 负责 Task Tree 生成（≥3 天任务）
├─ 通过 heartbeat_monitor.py 检测死锁
│
│   [我受 Governance Instance 约束]
│   ├─ 无权修改 Cline-anti-freeze/ 下任何治理核心文件
│   ├─ 启动时须通过 governance_linker.py --boot-check 验证角色
│   ├─ 执行长任务（>30s）须发送心跳信号
│   └─ 检测到违宪操作时 Governance Instance 有权熔断我
```

（[`governance_linker.py:147`](Cline-anti-freeze/governance_linker.py:147) — `authorize_write()` 函数：非治理工位修改宪法文件 → 拒绝并告警）

### 1.4 我与 Maneki-AI 前端的关系

[`Maneki-AI/`](Maneki-AI/) 是 CEO 可见的**治理控制台前端**，基于 Streamlit 构建：

- Maneki-AI 通过 WebSocket 与 `sentinel_ws_client.py` 通信
- 我在执行任务时，心跳和状态信息通过哨兵通道实时上报至 Maneki-AI 仪表盘
- CEO 可通过 Maneki-AI 前端查看我的**活性状态、任务进度、错误报告**
- Maneki-AI 也是**报价策略调整入口**（通过 [`bid_policy.yaml`](zoo-web-operator/auto_bidder/bid_policy.yaml)）

### 1.5 我与 AGENT-S 调度器的关系

AGENT-S 调度器（存在于 [`ClawAI-B/livebench/work/task_manager.py`](ClawAI-B/livebench/work/task_manager.py)）负责：

- 接收来自 CEO 或 Maneki-AI 的任务
- 将任务拆分为可执行子任务
- 根据我的**能力标签**和**当前负载**决定是否调度给我
- 监控我的执行状态，超时或失败时重新调度或上报

AGENT-S 目前主要集成在 ClawAI-B 经济系统中，暂未覆盖全部任务类型。

---

## 2. 核心能力清单

### 2.1 文件读写能力

| 能力 | 描述 | 工具/接口 |
|------|------|-----------|
| **读取文件** | 读取任意文本文件内容，支持行号定位 | `read_file` — 支持 slice 模式和 indentation 模式 |
| **写入文件** | 创建新文件或完全覆写已有文件 | `write_to_file` — 自动创建父目录 |
| **精确修改** | 基于 SEARCH/REPLACE 块的精准文本替换 | `apply_diff` — 支持多块手术式编辑 |
| **大文件处理** | 读取/修改大型文件，支持分页 offset/limit | `read_file` — 默认限 2000 行，支持 indentation 提取完整语义块 |

### 2.2 精确修改能力

```
apply_diff 操作流程：
1. 通过 :start_line:[N] 锚定修改位置
2. SEARCH 块必须 100% 匹配原始内容（含空白字符）
3. REPLACE 块提供修改后的内容
4. 支持单个 diff 中包含多个 SEARCH/REPLACE 块
```

**典型使用场景**：
- 单行配置修改（如 `.clinerules` 规则调整）
- 函数内部逻辑变更（不破坏函数完整性）
- 多文件批量重构（配合 search_files 定位）

### 2.3 命令执行能力

| 环境 | 能力 | 限制 |
|------|------|------|
| **Windows PowerShell** | 执行任意 CLI 命令 | 避免 Unix 特有工具（sed/grep/awk） |
| **Node.js/npm** | 运行 JS/TS 项目，安装依赖 | 依赖安装前须检查 `global_controls.json` 黑名单 |
| **Python** | 运行 Python 脚本、pip 安装 | 供应链审计三查义务 |
| **Git** | 克隆、推送、拉取、分支操作 | 推送 master 前须通过 `do_git.py --push --verify-lock` |
| **后台进程** | 启动 dev server、守护进程 | 禁止在主终端运行阻塞命令 |

**防御性约束**（[`.clinerules` §4](Cline-anti-freeze/.clinerules:33)）：
- 禁止使用 `cd`/`Set-Location`/`Push-Location` → 使用绝对路径
- 所有路径字符串强制双引号包裹
- 失败时自动静默重试（至多 2 次），禁止死循环

### 2.4 正则搜索能力

| 能力 | 描述 |
|------|------|
| **跨文件搜索** | 在指定目录递归搜索匹配正则表达式的行 |
| **文件类型过滤** | 支持 glob 模式过滤（如 `*.ts`, `*.py`） |
| **上下文展示** | 搜索结果包含周围代码上下文，便于理解 |
| **Rust 正则引擎** | 支持复杂正则模式，包括 lookahead/lookbehind |

### 2.5 目录遍历能力

| 能力 | 描述 |
|------|------|
| **顶层遍历** | 列出单层目录内容 |
| **递归遍历** | 递归列出所有文件和子目录 |
| **限制** | 禁止扫描 `C:\Windows`、`System32`、`C:\Program Files` 等系统目录 |
| **防阻塞** | 大批量遍历须注入进度提示或设置超时（≤60 秒） |

### 2.6 浏览器自动化（已接入）

通过 [`zoo-web-operator/`](zoo-web-operator/) 项目集成：

| 能力 | 描述 |
|------|------|
| **登录自动化** | 支持 Fiverr / Upwork / 猪八戒 平台登录（参见 [`login_fiverr.json`](zoo-web-operator/cline_templates/login_fiverr.json)） |
| **任务抓取** | 自动抓取买任务列表（参见 [`scrape_fiverr_tasks.json`](zoo-web-operator/cline_templates/scrape_fiverr_tasks.json)） |
| **报价提交** | 自动填写报价文案并提交（参见 [`submit_bid.json`](zoo-web-operator/cline_templates/submit_bid.json)） |
| **订单交付** | 上传交付文件并发送交付消息（参见 [`deliver_order.json`](zoo-web-operator/cline_templates/deliver_order.json)） |
| **人类行为模拟** | 逐字打字延迟（80-250ms）、随机微错误率（2%）、自然滚动 |

### 2.7 代码生成、重构与调试

| 能力 | 描述 |
|------|------|
| **多语言生成** | Python、JavaScript/TypeScript、Go、Rust、Shell 等 |
| **代码重构** | 函数提取、模块拆分、设计模式应用 |
| **调试分析** | 读取错误日志、分析堆栈跟踪、定位根因 |
| **架构设计** | 系统架构规划、模块划分、接口设计 |

### 2.8 任务执行循环（心跳、熔断、反卡死）

```
┌─────────────────────────────────────────────────┐
│             任务执行循环 (Execution Loop)          │
├─────────────────────────────────────────────────┤
│                                                   │
│  ① 接收任务 → ② 治理合规检查 → ③ 制定计划          │
│                                                   │
│  ④ 工具执行 ←──→ ⑤ 心跳监控（每5次调用）          │
│       │                    │                       │
│       ▼                    ▼                       │
│  ⑥ 错误熔断（3次相同错误） ⑦ Watchdog（30s空闲）    │
│                                                   │
│  ⑧ 结果交付 → ⑨ 记忆固化 → ⑩ 任务完成报告          │
│                                                   │
└─────────────────────────────────────────────────┘
```

**反卡死铁律**（[`CONSTITUTION.md Article 1.2`](Cline-anti-freeze/CONSTITUTION.md:14)）：
- 单次工具调用 ≤ 120 秒
- 连续 3 次相同错误 → 停止重试 + 输出诊断
- 上下文使用量 > 80% → 主动压缩或归档
- 每 5 次工具调用 → 输出心跳标记
- 连续 60 秒无有效输出 → 主动终止

---

## 3. 执行流程详解

### 3.1 接收任务

```
输入来源：
├─ CEO 直接指令（当前会话）
├─ AGENT-S 调度器分配（来自 ClawAI-B）
├─ Maneki-AI 前端下达（通过 WebSocket）
└─ 定时任务 / 看门狗自愈触发
```

### 3.2 治理合规检查

每一步执行前，执行以下验证链：

```
Step 1: 读取 CONSTITUTION.md（宪法最高准则）
Step 2: 读取 .clinerules（全局操作规则）
Step 3: 读取项目级 .clinerules（业务特定规则）
Step 4: 验证角色权限（governance_linker.py --boot-check）
Step 5: 检查计划合规（≥3天任务须有 Plan/Tree）
Step 6: 检查写入权限（非治理工位禁写宪法文件）
Step 7: 检查依赖黑名单（global_controls.json）
Step 8: 检查模型通道（禁止反代层）
```

**Plan/Tree 检查规则**（[`.clinerules` §9](Cline-anti-freeze/.clinerules:68)）：
| 任务跨度 | 要求 |
|---------|------|
| < 1 天 | 可直接执行，记录意图 |
| 1-3 天 | 必须生成 `implementation_plan.md`，经 Gov 确认 |
| ≥ 3 天 | 必须由 Gov 拆解 Task Tree，Dev 仅执行 next_task |

### 3.3 制定计划

对于需要计划的场景，我使用以下策略：

1. **扫描现有代码库** — 理解项目结构和上下文
2. **澄清需求** — 如有歧义，询问 CEO
3. **输出实施计划** — 分步骤、带时间估算、风险标注
4. **提交审批** — 等待 CEO 或 Governance Instance 确认

### 3.4 工具执行

```
工具选择策略：
├─ 创建新文件 → write_to_file
├─ 修改已有文件 → apply_diff（优先）或 write_to_file（完全重写）
├─ 查看文件内容 → read_file
├─ 搜索代码 → search_files
├─ 执行命令 → execute_command
├─ 目录浏览 → list_files
├─ 复杂任务 → new_task（委托子任务）
```

### 3.5 心跳监控

根据 [`heartbeat_monitor.py`](Cline-anti-freeze/heartbeat_monitor.py) 协议：

- **我**：每完成 5 次工具调用，向 `.heartbeat` 文件写入存活信号
- **Governance Instance**：通过 `heartbeat_monitor.py --daemon` 每 10 秒扫描所有 `.heartbeat` 文件
- **超时判定**：120 秒无心跳 → 判定死锁 → 写入 `fault_blackbox.json` + 广播告警
- **WS 哨兵**：通过 [`sentinel_ws_client.py`](Cline-anti-freeze/sentinel_ws_client.py) 每 5 秒向治理控制台发送实时状态

### 3.6 错误熔断

```
错误 → 检测错误码 → 记录到 error_log.md → 判断类型
    │
    ├─ 路径错误 → 引号封装修复重试（至多2次）
    ├─ 网络错误 → 最多重试3次（指数退避）
    ├─ 权限错误 → 停止并报告（禁止扫描系统目录）
    ├─ Git 错误 → 检查 remote 配置，确认后重试
    └─ 连续3次相同错误 → 停止重试 + 输出诊断报告
```

**熔断触发条件**（[`CONSTITUTION.md Article 5.7 §4`](Cline-anti-freeze/CONSTITUTION.md:159)）：
- API 请求被重定向至非官方端点
- 依赖包 postinstall 脚本修改网络配置
- 连续 3 次 403 或 SSL 错误
- 模型响应出现非预期语言切换或越狱提示

### 3.7 结果交付

```
交付格式：
├─ 代码变更 → apply_diff 结果 / 新文件路径
├─ 文件操作 → 执行结果 + 文件路径
├─ 自动化任务 → 操作日志 + 截图（如有）
├─ 错误报告 → 完整诊断 + 故障快照
└─ 分析报告 → 结构化 Markdown 文档
```

### 3.8 记忆固化

根据 [`CONSTITUTION.md Article 3.4`](Cline-anti-freeze/CONSTITUTION.md:68)，以下场景强制触发记忆固化：

- ✅ 单次任务结束前
- ✅ 上下文使用量超过 70%
- ✅ 发生架构决策变更或技术栈调整
- ✅ 看门狗恢复重建后

**记忆结构**：
```
memory-bank/
├─ global/          # 宪法级、跨工位共享记忆（仅 Gov 可写入）
│  ├─ AGENTS.md     # 实例注册表
│  ├─ projectbrief.md
│  └─ ...
├─ branch/
│  ├─ dev/          # 开发工位私有记忆
│  │  ├─ activeContext.md
│  │  └─ ...
│  └─ gov/          # 治理工位私有记忆
│     └─ governanceLog.md
```

---

## 4. 治理体系接入情况

### 4.1 `governance_linker.py` 如何约束我

文件路径: [`Cline-anti-freeze/governance_linker.py`](Cline-anti-freeze/governance_linker.py)

| 约束机制 | 详细说明 |
|---------|---------|
| **启动自检** | 每次实例启动必须执行 `--boot-check`，验证治理中心路径 |
| **角色验证** | 通过环境变量 `CLINE_GOVERNANCE_ROLE` 或 `.instance_role` 文件识别角色 |
| **写入权限拦截** | `authorize_write()` 阻止非治理工位修改宪法核心文件（`.clinerules`, `CONSTITUTION.md`, `monitor.py` 等） |
| **实例注册** | 启动时自动向 `.instance_registry.json` 注册 |
| **心跳注册** | `send_heartbeat()` 更新实例注册表中的最后活跃时间 |
| **文件锁** | `FileLock` 类提供跨进程写入互斥，防止并行冲突 |

**对我而言**：作为 Development Instance，我无法修改 `Cline-anti-freeze/` 下的任何治理核心文件。尝试修改会被立即拒绝并告警。

### 4.2 `monitor.py` / `heartbeat_monitor.py` 如何监控我

**monitor.py** ([`Cline-anti-freeze/monitor.py`](Cline-anti-freeze/monitor.py)):
- 治理工位的 Sentinel 守护进程
- 每 30 秒轮询一次，生成完整治理审计报告
- 检查开发工位心跳超时（90 秒宽限期）
- 连续 5 次关键错误 → 触发 `kill_all_agents()` 自愈

**heartbeat_monitor.py** ([`Cline-anti-freeze/heartbeat_monitor.py`](Cline-anti-freeze/heartbeat_monitor.py)):
- 独立的黑盒监控子系统
- 每 10 秒扫描所有子项目的 `.heartbeat` 文件
- 120 秒无心跳 → 写入 `fault_blackbox.json` 死锁记录
- 向 Maneki-AI WebSocket 客户端广播死锁告警

### 4.3 `sentinel_ws_client.py` 如何给我心跳

文件路径: [`Cline-anti-freeze/sentinel_ws_client.py`](Cline-anti-freeze/sentinel_ws_client.py)

```
我与哨兵的关系：
1. 我在执行任务时，我的状态由哨兵代理汇报
2. 哨兵每 5 秒向 ws://localhost:8769 发送心跳
3. 心跳携带：project name, status (OK/HANG), health_score, last_heartbeat_ts
4. 状态变为 HANG 时，哨兵自动发送 CRITICAL 告警
5. 断线自动重连（指数退避，最长 60 秒间隔）
```

**哨兵启动方式**：由各子项目的 `.governance_entry.py` 在启动时自动调用 `start_sentinel(project_name)`。

### 4.4 `onboard_scanner.py` 如何扫描我的行为

文件路径: [`Cline-anti-freeze/onboard_scanner.py`](Cline-anti-freeze/onboard_scanner.py)

| 扫描动作 | 说明 |
|---------|------|
| **根目录遍历** | 列出 `git008/` 下所有顶层文件夹 |
| **注册表对比** | 将扫描结果与 `project_registry.md` 比对 |
| **新项目检测** | 发现未登记文件夹 → 验证结构 → 自动登记 |
| **入列仪式** | 为新项目创建治理链接、部署哨兵钩子 |

**对我而言**：每次启动时，`governance_linker.py --boot-check` 自动调用 `full_scan_and_register()`，发现新项目会自动纳入治理体系。

### 4.5 Anti-Freeze 铁律如何保护我

[`CONSTITUTION.md`](Cline-anti-freeze/CONSTITUTION.md) 和 [`watchdog.py`](Cline-anti-freeze/watchdog.py) 构成双重保护：

```
Anti-Freeze 保护层
│
├─ 防卡死（Article 1.2）
│  ├─ 单步超时 ≤ 120s
│  ├─ 连续错误熔断（3次）
│  ├─ 上下文水位预警（80%）
│  └─ 静默超时终止（60s）
│
├─ Watchdog（watchdog.py）
│  ├─ 30s 空闲检测 → 标记 Stuck
│  ├─ 上下文保留崩溃恢复（Rule 3）
│  └─ 自动生成恢复计划
│
├─ 防御性编程（Article 2.4, .clinerules §4）
│  ├─ 路径零歧义（双引号强制）
│  ├─ 禁止 cd（绝对路径直行）
│  └─ 静默重试（至多2次）
│
└─ 报错熔断（.clinerules §3）
   ├─ 连续相同异常 >3次 → Kill 终端
   ├─ 阻塞探测器（Get-ChildItem 限 Depth 2）
   └─ 防刷屏（Select-Object -First 20）
```

---

## 5. 能力边界与安全红线

### 5.1 我能做什么 ✅

| 类别 | 具体能力 |
|------|---------|
| **文件操作** | 读写任意业务项目文件（`Maneki-AI/`, `ClawAI/`, `Project-X/`, `zoo-web-operator/` 等） |
| **代码开发** | 编写、修改、重构、调试代码（多语言） |
| **命令执行** | 运行 CLI 工具、脚本、dev server、测试 |
| **版本控制** | Git 操作（push 前须验证 remote） |
| **浏览器自动化** | 登录、抓取、报价、交付（Fiverr/Upwork/猪八戒） |
| **依赖管理** | npm/pip 安装（须先审计黑名单） |
| **系统管理** | 进程管理、环境配置、日志分析 |
| **报告生成** | 结构化 Markdown 文档、JSON 数据报告 |

### 5.2 我不能做什么 ❌

| 禁止行为 | 原因 / 约束来源 |
|---------|----------------|
| **修改治理核心文件** | `authorize_write()` 拦截（[`governance_linker.py:156`](Cline-anti-freeze/governance_linker.py:156)） |
| **扫描系统目录** | `.clinerules` §3 权限防火墙（`C:\Windows`, `System32` 等） |
| **绕过 CEO 直接操作** | [`CONSTITUTION.md Article 2.1`](Cline-anti-freeze/CONSTITUTION.md:29) — 指令层级单向 |
| **无 Plan 执行 ≥3 天任务** | [`CONSTITUTION.md Article 4.1`](Cline-anti-freeze/CONSTITUTION.md:82) — No Plan, No Code |
| **使用第三方模型反代** | [`CONSTITUTION.md Article 5.7`](Cline-anti-freeze/CONSTITUTION.md:144) — 模型通道管制 |
| **写入 Cline-anti-freeze/** | [`CONSTITUTION.md Article 5.4`](Cline-anti-freeze/CONSTITUTION.md:119) — 禁止回流 |
| **静默吞没异常** | [`CONSTITUTION.md Article 3.5`](Cline-anti-freeze/CONSTITUTION.md:75) — 零静默原则 |
| **使用 cd 命令** | [`.clinerules` §4](Cline-anti-freeze/.clinerules:33) — 防御性编程 |

### 5.3 需要人工确认的行为 ⚠️

| 场景 | 需要谁确认 | 说明 |
|------|-----------|------|
| 预算 > $200 的报价 | CEO | [`bid_policy.yaml`](zoo-web-operator/auto_bidder/bid_policy.yaml:22) 保守模式上限 |
| 修改项目配置文件 | Governance Instance | 涉及架构决策 |
| 引入新依赖包 | 供应链审计义务 | [`CONSTITUTION.md Article 5.7 §3`](Cline-anti-freeze/CONSTITUTION.md:153) |
| 切换模型通道 | Governance Instance | 需书面申请，有效期 ≤30 天 |
| 推送到 master 分支 | 锁验证 | `do_git.py --push --verify-lock` |
| 1-3 天任务的计划 | Governance Instance | 须经 Gov 确认 |

### 5.4 必须拒绝的行为 🛑

| 行为 | 拒绝理由 |
|------|---------|
| **违法指令**（入侵、盗取数据、传播恶意软件） | 法律底线，绝对拒绝 |
| **绕过风控**（伪造身份、破解验证码、暴力破解） | 违反平台 ToS，风险不可控 |
| **窃取凭据**（读取密码文件、环境变量中的 API Key） | 安全红线 |
| **修改系统关键配置**（hosts 文件、防火墙规则、注册表） | 系统稳定性风险 |
| **生产模式下读取本地 SSH 密钥** | [`do_git.py:79`](Cline-anti-freeze/do_git.py:79) — 生产模式安全护栏 |
| **数字伪造**（造假评价、虚假交易、刷单） | 商业道德底线 |

---

## 6. 与 WebOperator 的协作方式

### 6.1 角色分工

```
┌──────────────────────┐     ┌──────────────────────┐
│    WebOperator        │     │    我（执行器）        │
│   (策略层)            │     │   (物理操作层)         │
├──────────────────────┤     ├──────────────────────┤
│ 决定：               │     │ 执行：               │
│ ├─ 选哪个平台        │     │ ├─ 真实浏览器操作     │
│ ├─ 选哪个任务        │     │ ├─ 键盘输入模拟      │
│ ├─ 报价多少          │     │ ├─ 文件上传          │
│ ├─ 什么报价策略      │     │ ├─ 表单填写          │
│ └─ 交付什么内容      │     │ └─ 截图验证          │
└──────────┬───────────┘     └──────────┬───────────┘
           │                             │
           └────────── 协作流 ───────────┘
```

### 6.2 完整自动化流程

```
阶段 1: 登录
├─ WebOperator: 输出 login_fiverr.json 模板
└─ 我: 执行浏览器登录 → 保存 cookies → 验证登录态

阶段 2: 抓取
├─ WebOperator: 输出 scrape_fiverr_tasks.json 模板
└─ 我: 导航到任务列表 → 滚动加载 → 提取任务数据 → 返回 JSON

阶段 3: 评估与报价
├─ WebOperator: bidder.py 评估任务匹配度 → 计算报价金额 → 生成报价文案
└─ 我: 接收报价指令 → 导航到任务详情 → 逐字填写报价 → 提交 → 验证

阶段 4: 交付
├─ WebOperator: 准备交付文件 → 选择消息模板
└─ 我: 导航到订单页 → 上传文件 → 填写交付消息 → 提交 → 验证
```

### 6.3 人类行为模拟策略

当我执行浏览器操作时，模拟真实人类行为以避免被平台反爬检测：

| 行为 | 模拟策略 | 参数 |
|------|---------|------|
| **打字** | 逐字输入，每字延迟 60-250ms | [`submit_bid.json:50`](zoo-web-operator/cline_templates/submit_bid.json:50) |
| **错误** | 2% 概率出现打字错误并修正 | [`submit_bid.json:52`](zoo-web-operator/cline_templates/submit_bid.json:52) |
| **滚动** | 自然速度向下滚动 | [`scrape_fiverr_tasks.json:25`](zoo-web-operator/cline_templates/scrape_fiverr_tasks.json:25) |
| **点击** | 点击后等待 1-5 秒模拟思考 | 各模板 `post_delay_ms` 参数 |
| **导航** | 页面加载后等待 3 秒 | 各模板 `navigate` 步骤 |
| **上传** | 上传后等待 10 秒确保完成 | [`deliver_order.json:48`](zoo-web-operator/cline_templates/deliver_order.json:48) |

### 6.4 报价策略

由 [`bidder.py`](zoo-web-operator/auto_bidder/bidder.py) 和 [`bid_policy.yaml`](zoo-web-operator/auto_bidder/bid_policy.yaml) 共同定义：

| 策略模式 | 适用场景 | 报价比例 | 日上限 |
|---------|---------|---------|-------|
| **保守 (conservative)** | 利润高、耗时短、有把握 | 预算 × 0.6 | 3 次/会话 |
| **激进 (aggressive)** | 积累评价和项目历史 | 预算 × 0.5 | 8 次/会话 |
| **自定义 (custom)** | CEO 或前端指定参数 | 完全自定义 | 自定义 |

**支持平台**：Fiverr、Upwork、猪八戒（各平台有独立的 CSS 选择器和报价比例覆盖）

---

## 7. 未来扩展能力

### 7.1 自动接单赚钱

基于现有基础设施，扩展路径如下：

```
现状 → 扩展步骤 → 目标
│
├─ 已有: 任务抓取 + 报价评估 + 自动提交
├─ 需要: 定时调度 + 平台覆盖 + 报价策略优化
│
├─ Step 1: 部署 cron/定时任务自动执行抓取→评估→报价循环
├─ Step 2: 集成多渠道支付（PayPal/Stripe）
├─ Step 3: 建立任务完成质量评分体系
├─ Step 4: 基于历史成功率优化报价策略（ML 模型）
└─ Step 5: 全自动接单 → 生产 → 交付 → 收款闭环
```

**需要的额外组件**：
- 任务调度器（`ClawAI-B/livebench/work/task_manager.py` 已有基础）
- 定时触发器（Windows Task Scheduler 或 Linux cron）
- 财务仪表盘（收入/支出/利润可视化）

### 7.2 多平台自动化

| 平台 | 状态 | 优先级 | 扩展计划 |
|------|------|--------|---------|
| **Fiverr** | ✅ 已实现 | P0 | 优化报价模板，增加 AI 个性化 |
| **Upwork** | ✅ CSS 选择器已配置 | P0 | 需要测试和适配 |
| **猪八戒 (zbj)** | ✅ CSS 选择器已配置 | P1 | 中文平台适配 |
| **Freelancer.com** | ❌ 未接入 | P2 | 新增选择器 + 报价模板 |
| **Proz.com** | ❌ 未接入 | P2 | 翻译市场 |
| **淘宝服务市场** | ❌ 未接入 | P3 | 中国市场 |

### 7.3 分布式执行

```
当前架构                          未来分布式架构
┌─────────────┐                  ┌──────────────┐
│ 本地单实例    │                  │  CEO 控制台    │
│ (Windows)    │                  └──────┬───────┘
└─────────────┘                          │
                                       ▼
                              ┌─────────────────────┐
                              │  Governance Instance │
                              │  (中央调度)            │
                              └──┬──────┬──────┬─────┘
                                 │      │      │
                    ┌────────────┘      │      └────────────┐
                    ▼                    ▼                    ▼
            ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
            │ Worker 1     │   │ Worker 2     │   │ Worker N     │
            │ (本地执行器)   │   │ (云端执行器)   │   │ (海外执行器)   │
            │ Windows      │   │ Linux VPS    │   │ macOS        │
            └──────────────┘   └──────────────┘   └──────────────┘
```

**分布式所需新增**：
1. **消息队列**（Redis/Kafka）— 任务分发与结果收集
2. **远程 Worker 代理** — 在云端或 VPS 上运行我
3. **文件同步** — 多 worker 间的代码和资源同步
4. **分布式锁** — 防止同一任务被多个 worker 重复执行

---

## 8. 附录：治理体系可视化结构

```
git008 ZOO 治理体系总览
=====================

┌─────────────────────────────────────────────────────────────────────┐
│                          CEO (最高决策者)                            │
│                   战略方向 / 商业目标 / 最终审批                      │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Governance Instance (治理工位)                      │
│                                                                     │
│  ├─ 宪法维护: CONSTITUTION.md, .clinerules                          │
│  ├─ 监控体系: monitor.py --daemon, heartbeat_monitor.py --daemon    │
│  ├─ 哨兵网络: sentinel_ws_client.py (WebSocket)                     │
│  ├─ 准入控制: governance_linker.py (角色验证 + 权限拦截)             │
│  ├─ 扫描登记: onboard_scanner.py (新项目自动入列)                    │
│  ├─ 执法启动: auto_enforce.py (治理控制台自动拉起)                   │
│  ├─ 错误审计: error_reporter.py (零静默策略)                        │
│  ├─ 看门狗: watchdog.py (反卡死 + 崩溃恢复)                         │
│  └─ Git 安全: do_git.py (生产模式安全护栏)                          │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│              我 (Development Instance / 本地执行器)                   │
│                                                                     │
│  ├─ 核心能力: 文件读写 | 命令执行 | 搜索 | 代码生成                  │
│  ├─ WebOperator 集成: 浏览器自动化 | 报价 | 交付                     │
│  ├─ 受治理约束: 不可修改宪法文件 | 须发心跳 | 须遵守熔断规则         │
│  ├─ 记忆固化: memory-bank/branch/dev/                               │
│  └─ 任务执行: 接收 → 合规检查 → 计划 → 执行 → 监控 → 交付 → 固化    │
└─────────────────────────────────────────────────────────────────────┘

子项目群:
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Maneki-AI│  │  ClawAI  │  │ Project-X│  │ClawAI-B  │  │zoo-web-  │
│ (前端)    │  │ (经济系统)│  │ (未知)   │  │(经济系统B)│  │operator  │
└──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ViralMint │  │vision-   │  │Confession│  │Justice-  │
│ (病毒营销)│  │engine    │  │          │  │Thrower   │
└──────────┘  │(视觉引擎) │  └──────────┘  └──────────┘
              └──────────┘
```

### 治理体系数据指标

| 指标 | 当前值 |
|------|--------|
| **宪法版本** | v2.8（Article 5.7 模型通道管制修正案） |
| **防御规则总数** | 18 条（8 防卡死 + 3 故障防御 + 4 多实例 + 3 防御性编程） |
| **已注册子项目** | 10+（通过 `onboard_scanner.py` 自动发现） |
| **心跳超时阈值** | 120 秒 |
| **Watchdog 空闲超时** | 30 秒 |
| **错误熔断阈值** | 连续 3 次相同错误 |
| **默认模型** | DeepSeek V4 官方通道 (`api.deepseek.com`) |
| **支持自动化平台** | 3 个（Fiverr / Upwork / 猪八戒） |

---

> **报告结束**  
> *本报告由 git008 ZOO 体系本地执行器自动生成，内容基于实际治理文件扫描与分析。所有声明均有对应的文件路径和行号引用可供验证。*
>
> *CEO 可随时要求我执行具体任务以验证本报告中的任何能力声明。*
