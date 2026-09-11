# SKILL 01 · 情感化商业化设计（Emotion-Driven Monetization）

> 来源审计：`products/calorieai/src/app/page.tsx`（AdModal / BillingModal /
> 积分不足弹窗）、`products/calorieai/src/lib/i18n/{en,zh}.json`、
> `docs/AI_FACTORY_SPEC.md` §4（D 商业化 E2E）。

## 目标

付费触点不是「收银台」，而是用户旅程中自然的情感节点：免费额度用完时的
**损失感**、充值后的**即时正反馈**、广告奖励的**互惠感**。本 SKILL 固化
git008 已验证的情感化商业化模式，供所有套娃产品复用。

## 模式清单

1. **免费额度 + 触发型付费墙**
   - 新用户赠送 3 积分（`DEFAULT_FREE_CREDITS`，见 `middleware/credits.ts`）；
   - 每次 AI 调用扣 1 积分（`middleware/credit-guard.ts`），余额 < 1 时返回
     402 `INSUFFICIENT_CREDITS`；
   - 前端在收到 402 时弹出「积分不足」引导弹窗，而不是报错页。
2. **看广告领积分（互惠）**
   - `POST /api/v1/billing/ad-reward` 发放 +10 积分；
   - 前端 AdModal 3–5 秒倒计时后发奖，制造「付出即有回报」的正反馈。
3. **定价卡片情绪锚点**
   - 三档积分包（starter / booster / power），中间档标记 `popular` 徽章；
   - 文案强调「按次付费 · 不过期 · 即时到账」，弱化订阅长期承诺。
4. **i18n 情感一致性**
   - 商品名 / 描述统一经 `middleware/stripe-i18n.ts` 产出；
   - 全英文环境零汉字（`CJK_CHARS_REGEX` 断言），避免语言混杂破坏信任感。

## 质量闸门

- 支付弹窗按钮触达 ≥48px（移动端 E2E，见 `docs/AI_FACTORY_SPEC.md` §4.4）；
- `billing-modal` / `plan-card` / `ad-modal` 类名与 E2E 断言保持一致；
- 严禁在路由内硬编码中文商品名 / 描述（红线禁令三）。
