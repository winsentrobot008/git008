# SaaS Central Gateway — 中央大脑与收银中枢

> **定位**：Central Gateway 是整个 SaaS 套娃矩阵的 **中央大脑与收银中枢（Central Brain & Cashier Hub）**——集中托管全部上游敏感密钥（OpenAI/OpenRouter/Gemini/DeepSeek、Stripe Secret、PayPal、Vercel KV/Postgres），并向所有套娃 Client（CalorieAI、PetAI、PlantAI…）暴露统一 API 端点。
>
> 套娃前端 **零 Key**：只需持有 `APP_ID + GATEWAY_APP_TOKEN`，即可调用识图、发起支付、读写跨端积分。

```text
                  ┌─────────────────────────────────────────────┐
                  │        SaaS Central Gateway（中央大脑）       │
                  │   /api/v1/ai/vision · billing/checkout ·    │
                  │   /api/v1/credits · App-Token 鉴权 · CORS   │
                  └───────┬──────────────┬──────────────┬───────┘
                          │              │              │
        GATEWAY_APP_TOKEN │              │              │
                          ▼              ▼              ▼
                  CalorieAI          PetAI          PlantAI / …
                  （参考实现）       （克隆示例）      （后续克隆）
```

---

## 📋 目录

- [1. 架构与职责](#-1-架构与职责)
- [2. 快速开始](#-2-快速开始)
- [3. 子应用注册 SOP（APP_ID + GATEWAY_APP_TOKEN 颁发）](#-3-子应用注册-sopapp_id--gateway_app_token-颁发)
- [4. 统一环境变量](#-4-统一环境变量)
- [5. 统一 API 路由规范](#-5-统一-api-路由规范)
- [6. 安全与限频](#-6-安全与限频)
- [7. 部署上线（自托管 / Vercel）](#-7-部署上线自托管--vercel)
- [8. 套娃 Client 接入（10 秒上线）](#-8-套娃-client-接入10-秒上线)

---

## 🏗️ 1. 架构与职责

| 角色 | 说明 |
|------|------|
| **中央大脑** | 统一 AI 识图（按 `app_id` 切换 Prompt 与业务逻辑）、跨端积分/Pro 权威判定 |
| **收银中枢** | 统一 Stripe / PayPal 支付发起（Checkout Session / Order · **Credits Top-up 一次性付款，无订阅**），透传 `app_id` 记账 |
| **密钥保险箱** | OpenAI/OpenRouter/Gemini/DeepSeek、Stripe Secret、KV/Postgres 连接全部只存在于网关环境变量 |
| **安全闸门** | App-Token 鉴权 + 动态 CORS 白名单 + 滑动窗口限频 |

技术栈：**Hono + Node.js + TypeScript**；同时提供自托管（`@hono/node-server`）与 **Vercel Serverless**（`hono/vercel` + `api/index.ts`）双入口。

---

## ⚡ 2. 快速开始

```bash
npm install
cp .env.example .env
# 编辑 .env：GATEWAY_APP_TOKENS、上游密钥（详见 §4）
npm run build            # tsc 编译 → dist/
npm run dev              # 本地开发 http://127.0.0.1:8787
npm start                # 生产运行（自托管）
npm run smoke            # 冒烟：鉴权/CORS/积分/降级（10 项全过）
```

---

## 📝 3. 子应用注册 SOP（APP_ID + GATEWAY_APP_TOKEN 颁发）

### 3.1 颁发流程

| 步骤 | 操作 |
|------|------|
| 1. 申请 | 子应用负责人提交 `app_id`（如 `petai`）与前端域名白名单 |
| 2. 生成 | 网关管理员生成高强度 Token（`openssl rand -hex 32`），写入 `GATEWAY_APP_TOKENS` |
| 3. 注册 | 将子应用域名加入 `CORS_ALLOWED_ORIGINS`（或 `GATEWAY_APP_ORIGINS` 按应用隔离） |
| 4. 下发 | 通过安全通道（Secret Manager / 私密环境变量）下发 `GATEWAY_APP_TOKEN` 给子应用 |
| 5. 轮换 | 泄露时重新生成 Token 并更新环境变量即可全局吊销，无需改代码 |

### 3.2 注册表示例

```bash
# JSON 格式（推荐）
GATEWAY_APP_TOKENS={"calorieai":"tok_calorieai_xxx","petai":"tok_petai_xxx","plantai":"tok_plantai_xxx"}

# 或 key=value 逗号分隔（兼容）
GATEWAY_APP_TOKENS=calorieai=tok_calorieai_xxx,petai=tok_petai_xxx

# 按应用追加 Origin（可选，与全局 CORS_ALLOWED_ORIGINS 合并）
GATEWAY_APP_ORIGINS={"petai":["https://petai.vercel.app","https://petai-dev.vercel.app"]}
```

### 3.3 鉴权约定

子应用调用时携带（三选一，推荐第一个）：

```text
Authorization: Bearer <GATEWAY_APP_TOKEN>
x-app-token: <GATEWAY_APP_TOKEN>
x-app-key:   <GATEWAY_APP_TOKEN>   # 兼容旧命名
```

可选强校验头 `x-app-id`：若携带，必须与 Token 反查出的 `app_id` 一致，否则 403。

---

## 🔐 4. 统一环境变量

> 敏感密钥**只允许**存在于网关部署平台的环境变量 / Secret 中。

| 变量 | 必填 | 用途 |
|------|:---:|------|
| `GATEWAY_APP_TOKENS` | ✅ | 子应用注册表（APP_ID → Token，JSON 或 `k=v,k=v`） |
| `CORS_ALLOWED_ORIGINS` | ✅ | 动态 CORS 白名单（精确地址 + `https://*.vercel.app` 通配） |
| `GATEWAY_APP_ORIGINS` | 可选 | 按应用追加 Origin（JSON） |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | 推荐 | AI A 提供商（Vision） |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | 可选 | AI B 提供商（OpenAI 兼容） |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` | 可选 | AI C 提供商 |
| `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | 可选 | Stripe Checkout 收银 |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `PAYPAL_API_URL` | 可选 | PayPal 收银兜底 |
| `POSTGRES_URL` / `DATABASE_URL` | 可选 | 跨端积分持久化（Postgres） |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN`（含 `VERCEL_KV_*` / `UPSTASH_REDIS_*` 别名） | 可选 | 跨端积分持久化（KV） |
| `GATEWAY_DATA_DIR` | 可选 | 文件回退数据目录（默认 `os.tmpdir()/central-gateway-data`） |
| `PORT` | 可选 | 自托管端口（默认 8787） |

---

## 🛣️ 5. 统一 API 路由规范

### 5.1 `POST /api/v1/ai/vision` — 统一 AI 识图

`multipart/form-data`：`file`（图片）、`meal_type?`；`app_id` 由 Token 绑定（可显式 `x-app-id`）。

按 `app_id` 切换 Prompt（calorieai → 营养识图；petai → 宠物分析；可扩展任意子应用）。

```json
{
  "app_id": "calorieai",
  "count": 2,
  "records": [{ "food": "...", "grams": 200, "calories": 260, "protein_g": 4, "fat_g": 0.6, "carbs_g": 58, "confidence": 0.92 }],
  "model": { "provider": "gemini", "model": "gemini-2.0-flash", "label": "Gemini (gemini-2.0-flash)", "switched": false, "attempts": 1 }
}
```

### 5.2 `POST /api/v1/billing/checkout` — 统一收银发起

```json
{ "plan": "monthly", "provider": "stripe", "payment_method": "card", "user_id": "u_001", "email": "a@b.com" }
```

统一测试价 `$1.00`；**一次性付款（Credits Top-up），无订阅、无自动续费**。Stripe 返回 `{ sessionId, url }`，PayPal 返回 `{ orderId }`，均透传 `app_id`、`plan` 与可选 `credits`（用于按积分包入账）。

### 5.3 `GET/POST /api/v1/credits` — 跨端积分

- `GET ?user_id=xxx` → `{ credits, is_pro, app_id }`（新用户自动赠送 3）；
- `POST { user_id, delta, is_pro? }` → 增减积分 / 更新 Pro，返回最新余额。

### 5.4 其他

- `GET /health` — 健康检查（无需鉴权）。

---

## 🛡️ 6. 安全与限频

- **App-Token 鉴权**：Bearer / `x-app-token` / `x-app-key`，反查绑定 `app_id`；`x-app-id` 不一致 → 403。
- **动态 CORS**：`CORS_ALLOWED_ORIGINS` + `GATEWAY_APP_ORIGINS` 合并；支持 `*.` 通配；白名单外 Origin → 403。
- **限频**：按 `app_id + IP` 滑动窗口（识图 10 次/分、支付 20 次/分、积分 60 次/分），超限 429 + Retry-After。

---

## ☁️ 7. 部署上线（自托管 / Vercel）

### 7.1 自托管（Node）

```bash
npm run build && npm start        # 默认 8787，可 PORT= 覆盖
```

### 7.2 Vercel Serverless（推荐）

仓库已内置部署配置：

- [`api/index.ts`](api/index.ts) — `hono/vercel` 导出 GET/POST/OPTIONS 等 Handler；
- [`vercel.json`](vercel.json) — `/api/(.*)` 全部路由到网关函数，统一端点原样保留。

上线步骤：

1. 在 Vercel **Import Repository** 导入本目录（或 git008 子路径）；
2. **Environment Variables** 粘贴 §4 清单（`GATEWAY_APP_TOKENS` + 上游密钥）；
3. Deploy 后统一端点地址即 `https://<your-gateway>.vercel.app/api/v1/...`；
4. 将网关地址与 `GATEWAY_APP_TOKEN` 下发给各套娃 Client（见 §8）。

> 说明：Vercel 实际部署需账号/Token 授权；本仓库已完成构建与本地冒烟（10/10），导入后即可上线。

---

## 🚀 8. 套娃 Client 接入（10 秒上线）

子应用（如 CalorieAI 已内置 SDK）配置两项环境变量即可切换为网关模式：

```bash
GATEWAY_BASE_URL=https://<your-gateway>.vercel.app
GATEWAY_APP_TOKEN=tok_calorieai_xxx
```

接入后：识图与积分请求**优先经中央网关**（App-Token 鉴权、零上游密钥），网关不可用时自动回退直连——旧业务零影响。SDK 示例见 `products/calorieai/src/lib/gateway-client.ts`。
