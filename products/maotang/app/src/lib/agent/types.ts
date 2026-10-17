/**
 * Wire contract between the browser console and the server-side agent runtime.
 *
 * This file is imported by both sides, so it holds **types only** and imports nothing. That is
 * deliberate: the server runtime pulls in `@maotang/mobile-agent`, which reaches for `node:crypto`,
 * and a value import from here would drag that into the client bundle. `Address`/`Hex` are re-declared
 * rather than re-exported from the package for the same reason - the moment one of these becomes a
 * runtime import, the console stops being an edge client.
 *
 * Amounts cross the wire as canonical integer decimal strings, never as JSON numbers: a `number` is a
 * float, and a float that silently rounds is exactly how a spend becomes the wrong spend.
 */

/** 20-byte EVM address, lowercase `0x` hex. */
export type Address = `0x${string}`;

/** Hex string, `0x`-prefixed, whole number of bytes. */
export type Hex = `0x${string}`;

/** Which module refused, so the console can point at the pillar that said no. */
export type AgentRefusalStage =
  | "request"
  | "m1-engine"
  | "m1-translator"
  | "m2-policy"
  | "m2-authorization"
  | "m2-enclave";

/**
 * A refusal. `code` is the machine-readable identifier the module itself raised (`UNKNOWN_ACTION`,
 * `DESTINATION_NOT_ALLOWED`, `EnclaveUnavailableError`, ...), never a paraphrase, so the console can
 * show the owner the same string the unit tests assert.
 */
export interface AgentRefusal {
  readonly stage: AgentRefusalStage;
  /** The module's own code, or its error name when it does not have one. */
  readonly code: string;
  readonly reason: string;
}

/** The intent, as the console renders it. `data` is the calldata the contracts would receive. */
export interface IntentPreview {
  /** Allow-listed M1 action name (`createMemeToken` | `claimHumanQuota` | `transfer`). */
  readonly action: string;
  readonly to: Address;
  /** Native value in wei, as a canonical integer decimal string. */
  readonly valueWei: string;
  readonly data: Hex;
  readonly chainId: number;
  readonly description: string;
  /** 4-byte selector of `data`, or `null` for a plain value transfer. */
  readonly selector: Hex | null;
}

/** The M2 policy decision, restated for the wire. */
export type PolicyReport =
  | {
      readonly allowed: true;
      /** True when the policy demands a human authorization for this leg. */
      readonly requiresAuthorization: boolean;
      /** Window budget left *after* this intent, in wei as a decimal string. */
      readonly remainingWindowWei: string;
      /** Kept for symmetry with the denial branch; the selector is on the preview. */
      readonly selector: Hex | null;
    }
  | { readonly allowed: false; readonly code: string; readonly reason: string };

/** Text the M1 engine produced, kept for the audit trail. */
export interface InferenceReport {
  readonly backend: string;
  readonly modelId: string;
  readonly deterministic: boolean;
  /** Always `"enforced"`: the M1 sentinel has no off switch. */
  readonly networkIsolation: "enforced";
  readonly prompt: string;
  readonly raw: string;
}

/**
 * What `/api/agent/intent` answers on success.
 *
 * `success` mirrors `ok` as the flat flag the route also sends, so a caller can branch on one boolean
 * without knowing the staged shape.
 */
export interface IntentSuccess {
  readonly ok: true;
  readonly success: true;
  readonly inference: InferenceReport;
  readonly preview: IntentPreview;
  readonly decision: PolicyReport;
  /** The digest the enclave would sign, so the console shows one immutable value to authorize. */
  readonly digest: Hex;
  /**
   * Present only when the caller asked to sign *and* the device enclave released a signature. On a
   * server with no bridge this is always absent - see `signRefusal`.
   */
  readonly signed: SignedReport | null;
  /** Why signing did not happen. `null` when it did, or when it was not attempted. */
  readonly signRefusal: AgentRefusal | null;
}

/** A released signature, with the public material needed to re-check it. */
export interface SignedReport {
  readonly keyId: string;
  readonly signature: Hex;
  readonly spkiPublicKey: Hex;
  readonly authorizationMethod: string;
  readonly hardwareBacked: boolean;
  readonly signedAt: number;
}

/**
 * What `/api/agent/intent` answers on refusal.
 *
 * The route answers **HTTP 200** here: a deterministic M1/M2 verdict is a business answer, and a 4xx
 * would make the browser log a failed request that no JS can un-log (see the route's header comment).
 * `code`/`message` are the flat form and `refusal` keeps the stage the console points at; the pillar's
 * severity still travels, in the `x-maotang-refusal-status` response header.
 */
export interface IntentFailure {
  readonly ok: false;
  readonly success: false;
  readonly code: string;
  readonly message: string;
  readonly refusal: AgentRefusal;
}

export type IntentResponse = IntentSuccess | IntentFailure;