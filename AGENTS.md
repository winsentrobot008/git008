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

## Root Architecture

`git008` 是唯一中央仓库，所有子项目以目录形式纳入同一工作区，不拆分为独立仓库。

- 根级治理：`AGENTS.md`（本文件）、`.clinerules`（启动协议）、`PROJECT_STATUS.md`（进度与配置索引）。
- `products/`：可独立发布的产品子项目（`008ai-landing`、`calorieai`、`RoastBro`、`Confession` 等）。
- `factory_components/`：治理与运行时组件（`tools/Cline-anti-freeze` 为治理中心，另有 `constitution`、`orchestrator`、`second_brain`、`vision_engine`）。
- `factory_core/`、`services/`、`scripts/`、`qa_delivery/`：核心流水线、常驻服务、脚本与验收资产。
- `projects/`、`docs/`、`config/`：项目级产物、文档与配置。
- 禁读写目录与敏感文件以本文档开头的规则为准。

### products/008ai-landing

- Next.js 16 + Tailwind v4 产品站，生产域名为 `https://008ai.online`。
- 承载单一产品 **CALauraAI**（`src/app/(apps)/calaura`）：外层是一个沉浸式 AI 娃娃（Lumi）+ 毛玻璃输入条的极简表面，内里是摄入（Calorie Bestie）与消耗（Fit Bestie）双 AI 交叉闭环。
- API 路由位于 `src/app/api/**`（`calaura/chat`、`calaura/tts`、`calaura/entitlement`、`calaura/recognize`、`paypal/*`、`stripe/*`、`admin/*`）；`savage-fit/*`、`savage-cal/recognize` 为保留的旧别名 shim（同实现 re-export，不得 404）。
- 旧页面路由 `/savage-cal`、`/savage-fit` 保留为别名（各预选一半闭环），`/calaura` 为 canonical；全站品牌与文案一律使用 **CALauraAI**。
- 食物识别桥接子项目 `products/calorieai`；项目级规则见 `products/008ai-landing/.clinerules`。

## Build Gates

- 【类型门禁】任何 commit 或 deploy 之前必须先执行 `npx tsc --noEmit`；退出码非 0 时禁止继续。
- 【子项目内执行】门禁必须在目标子项目目录内执行（如 `products/008ai-landing`），禁止在根目录代跑。
- 【构建配置约束】`vercel.json` 禁止同时声明 `builds` 与 `functions`（触发 FUNCTIONS_AND_BUILDS 导致部署直接失败）；函数执行时长以路由级 `export const maxDuration` 为准。

## Release Policy

- 【唯一发布通道】生产发布必须执行 `node scripts/vercel-api-deploy.mjs`，工作目录固定为 `products/008ai-landing`。
- 【凭据注入】脚本依赖 `VERCEL_TOKEN` 环境变量注入，严禁写入仓库或提交历史；仓库无 CI（无 `.github/workflows`），发布由人工触发。
- 【成功判定】部署状态为 `READY` 且 `008ai.online` 别名重新绑定后，方可判定发布成功。
- 【发布后冒烟】`/calaura`（及别名 `/savage-cal`、`/savage-fit`）返回 200 且 EN 视图无 CJK；`/api/calaura/chat`（及别名 `/api/savage-fit/chat`）返回应用层错误（400/503）而非 404。

## Required Environment Keys

以下为运行与发布的必需键清单，仅登记键名，严禁登记真实值：

- 发布与后台：`VERCEL_TOKEN`、`ADMIN_KEY`
- AI 能力：`GEMINI_API_KEY`、`CALORIE_AI_API_URL`、`CALORIE_AI_API_KEY`
- 支付：`STRIPE_SECRET_KEY`、`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`、`NEXT_PUBLIC_PAYPAL_CLIENT_ID`、`PAYPAL_CLIENT_SECRET`、`PAYPAL_WEBHOOK_ID`
- 语音：`TTS_SUBSCRIPTION_KEY`、`TTS_REGION`
- 站点：`NEXT_PUBLIC_SITE_URL`（生产固定为 `https://008ai.online`）

缺失必需键时按各路由的 503 契约处理（`AI_KEY_MISSING` / `TTS_UNAVAILABLE` / `RECOGNITION_NOT_CONFIGURED`），不得回退 Mock 数据。
