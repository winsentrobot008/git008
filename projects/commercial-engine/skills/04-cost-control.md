# SKILL 04 · 成本控制与限流（Rate Limiting & Cost Control）

> 来源审计：`products/calorieai/src/lib/cost-control.ts`（Upstash 限频 +
> 扣积分）、`src/lib/anti-crawler.ts`（WAF + 每 IP 限频）、
> `src/lib/rate-limit.ts`、`projects/central-gateway/src/middleware/rate-limit.ts`。

## 双闸门成本防线

每个 AI 收费端点必须叠加以下闸门（缺一不可）：

1. **WAF 反爬虫**（`anti-crawler`）：拦截无 UA / Bot UA；
2. **单 IP 滑动窗口**：
   - 短窗：60 秒 ≤ 6 次（防并发恶意消耗）；
   - 日窗：24 小时 ≤ 30 次（Vision API 降本硬上限）；
3. **分布式限频**（可选但生产必配）：Upstash / Vercel KV
   （`middleware/rate-limit.ts` 的 `createUpstashSlidingWindowLimiter`，
   REST 协议 ZADD + ZREMRANGEBYSCORE + ZCARD，无 SDK 依赖）；
4. **积分守卫**（`middleware/credit-guard.ts`）：限频通过后原子扣 1 积分，
   余额不足返回 402；`withMutex` 防同实例竞态超扣。

## 模型成本约束

- 视觉 / 文本模型统一 `maxOutputTokens: 200`、`temperature: 0.2`；
- 图片上传 ≤200KB（前端压缩 + 服务端兜底校验）；
- 网关 A→B→C 回退（Gemini → OpenRouter → DeepSeek）只在密钥存在时尝试，
  避免无效请求。

## 错误语义

| 状态码 | code | 语义 |
| --- | --- | --- |
| 402 | INSUFFICIENT_CREDITS | 积分不足，前端引导充值 |
| 429 | RATE_LIMITED / DAILY_RATE_LIMITED | 限频，携带 Retry-After |
| 403 | BLOCKED_BY_WAF | 反爬拦截 |
| 503 | NO_VISION_KEY / NO_TEXT_KEY | 未配置模型密钥 |
