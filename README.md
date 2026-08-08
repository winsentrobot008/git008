# GIT008 — SaaS Matrix Factory（套娃矩阵工厂）· AGI 治理系统

**版本**: 2026.08 | **状态**: ✅ 运行中 | **健康评分**: 100/100

> **定位**：GIT008 是 **SaaS 套娃矩阵工厂**——以 **Central Gateway（中央大脑与收银中枢）** 为枢纽，批量生产同构 AI SaaS（CalorieAI / PetAI / PlantAI…）。每个套娃应用即一个**独立 Git 仓库**（主仓库 submodule 指针同步），克隆后只需配置 `GATEWAY_APP_TOKEN` 即可 **10 秒接入网关**。

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
- [11. 版本历史](#-11-版本历史)

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
│              │ GATEWAY_APP_TOKEN     │ 10 秒接入         │                          │
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

## 🔗 2. 主 / 子仓库协同机制

| 层级 | 职责 | 同步方式 |
|------|------|---------|
| **主仓库 git008** | 工厂与治理中枢；网关模块源码（`projects/central-gateway`）；套娃子仓库指针 | 直接提交 + push 分支 |
| **子仓库（products/*）** | 每个套娃应用独立 Git 仓库（如 `calorieai` → GitHub `winsentrobot008/calorieAI`），独立部署 Vercel | 子仓库 push main；主仓库提交 `chore(git008): bump <app> submodule pointer` |
| **Central Gateway** | 独立可部署模块（自托管 Node / Vercel Serverless） | 随主仓库提交；部署平台配置密钥 |

**质量门禁**：子仓库 pre-commit / pre-push 内置路由检查（`check-routes.mjs`）；线上回归由 `scripts/qa_inspect.py` 做 **0-Token E2E 巡检**（0 Console / 0 网络错误）。

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
| 7 | 接入网关 | 配置 `GATEWAY_BASE_URL + GATEWAY_APP_TOKEN` |

### 3.2 极速接入网关（10 秒上线）

```bash
# 子应用只需两项环境变量，识图/积分/收银立即切换到中央网关
GATEWAY_BASE_URL=https://<your-gateway>.vercel.app
GATEWAY_APP_TOKEN=tok_calorieai_xxx
```

网关不可用时自动回退子应用直连，**旧业务零影响**。SDK 示例：`products/calorieai/src/lib/gateway-client.ts`。

---

## 🧬 4. 套娃应用矩阵与接入状态

| 应用 | 路径 | 状态 | 网关接入 |
|------|------|:---:|------|
| **CalorieAI** | `products/calorieai` | 🟢 生产就绪（Vercel 实盘巡检通过） | ✅ SDK 内置 + 环境门控 |
| **PetAI** | 待克隆 | 🟡 模板可直接克隆 | 10 秒接入 |
| **PlantAI** | 待克隆 | 🟡 模板可直接克隆 | 10 秒接入 |
| **…** | 任意同构 AI SaaS | 🟢 矩阵可扩展 | 注册 `GATEWAY_APP_TOKENS` 即可 |

---

## 🛰️ 5. Central Gateway（中央大脑与收银中枢）

位于 [`projects/central-gateway`](projects/central-gateway/README.md)，Hono + Node + TypeScript：

| 统一端点 | 能力 |
|----------|------|
| `POST /api/v1/ai/vision` | 按 `app_id` 切换 Prompt 的统一 AI 识图（A→B→C 回退） |
| `POST /api/v1/billing/checkout` | 统一 Stripe / PayPal 收银发起，透传 `app_id` |
| `GET/POST /api/v1/credits` | 跨端积分 / Pro 权威判定 |

安全：App-Token / Bearer 鉴权（`GATEWAY_APP_TOKENS` 注册表）、动态 CORS 白名单（精确 + `*.` 通配）、滑动窗口限频。上游密钥（OpenAI/OpenRouter、Stripe、KV/Postgres）只存在于网关环境变量。

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
├── factory_components/           🏛️ 治理中心（constitution / orchestrator / tools）
├── scripts/                      📝 工厂脚本（git008_main_panel / qa_inspect / smoke-api）
├── qa_delivery/                  🧪 质检报告与截图（latest.md / screenshots）
├── runtime_data/                 💾 运行时日志与调度数据
└── README.md                     📘 本说明文件
```

---

## 📝 8. 系统脚本

| 脚本 | 路径 | 用途 |
|--------|------|------|
| 主面板 | [`scripts/git008_main_panel.py`](scripts/git008_main_panel.py) | 中央调度 UI（FastAPI, 端口 8000） |
| 线上巡检 | [`scripts/qa_inspect.py`](scripts/qa_inspect.py) | Playwright 0-Token E2E（写 qa_delivery/reports/latest.md） |
| 管线测试 | [`scripts/test_pipeline_run.py`](scripts/test_pipeline_run.py) | 集成测试套件 |
| 网关冒烟 | [`projects/central-gateway/scripts/smoke.mjs`](projects/central-gateway/scripts/smoke.mjs) | 网关鉴权/CORS/积分/降级 10 项自检 |

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
python scripts/git008_main_panel.py          # → http://localhost:8000

# 网关本地开发
cd projects/central-gateway && npm run dev   # → http://127.0.0.1:8787

# 套娃应用构建门禁（示例）
cd products/calorieai && npm run build

# 0-Token 线上回归
python scripts/qa_inspect.py --url https://calorie-ai-seven.vercel.app
```

---

## 🗓️ 11. 版本历史

| 日期 | 版本 | 变更内容 |
|------|---------|---------|
| 2026.08 | **v3.0** | 新增 SaaS 矩阵架构：Central Gateway（中央大脑/收银中枢）+ 套娃应用矩阵（CalorieAI 参考实现）；1-Step Clone 与 GATEWAY_APP_TOKEN 10 秒接入规范；根 README 重构 |
| 2026.07 | v2.0 | 治理审计与修复：+17 宪法导入、+7 哨兵钩子、目录重组、README 升级 |
| 2026.06 | v1.0 | 初始系统结构（core/ + Cline-anti-freeze/） |

---

*由 ZOO 治理审计管线生成 · 2026-08。*
