# git008 根项目治理宪法（Root Governance Constitution）
适用于：git008 根目录及其所有子项目（projects/*）

## 第 1 条：禁止未授权修改根文件（Root Documents）
以下文件属于根文件，禁止任何 Agent（包括 ZOO）在未接到 CEO 或 CTO 明确指令时修改：
- README.md
- docs/*.md
- 项目说明书
- 根配置文件（如 vite.config.js、main.py、package.json、pyproject.toml）

## 第 2 条：禁止使用会导致文件自动覆盖的危险 Git 命令
以下命令属于红色禁令（禁止执行）：
- git checkout .
- git restore .
- git reset --hard
- git merge（未确认冲突）
- git pull（未确认远程版本）
- VSCode 的 Discard Changes

这些命令会导致根文件被自动覆盖，属于违宪行为。

## 第 3 条：所有子项目必须继承根治理规则
git008\projects\* 下的所有子项目必须遵守本宪法，包括：
- FireworkBloom
- Lagom
- EmotionEngine
- AI-Video
- 以及未来新增的所有项目

## 第 4 条：README.md 必须启用三重保护机制
1. Git 合并锁定（merge=ours）
2. pre-commit 钩子（禁止提交修改）
3. 文件系统只读保护（attrib +R）

适用于根 README.md 和所有子项目 README.md。

## 第 5 条：README.md 修改必须经过 CEO 授权流程
流程：
1. CEO 下达指令
2. CTO 给出解除保护任务
3. ZOO 执行解除保护
4. 修改 README.md
5. 恢复保护机制

任何跳过此流程的修改属于违宪行为。

## 第 6 条：Agent 必须遵守"只执行任务，不做推断"原则
ZOO 不得：
- 自动优化
- 自动清理文件
- 自动恢复旧版本
- 自动合并分支
- 自动修改任何文件

只能执行 CEO 或 CTO 明确下达的任务。

## 第 7 条：所有系统级错误必须记录到系统修复日志
文件：
- docs/system_repair_log.md（根项目）
- projects/*/docs/system_repair_log.md（子项目）

必须记录：
- 错误原因
- 修复步骤
- 影响范围
- 防御措施
- 宪法条款更新
