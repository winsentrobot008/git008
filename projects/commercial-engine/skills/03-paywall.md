# SKILL 03 · 付费墙与 Pro 订阅（Paywall & Pro Subscription）

> 来源审计：`products/calorieai/src/lib/scan-limit.ts`（免费 2 次门控）、
> `src/app/api/stripe/subscribe/route.ts`（$9.99/月 Pro）、
> `src/app/page.tsx`（BillingModal + paywall 跳转）、
> `docs/AI_FACTORY_SPEC.md` §4.4/§5.2（i18n 支付一致性）。

## 触发模型（Cal AI 式极简闭环）

```text
Onboarding → 拍照 AI 拆解 → 今日进度条 → 免费 2 次 → 第 3 次触发付费墙
```

- `scan-limit.ts` 用 localStorage 计数（`FREE_SCAN_LIMIT = 2`）；
- 第 3 次拍照 → `POST /api/stripe/subscribe` → `$9.99/月` 全英文
  Stripe Checkout（`mode=subscription`，`locale=en`）；
- Pro 状态经 `GET /api/v1/billing/status` 下发，前端 `is_premium` 驱动
  无限识图（`remaining_daily_recognitions: 999`）。

## 与 Credits Top-up 的关系

2026-08 商业化定稿后 **Credits Top-up 为主模式**，Pro 订阅保留为高价值
用户的补充通道（`stripe/subscribe` 仍按 `getLocalizedPaymentItem("pro_monthly", lang)`
联动语言）。新增产品默认只接入积分包，不新建订阅接口。

## 语言一致性闸门（SOP-05）

- 商品名 / 描述一律经 `middleware/stripe-i18n.ts` 产出；
- 前端支付请求必须携带 `locale` / `current_lang`；
- 全英文环境零汉字断言：`expect(text).not.toMatch(/[\u4e00-\u9fa5]/)`；
- Stripe 支付页本身强制 `locale: "en"`（全英文收银台）。

## 模板

付费墙弹窗标准化模板：`commercial-engine/templates/billing-modal.tsx`。
