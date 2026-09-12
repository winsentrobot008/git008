# git008 项目宪法 (AGENTS.md)

> 本文件是 git008 工作区的操作级宪法。治理中心（Cline-anti-freeze）在运行时
> 动态解析本文件，并把规则同步到 `.codex/governance.json` 的执行层。
> 仅对 git008 工作区生效，不作用于其他 VS Code 项目。

## Forbidden Directories

以下目录禁止 Agent 直接读取/写入（治理黑名单，动态同步）：

- `output/`
- `work/`
- `node_modules/`
- `.git/`

禁止读取的敏感文件：

- `.env`

## Token Limits

治理中心据此控制单次会话与上下文体积（动态同步到 governance.json）：

- `max_session_tokens: 80000` — 单会话 Token 上限，超限自动熔断 Force Stop
- `max_request_tokens: 80000` — 单次请求 Token 上限，超限拒绝该请求
- `max_context_tokens: 30000` — 上下文体积上限，超限弹窗提醒运行 /clear
- `context_warn_rounds: 5` — 连续对话超过 5 轮触发上下文膨胀提醒
- `daily_budget_tokens: 2000000` — 全天消耗额度，超限暂停会话

## Governance

- 治理联动仅作用于 git008 工作区（scope: workspace-only）。
- 任务完成时，治理中心自动提示：`上下文膨胀，请立刻运行 /clear`。
- 违反禁读目录或 Token 上限时，治理中心自动阻断并弹窗警告。
