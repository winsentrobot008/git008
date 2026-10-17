/**
 * `POST /api/agent/intent` - one prompt, run through M1 and M2, answered as a preview.
 *
 * The pipeline is the shipped one, in the order the mobile agent documents it:
 *
 *   M1 `LocalSlmEngineAdapter.infer`  -> text (offline; the sentinel runs on every call)
 *   M1 `IntentTranslator.translate`   -> a `TransactionIntent`, or a schema refusal
 *   M2 `AutonomousWallet.preview`     -> the policy decision plus the digest that *would* be signed
 *   M2 `AutonomousWallet.signIntent`  -> only when the caller asks, and only if an enclave can sign
 *
 * Two properties are load-bearing:
 *
 *   1. **Nothing here signs by default.** `attemptSign` has to be asked for, and even then the wallet
 *      refuses without a hardware enclave, so this endpoint cannot be a signing oracle.
 *   2. **A refusal is a first-class answer.** Each failure carries the stage and the module's own
 *      error code (`UNKNOWN_ACTION`, `DESTINATION_NOT_ALLOWED`, `EnclaveUnavailableError`, ...), so
 *      the console names the pillar that said no instead of rendering a generic failure.
 *   3. **A refusal is answered `200`, not `4xx`.** A deterministic M1/M2 verdict is a business answer,
 *      and a browser logs *any* 4xx/5xx resource response to the console - a red `POST 422` entry no JS
 *      can remove, next to a card that is behaving correctly. So the verdict travels in the body
 *      (`success: false`, `code`, `message` plus the staged `refusal`) and the pillar's severity rides
 *      along in `x-maotang-refusal-status` for curl and ops. Only a malformed request body - which the
 *      console never sends - would be a transport-level error.
 */

import type { SlmInferenceResult, TranslatedIntent } from "@maotang/mobile-agent/dist/slm/index.js";

import { createRuntime, toRefusal } from "@/lib/agent/runtime";

import type { AgentRefusal, AgentRefusalStage, IntentResponse, SignedReport } from "@/lib/agent/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Longest prompt accepted. A model input box is not a file transfer; bound it at the edge. */
const MAX_PROMPT_CHARS = 2000;

/**
 * The severity a refusal *would* have carried as an HTTP status.
 *
 * Kept, but no longer sent as one: the verdict is the response body, and this mapping travels in the
 * `x-maotang-refusal-status` header so a curl or an ops filter can still tell "the caller sent
 * nonsense" (400) from "the enclave cannot sign" (501) without the browser logging a failed request.
 */
const STATUS_BY_STAGE: Record<AgentRefusalStage, number> = {
  request: 400,
  "m1-engine": 503,
  "m1-translator": 422,
  "m2-policy": 403,
  "m2-authorization": 403,
  "m2-enclave": 501,
};

function refuse(refusal: AgentRefusal): Response {
  const body: IntentResponse = {
    ok: false,
    success: false,
    code: refusal.code,
    message: refusal.reason,
    refusal,
  };
  return Response.json(body, {
    status: 200,
    headers: {
      "x-maotang-refusal-stage": refusal.stage,
      "x-maotang-refusal-status": String(STATUS_BY_STAGE[refusal.stage] ?? 400),
    },
  });
}

interface IntentRequest {
  readonly prompt?: unknown;
  readonly attemptSign?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  let body: IntentRequest;
  try {
    body = (await request.json()) as IntentRequest;
  } catch {
    return refuse({ stage: "request", code: "MALFORMED_BODY", reason: "the request body is not JSON" });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (prompt === "") {
    return refuse({ stage: "request", code: "EMPTY_PROMPT", reason: "prompt must be a non-empty string" });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return refuse({
      stage: "request",
      code: "PROMPT_TOO_LONG",
      reason: `prompt is ${prompt.length} characters; the bound is ${MAX_PROMPT_CHARS}`,
    });
  }
  const attemptSign = body.attemptSign === true;

  const built = createRuntime();
  if (!built.ok) {
    return refuse(built.refusal);
  }
  const agent = built.runtime;

  // -- M1: propose, then validate ---------------------------------------------------------------
  let inference: SlmInferenceResult;
  try {
    inference = await agent.engine.infer({ kind: "utterance", text: prompt });
  } catch (error) {
    return refuse(toRefusal(error, "m1-engine"));
  }

  let translated: TranslatedIntent;
  try {
    translated = agent.translator.translate(inference.raw);
  } catch (error) {
    return refuse(toRefusal(error, "m1-translator"));
  }

  // -- M2: dispose ------------------------------------------------------------------------------
  const preview = await agent.wallet.preview(translated.intent);
  if (!preview.decision.allowed) {
    return refuse({ stage: "m2-policy", code: preview.decision.code, reason: preview.decision.reason });
  }

  let signed: SignedReport | null = null;
  let signRefusal: AgentRefusal | null = null;

  if (attemptSign) {
    try {
      const released = await agent.wallet.signIntent(translated.intent);
      signed = {
        keyId: released.keyId,
        signature: released.signature,
        spkiPublicKey: released.spkiPublicKey,
        authorizationMethod: released.authorization?.method ?? "none",
        hardwareBacked: released.authorization?.hardwareBacked ?? false,
        signedAt: released.signedAt,
      };
    } catch (error) {
      // The preview stands on its own; a refused signature is reported next to it, not instead of it.
      signRefusal = toRefusal(error, "m2-enclave");
    }
  }

  const response: IntentResponse = {
    ok: true,
    success: true,
    inference: {
      backend: inference.backend,
      modelId: inference.modelId,
      deterministic: inference.deterministic,
      networkIsolation: inference.networkIsolation,
      prompt: inference.prompt,
      raw: inference.raw,
    },
    preview: {
      action: translated.action,
      // Read from the wallet's *normalized* intent, not the translator's raw one: normalization is
      // where `to`/`data` become the canonical `Address`/`Hex` the policy and digest actually cover.
      to: preview.intent.to,
      valueWei: preview.intent.valueWei.toString(),
      data: preview.intent.data,
      chainId: preview.intent.chainId,
      description: preview.intent.description,
      selector: preview.intent.selector,
    },
    decision: {
      allowed: true,
      requiresAuthorization: preview.decision.requiresAuthorization,
      remainingWindowWei: preview.decision.remainingWindowWei.toString(),
      selector: preview.decision.selector,
    },
    digest: preview.digest,
    signed,
    signRefusal,
  };

  return Response.json(response, { status: 200 });
}