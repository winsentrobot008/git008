# GIT008 — SaaS Matrix Factory（套娃矩阵工厂）· AGI 治理系统

**版本**: 2026.08 | **状态**: ✅ 运行中 | **健康评分**: 100/100

> **定位**：GIT008 是 **SPU 优先（SPU-first）的 SaaS 套娃矩阵工厂**——批量生产同构 AI SaaS（CalorieAI / PetAI / PlantAI…）。每个套娃应用即一个**独立 Git 仓库**（主仓库 gitlink 指针同步），自带商业化中台内联快照（`@git008/commercial-engine`）与直连 AI 调用，克隆后配置自有密钥即可**独立构建与部署**。
> 
> **Central Gateway 是可选组件**：仅作为多项目密钥集中托管 / 统一端点的开发者与矩阵代理，**不是任何应用的运行时必需**。

---

## 📋 目录

- [1. 矩阵全局架构图](#-1-矩阵全局架构图)
- [2. 主 / 子仓库协同机制](#-2-主--子仓库协同机制)
- [3. 1-Step App Clone 规范](#-3-1-step-app-clone-规范)
- [4. 套娃应用矩阵与接入状态](#-4-套娃应用矩阵与接入状态)
- [5. Central Gateway（中央大脑与收银中枢）](#-5-central-gateway中央大脑与收银中枢)
- [6. AGI 治理系统](#-6-agi-治理系统)
- [7. 目录结构](#-7-目录结构)
- [8. 系统脚本](#-8-系统脚本)
- [9. 数据与报告](#-9-数据与报告)
- [10. 开发者指南](#-10-开发者指南)
- [10.6 AI 工厂 SOP 说明书（docs/AI_FACTORY_SPEC.md）](#-106-ai-工厂-sop-说明书docsai_factory_specmd)
- [11. 矩阵商业运营与流量变现 SOP](#-11-矩阵商业运营与流量变现-sop)
- [12. 版本历史](#-12-版本历史)

---

## 🌐 1. 矩阵全局架构图

```text
┌──────────────────────────── GIT008 SaaS Matrix Factory ────────────────────────────┐
│                                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐         │
│   │  SaaS Central Gateway（中央大脑与收银中枢）· projects/central-gateway│         │
│   │  /api/v1/ai/vision · /api/v1/billing/checkout · /api/v1/credits     │         │
│   │  App-Token 鉴权 · 动态 CORS 白名单 · 限频 · 上游密钥集中托管          │         │
│   └──────────┬──────────────────────┬───────────────────┬───────────────┘         │
│              │ 密钥集中托管（可选）  │ 仅网关模式        │                          │
│   ┌──────────▼─────────┐   ┌────────▼─────────┐ ┌──────▼─────────┐                 │
│   │ CalorieAI（参考实现）│   │ PetAI（克隆示例）  │ │ PlantAI（可克隆）│  … 矩阵可扩展  │
│   │ products/calorieai │   │ products/petai   │ │ products/plantai│                 │
│   │ 独立 Git 仓库+指针   │   │ (submodule)      │ │ (submodule)     │                 │
│   └────────────────────┘   └──────────────────┘ └────────────────┘                 │
│                                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐         │
│   │  AGI 治理层：宪法 rules.py · 哨兵 sentinel_ws · 执行器 executor · 沙箱 │         │
│   │  受保护资产：second-brain（记忆）· vision-engine（视觉）              │         │
│   └─────────────────────────────────────────────────────────────────────┘         │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

> **架构说明**：上图中 Central Gateway 为**可选**的矩阵级代理；每个 SPU 默认以内联商业化中台 + 直连 AI 独立运行，不依赖网关。

## 🔗 2. 主 / 子仓库协同机制

| 层级 | 职责 | 同步方式 |
|------|------|---------|
| **主仓库 git008** | 工厂与治理中枢；网关模块源码（`projects/central-gateway`）；套娃子仓库指针 | 直接提交 + push 分支 |
| **子仓库（products/*）** | 每个套娃应用独立 Git 仓库（如 `calorieai` → GitHub `winsentrobot008/calorieAI`），独立部署 Vercel | 子仓库 push main；主仓库提交 `chore(git008): bump <app> submodule pointer` |
| **Central Gateway** | 独立可部署模块（自托管 Node / Vercel Serverless） | 随主仓库提交；部署平台配置密钥 |

**质量门禁**：子仓库 pre-commit / pre-push 内置路由检查（`check-routes.mjs`）；`npm run test:api` 与 `npm run qa:ui` 内置**语义级 QA 反 Mock 门禁**（AI 路由随机输入 + Provider 标记 + 硬编码 Mock 签名 FAIL 阻断）；线上回归由 `scripts/qa_inspect.py` 做 **0-Token E2E 巡检**（0 Console / 0 网络错误）。

---

## ⚡ 3. 1-Step App Clone 规范

### 3.1 克隆落地（约 10 分钟）

| # | 步骤 | 说明 |
|---|------|------|
| 1 | 复制模版 | `cp -r products/calorieai products/petai` |
| 2 | 全局重命名 | `calorieai → petai`、`CalorieAI → PetAI`、`app_id → petai` |
| 3 | 配置密钥 | `cp .env.example .env.local`（最小集：AI Key + Stripe 双 Key） |
| 4 | 本地门禁 | `npm install && npm run build` |
| 5 | 一键上线 | Vercel Import → Deploy（`vercel.json` 已内置 framework/build） |
| 6 | 支付 Webhook | Stripe → `/api/stripe/webhook` |
| 7 | 独立上线 | SPU 自包含，无需网关；如需多项目密钥集中托管再可选接入 Central Gateway |

### 3.2 可选：接入 Central Gateway（多项目开发者代理）

```bash
# 可选：仅当需要密钥集中托管 / 统一端点时才配置（SPU 默认不接网关）
GATEWAY_BASE_URL=https://<your-gateway>.vercel.app
GATEWAY_APP_TOKEN=tok_calorieai_xxx
```

未配置这两项时，SPU 走本地商业化中台与直连 AI（**默认路径**）；网关仅在这两个环境变量存在时才参与请求。

**网关（可选）提供的能力**：

1. 网关颁发 `GATEWAY_APP_TOKEN`（`GATEWAY_APP_TOKENS={"petai":"tok_petai_xxx",...}` 一行注册）；
2. 使用网关的部署再配置 `GATEWAY_BASE_URL + GATEWAY_APP_TOKEN` 两项环境变量（**SPU 默认不需要**）；
3. 网关侧统一 `credits`（跨端积分）、`billing/checkout`（统一收银台）、`ai/vision`（统一识图），
   便于多项目共享计价 —— **改网关一处配置，已接入的应用即按新配置收银**；未接入的 SPU 不受影响。

**10 分钟一键克隆引擎（v3.4）**：`node scripts/clone_app.mjs petai` 自动复制标准模版（`products/calorieai`）并全局重命名；克隆后只需改 `src/lib/app-config.ts`（App-ID/Prompt/配色）+ i18n 文案即可上线，详见 [`TEMPLATE_APP.md`](TEMPLATE_APP.md)。

---

## 🧬 4. 套娃应用矩阵与接入状态

| 应用 | 路径 | 状态 | 网关接入（可选） |
|------|------|:---:|------|
| **CalorieAI** | `products/calorieai` | 🟢 生产就绪（Vercel 实盘巡检通过） | SPU 自洽（内联商业化中台；网关可选） |
| **PetAI** | 待克隆 | 🟡 模板可直接克隆 | SPU 自洽（可选接网关） |
| **PlantAI** | 待克隆 | 🟡 模板可直接克隆 | SPU 自洽（可选接网关） |
| **…** | 任意同构 AI SaaS | 🟢 矩阵可扩展 | 克隆即独立运行；如需网关再注册 `GATEWAY_APP_TOKENS` |

---

## 🛰️ 5. Central Gateway（可选 · 矩阵级开发者代理）

位于 [`projects/central-gateway`](projects/central-gateway/README.md)，Hono + Node + TypeScript：

| 统一端点 | 能力 |
|----------|------|
| `POST /api/v1/ai/vision` | 按 `app_id` 切换 Prompt 的统一 AI 识图（A→B→C 回退） |
| `POST /api/v1/billing/checkout` | 统一 Stripe / PayPal 收银发起，透传 `app_id` |
| `GET/POST /api/v1/credits` | 跨端积分 / Pro 权威判定 |

安全：App-Token / Bearer 鉴权（`GATEWAY_APP_TOKENS` 注册表）、动态 CORS 白名单（精确 + `*.` 通配）、滑动窗口限频。上游密钥（OpenAI/OpenRouter、Stripe、KV/Postgres）只存在于网关环境变量。

### 5.1 商业模式核心（矩阵变现模型 · 2026.08 定稿）

**彻底弃用“强按月订阅（Subscription Traps）”**，全矩阵统一以下三种变现方式（均为一次性 / 非自动续费）：

| 变现支柱 | 说明 | 网关/应用落点 |
|----------|------|--------------|
| 💰 **一次性积分充值（Credits Top-up）** | 按次付费主模型：用户购买积分包（如 10/50/120 积分），识图等 AI 能力按次扣积分，无月租 | 网关 `billing/checkout` 统一收银 + `credits` 跨端记账；CalorieAI 参考实现已上线 |
| 🎬 **看广告领积分（Free Tier）** | 免费用户通过观看激励广告赚取积分，形成免费漏斗 + 广告收益 | 各套娃 `ad-reward` 端点（服务端权威 +N 积分） |
| 🃏 **终身买断卡（Lifetime Access）** | 可选的一次性买断 SKU：一次性付款解锁终身权限，**无续费、无订阅** | 网关/套娃以 One-Time Checkout 下发一次性会话 |

> 原则：**任何情况下不向用户强推按月/按年自动续费**。订阅类事件（`customer.subscription.*` / `invoice.*`）在网关与套娃侧一律视为遗留并忽略。

### 5.2 SPU 自洽优先，网关可选（SPU-First, Gateway Optional）

- **计费与计价默认由 SPU 本地自洽**：积分包目录与价格来自 `@git008/commercial-engine/middleware/credit-packs.ts`，支付渠道（Stripe/PayPal）在 SPU 路由内直连；接入网关时才改由网关 `GATEWAY_APP_TOKENS` 注册表 + `billing/checkout` 统一下发；
- **改一处，接入方生效**：调整网关配置后，已接入网关的应用无需改代码或重新发版；SPU 本地模式则升级权威实现后同步内联快照（`npm run check:engine-sync` 校验）；
- **零 Key 客户端（仅网关模式）**：接入网关时套娃前端不持有上游密钥，只持 `APP_ID + GATEWAY_APP_TOKEN`；SPU 模式下密钥只存在于自身部署环境变量；
- **无网关依赖**：SPU 默认不依赖网关，网关可用性与否都不影响 SPU 独立运行。

### 5.3 管理后台安全隐身（Admin Security Isolation）

- **前端 DOM 隐身**：底栏【管理后台】按钮（及 Logo 双击入口）仅在登录身份含 `admin`（`role: "admin" / "superadmin"`）或等于 `NEXT_PUBLIC_ADMIN_USER_ID` 时才渲染；普通用户（即使 Pro）**DOM 中完全不存在**该按钮；
- **后端强制拦截**：`/api/admin/*`（含 `/api/v1/admin/*`）全部强制鉴权，无令牌/伪造令牌一律 **401**，非法身份访问业务数据一律 **403**；
- **令牌机制**：管理登录签发 24h 随机 `x-admin-token`（服务端持久化），所有管理数据请求必须携带，防止绕过前端直接调用。

---

## 🏛️ 6. AGI 治理系统

### 6.1 协作宪法（总监-程序员体系）

1. **角色分工**：云端 AGI 设计总监负责顶层设计/审计/拆解；本地 ZOO 负责物理编写/合并/执行。
2. **一键指令**：总监提供可复制指令，CEO 直接转达本地运行。
3. **Karpathy 宪法**：写代码前先思考、保持极简、外科手术式修改、目标驱动执行（由 `anti_freeze_check()` 强制执行）。
4. **哨兵监控**：WebSocket 心跳 / 告警 / 自动重连 / 守护进程。

### 6.2 治理覆盖（2026.07 审计后）

| 网关组件 | 状态 |
|---|---|
| 宪法导入（17 个执行器模块） | ✅ 全部受保护 |
| 哨兵钩子（7 个入口点） | ✅ 全部受监控 |
| 心跳监控 / 看门狗 / 治理链接器 / 治理 UI | ✅ 运行中 |

---

## 📁 7. 目录结构

```text
git008/
├── projects/                     📂 产出子项目（非 Git 仓库/网关模块）
│   ├── central-gateway/          🛰️ 中央大脑与收银中枢（Hono，可 Vercel 部署）
│   ├── ViralMint/ OpenMontage/ Confession/ RoastBro/ …
├── products/                     📂 套娃应用（每个均为独立 Git 仓库，submodule 指针同步）
│   ├── calorieai/                🟢 CalorieAI 参考实现（Next.js 16）
│   └── …（PetAI / PlantAI 待克隆）
├── config/                       ⚙️ 根工厂统一配置（config.toml + models.json 模型目录）
├── factory_core/                 🧩 根工厂核心（web_browser / computer_use / llm）
├── master_pipeline.py            🎛️ 根总控：OpenRouter 分发 → 抓取 → 桌面闭环
├── services/                     🔌 自动化服务层（bb-browser 网络感知 + Computer Use 桌面自动化 + 三层流水线）
├── factory_components/           🏛️ 治理中心（constitution / orchestrator / tools）
├── scripts/                      📝 工厂脚本（qa_inspect / clone_app / check_integrations / api_budget_guard）
├── qa_delivery/                  🧪 质检报告与截图（latest.md / screenshots）
├── runtime_data/                 💾 运行时日志与调度数据
└── README.md                     📘 本说明文件
```

---

## 📝 8. 系统脚本

| 脚本 | 路径 | 用途 |
|--------|------|------|
| 主面板 | [`factory_components/tools/scripts/git008_main_panel.py`](factory_components/tools/scripts/git008_main_panel.py) | 中央调度 UI（FastAPI, 端口 8000） |
| 线上巡检 | [`scripts/qa_inspect.py`](scripts/qa_inspect.py) | Playwright 0-Token E2E（写 qa_delivery/reports/latest.md） |
| 管线测试 | [`factory_components/tools/scripts/test_pipeline_run.py`](factory_components/tools/scripts/test_pipeline_run.py) | 集成测试套件 |
| 网关冒烟 | [`projects/central-gateway/scripts/smoke.mjs`](projects/central-gateway/scripts/smoke.mjs) | 网关鉴权/CORS/积分/降级 10 项自检 |
| 根总控 | [`master_pipeline.py`](master_pipeline.py) | OpenRouter 免费模型任务分发 → bb-browser 抓取 → Computer Use 桌面闭环 |

## 🔌 13. 自动化服务层（bb-browser + Computer Use）

> 定位：把「结构化网络抓取」与「桌面 GUI 自动化」接入工厂，实现
> **素材搜集 → 视频渲染 → 桌面发布** 无人值守闭环。详见
> [`services/README.md`](services/README.md)。

| 层 | 模块 | 能力 |
|----|------|------|
| **Fetch** | `services/crawler/` | bb-browser CLI/daemon 复用已登录 Chrome Cookie/Session，站点 adapter 输出低 Token 结构化 JSON（知乎热榜/Twitter/B站/Reddit 等 103+ 命令） |
| **Process** | `services/pipeline/` | 调用现有 `008-video-factory`（Edge-TTS + FFmpeg）`node src/index.mjs --batch` 完成标准视频合成 |
| **Publish** | `services/gui_automation/` | Computer Use 三后端（pyautogui → powershell → MCP）桌面交互；后台/锁屏状态监测，无人值守默认拒绝注入 |

### 13.1 根总控（master_pipeline）

[`master_pipeline.py`](master_pipeline.py) 是根工厂调度入口：由 OpenRouter 免费模型
（`config/models.json` 中 `google/gemini-2.0-flash-exp:free` / `deepseek/deepseek-r1:free`）
按 Chat Completions（`wire_api="chat_completions"`）做任务分发，优先走
`factory_core/web_browser.py` 抓取素材；遇到本地应用渲染 / 复杂桌面操作时自动切入
`factory_core/computer_use.py` 闭环执行。LLM 不可用或 `--offline` 时回退规则分发。

```bash
# 模型下拉菜单数据源（界面可识别）
python master_pipeline.py --list-models

# 在线：LLM 分发 → bb-browser 抓取 → （必要时）渲染/桌面闭环
python master_pipeline.py --task "抓取知乎热榜文案并生成一条 CalorieAI 视频"

# 离线演示：规则分发 + 本地模板（零网络）
python master_pipeline.py --offline --task "抓取热点素材"
```

配置：仓库根 `config/config.toml`（`[llm]` + `[integrations.bb_browser]` / `[integrations.computer_use]` /
`[pipeline]`），环境变量同名覆盖（见 `.env.example`）。

```bash
# 健康检查（bb-browser / Chrome CDP / 屏幕控制接口）
python scripts/check_integrations.py --online

# 三层流水线（离线演示：Fetch 回退本地模板）
python -m services.pipeline --offline --product calorieai
```

接口失败均有明确 Fallback 日志（`runtime_data/logs/integration_fallback.log`），
与现有 Python/TypeScript 脚本完全解耦。

---

## 💾 9. 数据与报告

| 报告 | 描述 |
|--------|-------------|
| [`qa_delivery/reports/latest.md`](qa_delivery/reports/latest.md) | 最新线上 E2E 质检报告 |
| `factory_components/orchestrator/reports/` | 白龙马/巡检任务归档 |
| `runtime_data/logs/dragon_orchestrator.log` | 调度全链路日志 |

---

## 👨‍💻 10. 开发者指南

```bash
# 启动中央面板
python factory_components/tools/scripts/git008_main_panel.py          # → http://localhost:8000

# 网关本地开发
cd projects/central-gateway && npm run dev   # → http://127.0.0.1:8787

# 套娃应用构建门禁（示例）
cd products/calorieai && npm run build

# 0-Token 线上回归
python scripts/qa_inspect.py --url https://calorie-ai-seven.vercel.app
```

---

## 🧪 10.5 最近一次交付前 QA（ZOO ⚔️ CODEX 交叉对抗）

> 日期：2026-08-09 · 对象：CalorieAI（本地生产构建）+ Central Gateway（本地 :8787）

| 测试项 | 结果 |
|--------|------|
| `scripts/qa_inspect.py` 全量 UI E2E | ✅ PASS（0 Console / 0 网络错误） |
| TTS 调试组件/残留 Tab 扫描 | ✅ PASS（Tab 仅剩 记录饮食/数据看板/个人设置） |
| 多语言 × 明暗模式 DOM 盲测 | ✅ PASS（0 报错 / 0 错位） |
| CalorieAI API 全路由冒烟（30 路由） | ✅ PASS（0 404） |
| Central Gateway smoke（10 项） | ✅ PASS |
| 网关对抗测试（伪造 Token / 非法 Origin / app_id 错配 / 预检 / 限频，25 项） | ✅ PASS |
| Stripe Checkout 链接生成（6 支付用例） | ✅ PASS（未开通支付方式自动降级信用卡） |
| PayPal 沙箱订单 / 积分 DAL 读写 | ✅ PASS |

发现并修复：**Stripe Checkout 对未开通支付宝/微信的账户返回 500**（已加自动降级重试 + 前端友好提示）；清理 `test:e2e` 指向已裁撤 `qa-inspector` 的残留脚本；同步 PROJECT_SPEC 中 TTS 描述。

📄 缺陷清单：[`qa_delivery/reports/DEFECTS_LIST_2026-08-09.md`](qa_delivery/reports/DEFECTS_LIST_2026-08-09.md) ｜ 最新 E2E 报告：[`qa_delivery/reports/latest.md`](qa_delivery/reports/latest.md)

---

## 🧪 10.6 AI 工厂 SOP 说明书（docs/AI_FACTORY_SPEC.md）

> 工厂级可复制规范已沉淀至 [`docs/AI_FACTORY_SPEC.md`](docs/AI_FACTORY_SPEC.md)，套娃克隆后必须对齐：

| SOP | 规范内容 | 参考实现 |
|-----|---------|---------|
| **SOP-01** | CEO 拟人化 slowMo=1200ms 轨迹光标巡检：Canvas Custom Pointer（红点 + 蓝色光圈 + 淡出轨迹 + 40px 点击波纹）+ 全 UI 深度巡检（语言/导航/餐次/文字识图/商业化 A-D 分支） | `products/calorieai/scripts/ceo_visual_demo.py`（`npm run demo:visual` / `--mode mobile`） |
| **SOP-02** | 傻瓜式 Vision AI 数量清点与总账：强制 Count、名称带数量+约重（`小笼包 (9 颗 / 约 270g)`）、整盘总热量 Total 契约 | `products/calorieai/src/lib/app-config.ts` Prompt 工厂 + Central Gateway PROMPTS 表 |
| **SOP-03** | 移动端 Canvas 500KB 压缩防爆：最长边 1024px / JPEG 0.8 / ≤500KB 硬约束 / HEIC 兜底 / 「图片已优化 (XXKB)」Toast | `products/calorieai/src/lib/image-utils.ts` |

---

## 📈 11. 矩阵商业运营与流量变现 SOP（Yapi 模式参考与差异化超越）

> **定位**：**借鉴 Yapi 的商业流量策略，绝不照抄其单体架构**。git008 用「流量打法 + 透明变现 + 中央网关架构」的组合拳，实现矩阵级获客与变现：流量端吸收短内容引流精髓，商业端以透明一次性付费建立信任，架构端以 Central Gateway 实现单体 SaaS 做不到的「一处改价、全网同步」。

### 11.1 流量层面（吸收精髓）

| 手段 | 落地方式 | 目标 |
|------|----------|------|
| 🏠 **统一矩阵 Hub 导航站** | 搭建聚合 50+ 套娃应用入口的 Hub 页（SEO 聚合 + 交叉导流），一个链接承载全部产品线 | 流量集中承接、矩阵互导 |
| 🎬 **短视频矩阵引流** | TikTok / YouTube Shorts **15 秒 Demo 录屏**（识图、积分充值、看广告领积分），模板化批量生产与发布 | 低成本获客、算法推荐放大 |
| 🔁 **内容流水线** | 录屏 → 字幕模板 → 批量发布 → Hub 统一承接 → 子应用转化；按播放/转化数据迭代爆款选题 | 可复制、可规模化 |

> 每条短视频固定挂矩阵 Hub 链接，由 Hub 按用户兴趣分发到对应套娃应用（CalorieAI / PetAI / PlantAI…），形成「短视频 → Hub → 子应用 → 付费」闭环漏斗。

### 11.2 商业层面（透明变现）

- **彻底摒弃强订阅套路（Subscription Traps）**：无月租、无自动续费、无隐藏扣费；
- **主打「Credits 一次性充值 + 看广告领积分」**：用户按需充值积分、按次扣费，或用观看广告换取免费额度——**信任度提升 → 支付转化率提升**；
- **免费漏斗清晰**：新用户每日 3 次免费识图 → 广告积分续命 → 积分包 / 终身买断卡（可选一次性）付费；
- **One-Time Checkout 一步直达**：从短视频 Demo 到完成充值 ≤ 2 次点击，支付过程无订阅陷阱干扰。

### 11.3 架构层面（超越与差异化）

**Central Gateway 中央网关是 git008 对单体 SaaS 的硬实力碾压**：

- **1 步克隆**：`GATEWAY_APP_TOKEN` 配置即 10 秒挂载全套积分与收银台，50+ 套娃应用低成本复制；
- **全网积分通用**：跨端统一 `credits` 记账，用户在一个应用的积分/授权全网有效，不存在数据孤岛；
- **改网关即改全网**：积分包目录、价格、终身 SKU 由网关统一下发，**改一处配置 → 全网秒级同步**，无需逐仓改代码、逐仓发版；
- **零 Key 客户端 + 自动回退**：套娃前端不持有任何上游密钥，网关不可用时自动降级直连，旧业务零影响；
- **管理后台安全隐身**：管理入口仅管理员身份可见，后端 `/api/admin/*` 强制 401/403，防止攻击面暴露。

> **差异化结论**：单体 SaaS 改价要逐仓发版、积分各自为政、流量互相割裂；git008 以中央网关为枢纽实现「一套架构、全网收银、一处改价、全网同步」——这才是对 Yapi 模式「取其流量精华、去其架构糟粕」的超越。

---

## 🗓️ 12. 版本历史

| 日期 | 版本 | 变更内容 |
|------|---------|---------|
| 2026.08 | **v3.5** | 新增【AI 工厂 SOP 说明书】（`docs/AI_FACTORY_SPEC.md`）：SOP-01 CEO slowMo=1200ms 轨迹光标巡检（TEMP 真实图片集绑定 + Custom Pointer/Ripple + 全 UI 深度巡检 A-D）、SOP-02 Vision 数量清点与整盘总账、SOP-03 移动端 Canvas 500KB 压缩防爆；calorieai `demo:visual` 桌面/移动双端全绿 |
| 2026.08 | **v3.4** | 引入【语义级 QA 反 Mock 门禁】（smoke-api/qa_ui 动态语义探针：随机输入 + Provider 标记 + Mock 签名 FAIL 阻断）与【10 分钟套娃克隆引擎】（clone_app.mjs + TEMPLATE_APP.md + app-config.ts 集中控制 App-ID/Prompt/配色），实现套娃矩阵标准化 |
| 2026.08 | **v3.3** | 新增 §11 矩阵商业运营与流量变现 SOP：借鉴 Yapi 短内容引流（矩阵 Hub + TikTok/YT Shorts 15s Demo），透明变现（Credits 充值 + 看广告领积分，弃订阅套路），架构差异化（Central Gateway 一处改价全网同步） |
| 2026.08 | **v3.2** | 商业模式重构：弃用按月订阅（Subscription Traps），统一【一次性积分充值 + 看广告领积分 + 终身买断卡】三支柱；写入“中央网关控制一切”集中计价原则与“管理后台安全隐身”规范；网关/CalorieAI 说明书同步 One-Time Checkout 与 1-Step Clone SOP |
| 2026.08 | **v3.1** | 交付前 ZOO/CODEX 交叉对抗 QA：修复 Stripe Checkout 支付方式降级、清理 TTS 调试 UI 后的回归验证、网关安全对抗 25 项全过 |
| 2026.08 | **v3.0** | 新增 SaaS 矩阵架构：Central Gateway（中央大脑/收银中枢）+ 套娃应用矩阵（CalorieAI 参考实现）；1-Step Clone 与 GATEWAY_APP_TOKEN 10 秒接入规范；根 README 重构 |
| 2026.07 | v2.0 | 治理审计与修复：+17 宪法导入、+7 哨兵钩子、目录重组、README 升级 |
| 2026.06 | v1.0 | 初始系统结构（core/ + Cline-anti-freeze/） |

---

*由 ZOO 治理审计管线生成 · 2026-08。*
