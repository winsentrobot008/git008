# SKILL 02 · Credits Top-up 积分充值模式（One-Time Credit Top-up）

> 来源审计：`products/calorieai/src/lib/credit-packs.ts`、
> `src/app/api/stripe/{checkout,webhook}/route.ts`、
> `src/app/api/paypal/{create-order,capture-order}/route.ts`、
> `projects/central-gateway/src/routes/checkout.ts`。

## 模式定义（2026-08 定稿）

- **取消订阅套路**：全量采用一次性付款积分包，月付 / 年付 / 永久买断接口全部
  返回 410（`src/app/api/v1/billing/{subscribe,license}/route.ts`）；
- **固定汇率**：1 次 AI 识图 = 1 积分，积分不过期；
- **统一商品目录**：`middleware/credit-packs.ts` 是价格 / 积分唯一来源，
  Stripe / PayPal / 前端 / 中央网关共用，杜绝价差。

## 端到端流程

```text
前端 BillingModal
  → POST /api/stripe/checkout { pack_id, user_id, email, locale }
  → Stripe Checkout Session（mode=payment，元数据携带 pack_id/credits/amount_usd）
  → checkout.session.completed Webhook
  → addServerCredits(userId, pack.credits)      // 服务端权威发放
  → db.recordPayment({ orderId: session.id })   // 幂等去重
```

PayPal 同构：`create-order` → 前端 approve → `capture-order` → `COMPLETED`
后发放积分并 `recordPayment` 去重。

## 关键不变式

1. **幂等入账**：`recordPayment` 按 `order_id` 去重；Webhook 重试 / 双路径
   不会重复发积分；
2. **服务端权威**：积分发放只发生在 Webhook / Capture 成功回调，前端
   `finishPayment` 只做 UI 乐观更新；
3. **密钥缺失降级**：未配置真实密钥时返回 `mock:true` + 可读 message，
   禁止静默假成功（见 `docs/AI_FACTORY_SPEC.md` §4.3）；
4. **旧 plan 兼容**：`resolvePack()` 把 `monthly/yearly/permanent` 一律
   回退到默认体验包，防止旧客户端复活订阅语义。

## 质量闸门

- `check-stripe-config.mjs` / `test-stripe-e2e.mjs` 覆盖积分包元数据与幂等断言；
- 商品名必须含 `Credits`（英文环境），例如 `CalorieAI 50 Credits Pack`。
