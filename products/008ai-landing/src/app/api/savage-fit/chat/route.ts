/**
 * POST /api/savage-fit/chat
 *
 * Gemini 3.7 Flash coaching endpoint for Savage Fit AI.
 *
 * Body: {
 *   mode: "reply" | "snippet",   // snippet = social copy for the 9:16 studio
 *   personaId: "savage" | "soft" | "hype",  // default savage
 *   transcript: string,          // the freshly recorded user turn
 *   history?: { role: "user" | "coach", text: string }[],
 *   language?: "en" | "zh",
 *   sessionId?: string,          // unified gate bucket (lib/health-gate)
 *   email?: string,              // optional 008ai.online Pass entitlement
 *   healthContext?: string       // untrusted roast briefing from the food audit
 * }
 *
 * Response (mode=reply): text/plain stream of spoken-ready sentences.
 * Response (mode=snippet): { copy: { title, hook, hashtags }, source: "model" }
 *
 * Gate order (mirrors CalorieAI: WAF -> rate limit -> daily cap -> quota ->
 * paid call), and the route never fabricates model output: when no key is
 * configured it answers AI_KEY_MISSING instead of inventing a coaching reply.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  AI_TIMEOUT_MS,
  FREE_VOICE_TURNS,
  MAX_HISTORY_TURNS,
  HEALTH_CONTEXT_MAX_CHARS,
  MAX_TURN_CHARS,
  SNIPPET_MAX_OUTPUT_TOKENS,
  buildGeminiEndpoint,
  geminiApiKey,
  geminiModel,
  resolveLanguage,
  resolveVoiceTokenPolicy,
} from "@/lib/savage-fit/config";
import { checkRateLimit, checkUserAgent, clientIp } from "@/lib/savage-fit/guard";
import { getPersona } from "@/lib/savage-fit/personas";
import { consumeServerTurn, releaseServerTurn, resolveQuotaKey } from "@/lib/savage-fit/server-quota";
import { listEntitlements } from "@/lib/orders-store";
import { sanitizePrivateRoastConfig } from "@/lib/shared/roast-db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Per-IP burst and daily caps, independent from the per-session paywall. */
const RATE_LIMIT_PER_MINUTE = 20;
const MINUTE_MS = 60_000;
const DAILY_LIMIT = 240;
const DAY_MS = 24 * 60 * 60 * 1000;

type Mode = "reply" | "snippet";

interface GeminiTurn {
  role: "user" | "model";
  parts: { text: string }[];
}

interface CoachRequestBody {
  mode?: string;
  personaId?: string;
  transcript?: string;
  text?: string;
  history?: unknown;
  language?: string;
  sessionId?: string;
  email?: string;
  healthContext?: string;
  roastConfig?: unknown;
}

function jsonError(code: string, detail: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ code, detail, ...extra }, { status });
}

/** 008ai.online Pass lookup against the landing-page entitlement store. */
function isPassHolder(email: string): boolean {
  const target = email.trim().toLowerCase();
  if (!target) return false;
  try {
    return listEntitlements().some(
      (entry) => String(entry.email || "").toLowerCase() === target && entry.has_lifetime_access
    );
  } catch {
    return false;
  }
}

/** Accept only well-formed turns; never let a client inject a system role. */
function normalizeHistory(raw: unknown): GeminiTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: GeminiTurn[] = [];
  for (const item of raw.slice(-MAX_HISTORY_TURNS)) {
    const record = item as { role?: unknown; text?: unknown };
    const text = typeof record?.text === "string" ? record.text.trim().slice(0, MAX_TURN_CHARS) : "";
    if (!text) continue;
    turns.push({ role: record?.role === "coach" ? "model" : "user", parts: [{ text }] });
  }
  return turns;
}

const SNIPPET_INSTRUCTION = [
  "You write social copy for a 9:16 vertical fitness clip.",
  "Return strict JSON only, matching this shape:",
  '{"title": string, "hook": string, "hashtags": string[]}',
  "- title: at most 7 words, the clip headline, no hashtags, no emoji.",
  "- hook: one sentence, at most 14 words, written as an opening line for the caption.",
  "- hashtags: 4 to 6 entries, each starting with #, lowercase, no spaces, including one persona tag and #008ai.",
  "Do not add commentary, markdown fences, or any text outside the JSON object.",
].join("\n");

/** Tolerant JSON extraction (models occasionally wrap JSON in prose/fences). */
function extractJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const started = Date.now();
  const ip = clientIp(request.headers);

  // ── WAF: reject empty/scraper user agents before spending money ──
  const waf = checkUserAgent(request.headers.get("user-agent"));
  if (waf.blocked) {
    return jsonError("BLOCKED_BY_WAF", "Request blocked by the security gateway", 403, {
      reason: waf.reason,
    });
  }

  // ── Rate limits: burst then daily ──
  const burst = checkRateLimit(`savage-fit:min:${ip}`, RATE_LIMIT_PER_MINUTE, MINUTE_MS);
  if (!burst.allowed) {
    return NextResponse.json(
      { code: "RATE_LIMITED", detail: "Too many requests, slow down", retry_after: burst.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(burst.retryAfterSeconds) } }
    );
  }
  const daily = checkRateLimit(`savage-fit:day:${ip}`, DAILY_LIMIT, DAY_MS);
  if (!daily.allowed) {
    return NextResponse.json(
      { code: "RATE_LIMITED", detail: "Daily limit reached", retry_after: daily.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(daily.retryAfterSeconds) } }
    );
  }

  let body: CoachRequestBody;
  try {
    body = (await request.json()) as CoachRequestBody;
  } catch {
    return jsonError("INVALID_REQUEST", "Request body must be JSON", 400);
  }

  const mode: Mode = body.mode === "snippet" ? "snippet" : "reply";
  const persona = getPersona(body.personaId);
  const language = resolveLanguage(body.language);
  const transcript = String(body.transcript ?? body.text ?? "").trim();

  if (!transcript) {
    return jsonError("INVALID_REQUEST", "transcript is required", 400);
  }
  if (transcript.length > MAX_TURN_CHARS) {
    return jsonError("INVALID_REQUEST", `transcript must be <= ${MAX_TURN_CHARS} characters`, 400);
  }

  // Untrusted roast briefing handed over by the food audit (never instructions).
  const healthContext = String(body.healthContext || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, HEALTH_CONTEXT_MAX_CHARS);

  const apiKey = geminiApiKey();
  if (!apiKey) {
    return jsonError(
      "AI_KEY_MISSING",
      "Coaching model is not configured (set GEMINI_API_KEY)",
      503
    );
  }

  const history = normalizeHistory(body.history);
  const email = String(body.email || request.headers.get("x-savage-email") || "");
  const entitled = isPassHolder(email);
  // The private roast bank is a paid feature: it is only accepted from a caller
  // whose pass was just verified against the order store, and it is sanitised
  // before any of it can reach the system prompt.
  const privateRoast = entitled ? sanitizePrivateRoastConfig(body.roastConfig) : null;
  const quotaKey = resolveQuotaKey(body.sessionId, ip);

  // ── Hard paywall (server lock, independent from the client counter) ──
  let quotaConsumed = false;
  let quotaRemaining: number = FREE_VOICE_TURNS;
  if (mode === "reply" && !entitled) {
    const quota = consumeServerTurn(quotaKey, FREE_VOICE_TURNS);
    if (!quota.allowed) {
      return NextResponse.json(
        {
          code: "PAYWALL_REACHED",
          detail: `Free sessions include ${FREE_VOICE_TURNS} voice turns. Unlock the 008ai.online Pass to keep going.`,
          used: quota.used,
          limit: quota.limit,
          remaining: 0,
          retry_after: quota.retryAfterSeconds,
        },
        { status: 402, headers: { "Retry-After": String(quota.retryAfterSeconds) } }
      );
    }
    quotaConsumed = true;
    quotaRemaining = quota.remaining;
  }

  const model = geminiModel();
  const policy = resolveVoiceTokenPolicy(persona.temperature);
  const promptContext = {
    language: language.prompt,
    turnIndex: history.length,
    healthContext,
    ...(privateRoast ? { privateRoast } : {}),
  };
  const systemInstruction =
    mode === "snippet"
      ? `${persona.systemPrompt(promptContext)}\n\n${SNIPPET_INSTRUCTION}`
      : persona.systemPrompt(promptContext);

  const contents: GeminiTurn[] = [
    ...history,
    {
      role: "user",
      parts: [
        {
          text:
            mode === "snippet"
              ? `Write the 9:16 clip copy for this coaching moment.\nPersona: ${persona.name}.\nUser said: ${transcript}`
              : transcript,
        },
      ],
    },
  ];

  const generationConfig: Record<string, unknown> = {
    temperature: policy.temperature,
    topP: policy.topP,
    maxOutputTokens: mode === "snippet" ? SNIPPET_MAX_OUTPUT_TOKENS : policy.maxOutputTokens,
  };
  if (mode === "snippet") {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = {
      type: "OBJECT",
      properties: {
        title: { type: "STRING" },
        hook: { type: "STRING" },
        hashtags: { type: "ARRAY", items: { type: "STRING" } },
      },
      required: ["title", "hook", "hashtags"],
    };
  }

  const endpoint = buildGeminiEndpoint(model, mode === "reply");
  console.log(
    `[savage-fit] mode=${mode} model=${model} persona=${persona.id} policy=${policy.label} quota=${entitled ? "pass" : "free"} ip=${ip}`
  );

  const payload = {
    contents,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig,
  };

  const headers = {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };

  // ── Snippet mode: single JSON round-trip ──
  if (mode === "snippet") {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[savage-fit] snippet upstream ${response.status}: ${errorText.slice(0, 200)}`);
        return jsonError("UPSTREAM_ERROR", `Model error ${response.status}`, 502);
      }
      const data = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const raw = (data.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part?.text ?? "")
        .join("");
      const parsed = extractJsonObject(raw);
      if (!parsed) {
        return jsonError("UPSTREAM_ERROR", "Model returned unparsable copy", 502);
      }
      const hashtags = Array.isArray(parsed.hashtags)
        ? parsed.hashtags.map((tag) => String(tag)).filter(Boolean).slice(0, 6)
        : [];
      return NextResponse.json({
        copy: {
          title: String(parsed.title ?? persona.name).slice(0, 80),
          hook: String(parsed.hook ?? persona.tagline).slice(0, 160),
          hashtags: hashtags.length > 0 ? hashtags : [`#${persona.id}`, "#008ai"],
        },
        source: "model",
        model,
        latency_ms: Date.now() - started,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[savage-fit] snippet call failed:", message);
      return jsonError("UPSTREAM_ERROR", message, 502);
    }
  }

  // ── Reply mode: stream spoken-ready text as it arrives ──
  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[savage-fit] upstream unreachable:", message);
    if (quotaConsumed) releaseServerTurn(quotaKey);
    return jsonError("UPSTREAM_ERROR", message, 502);
  }

  if (!upstream.ok || !upstream.body) {
    const errorText = await upstream.text().catch(() => "");
    console.error(`[savage-fit] upstream ${upstream.status}: ${errorText.slice(0, 200)}`);
    if (quotaConsumed) releaseServerTurn(quotaKey);
    return jsonError("UPSTREAM_ERROR", `Model error ${upstream.status}`, 502);
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      let emitted = false;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const chunk = trimmed.slice(5).trim();
            if (!chunk || chunk === "[DONE]") continue;
            try {
              const parsed = JSON.parse(chunk) as {
                candidates?: { content?: { parts?: { text?: string }[] } }[];
              };
              const text = (parsed.candidates?.[0]?.content?.parts ?? [])
                .map((part) => part?.text ?? "")
                .join("");
              if (text) {
                emitted = true;
                controller.enqueue(encoder.encode(text));
              }
            } catch {
              /* partial or non-JSON keep-alive line */
            }
          }
        }
        if (!emitted && quotaConsumed) releaseServerTurn(quotaKey);
        controller.close();
      } catch (error) {
        if (quotaConsumed) releaseServerTurn(quotaKey);
        controller.error(error);
      }
    },
    cancel() {
      reader.cancel().catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Savage-Model": model,
      "X-Savage-Persona": persona.id,
      "X-Savage-Remaining": entitled ? "unlimited" : String(quotaRemaining),
    },
  });
}
