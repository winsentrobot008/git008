# 🧬 套娃应用标准模版（Template Convergence）· 10 分钟克隆规范

> 目标：**任何新套娃应用只需变更 App-ID、Prompt 与 UI 配色**，即可在 10 分钟内完成克隆与全自动部署。
> 标准模版 = `products/calorieai`（已通过真实 AI / 中央网关 / Stripe 全链路验证）。

## 1. 模版结构（克隆后只需改 3 类文件）

| 改动点 | 文件 | 说明 |
|--------|------|------|
| **App-ID / 品牌 / Prompt / 配色** | `src/lib/app-config.ts` | 网关注册 ID、品牌名、识图/文字分析 Prompt 工厂、主题主色 |
| **品牌文案** | `src/lib/i18n/{zh,en}.json` | UI 全部文案（i18n 已抽离，无硬编码中文） |
| **密钥** | `.env.example → .env.local` | AI Key + Stripe 双 Key（`.env.local` 永不入库） |

## 2. 一键克隆命令

```bash
node scripts/clone_app.mjs petai                 # 自动复制 + 重命名 calorieai→petai
node scripts/clone_app.mjs --target petai --brand PetAI --out products
```

脚本自动排除 `.git / node_modules / .next / qa-logs / data / .env.local*`，并全局重命名
`calorieai→petai`、`CalorieAI→PetAI`、`calorie-ai-seven→petai-seven`。

## 3. 10 分钟上线 SOP

| 分钟 | 步骤 | 命令 / 说明 |
|------|------|------------|
| 0-1 | 一键克隆 | `node scripts/clone_app.mjs petai` |
| 1-3 | 业务差异化 | 改 `src/lib/app-config.ts`（App-ID/Prompt/配色）+ i18n 品牌文案 |
| 3-5 | 密钥配置 | `cp .env.example .env.local` 填入 AI / Stripe 密钥 |
| 5-6 | 网关注册 | `GATEWAY_APP_TOKENS` 追加一行；子应用配置 `GATEWAY_BASE_URL + GATEWAY_APP_KEY` |
| 6-8 | 本地门禁 | `npm install && npm run build && npm run test:api && npm run qa:ui`（语义探针全过） |
| 8-10 | 全自动部署 | Vercel Git 集成自动部署，或 `VERCEL_TOKEN=xxx npm run deploy:prod` |

## 4. 架构复用清单（克隆零改动）

- **Central Gateway SDK**：`src/lib/gateway-client.ts`（vision / text / checkout / credits，自动回退直连）；
- **积分与收银**：Credits Top-up 一次性积分包 + Stripe One-Time Checkout / PayPal（无订阅）；
- **DAL**：Postgres / KV / 本地文件三适配器自动降级；
- **管理后台**：管理员身份 DOM 隐身 + `/api/v1/admin/*` 强制 `x-admin-token` 鉴权；
- **QA 体系**：`npm run test:api` 与 `npm run qa:ui` 内置语义级校验（随机输入 + 反 Mock 断言）。

> 语义级 QA 规范：所有 API 路由测试禁止仅断言 200 OK；AI 分析路由必须随机输入并断言
> 「动态变更或模型标记」，命中固定 Mock（白米饭/鸡胸肉/西兰花）直接判失败。
