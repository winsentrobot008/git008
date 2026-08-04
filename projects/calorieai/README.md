# CalorieAI — 项目 README（AGI 工厂视角）

> CalorieAI 是 AI 驱动的饮食记录与营养分析工具（Next.js 16 + React 19 + TypeScript），已 100% 生产就绪。
> 本文档从 **git008 AGI 工厂**视角记录两套核心协作架构：**Codex (DeepSeek-V4-Flash) 代码重构** 与 **白龙马 (White Dragon Horse) AGI UI 自动化巡检**，以及对应的测试指令。
>
> 实际源码与产品级文档位于独立 Git 仓库 [`products/calorieai`](../../products/calorieai/README.md)（GitHub: `winsentrobot008/calorieAI`，分支 `main`）；`projects/calorieai/` 是工厂侧的项目挂载点，本文档为工厂协作入口。

---

## 📌 项目概览

| 项 | 值 |
|---|---|
| **生产地址** | `https://calorie-ai-seven.vercel.app` |
| **源码仓库** | `products/calorieai`（独立 Git 仓库，Vercel Git 自动部署） |
| **技术栈** | Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4 + Turbopack |
| **支付** | Stripe（信用卡/支付宝/微信）+ PayPal，Webhook → `billing-store` → `data/subscriptions.json` |
| **AI 能力** | Gemini Flash / GPT-4o Vision 食物识别 + Edge-TTS 语音 |
| **i18n** | 自定义零依赖 `LocaleInit` + `hydrated` 双阶段渲染（防 React #418） |

---

## 1. Codex (DeepSeek-V4-Flash) 代码重构架构

### 1.1 角色与边界

**Codex** 是运行在 VS Code 内的代码重构 / Bug 修复代理，模型为 **DeepSeek-V4-Flash**。它遵循 `.codex/instructions.md`（AGI 工厂治理宪法 · Codex 版 v1.1，生效 2026-08-04）：

- **铁律一（代码约束）**：严禁破坏 **React #418 水合保护**、**多语言（i18n）与模版逻辑**、**Next.js 标准配置**；改动后保持结构化、可审计日志。
- **铁律二（职责边界）**：Codex 仅负责 VS Code 内的代码重构与 Bug 修复；**无权修改**白龙马 QA 引擎（`factory_components/orchestrator/`、`qa_delivery/`）与调度中枢。
- **铁律三（协同规范）**：修复 Bug 前必须读取 `qa_delivery/reports/` 下白龙马生成的 `inspection_*.md` 报告，**仅按 Fail 项定向修复**，不得发散改动；修复后说明与 Fail 条目的对应关系。
- **操作边界**：所有操作限定在 `projects/<产品名>/` 细分目录内；禁止扫描根目录 `node_modules`、`.git`、`dist`、`build`、`__pycache__` 等垃圾场目录。
- **命令哨兵**：单次命令超时硬限制 **30 秒**，超时即中止并降级处理。
- **指令优先级**：本宪法（硬约束）> Sentinel 哨兵 > 架构师总监指令 > CEO 指令。

### 1.2 重构闭环工作流

```
白龙马巡检 → 生成 inspection_*.md（Pass/Fail 报告）
     │
     ▼
Codex 读取报告 → 提取 Fail 项（URL/控制台错误/网络错误/截屏路径）
     │
     ▼
定向重构 / 修复（限定 projects/calorieai 内，遵守 #418 / i18n / Next.js 红线）
     │
     ▼
本地全量门禁（test:routes → build → test:api）全绿
     │
     ▼
独立 Git 提交推送（触发 Vercel 部署）→ 白龙马复检 → 直到全部 PASS
```

### 1.3 保护域（红线清单）

| 保护域 | 说明 | 变更要求 |
|---|---|---|
| React #418 水合保护 | `mounted`/`hydrated` 双阶段渲染、`<LocaleInit />`、`suppressHydrationWarning` | 须架构师总监书面批准 |
| i18n / 模版逻辑 | `src/lib/i18n/` 字典加载、语言切换、模版渲染链路 | 严禁无意抹除 |
| Next.js 配置 | `next.config.*` 等标准配置项 | 须架构师总监书面批准 |
| 白龙马 QA 引擎 / 调度中枢 | `factory_components/orchestrator/`、`qa_delivery/` | Codex 无权修改，发现问题上报 |

---

## 2. 白龙马 (White Dragon Horse) AGI UI 自动化巡检架构

### 2.1 角色与宪法

**白龙马** 是本地 AGI 质检官（QA Inspector / Local AGI Orchestrator），遵循 `factory_components/orchestrator/CONSTITUTION.md`（白龙马质检宪法 v1.0，生效 2026-08-04）三大铁律：

- **铁律一（只检不改）**：仅执行巡检、探测与质检，**严禁修改任何应用源码**；唯一写入范围为 `qa_delivery/reports/`（质检报告）与自身日志；问题只记录为 Fail 项，修复移交 Codex。
- **铁律二（巡检模式）**：仅执行 **Headful E2E 巡检**（有头可视模式，`slow_mo=500ms`），输出 Markdown 报告至 `qa_delivery/reports/`，截屏存至 `qa_delivery/reports/screenshots/`。
- **铁律三（报告闭环）**：报告明确列出 **Pass / Fail** 项；Fail 项须含可复现信息（URL、控制台错误、网络错误、交互日志、截屏路径），供 Codex 定向修复后复检闭环。

### 2.2 核心组件

| 组件 | 路径 | 职责 |
|---|---|---|
| 白龙马宪法 | `factory_components/orchestrator/CONSTITUTION.md` | 巡检行为总纲（只检不改 / Headful / 报告闭环） |
| Sentinel 哨兵配置 | `factory_components/orchestrator/config/sentinel.yaml` | CDP 9222 纯被动附加、Safe Pause 熔断、30s 超时 |
| UI 巡检器 | `factory_components/orchestrator/agent/ui_inspector.py` | Playwright 有头巡检：捕获 Console Error / 404/500 / requestfailed，遍历 `button/a/[role=button]`（≤15 个）点击，关闭遮罩、状态恢复、自动截屏 |
| 报告生成器 | `qa_delivery/inspector/report_generator.py` | 生成 `inspection_{task_id}_{ts}.md`，附截图与 Console 错误区块，预留 Webhook 发信出口 |
| AGI 桥接协议 | `factory_components/orchestrator/agi_bridge/protocol_v2.py` | 任务队列流转（`tasks/pending → processing → completed`）+ `report_*.json` 归档 |
| 启动入口 | `factory_components/orchestrator/scripts/start_agent_v2.py` | 拉起 `WhiteDragonHorseV2`，接收 pending 任务并执行 |
| 调度日志 | `runtime_data/logs/dragon_orchestrator.log` | 巡检全链路日志（任务接收/执行/报告生成） |

### 2.3 巡检执行流程

```
任务下发（pending JSON / 指令 UI_E2E inspect <url>）
     │
     ▼
启动白龙马（python scripts/start_agent_v2.py）→ 读取 pending 任务
     │
     ▼
UIInspector 有头模式（headless=false, slow_mo=500ms, CDP 9222 被动附加）
     │   ├─ 捕获 console error / 404/500 / requestfailed
     │   ├─ 关闭遮罩 → 遍历交互元素点击 → DOM 重置/URL 复位
     │   └─ 全页截屏 → qa_delivery/reports/screenshots/
     ▼
QAReportGenerator → qa_delivery/reports/inspection_<task_id>_*.md（PASS/FAIL）
     ▼
Codex 按 Fail 项定向修复 → 重新下发巡检 → 闭环
```

### 2.4 Sentinel 哨兵

- **CDP 监听（9222）**：仅 `127.0.0.1:9222` 纯被动附加（`--connect-current`），严禁 kill/restart/擅自拉起 Chrome。
- **Safe Pause 熔断**：`pynput` 监听人类鼠标位移与按键，检测到焦点丢失 / 按键异常立即暂停，交还控制权（Human-in-the-Loop）。
- **超时**：命令单次 30s；报告等待上限 600s；轮询间隔 5s。

---

## 3. 测试指令

### 3.1 Codex 本地代码质量门禁（在 `products/calorieai/` 内执行）

```bash
npm install
cp .env.example .env.local        # 填入真实密钥（Stripe/PayPal/Gemini/TTS）
npm run dev                       # 本地开发 → http://localhost:3000

# 质量门禁（提交前必过）
npm run test:routes               # 静态路由检查（拦截 /api/api、404 路径）
npm run build                     # 构建（prebuild 自动跑 test:routes；含 TS 校验）
npm run test:api                  # 动态 API 冒烟（启动服务逐个请求 /api，断言 0 404）
npm test                          # = test:routes + test:api

# 支付专项
node scripts/check-stripe-config.mjs   # Stripe 配置检测
node scripts/test-stripe-e2e.mjs       # 支付全链路 E2E
```

> 提交纪律：`npm run test:routes` → `npm run build` → 全绿后 `git add/commit/push`（独立仓库），触发 Vercel 自动部署。

### 3.2 白龙马 UI 自动化巡检

方式 A：**指令下发**

```text
UI_E2E inspect https://calorie-ai-seven.vercel.app/
```

方式 B：**任务 JSON 下发**（放入 `factory_components/orchestrator/tasks/pending/`）

```json
{
  "task_id": "CALORIEAI-E2E-007",
  "test_type": "ui_e2e",
  "url": "https://calorie-ai-seven.vercel.app/",
  "target_product": "calorieai",
  "mode": "headful_e2e",
  "source": "zoo_live_inspection"
}
```

然后启动白龙马：

```bash
cd factory_components/orchestrator
python scripts/start_agent_v2.py
```

**产物归档**：

| 产物 | 路径 |
|---|---|
| Markdown 质检报告 | `qa_delivery/reports/inspection_CALORIEAI-E2E-*.md` |
| 网页截图 | `qa_delivery/reports/screenshots/ui_*.png` |
| 结构化 JSON 报告 | `factory_components/orchestrator/reports/report_CALORIEAI-E2E-*.json` |
| 调度日志 | `runtime_data/logs/dragon_orchestrator.log` |

> 历史巡检：`CALORIEAI-E2E-001` ~ `006` 全部 ✅ PASS（0 Console Error / 0 网络错误）。

### 3.3 qa-inspector Playwright E2E（质检部门）

```bash
cd ../../products/qa-inspector

# 线上生产巡检（Vercel）
QA_INTERACT=1 node scripts/run-qa.mjs https://calorie-ai-seven.vercel.app

# 本地巡检
QA_INTERACT=1 node scripts/run-qa.mjs http://localhost:3000

# 已登录用户 Hydration #418 专项验证（localStorage 预置 user_email）
TARGET_URL=https://calorie-ai-seven.vercel.app npx playwright test tests/hydration-logged-in.spec.ts
```

**全绿口径**：断言 0 Console Error / 0 Uncaught Error（#418）/ 0 404 / 0 4xx，全部 `1 passed`。

### 3.4 报告与修复闭环核对

1. 白龙马生成 `inspection_*.md` 后，Codex 读取并锁定 **Fail 项**。
2. Codex 在 `products/calorieai/` 内定向修复，跑完 §3.1 全部门禁。
3. 重新下发巡检（§3.2），直到报告 **全部 PASS** 才算闭环。

---

## 4. 相关文档

| 文档 | 说明 |
|---|---|
| [`products/calorieai/README.md`](../../products/calorieai/README.md) | 产品级 README（技术栈/支付/API/部署/QA） |
| [`products/calorieai/PROJECT_SPEC.md`](../../products/calorieai/PROJECT_SPEC.md) | 生产规格：Hydration 守则、Agent 守则、套娃 SOP |
| [`products/calorieai/MEMORY.md`](../../products/calorieai/MEMORY.md) | 项目记忆与历史 Bug 自愈履历 |
| [`.codex/instructions.md`](../../.codex/instructions.md) | Codex 治理宪法（重构边界与哨兵） |
| [`factory_components/orchestrator/CONSTITUTION.md`](../../factory_components/orchestrator/CONSTITUTION.md) | 白龙马质检宪法（只检不改 / Headful / 报告闭环） |
| [`factory_components/orchestrator/config/sentinel.yaml`](../../factory_components/orchestrator/config/sentinel.yaml) | Sentinel 哨兵参数 |
| [`qa_delivery/reports/`](../../qa_delivery/reports/) | 白龙马巡检报告归档 |
