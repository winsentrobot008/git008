# Commercial-Engine 迁移审计报告（MIGRATION AUDIT REPORT）

> 审计日期：2026-08-25
> 范围：`products/calorieai`、`projects/central-gateway`、`products/RoastBro`、
> `factory_components/`、`factory_core/`、`docs/`（含 `docs/AI_FACTORY_SPEC.md`）
> 指令：RESTRUCTURING DIRECTIVE — Audit and Consolidate Commercial Assets into `commercial-engine`

## 1. 执行摘要

全仓库商业化代码已完成审计与整合：

- 新建 `commercial-engine/` 部门：`middleware/`（10 个权威实现模块）、
  `templates/`（4 个标准化前端模板）、`skills/`（01–05 五份商业化 SKILL 规范）；
- `products/calorieai` 与 `projects/central-gateway` 的支付 / 积分 / 限流 /
  密钥校验 / 错误翻译逻辑全部改为引用 `commercial-engine`，子项目仅保留薄适配层；
- 遗留订阅 / 买断接口保持 410 快速下线（fast-kill），无重复实现残留；
- 验证全绿：两项目 `tsc --noEmit`、calorieai `next build`（41 路由）、
  central-gateway 冒烟测试 10/10。

## 2. 迁移文件清单（Migrated Files）

### 2.1 逻辑迁入 commercial-engine/middleware（权威实现）

| 原位置（Legacy） | 迁入位置（Canonical） | 内容 |
| --- | --- | --- |
| `products/calorieai/src/lib/cost-control.ts` | `commercial-engine/middleware/credit-guard.ts` | 429 分布式限频 + 402 原子扣积分（Meal Guard） |
| `products/calorieai/src/lib/rate-limit.ts` | `commercial-engine/middleware/rate-limit.ts` | 内存滑动窗口 + Upstash/KV 分布式限频 + client IP |
| `products/calorieai/src/lib/db/index.ts`（init/add 积分算术） | `commercial-engine/middleware/credits.ts` | 积分账本（赠送 3 / 增减 / 下限 0） |
| `products/calorieai/src/lib/cost-control.ts`（并发扣减） | `commercial-engine/middleware/atomic.ts` | 进程内互斥锁 + 原子预留积分 |
| `products/calorieai/src/lib/credit-packs.ts` | `commercial-engine/middleware/credit-packs.ts` | Credits Top-up 商品目录（唯一价格源） |
| `products/calorieai/src/lib/stripe-i18n.ts` | `commercial-engine/middleware/stripe-i18n.ts` | 支付 i18n + CJK 零汉字断言 |
| `products/calorieai/src/lib/billing-store.ts` | `commercial-engine/middleware/billing-store.ts` | 订阅 / 支付流水（幂等入账 + 收入统计） |
| `products/calorieai/src/lib/billing-activate.ts` | `commercial-engine/middleware/billing-activate.ts` | 订阅 / Pro 权限激活（周期计算） |
| `products/calorieai/src/app/api/stripe/checkout/route.ts`（isPlaceholder + 支付方式白名单） | `commercial-engine/middleware/payment-keys.ts` | 卡密 / 支付密钥校验（占位值识别 + 支付方式解析） |
| `products/calorieai/src/app/api/stripe/checkout/route.ts`（describeStripeError） | `commercial-engine/middleware/payment-errors.ts` | Stripe 失败翻译（billing/failure 逻辑） |

### 2.2 前端模板（Templates）

| 来源 | 模板 | 说明 |
| --- | --- | --- |
| `products/calorieai/src/app/page.tsx`（BillingModal） | `commercial-engine/templates/billing-modal.tsx` | 标准化付费墙弹窗（Stripe + PayPal、i18n 注入） |
| `products/calorieai/src/app/billing/success/page.tsx` | `commercial-engine/templates/billing-success.tsx` | 支付成功静态页 |
| `products/calorieai/src/app/billing/cancel/page.tsx` | `commercial-engine/templates/billing-cancel.tsx` | 支付取消静态页 |
| `products/calorieai` 识图结果结构（records/totals） | `commercial-engine/templates/report-share-card.tsx` | 静态报告分享卡（统一字段契约） |

### 2.3 SKILL 规范（Skills）

| 文件 | 模式 |
| --- | --- |
| `commercial-engine/skills/01-emotion.md` | 情感化商业化设计 |
| `commercial-engine/skills/02-credit-topup.md` | Credits Top-up 积分充值模式 |
| `commercial-engine/skills/03-paywall.md` | 付费墙与 Pro 订阅 |
| `commercial-engine/skills/04-cost-control.md` | 成本控制与限流 |
| `commercial-engine/skills/05-fast-kill.md` | 快速下线 / 杀逻辑 |

## 3. 子项目适配层（Refactored Sub-Projects）

### 3.1 products/calorieai（改为 import 商业引擎，保留原导出签名）

| 文件 | 变更 |
| --- | --- |
| `tsconfig.json` | 新增 paths：`@git008/commercial-engine/* → ./src/lib/commercial-engine/*（SPU 内联快照）` |
| `next.config.ts` | 新增 `turbopack.root = <repo root>`（Turbopack monorepo 支持） |
| `src/lib/cost-control.ts` | 删除 Upstash/Redis 实现 → 委托 `credit-guard`（db 端口注入） |
| `src/lib/rate-limit.ts` | 删除本地 bucket 实现 → re-export / 委托 `rate-limit` |
| `src/lib/credit-packs.ts` | 全文 → re-export `credit-packs` |
| `src/lib/stripe-i18n.ts` | 全文 → re-export `stripe-i18n` |
| `src/lib/billing-store.ts` | 全文 → re-export `billing-store` |
| `src/lib/billing-activate.ts` | 全文 → 委托 `billing-activate`（db 端口注入） |
| `src/lib/anti-crawler.ts` | 保留 WAF；限频改为 `createInMemoryRateLimiter` 实例 |
| `src/lib/db/index.ts` | 积分算术委托 `createCreditLedger(db)` |
| `src/app/api/stripe/checkout/route.ts` | 删除本地 `isPlaceholder`/`describeStripeError`/支付方式映射 → 引用 `payment-keys` + `payment-errors` |
| `src/app/api/paypal/create-order/route.ts` | 硬编码中文商品名 → 统一走 `stripe-i18n`（locale 联动） |

### 3.2 projects/central-gateway

| 文件 | 变更 |
| --- | --- |
| `tsconfig.json` | `module/moduleResolution → esnext/bundler`、`noEmit: true`（共享 TS 源码） |
| `package.json` | `build → tsc --noEmit`；`start → tsx src/index.ts`（TS 原生运行） |
| `src/middleware/rate-limit.ts` | 本地 bucket 实现 → `commercial-engine/middleware/rate-limit.ts`（每端点独立 bucket） |
| `src/lib/store.ts` | 积分算术委托 `createCreditLedger`（保留 is_pro / last_app_id 记录结构） |
| `src/routes/checkout.ts` | 硬编码 $1.00 测试价 / 中文商品名 / plan 语义 → 统一 `credit-packs` + `stripe-i18n` + `payment-keys`（pack_id 主键，旧 plan 兼容回退） |
| `scripts/smoke.mjs` | 启动方式 `node dist/src/index.js` → `tsx src/index.ts` |

## 4. 遗留引用移除（Legacy References Removed）

- `products/calorieai/src/lib/cost-control.ts`：`@upstash/ratelimit` / `@upstash/redis` 直接调用移除（分布式限频改为商业引擎 REST 实现，语义等价：滑窗 + reset）；
- `products/calorieai/src/app/api/stripe/checkout/route.ts`：本地 `isPlaceholder` 与 `describeStripeError` 删除；
- `products/calorieai/src/app/api/paypal/create-order/route.ts`：硬编码中文 `CalorieAI N 积分包` 商品名删除（改 i18n 产出）；
- `projects/central-gateway/src/routes/checkout.ts`：硬编码 `$1.00` 测试价与中文商品名删除；
- `projects/central-gateway/src/middleware/rate-limit.ts`：本地滑动窗口桶删除；
- `projects/central-gateway/src/lib/store.ts`：本地积分算术删除；
- `docs/AI_FACTORY_SPEC.md`：`src/lib/stripe-i18n.ts` 权威路径引用 → `commercial-engine/middleware/stripe-i18n.ts`（§4.4 禁令三 / §4.5.1 / §5.2 / §5.3 / §5.4），并登记 v1.7 版本记录；
- 旧订阅/买断接口按 fast-kill 保留 410：`/api/v1/billing/subscribe`、`/api/v1/billing/license`；
- Stripe Webhook 对 `customer.subscription.*` / `invoice.*` 继续忽略（旧订阅事件不复活权限）。

## 5. 更新后的依赖路径（Updated Dependency Paths）

| 消费方 | 导入路径 |
| --- | --- |
| calorieai（Next / bundler） | `@commercial-engine/middleware/credit-guard`、`.../rate-limit`、`.../credits`、`.../credit-packs`、`.../stripe-i18n`、`.../billing-store`、`.../billing-activate`、`.../payment-keys`、`.../payment-errors` |
| central-gateway（Hono / NodeNext→bundler 类型检查，tsx 运行） | `@git008/commercial-engine/middleware/rate-limit`、`.../credits`、`.../credit-packs`、`.../stripe-i18n`、`.../payment-keys` |

## 6. 验证结果（Validation）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| calorieai 类型检查 | `npx tsc --noEmit`（products/calorieai） | ✅ 0 error |
| central-gateway 类型检查 | `npx tsc --noEmit`（projects/central-gateway） | ✅ 0 error |
| calorieai 生产构建 | `npx next build` | ✅ 41 路由全量编译（含跨根 commercial-engine 打包） |
| central-gateway 构建 | `npm run build`（tsc --noEmit） | ✅ |
| central-gateway 冒烟 | `npm run smoke` | ✅ 10/10 PASS（health / 鉴权 / CORS / 积分 3→13 / 密钥缺失 503） |
| calorieai 路由检查 | `npm run test:routes` | ✅ 79 文件 / 24 URL |

## 7. 审计发现（Findings）

1. **凭证泄露风险（高）**：`TEMP/stripe_backup_code.txt` 含 Stripe Dashboard 备份代码
   （dibv-nxjp-…）。该文件随仓库存在，应立即移出版本控制并吊销该代码；
   本报告不输出完整值。建议：`git rm --cached TEMP/stripe_backup_code.txt` + 在 Stripe
   Dashboard 重置 2FA 备份码。
2. **Live 密钥环境（中）**：calorieai `.env.local` 当前为 Stripe Live 模式
   （既有缺陷 D2 复现，见 `qa_delivery/reports/DEFECTS_LIST_2026-08-09.md`）；
   本地/预发应改用 `sk_test_` / `pk_test_`。
3. **legacy 重复实现（低，未在本指令 Phase 3 范围）**：
   - `products/008ai-landing`（Stripe/PayPal 组件与路由）为旧版收银台副本；
   - `products/ai-calorie-assistant`（Python FastAPI + JS 的 subscription/license/ad-reward）
     为更早克隆，含完整订阅/买断语义（与当前 Credits Top-up 定稿冲突）。
   建议下一轮迁移统一到 `commercial-engine`，或在克隆矩阵中标记下线。
4. **RoastBro / factory_components / factory_core**：未发现支付 / 积分 / 付费墙代码
   （仅内容素材 license 元数据与 showcase 卡片），不在商业引擎范围。

## 8. 后续建议（Follow-ups）

- 将 `008ai-landing` / `ai-calorie-assistant` 的支付栈迁入 `commercial-engine` 或下线；
- 为 `commercial-engine` 增加单测（credit-guard 402/429、recordPayment 幂等、i18n 零汉字）；
- CI 增加「任意子项目禁止复制 commercial-engine 逻辑」的门禁（可基于
  `skills/05-fast-kill.md` 检查清单）；
- 部署时确认：calorieai `next build` 需保留 `turbopack.root` 配置；
  central-gateway 自托管以 `npm start`（tsx）运行，Vercel Serverless 走 `api/index.ts`。
