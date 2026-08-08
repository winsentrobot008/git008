import { Hono } from "hono";
import type { Context } from "hono";
import { rateLimit } from "../middleware/rate-limit.js";
import type { Variables } from "../middleware/security.js";
import { initCredits, updateCredit } from "../lib/store.js";

/**
 * /api/v1/credits — 跨端统一积分管理
 *
 * GET  ?user_id=xxx            → 查询余额与 Pro 状态（无记录自动赠送 3）
 * POST { user_id, delta?, is_pro? } → 增减积分 / 更新 Pro，返回最新记录
 */
const credits = new Hono<{ Variables: Variables }>();

credits.get("/credits", rateLimit(60), async (c: Context<{ Variables: Variables }>) => {
  const appId = c.get("appId");
  const userId = c.req.query("user_id") || "anonymous";
  const record = await initCredits(userId, appId);
  return c.json({
    app_id: appId,
    user_id: record.user_id,
    credits: record.credits,
    is_pro: record.is_pro,
    updated_at: record.updated_at,
  });
});

credits.post("/credits", rateLimit(60), async (c: Context<{ Variables: Variables }>) => {
  const appId = c.get("appId");
  const body = await c.req.json().catch(() => ({}));
  const userId = body.user_id || "anonymous";
  const delta = Number(body.delta);
  if (!Number.isFinite(delta)) {
    return c.json({ error: "INVALID_DELTA", detail: "delta 必须为数字" }, 400);
  }
  const record = await updateCredit({
    userId,
    appId,
    delta,
    isPro: typeof body.is_pro === "boolean" ? body.is_pro : undefined,
  });
  return c.json({
    app_id: appId,
    user_id: record.user_id,
    credits: record.credits,
    is_pro: record.is_pro,
    updated_at: record.updated_at,
  });
});

export default credits;
