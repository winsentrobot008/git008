/**
 * config - Savage Fit AI application config (Savage Bestie Health Series).
 *
 * Clone contract (see TEMPLATE_APP.md): App-ID / brand / prompts / palette live in
 * this folder and nowhere else. The API route, the paywall and the 9:16 snippet
 * renderer all read from here, so a reskin stays a 3-file change.
 */

import { HEALTH_LIMITS } from "@/lib/shared/health-bus";

/** Stable App-ID used for storage keys, quota buckets and log labels. */
export const APP_ID = "savage-fit";

/** Product name (bilingual: EN label + the Chinese name used in the UI). */
export const APP_NAME = "Savage Fit AI";
export const APP_NAME_ZH = "毒舌健美闺蜜";

/** Series tagline, shown in the header and the share copy. */
export const BRAND_TAGLINE = "You slacked, I burn it";

/** Chinese counterpart of BRAND_TAGLINE, for zh-locale surfaces. */
export const BRAND_TAGLINE_ZH = "毒舌健美闺蜜 AI · 你偷懒，我来烧脂";

export const BRAND_SHORT = "Savage Fit";
export const BRAND_DOMAIN = "008ai.online";
export const BRAND_ORIGIN = "https://008ai.online";
export const BRAND_HANDLE = "@008ai.online";
export const BRAND_PASS_LABEL = "008ai.online Pass";

/**
 * Hard paywall: unpaid visitors get exactly this many voice interactions per
 * session. Re-exported from the shared bus so both apps share one free tier.
 */
export const FREE_VOICE_TURNS = HEALTH_LIMITS.voiceTurns;

/** Safety rails for a voice-first loop (turns are spoken, so they must stay short). */
export const MAX_TURN_CHARS = 500;
export const MAX_HISTORY_TURNS = 8;

/** Cap for the untrusted roast briefing handed over from the food audit. */
export const HEALTH_CONTEXT_MAX_CHARS = 320;
export const MAX_TURNS_PER_SESSION = 60;
export const MAX_TURN_MS = 20_000;
export const MIN_TURN_MS = 700;
export const SILENCE_END_MS = 1_250;
export const SPEECH_RMS_THRESHOLD = 0.055;

/** 9:16 vertical snippet renderer (HD 720x1280, mobile-web friendly encode cost). */
export const SNIPPET_WIDTH = 720;
export const SNIPPET_HEIGHT = 1280;
export const SNIPPET_FPS = 30;
export const SNIPPET_MAX_SECONDS = 15;
export const SNIPPET_BARS = 56;

/** UI locales supported by the shared voice surface. */
export const SUPPORTED_LANGUAGES = [
  { id: "en", label: "EN", speech: "en-US", prompt: "English" },
  { id: "zh", label: "\u4e2d\u6587", speech: "zh-CN", prompt: "Simplified Chinese" },
] as const;

export type LanguageId = (typeof SUPPORTED_LANGUAGES)[number]["id"];
export type LanguageOption = (typeof SUPPORTED_LANGUAGES)[number];

export function resolveLanguage(raw: string | null | undefined): LanguageOption {
  return SUPPORTED_LANGUAGES.find((item) => item.id === raw) ?? SUPPORTED_LANGUAGES[0];
}

// Gemini 3.7 Flash -----------------------------------------------------------

/** Default coaching model (Gemini 3.7 Flash). Override with GEMINI_MODEL. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.7-flash";

const RETIRED_GEMINI_MODELS = new Set([
  "gemini-pro",
  "gemini-pro-vision",
  "gemini-1.0-pro",
  "gemini-1.0-pro-001",
  "gemini-1.0-pro-vision",
]);

/** Any 1.5-generation id (gemini-1.5-flash / -pro / -002 ...). */
const DEPRECATED_GEMINI_GENERATION = /(?:^|[^0-9])1\.5(?:[^0-9]|$)/;

/**
 * Normalize a Gemini model id: strips a mis-configured "models/" or
 * "v1beta/models/" prefix and redirects retired ids, so a bad env var can
 * never 404 the coaching route.
 */
export function normalizeGeminiModel(raw: string | null | undefined): string {
  const cleaned = String(raw || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/^v\d+(?:beta|alpha)?\/models\//i, "")
    .replace(/^models\//i, "");
  if (!cleaned) return DEFAULT_GEMINI_MODEL;
  const id = cleaned.toLowerCase();
  if (RETIRED_GEMINI_MODELS.has(id) || DEPRECATED_GEMINI_GENERATION.test(id)) {
    return DEFAULT_GEMINI_MODEL;
  }
  return cleaned;
}

export function geminiApiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    ""
  ).trim();
}

export function geminiModel(): string {
  return normalizeGeminiModel(process.env.GEMINI_MODEL || process.env.GEMINI_COACH_MODEL || "");
}

/** Optional base-url override (kept for parity with the CalorieAI guard layer). */
export function geminiBaseUrl(): string {
  return (
    process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com"
  ).replace(/\/+$/, "");
}

/**
 * Build the Generative Language endpoint.
 * `stream` switches to :streamGenerateContent?alt=sse (one JSON per data line).
 */
export function buildGeminiEndpoint(model: string, stream: boolean): string {
  const suffix = stream ? ":streamGenerateContent?alt=sse" : ":generateContent";
  return `${geminiBaseUrl()}/v1beta/models/${encodeURIComponent(model)}${suffix}`;
}

// Cost control (CalorieAI cost-guard equivalent) -----------------------------

export interface VoiceTokenPolicy {
  /** Hard cap on spoken-token spend per turn. */
  maxOutputTokens: number;
  temperature: number;
  topP: number;
  /** true when the paid-cloud cap applies; false when the endpoint is exempt. */
  capped: boolean;
  label: string;
}

/**
 * Local (self-hosted) endpoints are exempt from the paid-cloud cap so a full
 * chain of thought stays available in dev - the same exemption rule CalorieAI
 * applies in resolveTokenPolicy.
 */
export function isLocalEndpoint(baseUrl: string): boolean {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]/i.test(baseUrl);
}

/** Voice turns are spoken aloud, so long answers are wasted spend. */
export const VOICE_MAX_OUTPUT_TOKENS = 260;

/** Snippet copy generation returns strict JSON, so it needs a higher cap. */
export const SNIPPET_MAX_OUTPUT_TOKENS = 480;

export function resolveVoiceTokenPolicy(temperature: number): VoiceTokenPolicy {
  if (isLocalEndpoint(geminiBaseUrl())) {
    return { maxOutputTokens: 2048, temperature, topP: 0.95, capped: false, label: "local-exempt" };
  }
  return {
    maxOutputTokens: VOICE_MAX_OUTPUT_TOKENS,
    temperature: Math.min(1, Math.max(0.1, temperature)),
    topP: 0.9,
    capped: true,
    label: "cloud-capped",
  };
}

export const AI_TIMEOUT_MS = 25_000;
