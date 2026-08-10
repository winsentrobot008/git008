import { env } from "../env.js";

/**
 * AI 视觉 / 文本提供商统一调用（A→B→C 回退）。
 * 敏感 API Key 全部由网关环境变量托管，套娃前端无需持有任何密钥。
 */

export interface FoodRecord {
  food: string;
  food_en: string;
  grams: number;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  confidence: number | null;
}

export interface ProviderResult {
  count: number;
  records: FoodRecord[];
  model: { provider: string; model: string; label: string; switched: boolean; attempts: number };
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeRecords(items: unknown[]): FoodRecord[] {
  return items
    .filter((item) => item && typeof item === "object")
    .map((raw) => {
      const item = raw as Record<string, unknown>;
      return {
        food: String(item.food ?? item.name ?? item.food_name ?? item.food_en ?? "未知"),
        food_en: String(item.food_en ?? item.name_en ?? ""),
        grams: toNumber(item.grams ?? item.weight_g ?? item.weight ?? item.estimated_weight_g),
        calories: toNumber(item.calories ?? item.kcal ?? item.calorie),
        protein_g: toNumber(item.protein_g ?? item.protein),
        fat_g: toNumber(item.fat_g ?? item.fat),
        carbs_g: toNumber(item.carbs_g ?? item.carbs ?? item.carbohydrates_g ?? item.carbohydrates),
        confidence:
          item.confidence != null
            ? toNumber(item.confidence)
            : item.confidence_score != null
              ? toNumber(item.confidence_score)
              : null,
      };
    });
}

/** 稳健解析 AI 返回 JSON（纯数组 / Markdown 包裹 / 对象包装 / 夹带文字） */
export function parseRecords(text: string): FoodRecord[] {
  const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
  const tryParse = (raw: string): unknown[] | null => {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") {
        for (const key of ["records", "items", "foods"]) {
          const list = (parsed as Record<string, unknown>)[key];
          if (Array.isArray(list)) return list;
        }
      }
      return null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(cleaned);
  if (direct !== null) return normalizeRecords(direct);
  const match = cleaned.match(/\[[\s\S]*\]/);
  if (match) {
    const extracted = tryParse(match[0]);
    if (extracted !== null) return normalizeRecords(extracted);
  }
  throw new Error("AI 返回内容无法解析为 JSON 数组");
}

function buildLabel(provider: string, model: string): string {
  const short = provider === "openrouter" ? model.split("/").pop() || model : model;
  const names: Record<string, string> = { gemini: "Gemini", openrouter: "OpenRouter", deepseek: "DeepSeek" };
  return `${names[provider] || provider} (${short})`;
}

async function analyzeWithGemini(
  base64: string,
  mimeType: string,
  prompt: string,
  apiKey: string
): Promise<FoodRecord[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }, { inlineData: { mimeType, data: base64 } }],
          },
        ],
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`Gemini API ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return parseRecords(data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]");
}

async function analyzeWithOpenAICompatible(
  base64: string,
  mimeType: string,
  prompt: string,
  apiKey: string,
  options: { provider: string; endpoint: string; model: string }
): Promise<FoodRecord[]> {
  const response = await fetch(options.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          ],
        },
      ],
      max_tokens: 1024,
    }),
  });
  if (!response.ok) {
    throw new Error(`${options.provider} API ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return parseRecords(data?.choices?.[0]?.message?.content || "[]");
}

/** A→B→C 回退链：Gemini → OpenRouter → DeepSeek */
export async function runVisionProviders(
  base64: string,
  mimeType: string,
  prompt: string
): Promise<ProviderResult> {
  const chain: { provider: string; key: string; run: () => Promise<FoodRecord[]> }[] = [
    { provider: "gemini", key: env.geminiKey, run: () => analyzeWithGemini(base64, mimeType, prompt, env.geminiKey) },
    {
      provider: "openrouter",
      key: env.openrouterKey,
      run: () =>
        analyzeWithOpenAICompatible(base64, mimeType, prompt, env.openrouterKey, {
          provider: "openrouter",
          endpoint: "https://openrouter.ai/api/v1/chat/completions",
          model: env.openrouterModel,
        }),
    },
    {
      provider: "deepseek",
      key: env.deepseekKey,
      run: () =>
        analyzeWithOpenAICompatible(base64, mimeType, prompt, env.deepseekKey, {
          provider: "deepseek",
          endpoint: "https://api.deepseek.com/chat/completions",
          model: env.deepseekModel,
        }),
    },
  ];

  let lastError: Error | null = null;
  let attempted = 0;
  for (const item of chain) {
    if (!item.key) continue;
    attempted += 1;
    try {
      const records = await item.run();
      const model =
        item.provider === "gemini"
          ? env.geminiModel
          : item.provider === "openrouter"
            ? env.openrouterModel
            : env.deepseekModel;
      return {
        count: records.length,
        records,
        model: {
          provider: item.provider,
          model,
          label: buildLabel(item.provider, model),
          switched: attempted > 1,
          attempts: attempted,
        },
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[Gateway Vision] ${item.provider} failed:`, lastError.message);
    }
  }

  if (lastError) {
    throw new Error(`VISION_PROVIDER_ERROR: ${lastError.message.slice(0, 200)}`);
  }
  throw new Error("NO_VISION_KEY: 未配置任何 AI 视觉密钥");
}

// ─── 文字食物分析（用户描述 → 营养估算，A→B→C 回退） ──────────────────

async function analyzeTextWithGemini(prompt: string, apiKey: string): Promise<FoodRecord[]> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`Gemini API ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return parseRecords(data?.candidates?.[0]?.content?.parts?.[0]?.text || "[]");
}

async function analyzeTextWithOpenAICompatible(
  prompt: string,
  apiKey: string,
  options: { provider: string; endpoint: string; model: string }
): Promise<FoodRecord[]> {
  const response = await fetch(options.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
    }),
  });
  if (!response.ok) {
    throw new Error(`${options.provider} API ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  return parseRecords(data?.choices?.[0]?.message?.content || "[]");
}

/** 文字分析 A→B→C 回退链：Gemini → OpenRouter → DeepSeek */
export async function runTextProviders(prompt: string): Promise<ProviderResult> {
  const chain: { provider: string; key: string; run: () => Promise<FoodRecord[]> }[] = [
    { provider: "gemini", key: env.geminiKey, run: () => analyzeTextWithGemini(prompt, env.geminiKey) },
    {
      provider: "openrouter",
      key: env.openrouterKey,
      run: () =>
        analyzeTextWithOpenAICompatible(prompt, env.openrouterKey, {
          provider: "openrouter",
          endpoint: "https://openrouter.ai/api/v1/chat/completions",
          model: env.openrouterModel,
        }),
    },
    {
      provider: "deepseek",
      key: env.deepseekKey,
      run: () =>
        analyzeTextWithOpenAICompatible(prompt, env.deepseekKey, {
          provider: "deepseek",
          endpoint: "https://api.deepseek.com/chat/completions",
          model: env.deepseekModel,
        }),
    },
  ];

  let lastError: Error | null = null;
  let attempted = 0;
  for (const item of chain) {
    if (!item.key) continue;
    attempted += 1;
    try {
      const records = await item.run();
      const model =
        item.provider === "gemini"
          ? env.geminiModel
          : item.provider === "openrouter"
            ? env.openrouterModel
            : env.deepseekModel;
      return {
        count: records.length,
        records,
        model: {
          provider: item.provider,
          model,
          label: buildLabel(item.provider, model),
          switched: attempted > 1,
          attempts: attempted,
        },
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`[Gateway Text] ${item.provider} failed:`, lastError.message);
    }
  }

  if (lastError) {
    throw new Error(`TEXT_PROVIDER_ERROR: ${lastError.message.slice(0, 200)}`);
  }
  throw new Error("NO_TEXT_KEY: 未配置任何 AI 文本密钥");
}
