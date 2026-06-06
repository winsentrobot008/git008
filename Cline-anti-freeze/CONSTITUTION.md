# git008 治理宪法

> 统一治理宪法文件
> 所有 Cline 实例在启动时必须加载本文件
> 生效日期：2026-06-06

---

## 第一章：总则

**Article 1.1** 本宪法是 git008 工作空间的最高治理准则，所有 Cline 实例必须遵守。
**Article 1.2** 宪法文件统一存放于 `Cline-anti-freeze/CONSTITUTION.md`，为唯一源（Single Source of Truth）。
**Article 1.3** 仅 governance 角色的实例有权修改宪法文件。development 角色实例修改将被拦截。

---

## 第二章：防卡死协议（Anti-Freeze Protocol）

### Article 2.1：超时熔断
任何单次工具调用必须在 120 秒内返回结果。超时则主动中断并报告。

### Article 2.2：循环检测
连续 3 次工具调用返回相同错误或空结果时，停止重试并输出诊断信息。同一操作最多重试 3 次。

### Article 2.3：上下文窗口保护
当上下文使用量超过 80%（约 100K tokens）时，必须主动压缩或归档历史记录。

### Article 2.4：心跳检查
每完成 5 次工具调用，输出一次状态标记 `[治理心跳] 运行中`。

### Article 2.5：异常退出
若检测到自身处于卡死状态（如连续 60 秒无有效输出），主动终止并输出错误报告。

---

## 第三章：环境治理

### Article 3.1：依赖重构原则
禁止修复损坏的 `node_modules` 软链接。检测到模块缺失错误时，执行"删除-重装"原子化操作。

### Article 3.2：编码统一原则
所有源代码必须使用 UTF-8（无 BOM）编码。自动清除 U+FEFF 字符。

---

## 第四章：历史故障防御规则

### Article 4.1：权限防火墙
严禁扫描系统关键目录（C:\Windows、System32、C:\Program Files 等）。所有批量文件扫描必须限定在工作空间内。

### Article 4.2：Git 安全门禁
执行 git push 前必须通过 `do_git.py --push --verify-lock` 检查远程仓库配置。本地操作不受限。

### Article 4.3：阻塞探测器
执行 Get-ChildItem 或大批量目录遍历时，必须注入进度提示或设置超时限制。高容量目录使用 `-Depth 2` 限制深度，总耗时不得超过 60 秒。

### Article 4.4：上下文防刷屏与大对象拦截协议

#### Article 4.4.1
严禁在未加限制的情况下在根目录或回收站运行全局文件扫描（如无限制的 Get-ChildItem 或 find）。

#### Article 4.4.2
任何涉及路径检索、日志读取的操作，必须强制追加限制参数（例如使用 `-Depth 2`，或配合 `Select-Object -First 20` 限制输出行数），防止过长的文本刷屏击穿模型的思考上下文导致僵死。

#### Article 4.4.3
如果在执行命令后超过 30 秒未能生成有效下一步动作，必须自主中断当前逻辑，向用户抛出极简状态总结，严禁无限消耗 Token。

---

### Article 4.5：服务依赖与异常洪流拦截协议

#### Article 4.5.1 [依赖先行原则]
在启动任何前端项目（如 Vite 运行）前，必须优先检查并启动对应的后端服务（如 FastAPI / 核心 Engine），严禁在后端断线的情况下单端空转前端。

#### Article 4.5.2 [报错熔断机制]
在执行本地开发命令时，若检测到终端出现连续相同异常（如每秒重复提示 ECONNREFUSED）超过 3 次，必须立即主动终止（Kill）该终端进程，禁止任由报错刷屏击穿上下文。

---

### Article 4.6 [持久化服务后台异步挂起协议]

#### Article 4.6.1 [前台阻塞禁止]
严禁在主终端中直接运行带有持久监听属性的阻塞命令（如 `uvicorn`、`npm run dev`、`nodemon` 等）。此类命令必须以后台守护进程形式启动。

#### Article 4.6.2 [标准异步后台启动]
在 Windows 环境下启动此类守护进程，必须使用以下标准模式：
```powershell
Start-Process powershell -ArgumentList '-NoExit', '-Command', 'python -m uvicorn livebench.api.server:app --port 8020'
```
或用 `execute_command` + `requires_approval: false` 触发 `start` / `Start-Process` 在新窗口中后台挂起，不得阻塞当前对话。

#### Article 4.6.3 [自主释放防卡死]
一旦终端输出出现以下关键字之一，必须立即判定"服务已就绪"，并在 5 秒内释放当前步骤（Proceed While Running 或发起并行验证）：
- `running on http://...`
- `compiled successfully`
- `Application startup complete`
- `Ready on port`
绝对禁止在终端前台死等进程自然结束。

---

## 第五章：防御性编程规则

### Article 5.1：路径零歧义原则
所有路径字符串强制包裹在双引号内。禁止直接拼接路径，必须使用 `os.path.join()`。

### Article 5.2：执行命令标准化
严禁使用 `cd`/`Set-Location`/`Push-Location`。必须使用绝对路径直接执行。Git 操作使用 `git -C "绝对路径"`。

### Article 5.3：强制静默重试
失败时自动检测错误码，路径解析错误自动执行引号封装修复重试（至多 2 次）。记录到 error.log 并一次性总结，严禁死循环。

---

## 第六章：多实例并行协作协议

### Article 6.1：工位职能隔离
- 开发工位仅允许业务逻辑编码，严禁修改 `Cline-anti-freeze/.clinerules`、`clinerules.yaml`、`protocols`、`governance_evolution.md`、`monitor.py`、`governance_linker.py`。
- 治理工位拥有全局治理规则的编辑权与执法权。
- 每个实例启动时通过 `governance_linker.py --boot-check` 验证角色。

### Article 6.2：并行写入互斥
并行实例向 error_log.md 写入日志时必须遵循 `[时间戳 | 实例ID | 模块/错误内容]` 格式。通过 FileLock 互斥机制规避冲突。

### Article 6.3：宪法唯一源
所有实例启动时验证治理中心是否为 `Cline-anti-freeze/`。非治理工位修改宪法被拒绝。

### Article 6.4：心跳同步机制
开发工位执行长任务（>30秒）时向 error_log.md 发送心跳。治理工位每 60 秒扫描心跳，超过 90 秒无心跳判定为"失活"。

### Article 6.5：Master 分支推送加锁检查
所有 master 分支推送必须通过 `do_git.py --push --verify-lock` 检查，防止多实例并发推送冲突。

---

## 第七章：自主扫描与登记协议

### Article 7.1：自动巡检
在任何 VSC 实例启动时，扫描 git008 根目录下所有顶级文件夹。
### Article 7.2：差异对比
将扫描结果与 `Cline-anti-freeze/project_registry.md` 进行比对。
### Article 7.3：发现即登记
发现未登记文件夹时，在 registry.md 中追加登记记录，验证项目结构，运行治理链接脚本。
### Article 7.4：状态报告
发现新项目后，在首次对话中向 CEO 汇报。

---

## 第八章：错误报告与防卡死协议（Error Reporting & Anti-Hang Protocol）

### Article 8.1：零静默原则（Zero-Silence Policy）
任何 `try/except` 块不得静默吞没异常。必须执行以下操作：
- 通过 `error_reporter.report_error()` 将完整 traceback 写入 `governance_logs/error_report.json`
- 同时在 `error_log.md` 追加结构化日志条目（时间戳 | 模块 | 严重度 | 错误摘要）
- 严重度分级：INFO、WARNING、ERROR、CRITICAL
- CRITICAL 级别错误需立即通过 WebSocket 广播至治理控制台仪表盘

### Article 8.2：防卡死看门狗（Anti-Hang Watchdog）
所有 Agent 任务执行器和长时间运行循环必须附加 `Watchdog` 监控器：
- 默认空闲超时：**30 秒**（可通过 `global_controls.json` 的 `heartbeat_timeout_sec` 调节）
- 超过超时阈值未产生心跳（`ping()`）即判定为 "Stuck/Hang"
- 触发 Hang 后自动执行：
  1. 运行自我诊断（捕获所有线程堆栈、环境状态）
  2. 调用 `dump_state()` 保存上下文快照至 `governance_logs/crash_dumps/`
  3. 通过 `error_reporter` 上报 CRITICAL 级别故障
  4. 调用 `hang_callback` 执行恢复（kill + reinitialize）

### Article 8.3：上下文保留崩溃恢复（Context-Preserving Crash Recovery）
在进程被看门狗强制终止前，必须：
- 调用 `Watchdog.dump_state("crash")` 将当前执行上下文写入 JSON 文件：
  - task_id、agent_signature、module
  - 所有活跃线程的堆栈回溯（stack trace）
  - 运行时间、最后活动时间、超时配置
  - 附加上下文（context 字典）
- 治理中心读取 dump 文件后调用 `create_clean_restart_plan()` 生成恢复计划
- 恢复计划包含：kill zombie → clear stale locks → re-initialize → retry

### Article 8.4：心跳失活自动清理
治理中心 `governance_ui.py` 启动时必须：
1. 每隔 **3 秒** 遍历所有已注册项目的 `.heartbeat` 文件
2. 检查心跳时间戳，超过 `heartbeat_timeout_sec`（默认 120 秒）判定为 "HANG"
3. 判定 HANG 的项目执行：
   - 扫描 `governance_logs/crash_dumps/` 获取最后状态 dump
   - 读取 dump 中的 agent_signature 和 module
   - 调用 `monitor.py --kill-agent <agent_signature>` 强制终止僵尸进程
   - 根据 `create_clean_restart_plan()` 重新初始化 Agent
4. 所有操作记录到 `governance_logs/watchdog_diagnostics.json`

### Article 8.5：实施文件
- `Cline-anti-freeze/error_reporter.py` — Rule 1 零静默原则实现
- `Cline-anti-freeze/watchdog.py` — Rule 2 & 3 看门狗 + 崩溃恢复实现
- `Cline-anti-freeze/governance_ui.py` — Rule 4 心跳监控集成
- `Cline-anti-freeze/governance_logs/` — 运行日志与故障快照存储目录

---

> 本宪法最后更新：2026-06-06
> 当前宪法版本：v2.2
> 防御规则总数：30 条
