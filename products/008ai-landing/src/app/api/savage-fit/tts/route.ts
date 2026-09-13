/**
 * POST /api/savage-fit/tts
 *
 * Real-time TTS chunk endpoint for the Pingo-style voice engine.
 *
 * Body: {
 *   text: string,                       // <= 1000 chars
 *   personaId?: "savage" | "soft" | "hype", // default savage
 *   language?: "en" | "zh",
 *   mode?: "single" | "chunked",        // chunked = NDJSON audio frames per sentence
 *   voice?: string                      // explicit Azure/Edge voice override
 * }
 *
 * mode="single"  -> audio/mpeg for the whole text.
 * mode="chunked" -> application/x-ndjson, one {"index","text","audioBase64"} per
 *                   sentence so playback can start before synthesis finishes.
 *
 * Tier behaviour: this is the *server* TTS tier. The client prefers the browser
 * SpeechSynthesis voice (zero latency, works offline) and falls back here when
 * the platform has no speech engine - so an unconfigured deployment returns 503
 * TTS_UNAVAILABLE instead of pretending to speak.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveLanguage } from "@/lib/savage-fit/config";
import { checkRateLimit, checkUserAgent, clientIp } from "@/lib/savage-fit/guard";
import { getPersona, type PersonaId } from "@/lib/savage-fit/personas";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_TTS_CHARS = 1000;
const MAX_CHUNK_CHARS = 220;
const RATE_LIMIT_PER_MINUTE = 60;

/** Persona -> voice map (Azure/Edge neural voices). */
const VOICES: Record<PersonaId, { en: string; zh: string }> = {
  savage: { en: "en-US-AriaNeural", zh: "zh-CN-XiaoyiNeural" },
  soft: { en: "en-US-JennyNeural", zh: "zh-CN-XiaoxiaoNeural" },
  hype: { en: "en-US-GuyNeural", zh: "zh-CN-YunxiNeural" },
};

const VOICE_LOCALES: Record<string, string> = { en: "en-US", zh: "zh-CN" };

function ttsKey(): string {
  return (process.env.TTS_SUBSCRIPTION_KEY || process.env.AZURE_SPEECH_KEY || "").trim();
}

function ttsRegion(): string {
  return (process.env.TTS_REGION || process.env.AZURE_SPEECH_REGION || "eastus").trim();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Sentence-ish chunker so chunked mode can stream audio frame by frame. */
function chunkText(text: string, maxChars = MAX_CHUNK_CHARS): string[] {
  const sentences = text.match(/[^.!?\u3002\uff01\uff1f\u2026]+[.!?\u3002\uff01\uff1f\u2026]*/g) ?? [text];
  const chunks: string[] = [];
  let buffer = "";
  for (const sentence of sentences) {
    const clean = sentence.trim();
    if (!clean) continue;
    if (buffer && (buffer.length + clean.length > maxChars)) {
      chunks.push(buffer);
      buffer = clean;
    } else {
      buffer = buffer ? `${buffer} ${clean}` : clean;
    }
    while (buffer.length > maxChars) {
      chunks.push(buffer.slice(0, maxChars));
      buffer = buffer.slice(maxChars);
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}

async function synthesize(text: string, voice: string, locale: string): Promise<ArrayBuffer> {
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${locale}">` +
    `<voice name="${voice}">${escapeXml(text)}</voice></speak>`;

  const response = await fetch(
    `https://${ttsRegion()}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3",
        "Ocp-Apim-Subscription-Key": ttsKey(),
        "User-Agent": "008AI-Savage Fit",
      },
      body: ssml,
      signal: AbortSignal.timeout(15_000),
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`TTS upstream ${response.status}: ${detail.slice(0, 160)}`);
  }
  return response.arrayBuffer();
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request.headers);
  const waf = checkUserAgent(request.headers.get("user-agent"));
  if (waf.blocked) {
    return NextResponse.json({ code: "BLOCKED_BY_WAF", detail: "Request blocked" }, { status: 403 });
  }
  const limit = checkRateLimit(`savage-fit:tts:${ip}`, RATE_LIMIT_PER_MINUTE, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { code: "RATE_LIMITED", detail: "Too many TTS requests", retry_after: limit.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  let body: { text?: string; personaId?: string; language?: string; mode?: string; voice?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_REQUEST", detail: "Body must be JSON" }, { status: 400 });
  }

  const text = String(body.text || "").trim();
  if (!text) {
    return NextResponse.json({ code: "INVALID_REQUEST", detail: "text is required" }, { status: 400 });
  }
  if (text.length > MAX_TTS_CHARS) {
    return NextResponse.json(
      { code: "INVALID_REQUEST", detail: `text must be <= ${MAX_TTS_CHARS} characters` },
      { status: 400 }
    );
  }

  if (!ttsKey()) {
    return NextResponse.json(
      {
        code: "TTS_UNAVAILABLE",
        detail:
          "Server TTS is not configured (set TTS_SUBSCRIPTION_KEY). The client falls back to the browser speech engine.",
      },
      { status: 503 }
    );
  }

  const persona = getPersona(body.personaId);
  const language = resolveLanguage(body.language);
  const locale = VOICE_LOCALES[language.id] ?? "en-US";
  const voice = String(body.voice || VOICES[persona.id][language.id] || VOICES.soft.en);

  // ── Single shot ──
  if (body.mode !== "chunked") {
    try {
      const audio = await synthesize(text, voice, locale);
      return new NextResponse(audio, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(audio.byteLength),
          "Cache-Control": "no-store",
          "X-TTS-Voice": voice,
          "X-TTS-Persona": persona.id,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[savage-fit] tts failed:", message);
      return NextResponse.json({ code: "TTS_UPSTREAM_ERROR", detail: message }, { status: 502 });
    }
  }

  // ── Chunked (NDJSON audio frames) ──
  const chunks = chunkText(text);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let index = 0; index < chunks.length; index += 1) {
        try {
          const audio = await synthesize(chunks[index], voice, locale);
          const base64 = Buffer.from(audio).toString("base64");
          controller.enqueue(
            encoder.encode(`${JSON.stringify({ index, text: chunks[index], audioBase64: base64, mimeType: "audio/mpeg" })}\n`)
          );
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          controller.enqueue(encoder.encode(`${JSON.stringify({ index, error: detail })}\n`));
          break;
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-TTS-Voice": voice,
      "X-TTS-Persona": persona.id,
    },
  });
}
