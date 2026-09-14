# 008AI — Landing Page (008ai.online)

Crystal Pink（水晶粉）极简落地页，Manrope 字体，Next.js 16 (App Router) +
Tailwind CSS v4。除 **008ai.online Pass** 生态外，内嵌合并后的健康产品 **CALauraAI**：
**Calorie Bestie（卡路里知己）** + **Fit Bestie（运动知己）** 双 AI 交叉闭环，Barbie / 莫兰迪粉高阶编辑部视觉。

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

## CALauraAI 合并（008ai.online Pass）

落地页产品矩阵：**CALauraAI**（Calorie Bestie 拍照记录一餐 + Fit Bestie 语音陪练与运动记录，
双 AI 交叉闭环与 Barbie 剪影塑形进度）、**Runify**（智能路线与地图生成）。单档 `$19.99` Early Bird
终身 Pass 同时解锁 CALauraAI + Runify + 全套件。
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

## CALauraAI · 双 AI 知己交叉闭环（沉浸式）

`savage-cal` 与 `savage-fit` 已合并为 **CALauraAI**：一个页面、一位 AI 娃娃（Lumi）、两位闺蜜。前端是极简沉浸表面（梦幻社区背景 + 中央娃娃 + 底部毛玻璃输入条），后台仍是摄入 ⇄ 消耗双向交叉闭环。
旧路由与旧 API 命名空间保留为别名（发布冒烟契约仍然成立），页面均指向 `/calaura` 并预选对应的一半。

| 知己 | 入口 | 定位 |
|---|---|---|
| **Calorie Bestie 卡路里知己** | `/calaura`（Fit 侧交接进入） | 拍照记录一餐 → 温柔点评与平衡账单 → 交棒给 Fit Bestie |
| **Fit Bestie 运动知己** | `/calaura`（Cal 侧交接进入） | 语音陪练 + 运动记录 → 交棒回 Calorie Bestie |

闭环：**记录一餐 → 能量换算 → 知己鼓励 → 记录运动 → 带回平衡 → 导出短片**。
交接契约见 `src/lib/calaura/loop.ts`：`/calaura?food=<菜名>&calories=<kcal>&from=calorie_bestie`
（`buildMovementHandoffHref` / `buildIntakeHandoffHref` / `parseLoopContext` / `entryOpeningLine`）。落地方向后知己
**主动开口说第一句**（无需先按麦克风），入口参数在客户端解析，页面仍是静态预渲染。基调：只鼓励选择、不评判身体，
平衡差额一律渲染成「Barbie 剪影 / 理想比例塑形进度」，绝不出现红色报错文案。

### CALauraAI 合并结构（`/calaura`）

| 层 | 文件 | 说明 |
|---|---|---|
| 品牌配置 | `src/lib/calaura/config.ts` | `APP_ID='calaura'`、`APP_NAME='CALauraAI'`、`BRAND_TAGLINE='Two besties, one gentle loop'`、`APP_PATH='/calaura'`、`FREE_FOOD_SCANS`、9:16 尺寸与 Gemini 模型解析（中文名只存在于 `zh.json`，避免 EN 视图泄漏 CJK） |
| 双知己人格 | `src/lib/calaura/besties.ts` | `BestieId = "calorie" \| "fit"`、`BESTIES` / `getBestie()` / `otherBestie()`（旧值 `savage`/`soft`/`hype` 映射为 `fit` 作迁移兼容）；共享口语输出契约、`SAFETY_BOUNDARIES` 与 `ENCOURAGEMENT_ETIQUETTE` |
| 餐次评级 | `src/lib/calaura/rating.ts` | `light / balanced / generous` 三档（无红/报错态），`invitesMovement()` 决定是否温和邀请运动 |
| 平衡与塑形 | `src/lib/calaura/balance.ts` | `computeBalance` 摄入/消耗差额（MET 换算成「要动多久」）；`computeSculpt()` 把当日摄入与消耗映射为 `SculptProgress`（Radiant / Aligned / Shaping），驱动剪影进度条 |
| 页面 | `src/app/(apps)/calaura/page.tsx` | route group `(apps)` 不产生 URL 段，实际访问 `/calaura`；`/savage-cal`、`/savage-fit` 为别名并预选对应知己 |
| 沉浸舞台 | `src/components/calaura/CalauraStage.tsx` | 极简表面：娃娃 + 对话气泡 + 塑形光环 + 毛玻璃输入条；同时是意图路由（文字/语音/照片）与全部总线写入的唯一入口 |
| 背景视觉 | `src/components/calaura/DreamDistrict.tsx` | 纯 SVG + CSS 的「芭比梦幻社区」背景：莫兰迪粉天空、奶油色精品店与条纹雨棚、光带街道、闪烁串灯与星尘（无二进制资源、可静态预渲染） |
| AI 娃娃 | `src/components/calaura/LumiAvatar.tsx` | 内联 SVG 娃娃 Lumi，双 AI 闺蜜的统一化身：眨眼/呼吸/说话口型/视线高光等微表情，光环按 `computeSculpt().progress` 填充 |
| 输入条 | `src/components/calaura/GlassComposer.tsx` | 底部悬浮毛玻璃采集框：文字输入 + 麦克风实时语音 + 识图上传（仅展示层，状态由舞台持有） |
| 意图路由 | `src/lib/calaura/intent.ts` | `detectLoopIntent()`（中英动词表）与 `extractKcal()`（只接受带能量单位的数字）；`INTAKE_PRESETS` / `MOVEMENT_PRESETS` 为两半闭环的快捷卡片 |
| UI 外壳 | `src/components/calaura/CalauraApp.tsx` | 持有 `bestieId`、交接上下文与当日摄入/消耗聚合；渲染沉浸舞台 + 按需挂载的「微调」抽屉（详见面板） |
| 知己面板 | `CalorieBestiePanel.tsx` / `FitBestiePanel.tsx` | 拍照记录与点评；语音陪练 + 运动记录（walk 90 / pilates 150 / dance 210 / strength 240 kcal 预设） |
| 交接卡 | `src/components/calaura/BestieHandoffCard.tsx` | `direction: intake-to-movement \| movement-to-intake`，文案取自 `calaura.handoffToFit*` / `calaura.handoffToCalorie*` |
| 塑形进度 | `src/components/calaura/SculptProgressCard.tsx` | Barbie 剪影（SVG 裙型轮廓）按 `computeSculpt().progress` 填充，仅莫兰迪粉与奶油白，无红色告警 |
| 温柔点评 | `src/components/calaura/BestieNoteCard.tsx` + `src/lib/shared/bestie-lines.ts` | `pickBestieNote(category, nonce)` 确定性取词（MEAL_GENEROUS / MEAL_LIGHT_CHOICE / MOVEMENT_PAUSE / MOVEMENT_COMPLETE） |
| 接口 | `src/app/api/calaura/{chat,tts,entitlement,recognize}/route.ts` | 唯一实现所在命名空间；`/api/savage-fit/*` 与 `/api/savage-cal/recognize` 为同实现的 re-export 别名（旧链接与冒烟契约仍成立，永不 404） |

### 共享健康总线（`src/lib/shared/`）

| 层 | 文件 | 说明 |
|---|---|---|
| 契约 | `src/types/health-bus.ts` | `HealthEvent` 判别联合（food.scan / coach.turn / workout.completed / video.exported / paywall.hit / wearable.sync / wearable.metric）、`BalanceMath`、`WearableSyncPayload`、`WearableAggregate`、`TotalHealthBundle`、`LoopBriefing`、`ApiErrorEnvelope` |
| 总线 | `src/lib/shared/health-bus.ts` | 统一存储键 `calaura_health_event`：事件日志与 `LoopBriefing` 落 localStorage（跨刷新 / 新标签页，保证交接不丢），付费计数与匿名 session 留在 sessionStorage（保证「每会话」语义）。`HEALTH_LIMITS = { foodScans: 2, voiceTurns: 3 }` 是免费额度唯一来源，`TOTAL_HEALTH_BUNDLE`（$19.99/mo / $149.99/yr） |
| Hooks | `src/lib/shared/health-hooks.ts` | `useHealthBus` / `useHealthGate`；与总线拆开，使路由处理器能 import 纯函数而不把 API 变成客户端边界 |
| 服务端门 | `src/lib/shared/health-gate.ts` | 与客户端同源的二次锁（12h 窗口、进程内 Map 的 best-effort 层）：`consumeServerGate` / `releaseServerGate` |
| 闭环交接 | `src/lib/calaura/loop.ts` | 构造 / 解析 `/calaura?food=&calories=&from=calorie_bestie`，并提供开场白 `entryOpeningLine` |
| 埋点 | `src/lib/shared/analytics.ts` | `trackCalauraEvent` + `CALAURA_EVENT_NAMES`（intake / movement 的 logged 与 handoff、turn、paywall、snippet） |
| 成片引擎 | `src/lib/video-exporter.ts` | 720x1280 / 30fps：`canvas.captureStream` + Web Audio 图 → `MediaRecorder`，导出 webm/mp4，含 WeakMap 音频图缓存与 URL 回收 |
| 可穿戴预留 | `src/app/api/wearables/sync/route.ts` | Apple Watch / Garmin 保留 webhook：校验 `WearableSyncPayload`（含单位漂移防护）+ 可选 `x-008ai-signature`（HMAC-SHA256 十六进制），返回 `WearableSyncResult { status: "reserved" }`，暂不落库；`GET` 返回机器可读契约 |

硬付费墙：未付费用户每会话 **2 次拍照记录 + 3 轮实时语音**。第 3 轮语音播放结束即中断播放并弹出
`components/calaura/PaywallModal.tsx`（全产品唯一订阅出口，`gate` 参数切换语音/拍照文案），主推
**008AI Total Health Bundle（$19.99/mo | $149.99/yr）**，同时保留线上在售的
008ai.online Pass（一次性 $19.99）与邮箱找回路径。

国际化：落地页与 CALauraAI 共用 `src/i18n/locales/{en,zh}.json`，`calaura.*` 命名空间承载双知己与交接文案。
门禁 `node scripts/check-i18n-integrity.mjs` 断言 EN 视图零中文残留、en/zh 字典 100% 对齐。

部署：`vercel.json` 为 `api/savage-fit/chat` 与 `api/savage-fit/tts` 声明 `maxDuration: 30`，
`api/savage-cal/recognize` 为 45（视觉识别上游较慢）；`/api/calaura/*` 与 `/api/calaura/*` 为同实现的别名。
环境变量：`GEMINI_API_KEY`（必需，未配置返回 `AI_KEY_MISSING`，绝不伪造教练话术）；
`TTS_SUBSCRIPTION_KEY` + `TTS_REGION`（实时语音）；`CALORIE_AI_API_URL` + `CALORIE_AI_API_KEY`
（未配置时识别接口返回 503，不伪造结果）；可选 `WEARABLES_WEBHOOK_SECRET`（配置后强制 HMAC 校验）、
`WEARABLES_SYNC_ENABLED=false`（关闭入口）。
