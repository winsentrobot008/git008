# commercial-engine — 商业化中台（Commercial Engine）

> 治理范围：git008 全部套娃产品（calorieai / central-gateway / RoastBro / ai-factory /
> 008ai-landing / ai-calorie-assistant 等）的**商业化逻辑唯一权威实现**。
> 本目录由「RESTRUCTURING DIRECTIVE」建立，取代各子项目内散落的支付 / 积分 / 限流 / 付费墙实现。

## 目录结构

```text
commercial-engine/
├── middleware/                 # 可复用后端逻辑（框架无关，存储经端口注入）
│   ├── credits.ts              #   积分账本（赠送 / 增减 / 初始化）
│   ├── atomic.ts               #   原子锁 + 积分扣减互斥
│   ├── rate-limit.ts           #   滑动窗口限频（内存 / Upstash 分布式）
│   ├── credit-guard.ts         #   AI 调用积分守卫（429 限频 + 402 扣积分）
│   ├── credit-packs.ts         #   Credits Top-up 商品目录（唯一价格源）
│   ├── stripe-i18n.ts          #   支付数据 i18n（零汉字断言 + 统一商品名）
│   ├── billing-store.ts        #   订阅 / 支付流水账本（幂等入账）
│   ├── billing-activate.ts     #   订阅 / Pro 权限激活（周期计算）
│   ├── payment-keys.ts         #   卡密 / 支付密钥校验（占位值识别 + 支付方式白名单）
│   └── payment-errors.ts       #   Stripe 失败翻译（billing/failure 逻辑）
├── templates/                  # 前端模板（付费墙弹窗 / 支付结果页 / 报告分享卡）
├── skills/                     # 商业化模式 SKILL 规范（01-emotion ~ 05-fast-kill）
└── MIGRATION_AUDIT_REPORT.md   # 迁移审计报告（本仓库权威清单）
```

## 接入约定

1. **后端逻辑**：子项目禁止复制本目录逻辑；必须 import 本目录实现。
   - 模块名：`@git008/commercial-engine`（`package.json` 已声明 `middleware/*`、`templates/*`、`skills/*` 子路径 exports）；
   - calorieai（Next.js / bundler）：`import { ... } from "@git008/commercial-engine/middleware/xxx"`
   - central-gateway（NodeNext / Hono）：`import { ... } from "@git008/commercial-engine/middleware/xxx.js"`
2. **存储注入**：本目录 middleware 不依赖任何数据库 / Next.js / Hono。
   调用方把自己的 `getCredits/setCredits/upsertSubscription` 等以端口（Port）方式注入。
3. **价格单一来源**：`credit-packs.ts` 是唯一价格 / 积分映射源；
   所有 Stripe / PayPal / 前端展示必须经 `stripe-i18n.ts` 产出商品名，禁止在路由内硬编码。
4. **SKILL 文档**：新增商业化功能前先读 `skills/` 对应模式，遵循既有约定。

## 质量闸门

- `npx tsc --noEmit`（products/calorieai 与 projects/central-gateway）必须通过。
- 支付商品名/描述零汉字断言：`CJK_CHARS_REGEX`（stripe-i18n.ts）。
- 幂等入账：`recordPayment` 按 order_id 去重，webhook 重试不会重复发积分。
