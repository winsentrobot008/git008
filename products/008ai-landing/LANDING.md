# 008AI — Landing Page (008ai.online)

Crystal Pink（水晶粉）极简落地页，Manrope 字体，Next.js 16 (App Router) +
Tailwind CSS v4。定位为 **008ai.online Pass** 多应用生态（CalorieAI + Runify + 008AI Suite）。

## 本地运行

```bash
npm install
npm run dev        # http://localhost:3000
```

## 生产构建

```bash
npm run build
npm run start
```

## 环境变量（`.env.local`）

```bash
# PayPal 预购（前端 SDK Client ID + 服务端密钥）
NEXT_PUBLIC_PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_API_URL=https://api-m.sandbox.paypal.com

# 后台控制面板 /admin 登录密钥
ADMIN_KEY=change-me-008ai-admin

# PayPal Webhook（生产推荐）
PAYPAL_WEBHOOK_ID=YOUR_PAYPAL_WEBHOOK_ID_HERE

# Hero 演示视频（15s MP4/GIF，可选；不配置显示占位图）
NEXT_PUBLIC_DEMO_VIDEO_URL=/demo.mp4
```

未配置 PayPal 密钥时按钮进入 Demo 模式（显式提示，不伪造真实支付）。

## Crystal Pink 设计令牌

定义于 `src/app/globals.css` 的 `@theme`：

| Token | 值 | 用途 |
|---|---|---|
| `--color-brand` | `#EC4899` (pink-500) | 主强调 |
| `--color-brand-deep` | `#F43F5E` (rose-500) | 渐变深色端 |
| `--color-blush` / `--color-brand-soft` | `#FFF5F7` | 水晶粉背景晕 |
| `--color-velvet` | `#0F0C10` | 深色 Velvet 强调（CTA 卡片） |
| `--color-ink` / `ink-soft` / `ink-faint` | `#1F1B21 / #6E6477 / #A79FB1` | 文本层级 |

玻璃拟态：`bg-white/70 backdrop-blur-xl border-pink-200/50 shadow-pink-100/50`。

## 双应用整合（008ai.online Pass）

落地页产品矩阵三卡：**CalorieAI**（旗舰：AI 食物扫描与宏量追踪）、**Runify**
（智能路线与地图生成）、**008AI Suite**（未来 AI 工具）。单档 `$19.99` Early Bird
终身 Pass 同时解锁 CalorieAI + Runify + 全套件。

## PayPal Live / Sandbox 与 Webhook 权益流

- 前端 `src/components/PayPalCheckout.tsx` 加载 PayPal JS SDK 按钮；
- `POST /api/paypal/create-order` 创建订单；`POST /api/paypal/capture-order` 捕获
  并调用 `orders-store.recordOrder()` / `upsertEntitlement()` 落库（幂等，按 orderId 去重）；
- `POST /api/paypal/webhook` 处理 `PAYMENT.CAPTURE.COMPLETED`（生产建议补上
  `PAYPAL_WEBHOOK_ID` 签名校验），保证前端失败时后端仍能落库激活权益；
- 权益存储：`src/lib/orders-store.ts`（os.tmpdir 文件 + 内存回退，生产替换为
  Postgres / Vercel KV）。

## Admin 控制面板（/admin）

- 登录：访问 `/admin` 输入 `ADMIN_KEY`，`POST /api/admin/login` 签发 24h 会话令牌；
- 数据路由均需 `x-admin-token` 头（`src/lib/admin-auth.ts`）：
  - `GET /api/admin/stats` → `total_sales / paid_orders / active_passes`
  - `GET /api/admin/orders` → 订单列表（Order ID / Email / Source / Date / Entitlement）
  - `GET /api/admin/entitlements` → 活跃 Early Bird Pass 列表
  - `PATCH /api/admin/entitlements` → 手动切换 `has_lifetime_access` on/off

## 部署（Vercel 子目录）

1. **Import 项目**：`git008` 仓库 → 项目设置 **Root Directory = `products/008ai-landing`**
   （Root Directory 只配置在项目设置层；`vercel.json` 仅含 `framework` /
   `buildCommand` / `installCommand`，新版 schema 不再接受 `rootDirectory` 字段）。
2. **Framework Preset**：Next.js（自动识别）；Build 命令 `npm run build`。
3. **环境变量**：在 Vercel → Settings → Environment Variables 逐一添加下表变量，
   并勾选 **Apply to: Production / Preview / Development**：

   | 变量 | 必需 | 说明 |
   |---|---|-----|
   | `ADMIN_KEY` | 必需 | `/admin` 登录密钥（未配置回退 `008ai-admin`） |
   | `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | 必需 | PayPal 前端 SDK Client ID（服务端 create/capture 回退读取） |
   | `PAYPAL_CLIENT_SECRET` | 必需 | PayPal 服务端密钥（仅服务端） |
   | `PAYPAL_WEBHOOK_ID` | 必需 | PayPal Webhook ID（签名校验预留；Endpoint: `https://008ai.online/api/paypal/webhook`） |
   | `NEXT_PUBLIC_DEMO_VIDEO_URL` | 必需 | Hero 演示视频 URL（如 `/demo.mp4`） |
   | `PAYPAL_API_URL` | 可选 | PayPal API 地址（默认 Sandbox；Live 改 `https://api-m.paypal.com`） |

4. 绑定域名 `008ai.online` 并部署即可。

### 无 CLI 备用部署（REST API）

本机 Vercel CLI 偶发静默挂起时，可用 `scripts/vercel-api-deploy.mjs` 走 REST API：

```powershell
$env:VERCEL_TOKEN = "<token>"
node scripts/vercel-api-deploy.mjs
```

脚本自动完成：从 `calorie-ai` 拉取 production 环境变量导入 `008ai-landing` →
补全 `ADMIN_KEY` → 设置 Next.js 构建参数 → 文件内容上传到 `/v2/files` 全局存储 →
以 `builds: [{src:"package.json", use:"@vercel/next"}]` 触发真实构建（轮询至 READY）。
注意：直传部署要求项目级 Root Directory 为空（文件根即项目根），上传的
`vercel.json` 会剔除 `rootDirectory` 字段；GitHub 导入部署仍使用仓库内
`vercel.json`。SSO 部署保护建议设为 `preview`（生产 `.vercel.app` 公开访问）。
