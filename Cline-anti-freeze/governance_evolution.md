# 治理体系演进记录

## 阶段一：分散治理
- 各项目独立维护 .clinerules
- 缺乏统一标准和协调

## 阶段二：集中治理
- 创建 .governance_system/ 作为统一治理入口
- 引入 governance_linker.py 自动链接

## 阶段三：防卡死协议
- 重命名为 Cline-anti-freeze/
- 集成 Anti-Freeze 强制协议
- 统一治理与防卡死双重职能

## [2026-06-05 09:37:27] 治理演进记录

## 阶段四：自动化治理闭环（2026-06-05）
### 核心进展
- **自动化协议启动**: 实现开机自检(Boot Sequence)全自动执行——接手任务自动运行 monitor.py、验证 .clinerules 加载、do_git.py 环境权限检测、24h 错误扫描四步预检查
- **防御闭环加固**: 基于 2026-06-04 的 4 条历史故障(PermissionDenied / GitPushError / IOBlock)完成根因分析与宪法规则注入，新增 .clinerules 第 6/7/8 条防御规则
- **Monitor 升级**: monitor.py 从 v1.0 精简版(21行)升级至 v3.3.5 完整版(467行)，支持 --report / --scan-errors / --kill-all / --local-test / --evolution 完整 CLI
- **自愈能力**: kill_all_agents() 僵尸进程终止函数就绪，5 次连续关键错误触发自动自愈
- **宪法哈希**: constitution_hash=84507160b7c130d5，防篡改签名已启用
### 待演进事项
- Sentinel 守护进程模式(--daemon)需在持久化环境中启用
- Maneki-AI / ClawWork worker 任务需在防御闭环通过后自动调度

---

## [2026-06-05 09:45:00] 治理演进记录

## 阶段五：多实例并行协作协议（2026-06-05 宪法修正案）

### 修正法案概要
本次宪法修正案引入「多实例并行协作协议 (Multi-Instance Protocol)」，为 git008 治理体系在多个 Cline 实例并行运行场景下提供完整的协调与隔离机制。

### 核心变更

#### 1. governance_linker.py（新建）
- **职能**: 所有 Cline 实例的治理入口验证器
- **功能**:
  - 实例身份生成与管理（hostname-PID-uuid8）
  - 角色识别（governance / development）
  - 宪法唯一源验证（确认治理中心为 Cline-anti-freeze/）
  - 宪法文件写入权限拦截（非治理工位无权修改）
  - 跨进程文件锁（FileLock）防止并行写入冲突
  - 实例注册表管理与心跳注册
  - 启动自检 CLI（--boot-check）

#### 2. monitor.py 升级至 v3.5.0
- **新增函数**:
  - `get_governance_instance_id()` — 获取治理工位实例 ID
  - `log_error()` 升级 — 日志格式改为 `[时间戳 | 实例ID | 模块]`
  - `log_heartbeat()` — 心跳存活信号写入
  - `load_instance_registry()` — 加载实例注册表
  - `scan_instance_heartbeats()` — 扫描 error_log.md 中各实例心跳
  - `check_stale_instances()` — 检查开发工位心跳超时
  - `generate_report()` 增强 — 含多实例心跳检查
  - `sentinel_daemon()` 增强 — 注册实例、周期性心跳扫描、超时告警
- **新增 CLI 参数**: `--heartbeat`, `--check-stale`, `--list-instances`

#### 3. .clinerules 新增规则 9-12
- **规则 9**: 工位职能隔离（Functional Isolation）
- **规则 10**: 并行写入互斥（Write Mutex）
- **规则 11**: 宪法唯一源（Single Source of Truth）
- **规则 12**: 心跳同步机制（Heartbeat Synchronization）

#### 4. clinerules.yaml 升级至 v2.0
- 新增 `multi_instance` 配置节，定义角色、能力、限制、心跳参数
- 新增 `error_log_format` 规范定义

#### 5. error_log.md 格式迁移
- 从 v1.0 表格格式迁移至 v2.0 `[时间戳 | 实例ID | 模块]` 格式
- 历史条目保留为归档参考

#### 6. protocols 升级至 v2.0
- 新增多实例并行协作治理职能声明
- 明确治理工位与开发工位角色定义

### 防御体系当前状态
- .clinerules: 8 项防卡死约束 + 3 项历史故障防御规则 + 4 项多实例并行协作协议 = **15 条防御规则**
- governance_linker.py: 就绪（实例管理、角色验证、文件锁、启动自检）
- monitor.py: v3.5.0 就绪（多实例心跳监控、自愈触发）
- 状态: **HEALTHY** — 多实例并行协作协议已部署

---

## [2026-06-05 17:28] 治理演进记录

## 阶段六：防御性编程宪法修正案（2026-06-05）

### 修正法案概览
本次宪法修正案引入**三条「防御性编程」宪法修正案**，针对 PowerShell 对带有中文和空格的路径处理能力极弱的问题，实施全面路径安全改造。

### 核心变更

#### 1. lib/path_utils.py（新建）
- **职能**: 防御性编程路径工具模块
- **功能**:
  - `safe_quote(path)` — 将路径强制包裹在双引号内（路径零歧义原则）
  - `abs_path(path)` — 返回规范化绝对路径
  - `quote_abs_path(path)` — 同时应用绝对路径和双引号包裹
  - `join_path(*parts)` — 使用 os.path.join 安全拼接路径
  - `run_command(cmd)` — 执行命令，带自动静默重试机制
  - `run_python_script(script, *args)` — 一步到位执行 Python 脚本
  - `build_cmd(target, *args)` — 构建标准化命令列表

#### 2. 路径零歧义原则（Zero-Ambiguity Principle）
- 所有涉及路径的字符串，必须强制包裹在双引号内（`"${path}"`）
- 禁止直接使用路径拼接，必须使用 `os.path.join()` 或 `join_path()` 处理
- 已在以下文件中实施：tools/ffmpeg_wrapper.py, sandbox/sandbox_launcher.py, sandbox/process_monitor.py

#### 3. 执行命令标准化（Standardized Execution）
- 严禁使用 `cd`/`Set-Location`/`Push-Location` 进入目录后再执行
- 必须使用绝对路径直接执行
- 已在以下文件中实施：build_exe.bat, audit_and_build.ps1, scripts/build_exe.ps1, scripts/rename_and_rebrand.ps1

#### 4. 强制静默重试（Silent Retry）
- 失败时自动检测错误码，若为路径解析错误，自动执行引号封装修复重试（至多 2 次）
- 记录到 error.log 并一次性总结，严禁死循环
- 已在以下文件中实施：lib/path_utils.py（核心实现）, tools/ffmpeg_wrapper.py（调用层）

### 修改文件清单
| 文件 | 修改内容 |
|------|---------|
| lib/path_utils.py | **新建**—路径工具模块 |
| tools/ffmpeg_wrapper.py | 导入 path_utils；_run() 改用 run_command 实现静默重试；新增 _ensure_quoted_args() |
| sandbox/run_in_sandbox.py | 导入 path_utils；使用 abs_path() 解析目标程序路径 |
| sandbox/sandbox_launcher.py | 导入 safe_quote/join_path；命令参数强制双引号包裹；使用 join_path 替代路径拼接 |
| sandbox/process_monitor.py | 导入 safe_quote；safe_popen() 中命令路径强制双引号包裹 |
| 视频生产APP.py | 导入 path_utils 模块 |
| build_exe.bat | 使用绝对路径直接执行 pyinstaller，移除 cd |
| audit_and_build.ps1 | 移除 Push-Location/Pop-Location，使用绝对路径直接执行 |
| scripts/build_exe.ps1 | 移除 Set-Location，使用绝对路径直接执行 |
| scripts/export_video.ps1 | 使用 -LiteralPath 和 Resolve-Path 获取绝对路径 |
| scripts/import_sample.ps1 | 使用 -LiteralPath 和 Resolve-Path 获取绝对路径 |
| scripts/rename_and_rebrand.ps1 | 使用 git -C 替代 Set-Location；使用 -LiteralPath |

### 防御体系当前状态
- .clinerules: 8 项防卡死约束 + 3 项历史故障防御规则 + 4 项多实例并行协作协议 + 3 项防御性编程规则 = **18 条防御规则**
- lib/path_utils.py: 就绪（防御性编程路径工具）
- 状态: **HEALTHY** — 防御性编程宪法修正案已部署
