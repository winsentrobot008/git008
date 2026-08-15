# GIT008 AI 工厂 SOP 说明书（AI_FACTORY_SPEC.md）

**版本**: v1.6（2026.08）· **适用范围**: git008 矩阵工厂全部套娃产品（CalorieAI / PetAI / PlantAI…）与 Central Gateway 视觉链路

> 本文件沉淀五类可复制的工厂标准规范，任何套娃应用克隆后必须对齐：
> **SOP-01** CEO 拟人化慢速轨迹光标巡检（slowMo=1200ms）｜
> **SOP-02** 傻瓜式 Vision AI 数量清点与总账（Count & Total）｜
> **SOP-03** 移动端 Canvas 500KB 压缩防爆（Compress & Anti-Burst）｜
> **SOP-04** 008 工厂极速 MVP 交付规范：双 Agent 互测闭环（Cal AI Ground Truth 对标 + 红线禁令）｜
> **SOP-05** 质量闸门（Quality Gate）：i18n 支付数据一致性 + 全外语环境零汉字盲点断言。

---

## 📋 目录

- [SOP-01 拟人化 slowMo=1200ms 轨迹光标巡检](#sop-01-拟人化-slowmo1200ms-轨迹光标巡检ceo-可视化深度巡检)
- [SOP-02 傻瓜式 Vision AI 数量清点与总账](#sop-02-傻瓜式-vision-ai-数量清点与总账count--total)
- [SOP-03 移动端 Canvas 500KB 压缩防爆](#sop-03-移动端-canvas-500kb-压缩防爆compress--anti-burst)
- [SOP-04 极速 MVP 交付规范：双 Agent 互测闭环](#sop-04-008-工厂极速-mvp-交付规范双-agent-互测闭环v16)
- [SOP-05 质量闸门：i18n 支付数据一致性 + 全外语环境零汉字盲点断言](#sop-05-质量闸门-quality-gatei18n-支付数据一致性--全外语环境零汉字盲点断言)
- [附录 A 一键执行与产物清单](#附录-a-一键执行与产物清单)
- [附录 B 版本记录](#附录-b-版本记录)

---

## 🎬 SOP-01 拟人化 slowMo=1200ms 轨迹光标巡检（CEO 可视化深度巡检）

### 1.1 定位

面向 CEO / 投资人展示的**慢速可视化深度巡检**：浏览器以人类肉眼可追踪的速度逐个执行全 UI / 逻辑分支，
配合 Canvas 光标特效（红色 Pointer + 蓝色追随光圈 + 淡出轨迹 + 点击波纹），让每一段操作路线、
每一次点击落点、每一个 Toast 与结果卡都被清晰捕获并截图留档。

### 1.2 运行命令

```bash
# 在套娃应用根目录（如 products/calorieai）执行
npm run demo:visual                          # 桌面端（默认线上生产 URL）
python scripts/ceo_visual_demo.py --mode mobile   # iPhone 14 移动端模拟
python scripts/ceo_visual_demo.py --fast     # 快节奏短视频模式：slowMo=150ms + 自动录屏导出 MP4
python scripts/ceo_visual_demo.py --promo-en # YouTube Shorts 英文宣推：全英文 UI + Edge-TTS 美音解说 + 高码率 MP4
python scripts/ceo_visual_demo.py --url http://127.0.0.1:3100   # 本地联调
```

### 1.3 视觉特效硬规范（Custom Pointer & Ripple）

1. **全局注入（强制渲染）**：通过 `page.add_init_script` 在页面任何脚本运行前向根节点注入
   `<canvas id="ceo-pointer-canvas">`，`z-index:999999!important` + `pointer-events:none` 覆盖全视口；
   同时注入 `cursor: none !important` 隐藏原生光标；MutationObserver 兜底，框架重绘也无法移除画布。
2. **高亮红点 Pointer**：监听 `window.mousemove`，绘制 8px 红色实心圆点 + 白色描边（高对比高亮）。
3. **蓝色半透明追随光圈**：以 `lerp 0.2` 平滑滞后跟随红点（20px 蓝色光圈，双层描边），
   滞后产生的拖影让移动路线即使静止后仍可见。
4. **human_move 轨迹滑动**：每次关键操作前调用 `page.mouse.move(x, y, steps=25)` 分段插值，
   模拟平滑曲线滑行；Canvas 保留**近 15 个历史坐标点**连线尾迹，700ms 淡出，人眼可极其清晰地看到红点划过屏幕。
5. **human_click 拟人化点击**：先沿 25 步轨迹滑到目标中心，再执行 `page.click`；
   监听 `window.mousedown`，每次点击在落点生成 **40px 红色扩散波纹**（300ms 渐隐动画，触屏兜底同样触发）。
6. **slowMo=1200ms**：`chromium.launch(slow_mo=1200)` 全链路放缓，所有动作均以 1.2s/步的人眼可读节奏执行。

### 1.6.1 快节奏短视频模式（--fast）

面向“爆款短视频”出片：`slowMo=150ms`、`human_move` 步进压缩至 8 步（快速平滑）、装饰性等待统一 ÷6（下限 60ms）、
小笼包高光停顿 1s；`analyze-text / analyze-image` 使用内置演示应答保证快节奏出片（实测动作序列 ~18s，加载头自动裁剪；
真实 AI 仅在默认深度巡检模式执行，该模式全程 ~5 分钟）。
通过 `record_video_dir` 录制 Chrome 窗口，脚本结束后自动 ffmpeg 转码（webm → H.264 MP4，裁掉页面加载头）并落盘。
转码采用**恒定码率高兼容参数**：`-preset slow -b:v 3M -minrate 3M -maxrate 3M -bufsize 6M -x264-params nal-hrd=cbr
-pix_fmt yuv420p -movflags +faststart`，保证 3~10MB 体积、Windows 媒体播放器原生播放（yuv420p + moov 前置秒开、非黑屏）：

```text
C:\Users\aoogoost\Desktop\Projekt\git008\TEMP\calorieai_demo_fast.mp4
```

Canvas 红点轨迹 / 蓝色光环 / 点击波纹与小笼包 scale(1.08) 高光在 fast 模式完整保留。

### 1.6.2 YouTube Shorts 英文宣推模式（--promo-en）

一键生成可直接上传 YouTube 的英文宣推视频：

| 能力 | 规范 |
|------|------|
| **全英文环境** | Playwright context `locale="en-US"` + `timezone America/New_York` + localStorage `calorieai_locale=en`，UI 自动切英文；断言锚点 `Log Meal / Dashboard / Profile / Breakfast / Text Input / Photo / Upload / Image optimized (XXKB) / Total` |
| **英文演示应答** | `Steamed Buns (9 pcs / approx. 270g) - 540 kcal`、`Soy Milk`、`Total: 400 kcal`；识别断言用 `EN_QTY_G_RE`（pcs/pieces/bowls/cups + approx. + g） |
| **Edge-TTS 解说** | 4 段：Intro（ChristopherNeural）、Scan（JennyNeural）、Pro（JennyNeural）、CTA（ChristopherNeural）；脚本启动时在 Playwright 上下文**之外**生成 mp3（sync API 内部已有事件循环，`asyncio.run` 会失败），演练中经 winsound 逐段实时播放 |
| **音轨混音** | ffmpeg `adelay + amix` 按 UI 步骤时间轴放置 4 段解说（intro@0.2s / scan@识图 / pro@收银台 / cta@结尾），AAC 192k 合入 |
| **高码率高清** | `-c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -b:v 6M -movflags +faststart -c:a aac -b:a 192k` |
| **产物** | `C:\Users\aoogoost\Desktop\Projekt\git008\TEMP\calorieai_yt_promo_en.mp4`（实测 41.9s / 1.7MB / h264+aac / yuv420p / faststart / 4 段解说音量 -22~-27dB） |

### 1.4 全 UI / 逻辑深度巡检分支（对齐 PROJECT_SPEC）

| 分支 | 覆盖内容 | 关键断言 |
|------|---------|---------|
| **A 语言与导航** | 中文 → 记录饮食/数据看板/个人设置 → EN 切换 → 回中文 | 3 Tab 文案断言（`记录饮食` / `Log Meal`）；页面渲染锚点 `.meal-type-row` / `.cal-ring-container` / 表单输入 |
| **B 餐次** | 早餐 → 午餐 → 晚餐 → 加餐 | `.meal-type-btn.active` 逐次等于当前餐次 |
| **C 文字输入** | 逐字输入「吃了2个包子和1杯豆浆」（`delay=140`）→ AI 分析 | `.food-item` 出现、总计行含 kcal；积分角标差额记录（本地 -1 校验） |
| **C 识图（TEMP 图片集）** | 扫描 `git008/TEMP` 真实图片（jpg/jpeg/png ≤3MB，取前 3 + `demo-food.jpg` 锚点）逐张上传；命中数量卡片后**显式停顿 2 秒**并放大高亮「小笼包 (X 颗)」结果卡片 | 「图片已优化 (XXKB)」Toast；数量名称（含单位）；「数量 + 约重」格式（如 `小笼包 (9 颗 / 约 270g)`）；整盘总热量总计行含 kcal；高亮卡片截图 |
| **D 商业化** | 看广告领积分 (+10) → 充值/Pro → Stripe 3 套定价卡片 → 信用卡 → Checkout | 广告发奖后积分差额 +10；`.billing-modal .plan-card` 数量 = 3；URL 命中 `checkout.stripe.com` |

### 1.5 巡检断言锚点（代码级）

- Toast：`图片已优化 (XXKB)`（正则 `图片已优化\s*\(([\d.]+KB)\)`）。
- 数量清点：`QTY_RE = 正则(\s*\d+\s*(颗|块|个|碗|份|只|串|片|杯|盘))`。
- 数量 + 约重总账：`QTY_G_RE`（数量单位 + `约 XXg/克`），并强制同图存在整盘总热量（总计行含 `kcal`）。
- 积分：文字分析本地扣 1（`deductCredit`），轮询角标取最小观测差额；广告 +10；Stripe 3 卡片 + Checkout 跳转。

### 1.6 产物与全绿判定

- 结果报告：`products/<app>/qa-logs/demo-result-{mode}.json`（逐步 ok / 耗时 / findings / 截图清单 / console 错误）。
- 截图：`qa-logs/demo-{mode}-{步骤}-{时间戳}.png`（A1-A4 / B / C1 / C2-每图 / D1-D2 / final）。
- 全绿判定：全部步骤 `ok: true`，终端输出 `PERFECT PLAY ✅`，退出码 0；否则输出 `HAS ISSUES ❌` 退出码 1。

---

## 🍱 SOP-02 傻瓜式 Vision AI 数量清点与总账（Count & Total）

### 2.1 目标

识别食物图片时，AI 必须**逐项清点数量**、**名称自带数量与整盘约重**、并给出**整盘/整笼的实际总热量与总营养素**
（单品 × 数量，禁止只报单颗或 100g 基础单位）。让用户一眼看懂「这盘到底多少、一共多少卡」。

### 2.2 Prompt 规范（统一 Prompt 工厂）

Prompt 由 `src/lib/app-config.ts` 的 `prompts.image(mealType)` 集中维护（克隆套娃只改此处）：

```text
1. 强制清点数量 Count：清点画面中所有可见食物的具体数量/份数（如「9 颗小笼包」「3 块炸鸡」「1 碗米饭」）。
2. 名称带数量与预估总重：food 名称格式「小笼包 (9 颗 / 约 270g)」「炸鸡 (3 块 / 约 240g)」「米饭 (1 碗 / 约 300g)」。
3. 计算总账 Total：每项 kcal / P / F / C 必须是画面中所有数量的总和（单品 × 总数量），直接输出整盘实际总热量与总营养素。
```

### 2.3 输出 JSON 契约

```json
[
  {
    "food": "小笼包 (9 颗 / 约 270g)",
    "food_en": "Xiaolongbao (9 pieces / ~270g)",
    "grams": 270,
    "calories": 450,
    "protein_g": 36,
    "fat_g": 18,
    "carbs_g": 42,
    "confidence": 0.92
  }
]
```

前端将第一项作为「数量名称卡」，并渲染「总计」行（整盘总卡路里 + 三大营养素）。
服务端 `analyze-image` 强制解析 JSON 并记录 `count`，Provider（gemini/openrouter/deepseek）A→B→C 回退；
Central Gateway `/api/v1/ai/vision` 的 Prompt 表必须与此保持一致（按 `app_id` 切换）。

### 2.4 数量单位白名单

`颗 / 块 / 个 / 碗 / 份 / 只 / 串 / 片 / 杯 / 盘`。巡检正则（见 SOP-01 §1.5）按白名单匹配数量名称；
「数量 + 约重」完整格式必须含 `约 XXg/克`，两者缺一即视为未对齐。

### 2.5 验收标准

- 任一 TEMP 图片集内至少 1 张图命中「数量 + 约重」格式（如 demo-food.jpg 的 `小笼包 (9 颗 / 约 270g)`）。
- 命中数量名称的图片必须同时存在整盘总热量总计行（含 kcal），否则判 FAIL。
- 文字输入「吃了2个包子和1杯豆浆」必须返回 ≥2 项食物 + 总计行，并记录积分 -1 校验。

---

## 📱 SOP-03 移动端 Canvas 500KB 压缩防爆（Compress & Anti-Burst）

### 3.1 问题背景

手机相册原图（HEIC / 4-40MB 大图）直传会触发 Vercel **4.5MB Body Size Limit（HTTP 413）**，
导致识图失败。规范要求客户端统一 Canvas 压缩后再上传。

### 3.2 压缩硬规则（`src/lib/image-utils.ts`）

| 规则 | 值 |
|------|-----|
| 最大边长 | **1024px**（保持宽高比） |
| 导出格式 / 质量 | **JPEG / 0.8**（白底填充，防透明 PNG 转黑底） |
| Payload 上限 | **≤ 500KB（硬约束）** |
| 阶梯降级 | 边长 `[1024, 896, 768, 640]` × 质量 `[0.8, 0.7, 0.6, 0.5]` 逐级压缩，超限抛 `STILL_TOO_LARGE` |
| HEIC / HEIF | 浏览器解码 + Canvas 兜底转换；解码失败抛 `HEIC_DECODE_FAILED` 并给出可读提示 |

### 3.3 Toast 与错误处理

- 压缩成功后统一 Toast：`图片已优化 (XXKB)`（`toast_image_optimized`，XX 为压缩后 KB）。
- 错误码全覆盖：`DECODE_FAILED` / `HEIC_DECODE_FAILED` / `STILL_TOO_LARGE` /
  `CANVAS_UNAVAILABLE` / `JPEG_EXPORT_FAILED`，前端均给出可读提示，不允许静默失败。
- 上传失败（413 / 网络错误）提示后保持预览，用户可重试。

### 3.4 巡检断言

- 每张 TEMP 真实图片上传后必须捕获「图片已优化 (XXKB)」Toast（正则见 SOP-01 §1.5）。
- 本地测试集扫描规范：`TEMP` 目录 `*.jpg / *.jpeg / *.png` 且 ≤3MB，排序取前 3 张 + 固定 `demo-food.jpg` 数量清点锚点。

---

## 🚀 SOP-04 008 工厂极速 MVP 交付规范：双 Agent 互测闭环（v1.5）

### 4.1 定位

以 **Cal AI 为 Ground Truth（对标基准）**，任何套娃产品（CalorieAI / PetAI / PlantAI…）的 MVP
必须对齐其唯一主路线。全链路由**双 Agent 互测闭环**交付：Agent A（实现）产码 →
Agent B（对标巡检）以移动端 Playwright 巡检脚本独立回测，只有全绿才算 MVP 达标。
任何偏离该主路线或触碰红线禁令的改动一律打回。

### 4.2 对标 Ground Truth：Cal AI 主路线（不可裁剪的主干）

> 主路线：**极简 Onboarding → 拍照 AI 拆解 → 今日进度条 → 免费 2 次后 Stripe 订阅**

| # | 主干步骤 | 验收锚点（Cal AI 标准） | 巡检用例（`e2e/mobile-calai-benchmark.spec.ts`） |
|---|---------|------------------------|------------------------------------------------|
| 1 | **极简 Onboarding** | 3 步设置（性别 → 体重/目标/身高/年龄 → 每日卡路里目标，可推荐微调）；登录后未设置自动弹出 | Onboarding 用例 |
| 2 | **拍照 AI 拆解** | 上传/拍照 → AI 返回结构化拆解卡（名称/克数/卡路里/PFC），可微调克数 | 拍照拆解用例 |
| 3 | **今日进度条** | Save to Log → Dashboard 环形进度实时 +kcal（今日总热量） | 今日进度条用例 |
| 4 | **免费 2 次后 Stripe 订阅** | 前 2 次拍照免费；第 3 次拍照触发 **$9.99/月** 全英文 Stripe Checkout（`locale=en`） | 全英文 Stripe 路由用例 |

### 4.3 双 Agent 互测闭环（交付流程）

1. **Agent A（实现 Agent）交付**：完成主路线代码 + 本地自测（`test:routes` / `build` / `test:api`）。
2. **Agent B（对标巡检 Agent）独立互测**：以 Cal AI 为 Ground Truth，运行移动端 Playwright
   巡检脚本（iPhone 390x844），逐用例断言：
   - 按钮触达 ≥48px、全英文 Stripe 路由、Cal AI 核心链路（Onboarding → 识图 → 进度 → 订阅）。
   - 读取 `qa_delivery/reports/` 质检报告 Fail 项交叉核验，防止实现 Agent 自说自话。
3. **任一 Fail → 打回定向修复**：Agent A 仅针对 Fail 项修复（严禁发散式改动），修复后重新进入互测。
4. **全绿 → 交付收口**：子仓库 commit + push → 主仓库 bump submodule 指针，见附录 A。

### 4.4 红线禁令（硬约束，违者视为违约）

- **禁令一 · 严禁过度的 Dummy Mock 欺骗**：
  禁止以本地假数据（硬编码 Dummy/Demo 应答、全 mock 回退、伪造识别结果或支付成功）
  冒充真实 AI / 支付链路向 CEO、投资人或质检交付演示。
  - 生产链路必须走真实 **A→B→C 视觉回退链**（Gemini → OpenRouter → DeepSeek），**绝不回退 Mock**（见 `products/calorieai/MEMORY.md` 决策 7）；
  - Stripe / PayPal 未配密钥时仅允许明确的「演示模式」降级提示（`mock:true` + 可读 message），
    禁止静默伪造成真实扣款；
  - **测试桩唯一合法位置**：E2E 巡检脚本内的显式拦截（标注 `TEST-STUB`，如拦截
    `analyze-image` / `stripe/subscribe` 返回确定性数据以支撑断言），禁止外泄到生产代码。
- **禁令二 · 严格收缩 MVP 边界，禁止非主线功能扩增**：
  凡不属于 §4.2 主路线四步主干的功能（额外仪表盘、自定义主题、复杂报表、多余设置项、非核心
  营销页等）一律禁止加入 MVP。需求外溢须先经架构师总监 / CEO 书面审批并记录，否则一律回退。
  新增功能必须显式回答「它服务于 Cal AI 主路线四步的哪一步？」。
- **禁令三 · i18n 支付数据一致性（严禁中英混杂商品名）**：
  所有传入 Stripe 的 `name` / `description` 必须经 `src/lib/stripe-i18n.ts` 的
  `getLocalizedPaymentItem(planId, lang)` 统一产出；**严禁在 `api/stripe/*` 路由内硬编码任何
  中文商品名或描述**。当 `lang === 'en'`（或任何非中文环境）时，商品名与描述必须 100% 为标准
  英文（零汉字）。订阅 Paywall（`stripe/subscribe`）与积分包一致按应用语言联动
  （EN 恒英文，zh 可中文；支付页本身始终 `locale=en` 全英文收银台）。质量闸门详见 §5。

### 4.5 移动端对标巡检脚本（Mobile Playwright）

- **位置**：`products/<app>/e2e/mobile-calai-benchmark.spec.ts`
- **Viewport**：iPhone 390x844（`devices["iPhone 13"]`，touch + isMobile + deviceScaleFactor 3）
- **用例矩阵**（与 §4.2 一一对应）：
  - `[M1] 按钮触达 ≥48px`：核心交互按钮（升级 / 登录 / 看广告 / 餐次 / 上传 / 导航 Tab /
    Onboarding 选项）`boundingBox().height ≥ 48`。
  - `[M2] 全英文 Stripe 路由`：免费 2 次后第 3 次拍照 → 拦截 `stripe/subscribe`（TEST-STUB）→
    断言跳转 `checkout.stripe.com` + 应用 `<html lang="en">`。
  - `[M3] Cal AI 核心链路`：极简 Onboarding → 拍照 AI 拆解 → Save to Log → 今日进度条数值增加。

#### 4.5.1 E2E 深度断言规则（Stripe 商品名/描述全英文）

- **触发点**：`[M2]` 跳转 `checkout.stripe.com` 之后，除 `<html lang="en">` 外必须继续断言左侧商品摘要。
- **硬规则（违者巡检 FAIL）**：
  1. 商品标题可见且匹配英文锚点 —— 积分包必须含 `Credits`，订阅必须含 `Pro`
     （如 `CalorieAI 50 Credits Pack` / `CalorieAI Pro`）；
  2. 商品标题与描述**绝不包含任何中文字符**（正则 `[\u4e00-\u9fa5]` 命中即 FAIL）；
  3. 描述必须为地道英文（如 `One-time payment - 50 Credits added instantly (No subscription)`、
     `Unlimited AI meal scans - $9.99/month (cancel anytime)`）；
  4. 同时断言前端发给 `stripe/subscribe` / `stripe/checkout` 的请求负载携带 `locale: "en"`
     （验证 EN 模式与商品名联动，杜绝中英混杂）。
- **实现位置**：`products/<app>/e2e/mobile-calai-benchmark.spec.ts` → `[M2]`（TEST-STUB
  返回确定性英文商品摘要页 `STRIPE_CHECKOUT_PAGE`，`data-testid="product-name"` /
  `data-testid="product-description"` 为断言锚点）。
- **后端契约**：商品名/描述统一由 `src/lib/stripe-i18n.ts` 的 `getLocalizedPaymentItem(planId, lang)`
  产出（008 工厂统一函数）；`/api/stripe/checkout` 按请求体 `locale` / `current_lang` 联动
  （`'zh'` 输出中文商品名/描述，其余含 `'en'` 一律 100% 英文）；`/api/stripe/subscribe`（Pro 订阅
  Paywall）同样按 `locale` / `current_lang` 联动（EN 恒英文，zh 可中文）。严禁在路由内硬编码。

### 4.6 运行与全绿判定

```bash
cd products/calorieai
npx playwright test e2e/mobile-calai-benchmark.spec.ts   # iPhone 390x844 移动端对标巡检
```

- 全绿：全部用例 `ok` → 终端 `PERFECT PLAY ✅`，退出码 0；否则 `HAS ISSUES ❌` 退出码 1。
- 产物：Playwright HTML 报告 + 失败 trace / video（`test-results/`）。

---

## 🛡️ SOP-05 质量闸门（Quality Gate）：i18n 支付数据一致性 + 全外语环境零汉字盲点断言

### 5.1 定位

将【Stripe 中英文混杂】与【Agent 视觉断言盲点】固化为**底层防 Bug 机制**：
支付数据（商品名/描述）语言必须与应用 UI 语言严格一致，并由程序化正则断言兜底，
杜绝依赖人眼/截图目测（视觉巡检会漏看细小中文字符）。

### 5.2 i18n 支付数据一致性规程（Payment Data i18n Consistency）

- **统一函数**：所有 Stripe 商品名/描述统一经 `products/<app>/src/lib/stripe-i18n.ts` 的
  `getLocalizedPaymentItem(planId, lang)` 产出，套娃克隆只同步该文件；
  - `lang === 'en'`（或非中文环境）→ `name` / `description` 100% 标准英文（零汉字）；
  - `lang === 'zh'` → 允许中文商品文案（仅当应用 UI 为中文时）。
- **禁止硬编码**：`api/stripe/*` 路由内**严禁**出现任何中文商品名/描述硬编码（违者违反禁令三）。
- **订阅 Paywall 语言联动**：`/api/stripe/subscribe` 与积分包一致，按请求体 `locale` /
  `current_lang` 联动商品名/描述（EN 恒英文、zh 可中文）；支付页本身始终 `locale=en`
  （全英文收银台），杜绝「英文支付页 + 中文商品名」的中英混杂。
- **前端联动**：支付请求（`stripe/checkout` / `stripe/subscribe`）必须携带当前语言 `locale`
  （由 `getLocale()` 注入），供服务端联动商品名语言。

### 5.3 全外语环境零汉字盲点断言（Zero-Chinese Gate）

- **CJK 正则**：`/[\u4e00-\u9fa5]/`（`src/lib/stripe-i18n.ts` 的 `CJK_CHARS_REGEX` /
  `hasChineseChars()`）。
- **E2E 硬断言**：所有全英文用例对以下文本执行 `expect(text).not.toMatch(CJK)`，命中即 FAIL：
  1. **Stripe 页面**（TEST-STUB 镜像 `checkout.stripe.com`）：`data-testid="product-name"` /
     `data-testid="product-description"` 商品名与描述（如 `CalorieAI 50 Credits Pack`）；
  2. **应用主界面**（en locale）：Billing Modal、Header、Tab 等关键区域 `innerText`；
  3. **支付请求负载**：`locale === "en"`（验证 EN 模式与商品名联动）。
- **实现位置**：`products/<app>/e2e/mobile-calai-benchmark.spec.ts` → `expectNoChinese()` +
  `[M2]`（Pro 订阅）/ `[M4]`（50 积分包）。

### 5.4 套娃自动继承

- 克隆套娃模板后，以下质量检查链随模板自动生效，无需人工配置：
  1. `src/lib/stripe-i18n.ts`（统一商品名函数 + CJK 正则）；
  2. `e2e/mobile-calai-benchmark.spec.ts`（零汉字断言用例 M2 / M4）；
  3. `playwright.config.ts`（iPhone 390x844 移动端 + 生产构建 webServer）。
- 新增支付类功能时，必须同步补充对应 `getLocalizedPaymentItem` 条目与 E2E 零汉字断言，
  否则视同违反禁令三。

---

## 附录 A 一键执行与产物清单

```bash
cd products/calorieai
npm run demo:visual                        # 桌面端全绿验证
python scripts/ceo_visual_demo.py --mode mobile   # 移动端全绿验证
```

产物：`qa-logs/demo-result-desktop.json` / `demo-result-mobile.json` + 全流程截图（A/B/C/D + final）。
全绿后按主/子仓库协同机制提交推送（子仓库 push → 主仓库 bump submodule 指针）。

## 附录 B 版本记录

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026.08 | v1.6 | 新增 SOP-05 质量闸门（Quality Gate）：i18n 支付数据一致性规程（统一 `getLocalizedPaymentItem(planId, lang)`，严禁 api/stripe/* 硬编码中文商品名/描述）+ 全外语环境零汉字盲点断言（`expect(text).not.toMatch(/[\u4e00-\u9fa5]/)`）；新增红线禁令三；E2E 升级（M4：50 积分包 `CalorieAI 50 Credits Pack` 零汉字） |
| 2026.08 | v1.5 | 新增 SOP-04《008 工厂极速 MVP 交付规范：双 Agent 互测闭环》：以 Cal AI 为 Ground Truth（极简 Onboarding → 拍照 AI 拆解 → 今日进度条 → 免费 2 次后 Stripe 订阅）；双 Agent 互测闭环交付；红线禁令（严禁过度 Dummy Mock 欺骗 / 严格收缩 MVP 边界）；移动端 Playwright 对标用例（按钮触达 ≥48px / 全英文 Stripe 路由 / Cal AI 核心链路） |
| 2026.08 | v1.4 | 新增 SOP-01.6.2 YouTube Shorts 英文宣推模式（--promo-en）：locale en-US 全英文 UI、Edge-TTS 4 段美音解说（含演练实时播放 + adelay/amix 时间轴混音）、`-preset slow -crf 18 -b:v 6M -movflags +faststart` 高码率高清导出 |
| 2026.08 | v1.3 | MP4 导出修复：恒定码率 3Mbps（nal-hrd=cbr）替代 CRF（静态 UI 内容 CRF/ABR 欠码至 0.6~2.3MB），`-preset slow -pix_fmt yuv420p -movflags +faststart`，产物稳定 3~10MB 且 WMP 原生播放 |
| 2026.08 | v1.2 | 新增 SOP-01.6.1 快节奏短视频模式（--fast）：slowMo=150ms / human_move 8 步 / 内置演示应答 / 小笼包高光 1s；record_video_dir 录屏 + ffmpeg 转码导出 TEMP/calorieai_demo_fast.mp4 |
| 2026.08 | v1.1 | 视觉特效强制渲染：`add_init_script` 注入 `#ceo-pointer-canvas`（z-index !important + MutationObserver 持久化）、window mousemove/mousedown 监听、8px 红点 + 20px 蓝圈 + 15 点尾迹 + 40px/300ms 波纹；human_move 25 步；小笼包卡片 2s 放大高亮 |
| 2026.08 | v1.0 | 首次沉淀：SOP-01 光标轨迹巡检 / SOP-02 Vision 数量清点总账 / SOP-03 Canvas 500KB 压缩防爆 |
