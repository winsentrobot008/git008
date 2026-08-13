# GIT008 AI 工厂 SOP 说明书（AI_FACTORY_SPEC.md）

**版本**: v1.0（2026.08）· **适用范围**: git008 矩阵工厂全部套娃产品（CalorieAI / PetAI / PlantAI…）与 Central Gateway 视觉链路

> 本文件沉淀三类可复制的工厂标准规范，任何套娃应用克隆后必须对齐：
> **SOP-01** CEO 拟人化慢速轨迹光标巡检（slowMo=1200ms）｜
> **SOP-02** 傻瓜式 Vision AI 数量清点与总账（Count & Total）｜
> **SOP-03** 移动端 Canvas 500KB 压缩防爆（Compress & Anti-Burst）。

---

## 📋 目录

- [SOP-01 拟人化 slowMo=1200ms 轨迹光标巡检](#sop-01-拟人化-slowmo1200ms-轨迹光标巡检ceo-可视化深度巡检)
- [SOP-02 傻瓜式 Vision AI 数量清点与总账](#sop-02-傻瓜式-vision-ai-数量清点与总账count--total)
- [SOP-03 移动端 Canvas 500KB 压缩防爆](#sop-03-移动端-canvas-500kb-压缩防爆compress--anti-burst)
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
python scripts/ceo_visual_demo.py --url http://127.0.0.1:3100   # 本地联调
```

### 1.3 视觉特效硬规范（Custom Pointer & Ripple）

1. **全局注入**：打开页面后通过 `page.add_script_tag` 注入 Canvas 特效脚本，最外层 `z-index:999999` +
   `pointer-events:none` 覆盖全视口；同时注入 `cursor: none !important` 隐藏原生光标，保证只显示自定义 Pointer。
2. **高亮红点 Pointer**：实时跟随鼠标/触摸，红色实心点（半径 6px）+ 红色描边（10px，45% 透明度）。
3. **蓝色半透明追随光圈**：以 `lerp 0.18` 平滑滞后跟随红点（半径 18px、蓝色 95% 描边），
   滞后产生的拖影让移动路线即使静止后仍可见。
4. **smooth_move 轨迹滑动**：每次关键操作前调用 `page.mouse.move(x, y, steps=N)` 分段插值落点，
   配合 slowMo=1200ms 逐段留痕；Canvas 记录最近 24 个轨迹点连线，1.4 秒淡出，人眼可清晰捕获移动路线。
5. **human_click 拟人化点击**：先沿 smooth 轨迹滑到目标中心，再执行 `page.click`；
   每次点击在落点生成 **40px 红色扩散波纹**（550ms 生命周期，pointer/touch/mouse 均触发）。
6. **slowMo=1200ms**：`chromium.launch(slow_mo=1200)` 全链路放缓，所有动作均以 1.2s/步的人眼可读节奏执行。

### 1.4 全 UI / 逻辑深度巡检分支（对齐 PROJECT_SPEC）

| 分支 | 覆盖内容 | 关键断言 |
|------|---------|---------|
| **A 语言与导航** | 中文 → 记录饮食/数据看板/个人设置 → EN 切换 → 回中文 | 3 Tab 文案断言（`记录饮食` / `Log Meal`）；页面渲染锚点 `.meal-type-row` / `.cal-ring-container` / 表单输入 |
| **B 餐次** | 早餐 → 午餐 → 晚餐 → 加餐 | `.meal-type-btn.active` 逐次等于当前餐次 |
| **C 文字输入** | 逐字输入「吃了2个包子和1杯豆浆」（`delay=140`）→ AI 分析 | `.food-item` 出现、总计行含 kcal；积分角标差额记录（本地 -1 校验） |
| **C 识图（TEMP 图片集）** | 扫描 `git008/TEMP` 真实图片（jpg/jpeg/png ≤3MB，取前 3 + `demo-food.jpg` 锚点）逐张上传 | 「图片已优化 (XXKB)」Toast；数量名称（含单位）；「数量 + 约重」格式（如 `小笼包 (9 颗 / 约 270g)`）；整盘总热量总计行含 kcal |
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
| 2026.08 | v1.0 | 首次沉淀：SOP-01 光标轨迹巡检 / SOP-02 Vision 数量清点总账 / SOP-03 Canvas 500KB 压缩防爆 |
