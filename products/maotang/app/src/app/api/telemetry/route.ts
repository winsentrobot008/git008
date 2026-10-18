/**
 * `POST /api/telemetry` - the sanitising funnel sink.
 *
 * The deployment has no durable analytics store, so this route says so: it accepts the event, writes
 * one structured line to the process log, and returns `persistent: false`. It never claims a
 * conversion was stored when it was not, and it never accepts message text or device credentials.
 */

import { TELEMETRY_ALLOWED_PROPS, type TelemetryEvent } from "@/lib/telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION = /^[A-Za-z0-9_-]{16,64}$/;

function reply(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return reply({ ok: false, code: "INVALID_JSON" }, 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return reply({ ok: false, code: "INVALID_BODY" }, 400);
  }

  const record = body as Record<string, unknown>;
  const event = record.event;
  const sessionId = record.sessionId;
  // `in` walks the prototype chain, so `toString` (or any other inherited key) would pass this
  // check and then make `TELEMETRY_ALLOWED_PROPS[event]` hand back a function instead of an
  // allow-list. Use an own-property check before indexing.
  if (typeof event !== "string" || !Object.hasOwn(TELEMETRY_ALLOWED_PROPS, event)) {
    return reply({ ok: false, code: "EVENT_NOT_ALLOWED" }, 422);
  }
  if (typeof sessionId !== "string" || !SESSION.test(sessionId)) {
    return reply({ ok: false, code: "SESSION_INVALID" }, 422);
  }

  const allowed = new Set(TELEMETRY_ALLOWED_PROPS[event as TelemetryEvent]);
  const props: Record<string, string | number | boolean> = {};
  const supplied = record.props;
  if (supplied !== null && typeof supplied === "object" && !Array.isArray(supplied)) {
    for (const [key, value] of Object.entries(supplied as Record<string, unknown>)) {
      if (!allowed.has(key)) {
        continue;
      }
      if (typeof value === "string" && value.length <= 120) {
        props[key] = value;
      } else if (typeof value === "number" && Number.isFinite(value)) {
        props[key] = value;
      } else if (typeof value === "boolean") {
        props[key] = value;
      }
    }
  }

  // Structured, non-identifying: no IP, no address, no message body, no WebAuthn material.
  console.info(JSON.stringify({ telemetry: event, session: sessionId, props }));

  return reply({
    ok: true,
    accepted: true,
    event,
    persistent: false,
    sink: "process-log",
    note: "No durable attribution store is configured; this sample is not queryable after the process exits.",
  });
}
