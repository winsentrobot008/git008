# SKILL 05 · 快速下线 / 杀逻辑（Fast-Kill & Deprecation）

> 来源审计：`products/calorieai/src/app/api/v1/billing/{subscribe,license}/route.ts`
> （410 停用）、`src/app/api/stripe/webhook/route.ts`（旧订阅事件忽略）、
> `docs/AI_FACTORY_SPEC.md`（订阅 → Credits Top-up 迁移）。

## 模式

商业化模型迭代时，旧接口**不允许悄悄删除**，必须「快速杀掉」：

1. **410 Gone 桩**：旧接口保留路由，返回结构化 410 + 中文说明，防止旧客户端
   误调用后拿到 404/500 造成误导；
   ```ts
   return NextResponse.json(
     { error: "DEPRECATED", detail: "订阅接口已停用：请使用积分包支付。" },
     { status: 410 }
   );
   ```
2. **旧事件忽略**：Webhook 对 `customer.subscription.*` / `invoice.*` 仅记录日志
   并跳过，不再激活 / 续费 / 停用任何订阅权限；
3. **旧 plan 兼容**：`resolvePack()` 把订阅语义 plan 名回退到默认积分包，
   前端旧请求不崩坏；
4. **Mock 降级**：密钥未配置时返回 `mock:true` + 可读 message，测试环境可
   确定性断言，生产环境不会产生真实支付。

## 杀逻辑检查清单

- [ ] 旧路由返回 410 且说明迁移方向；
- [ ] 旧 Webhook 事件被忽略且记录日志；
- [ ] 旧前端字段（plan / is_premium）仍被新响应兼容或前端已同步迁移；
- [ ] `docs/AI_FACTORY_SPEC.md` 变更记录更新（见文件底部版本表）；
- [ ] 迁移审计报告登记（`commercial-engine/MIGRATION_AUDIT_REPORT.md`）。
