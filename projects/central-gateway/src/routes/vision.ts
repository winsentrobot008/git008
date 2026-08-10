import { Hono } from "hono";
import type { Context } from "hono";
import { rateLimit } from "../middleware/rate-limit.js";
import type { Variables } from "../middleware/security.js";
import { runVisionProviders, runTextProviders } from "../lib/providers.js";

/**
 * POST /api/v1/ai/vision
 *
 * 统一 AI 识图端点：根据 x-app-id（由 App-Key 鉴权绑定）区分套娃应用逻辑与 Prompt。
 * 表单字段: file（图片）, meal_type?（餐次）
 * 响应: { app_id, count, records, model: { provider, model, label, switched, attempts } }
 */
const vision = new Hono<{ Variables: Variables }>();

const PROMPTS: Record<string, (mealType: string) => string> = {
  calorieai: (mealType) =>
    `你是一位专业的营养师。请分析这张食物照片，返回 JSON 数组格式的食物列表。
每个对象必须包含: food(中文名), food_en(英文名), grams(估算重量克数), calories(卡路里), protein_g(蛋白质克数), fat_g(脂肪克数), carbs_g(碳水克数), confidence(0-1的置信度).
餐次类型: ${mealType}
只返回 JSON 数组，不要其他文字。`,
  petai: () =>
    `你是宠物健康助手。请分析这张宠物照片，返回 JSON 数组格式的对象列表。
每个对象必须包含: food(宠物名称/品种), food_en(英文名), grams(估算体重克数), calories(建议每日卡路里), protein_g(蛋白质克数), fat_g(脂肪克数), carbs_g(碳水克数), confidence(0-1的置信度).
只返回 JSON 数组，不要其他文字。`,
};

const VALID_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

const TEXT_PROMPTS: Record<string, (text: string, mealType: string) => string> = {
  calorieai: (text, mealType) =>
    `你是一位专业的营养师。请根据用户的食物描述文本，估算每种食物的营养数据，返回 JSON 数组格式的食物列表。
每个对象必须包含: food(中文名), food_en(英文名), grams(估算重量克数), calories(卡路里), protein_g(蛋白质克数), fat_g(脂肪克数), carbs_g(碳水克数), confidence(0-1的置信度).
餐次类型: ${mealType}
用户描述: ${text}
只返回 JSON 数组，不要其他文字。`,
  petai: (text) =>
    `你是宠物健康助手。请根据用户描述估算宠物每日营养需求，返回 JSON 数组格式的对象列表。
每个对象必须包含: food(项目名称), food_en(英文名), grams(克数), calories(卡路里), protein_g(蛋白质克数), fat_g(脂肪克数), carbs_g(碳水克数), confidence(0-1的置信度).
用户描述: ${text}
只返回 JSON 数组，不要其他文字。`,
};

vision.post("/vision", rateLimit(10), async (c: Context<{ Variables: Variables }>) => {
  const appId = c.get("appId");
  const promptBuilder = PROMPTS[appId];
  if (!promptBuilder) {
    return c.json({ error: "APP_PROMPT_NOT_DEFINED", detail: `应用 ${appId} 未配置识图 Prompt` }, 400);
  }

  const form = await c.req.parseBody();
  const file = form["file"];
  const mealType = String(form["meal_type"] || "unknown");
  if (!file || typeof file === "string") {
    return c.json({ error: "MISSING_FILE", detail: "请上传图片文件" }, 400);
  }
  if (!VALID_TYPES.includes(file.type)) {
    return c.json({ error: "UNSUPPORTED_TYPE", detail: "不支持的图片格式" }, 400);
  }

  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");

  try {
    const result = await runVisionProviders(base64, file.type, promptBuilder(mealType));
    return c.json({ app_id: appId, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("NO_VISION_KEY")) {
      return c.json({ error: "NO_VISION_KEY", detail: "网关未配置 AI 视觉密钥" }, 503);
    }
    return c.json({ error: "VISION_PROVIDER_ERROR", detail: message.slice(0, 200) }, 502);
  }
});

/**
 * POST /api/v1/ai/text — 统一文字食物分析（Credits Top-up 按次付费配套）
 * Body: { text: string, meal_type?: string }
 * 响应: { app_id, count, records, items, totalKcal, totalProtein, totalFat, totalCarbs, model }
 */
vision.post("/text", rateLimit(10), async (c: Context<{ Variables: Variables }>) => {
  const appId = c.get("appId");
  const promptBuilder = TEXT_PROMPTS[appId];
  if (!promptBuilder) {
    return c.json({ error: "APP_TEXT_PROMPT_NOT_DEFINED", detail: `应用 ${appId} 未配置文字分析 Prompt` }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const text = String(body?.text || "").trim();
  const mealType = String(body?.meal_type || "unknown");
  if (!text) {
    return c.json({ error: "EMPTY_TEXT", detail: "请输入食物描述文本" }, 400);
  }
  if (text.length > 500) {
    return c.json({ error: "TEXT_TOO_LONG", detail: "食物描述过长（最多 500 字）" }, 400);
  }

  try {
    const result = await runTextProviders(promptBuilder(text, mealType));
    const records = result.records;
    const totalKcal = records.reduce((s, r) => s + (Number(r.calories) || 0), 0);
    const totalProtein = records.reduce((s, r) => s + (Number(r.protein_g) || 0), 0);
    const totalFat = records.reduce((s, r) => s + (Number(r.fat_g) || 0), 0);
    const totalCarbs = records.reduce((s, r) => s + (Number(r.carbs_g) || 0), 0);
    return c.json({
      app_id: appId,
      ...result,
      items: records,
      totalKcal,
      totalProtein,
      totalFat,
      totalCarbs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.startsWith("NO_TEXT_KEY")) {
      return c.json({ error: "NO_TEXT_KEY", detail: "网关未配置 AI 文本密钥" }, 503);
    }
    return c.json({ error: "TEXT_PROVIDER_ERROR", detail: message.slice(0, 200) }, 502);
  }
});

export default vision;
