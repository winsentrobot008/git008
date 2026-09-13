# 008AI — Landing Page (008ai.online)

Crystal Pink（水晶粉）极简落地页，Manrope 字体，Next.js 16 (App Router) +
Tailwind CSS v4。除 **008ai.online Pass** 生态外，内嵌 **Savage Bestie Health Series（毒舌闺蜜健康系列）**：Savage Cal AI（毒舌卡路里闺蜜）+ Savage Fit AI（毒舌健美闺蜜）。

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

落地页产品矩阵：**Savage Cal AI**（毒舌卡路里闺蜜：拍照热量审计与红黄绿评级）、**Savage Fit AI**
（毒舌健美闺蜜：语音教练与 9:16 短片导出）、**Runify**（智能路线与地图生成）。单档 `$19.99` Early Bird
终身 Pass 同时解锁 Savage Cal AI + Savage Fit AI + Runify + 全套件。

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

### 生产域名别名与 Webhook 控制（重要）

为杜绝 GitHub push 触发 Webhook 自动构建对生产域名 `008ai.online` 造成抖动/被旧构建覆盖，
生产部署采用「**关闭 Git 自动部署 + 别名仅由 API 脚本显式更新**」策略：

1. **断开 GitHub 自动部署（二选一）**
   - Vercel UI：项目 `008ai-landing` → Settings → Git → **移除 GitHub 连接**
     （或关闭 `Production Branch` 的自动部署），此后 push 不再触发构建；
   - 或提供有效 `VERCEL_TOKEN` 后用 API 断开。
2. **别名只由脚本更新**：`scripts/vercel-api-deploy.mjs` 已在部署 READY 后自动把
   `008ai.online` / `www.008ai.online` 别名显式绑定到该生产部署，并校验
   `https://008ai.online` 恢复 **HTTP 200**（`assignAliases()` + `verifyDomain()`）。
3. **手动触发生产更新**：需要发版时执行
   ```powershell
   $env:VERCEL_TOKEN = "<有效 token>"
   node scripts/vercel-api-deploy.mjs
   ```
   脚本完成：拉 env → 构建 → 轮询 READY → 绑定别名 → 校验 200。

## Savage Bestie Health Series（毒舌闺蜜健康系列）

两个 App 共享同一条数据总线与同一道硬付费墙：

| App | 路由 | 系列定位 |
|---|---|---|
| **Savage Cal AI**（毒舌卡路里闺蜜） | `/savage-cal` | 拍照审计热量 → 红/黄/绿评级 → 标红即转化 |
| **Savage Fit AI**（毒舌健美闺蜜） | `/savage-fit` | 语音闺蜜教练 → 赎罪训练 → 9:16 短片导出 |

闭环：**拍照审计 → 摄入/消耗平衡换算 → 毒舌开骂 → 赎罪开练 → 病毒视频导出**。
平衡差额由 `src/lib/savage-cal/balance.ts` 换算成「要练多少」：审计结果落成
`balanceMath` 账单，随 FoodScanEvent 进总线，并作为一行 briefing 交给语音教练，
因此 Savage Fit AI 顶部的「Atonement queued」显示的是同一个待消耗目标。
引流契约见 `src/lib/shared/referral.ts`：
`/savage-fit?food=<菜名>&calories=<kcal>&from=savage_cal`。落地 `/savage-fit` 后闺蜜
**主动开口骂第一句**（无需先按麦克风），入口参数在客户端解析，页面仍是静态预渲染。

### Savage Cal AI（`/savage-cal`）

| 层 | 文件 | 说明 |
|---|---|---|
| 配置 | `src/lib/savage-cal/config.ts` | `APP_ID='savage-cal'`、`APP_NAME='Savage Cal AI'`、`BRAND_TAGLINE='毒舌卡路里闺蜜 AI · You ate it, I audit it'`、`FREE_FOOD_SCANS` |
| 评级 | `src/lib/savage-cal/rating.ts` | 热量分档 green ≤450 / yellow ≤850 / red >850；RED/YELLOW 触发引流 CTA |
| 平衡算法 | `src/lib/savage-cal/balance.ts` | 摄入/消耗差额：净超标热量 = 摄入 − 餐次额度(700) − 可穿戴已消耗，再按 MET 公式（平板支撑 4.0 / 慢跑 7.0，70kg 基准）换算 `targetBurnCalories`、`suggestedPlankSeconds`、`suggestedRunMinutes` |
| 页面 | `src/app/(apps)/savage-cal/page.tsx` | route group `(apps)` 不产生 URL 段，实际访问 `/savage-cal` |
| UI | `src/components/savage-cal/SavageCalApp.tsx`、`src/components/savage-cal/BalanceMathCard.tsx` | 深色 `#0b0d14` + 琥珀/玫红：拍照 → 热量清单 → 评级 → 平衡账单（差额 / 平板支撑 / 慢跑等价）→ CTA「🔥 偷吃被发现了吧？让毒舌健美闺蜜带你开练 →」 |
| 接口 | `src/app/api/savage-cal/recognize/route.ts` | 转发到 `CALORIE_AI_API_URL` 并归一化为 `FoodScanItem`；未配置返回 `RECOGNITION_NOT_CONFIGURED`（不伪造菜品与热量） |

### Savage Fit AI（`/savage-fit`）

| 层 | 文件 | 说明 |
|---|---|---|
| 配置 | `src/lib/savage-fit/config.ts` | `APP_ID='savage-fit'`、`APP_NAME='Savage Fit AI'`、`BRAND_TAGLINE='毒舌健美闺蜜 AI · You slacked, I burn it'`、9:16 尺寸与 Gemini 模型解析 |
| 人格 | `src/lib/savage-fit/personas.ts` | Savage Bestie 毒舌辣妹闺蜜（默认）/ Soft Mentor Bestie 治愈系御姐闺蜜 / Hype Bestie 显眼包闺蜜，共享口语输出契约与安全底线（只骂选择、不骂身体） |
| 页面 | `src/app/(apps)/savage-fit/page.tsx` | 静态预渲染；入口参数在客户端 `window.location.search` 解析，不破坏 SSG |
| 语音引擎 | `src/components/savage-fit/use-voice-engine.ts` | SpeechRecognition + MediaRecorder + AnalyserNode VAD，免手持续对话循环 |
| 硬付费墙 | `src/lib/savage-fit/quota.ts`、`server-quota.ts`、`components/savage-fit/PaywallModal.tsx` | 每会话 3 轮免费语音；客户端计数 + 服务端二次锁；第 3 轮后弹出订阅弹窗，支持已购 Pass 邮箱找回 |
| 9:16 成片 | `src/components/savage-fit/SnippetStudio.tsx` | 720x1280 canvas：逐词动画字幕 + 真实麦克风波形，`canvas.captureStream` + `MediaRecorder` 导出 webm/mp4 |
| 对话接口 | `src/app/api/savage-fit/chat/route.ts` | Gemini 3.7 Flash 流式教练接口（`mode=reply` 流式口语回复 / `mode=snippet` 社媒文案 JSON） |
| 语音合成 | `src/app/api/savage-fit/tts/route.ts` | Azure/Edge TTS：`mode=single` 音频流 / `mode=chunked` NDJSON 分块；未配置返回 `TTS_UNAVAILABLE`，前端回退浏览器内置语音 |
| 权益 | `src/app/api/savage-fit/entitlement/route.ts` | 校验 008ai.online Pass 邮箱，用于「已有 Pass 找回」 |

### 共享健康总线（`src/lib/shared/`）

| 层 | 文件 | 说明 |
|---|---|---|
| 契约 | `src/types/health-bus.ts` | `HealthEvent` 判别联合（food.scan / coach.turn / workout.completed / video.exported / paywall.hit / wearable.sync / wearable.metric）、`BalanceMath`、`WearableSyncPayload`、`WearableAggregate`、`TotalHealthBundle`、`RoastBriefing`、`ApiErrorEnvelope` |
| 总线 | `src/lib/shared/health-bus.ts` | 统一存储键 `savage_bestie_health_event`：事件日志与 RoastBriefing 落 localStorage（跨刷新 / 新标签页，保证引流交接不丢），付费计数与匿名 session 留在 sessionStorage（保证「每会话」语义）。`HEALTH_LIMITS = { foodScans: 2, voiceTurns: 3 }` 是免费额度唯一来源，`TOTAL_HEALTH_BUNDLE`（$19.99/mo / $149.99/yr） |
| Hooks | `src/lib/shared/health-hooks.ts` | `useHealthBus` / `useHealthGate`；与总线拆开，使路由处理器能 import 纯函数而不把 API 变成客户端边界 |
| 服务端门 | `src/lib/shared/health-gate.ts` | 与客户端同源的二次锁（12h 窗口、进程内 Map 的 best-effort 层）：`consumeServerGate` / `releaseServerGate` |
| 引流契约 | `src/lib/shared/referral.ts` | 构造 / 解析 `/savage-fit?food=&calories=&from=savage_cal`，并提供 CTA 文案 |
| 成片引擎 | `src/lib/video-exporter.ts` | 720x1280 / 30fps：`canvas.captureStream` + Web Audio 图 → `MediaRecorder`，导出 webm/mp4，含 WeakMap 音频图缓存与 URL 回收 |
| 可穿戴预留 | `src/app/api/wearables/sync/route.ts` | Apple Watch / Garmin 保留 webhook：校验 `WearableSyncPayload`（含单位漂移防护）+ 可选 `x-008ai-signature`（HMAC-SHA256 十六进制），返回 `WearableSyncResult { status: "reserved" }`，暂不落库；`GET` 返回机器可读契约 |

硬付费墙：未付费用户每会话 **2 次拍照审计 + 3 轮实时语音**。第 3 轮语音播放结束即中断播放并弹出
`components/savage-fit/PaywallModal.tsx`（全产品唯一订阅出口，`gate` 参数切换语音/拍照文案），主推
**008AI Total Health Bundle（$19.99/mo | $149.99/yr）**，同时保留线上在售的
008ai.online Pass（一次性 $19.99）与邮箱找回路径。

部署：`vercel.json` 为 `api/savage-fit/chat` 与 `api/savage-fit/tts` 声明 `maxDuration: 30`，
`api/savage-cal/recognize` 为 45（视觉识别上游较慢）。

环境变量：`GEMINI_API_KEY`（必需，未配置返回 `AI_KEY_MISSING`，绝不伪造教练话术）；
`TTS_SUBSCRIPTION_KEY` + `TTS_REGION`（实时语音）；`CALORIE_AI_API_URL` + `CALORIE_AI_API_KEY`
（未配置时识别接口返回 503，不伪造结果）；可选 `WEARABLES_WEBHOOK_SECRET`（配置后强制 HMAC 校验）、
`WEARABLES_SYNC_ENABLED=false`（关闭入口）。
