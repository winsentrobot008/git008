/**
 * M1 - the intent translator: the only bridge between model text and a `TransactionIntent`.
 *
 * A language model is a text generator, not an authority, so nothing it emits is trusted here. This module
 * does exactly two things, in this order:
 *
 *   1. **Extract.** Pull one JSON object out of arbitrary model output (prose, fences, or bare JSON), using a
 *      string-aware brace scanner. Zero objects or more than one object are refusals: an ambiguous answer is
 *      the shape a prompt-injection payload takes, and picking "the first one" is how a benign object gets used
 *      to authorise a malicious one.
 *   2. **Validate.** Turn that object into a `TransactionIntent`, or refuse it. The model never supplies the
 *      destination, the calldata, the chain id or the amount's meaning: it names an action from a fixed
 *      allow-list, and *this* module builds the calldata with the same encoders the integration tests check
 *      byte-for-byte against Foundry, and takes the destination from the injected deployment catalog.
 *
 * Refusals carry a machine-readable {@link IntentTranslationCode}. The translator is a *schema* gate, not an
 * authority on spending: it bounds amounts as a sanity check, and `signer/policy.ts` remains the only thing
 * that decides whether a validated intent may actually be signed. Both gates run; neither substitutes for the
 * other.
 */

import { AbiEncodingError, encodeClaimHumanQuota, encodeCreateMemeToken } from "../signer/abi.js";
import { normalizeAddress, type Address, type Hex } from "../signer/types.js";
import type { TransactionIntent } from "../signer/wallet.js";

/** Actions the model is allowed to name. Anything else is a refusal, never a new capability. */
export type SlmAction = "createMemeToken" | "claimHumanQuota" | "transfer";

/** The allow-list, exported so the prompt, the docs and the tests quote one list. */
export const SLM_ACTIONS: readonly SlmAction[] = ["createMemeToken", "claimHumanQuota", "transfer"];

/** Why a model output was refused. Stable strings: they are logged and asserted, not shown to users. */
export type IntentTranslationCode =
  | "EMPTY_OUTPUT"
  | "MALFORMED_JSON"
  | "AMBIGUOUS_OUTPUT"
  | "NOT_AN_OBJECT"
  | "UNSUPPORTED_REQUEST"
  | "UNKNOWN_ACTION"
  | "UNKNOWN_FIELD"
  | "INVALID_PARAMETER"
  | "INVALID_CHAIN"
  | "AMOUNT_OUT_OF_BOUNDS";

/** Thrown for any model output that cannot be turned into a valid intent. Carries a stable code. */
export class IntentTranslationError extends Error {
  readonly code: IntentTranslationCode;

  constructor(code: IntentTranslationCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "IntentTranslationError";
    this.code = code;
  }
}

/** The deployed contracts the translator is allowed to target. Injected by the host, never by the model. */
export interface IntentCatalog {
  readonly chainId: number;
  readonly contracts: {
    readonly HumanToken: string;
    readonly MaoTangFactory: string;
  };
}

/** Caller-defined sanity bounds. The wallet's spend policy remains the authority; these are a first pass. */
export interface IntentLimits {
  /** Refuse any intent whose native value exceeds this, in wei. */
  readonly maxValueWeiPerIntent: bigint;
}

export interface IntentTranslatorOptions {
  readonly catalog: IntentCatalog;
  readonly limits: IntentLimits;
  /** Unix seconds, surfaced on the translation for audit. Injected so tests can pin it. */
  readonly now?: () => number;
}

/** A validated intent plus the provenance a caller needs to log it. */
export interface TranslatedIntent {
  readonly intent: TransactionIntent;
  readonly action: SlmAction;
  /** The model output this was derived from, kept verbatim for the audit trail. */
  readonly raw: string;
  readonly translatedAt: number;
}

/** Fields the schema accepts at the top level. Anything else is refused as a possible injection attempt. */
const ALLOWED_FIELDS: readonly string[] = [
  "action",
  "chainId",
  "valueWei",
  "name",
  "symbol",
  "proof",
  "nullifierHash",
  "to",
  "reason",
];

const MAX_NAME_BYTES = 64;
const MAX_SYMBOL_LENGTH = 12;
const MAX_REASON_LENGTH = 200;
const MAX_WEI_DIGITS = 78;

/**
 * Extracts the single JSON object from model output.
 *
 * The scanner tracks string state and escapes, so a `}` inside a string value (a token named `A}B`) does not
 * end the object early. Fences and prose are tolerated; ambiguity is not.
 */
export function extractJsonObject(output: string): string {
  if (typeof output !== "string" || output.trim().length === 0) {
    throw new IntentTranslationError("EMPTY_OUTPUT", "the model produced no output to translate");
  }
  const text = output.trim();
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }
    if (character === "}") {
      if (depth > 0) {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          objects.push(text.slice(start, index + 1));
          start = -1;
        }
      }
    }
  }
  if (objects.length === 0) {
    throw new IntentTranslationError("MALFORMED_JSON", "no complete JSON object was found in the model output");
  }
  if (objects.length > 1) {
    throw new IntentTranslationError(
      "AMBIGUOUS_OUTPUT",
      `the model output contains ${objects.length} top-level JSON objects; refusing to guess which one was meant`,
    );
  }
  const candidate = objects[0];
  try {
    JSON.parse(candidate);
  } catch (error) {
    throw new IntentTranslationError("MALFORMED_JSON", `the extracted object is not parseable JSON: ${(error as Error).message}`);
  }
  return candidate;
}

/**
 * Turns model output into a validated {@link TransactionIntent}.
 *
 * Synchronous and pure apart from the injected clock: there is no retry, no "best effort" parse and no repair
 * of a nearly-correct object, because a repaired intent is one the model did not actually ask for.
 */
export class IntentTranslator {
  readonly #chainId: number;
  readonly #humanToken: Address;
  readonly #factory: Address;
  readonly #maxValueWei: bigint;
  readonly #now: () => number;

  constructor(options: IntentTranslatorOptions) {
    if (options === null || options === undefined || typeof options !== "object") {
      throw new RangeError("IntentTranslator needs an options object with a catalog and limits");
    }
    const catalog = options.catalog;
    if (catalog === null || catalog === undefined || typeof catalog !== "object") {
      throw new RangeError("a deployment catalog is required: the model never supplies destinations");
    }
    if (!Number.isSafeInteger(catalog.chainId) || catalog.chainId <= 0) {
      throw new RangeError(`catalog.chainId must be a positive integer, got ${String(catalog.chainId)}`);
    }
    if (catalog.contracts === null || catalog.contracts === undefined || typeof catalog.contracts !== "object") {
      throw new RangeError("catalog.contracts must name HumanToken and MaoTangFactory");
    }
    this.#humanToken = requireAddress(catalog.contracts.HumanToken, "catalog.contracts.HumanToken");
    this.#factory = requireAddress(catalog.contracts.MaoTangFactory, "catalog.contracts.MaoTangFactory");
    this.#chainId = catalog.chainId;

    const limits = options.limits;
    if (limits === null || limits === undefined || typeof limits !== "object") {
      throw new RangeError("limits are required: an unbounded intent bound is not a bound");
    }
    if (typeof limits.maxValueWeiPerIntent !== "bigint" || limits.maxValueWeiPerIntent < 0n) {
      throw new RangeError(
        `limits.maxValueWeiPerIntent must be a non-negative bigint, got ${String(limits.maxValueWeiPerIntent)}`,
      );
    }
    this.#maxValueWei = limits.maxValueWeiPerIntent;
    this.#now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /** The chain this translator builds intents for. Exposed so a caller can assert its own configuration. */
  get chainId(): number {
    return this.#chainId;
  }

  translate(raw: string): TranslatedIntent {
    const json = extractJsonObject(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new IntentTranslationError("MALFORMED_JSON", `the extracted object is not parseable JSON: ${(error as Error).message}`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new IntentTranslationError("NOT_AN_OBJECT", "the model output must be a single JSON object");
    }
    const record = parsed as Record<string, unknown>;

    const unknownFields = Object.keys(record).filter((field) => !ALLOWED_FIELDS.includes(field));
    if (unknownFields.length > 0) {
      throw new IntentTranslationError(
        "UNKNOWN_FIELD",
        `the model output carries unrecognised field(s) ${unknownFields.join(", ")}; the schema is closed so that ` +
          "an unexpected key cannot smuggle in a destination or a payload",
      );
    }
    if (record.reason !== undefined) {
      if (typeof record.reason !== "string" || record.reason.length > MAX_REASON_LENGTH) {
        throw new IntentTranslationError("INVALID_PARAMETER", `reason must be a string of at most ${MAX_REASON_LENGTH} characters`);
      }
      // Accepted and deliberately discarded: the authorization prompt shows the translator's description of the
      // validated call, never model-authored prose that could be written to talk a human into approving.
    }

    const action = record.action;
    if (action === "unsupported") {
      throw new IntentTranslationError(
        "UNSUPPORTED_REQUEST",
        "the model reported that the input does not request a supported action",
      );
    }
    if (typeof action !== "string" || !SLM_ACTIONS.includes(action as SlmAction)) {
      throw new IntentTranslationError(
        "UNKNOWN_ACTION",
        `action ${describeValue(action)} is not one of ${SLM_ACTIONS.join(", ")}; a method the protocol does not ` +
          "have is a hallucination, not a new capability",
      );
    }

    if (record.chainId !== undefined) {
      if (!Number.isSafeInteger(record.chainId) || record.chainId !== this.#chainId) {
        throw new IntentTranslationError(
          "INVALID_CHAIN",
          `the model named chain ${describeValue(record.chainId)} but this translator is bound to ${this.#chainId}`,
        );
      }
    }

    const translatedAt = this.#now();
    switch (action as SlmAction) {
      case "createMemeToken":
        return this.#translateCreateMemeToken(record, raw, translatedAt);
      case "claimHumanQuota":
        return this.#translateClaimHumanQuota(record, raw, translatedAt);
      default:
        return this.#translateTransfer(record, raw, translatedAt);
    }
  }

  #translateCreateMemeToken(record: Record<string, unknown>, raw: string, translatedAt: number): TranslatedIntent {
    const name = requireText(record.name, "name", MAX_NAME_BYTES);
    const symbol = requireSymbol(record.symbol);
    const valueWei = this.#readValue(record, 0n);
    const description = `Create meme token "${name}" (${symbol}) on MaoTangFactory, sending ${valueWei.toString()} wei`;
    return {
      action: "createMemeToken",
      raw,
      translatedAt,
      intent: { to: this.#factory, valueWei, data: encodeCreateMemeToken(name, symbol), chainId: this.#chainId, description },
    };
  }

  #translateClaimHumanQuota(record: Record<string, unknown>, raw: string, translatedAt: number): TranslatedIntent {
    const valueWei = this.#readValue(record, 0n);
    if (valueWei !== 0n) {
      throw new IntentTranslationError(
        "INVALID_PARAMETER",
        "claimHumanQuota sends no native value; a non-zero valueWei would turn a personhood claim into a transfer",
      );
    }
    const proof = requireHexText(record.proof, "proof");
    const nullifierHash = requireHexText(record.nullifierHash, "nullifierHash");
    let data: Hex;
    try {
      data = encodeClaimHumanQuota(proof, nullifierHash);
    } catch (error) {
      if (error instanceof AbiEncodingError) {
        throw new IntentTranslationError("INVALID_PARAMETER", `the personhood claim is malformed: ${error.message}`);
      }
      throw error;
    }
    const description = `Claim the HumanToken personhood quota (nullifier ${shortHex(nullifierHash)})`;
    return {
      action: "claimHumanQuota",
      raw,
      translatedAt,
      intent: { to: this.#humanToken, valueWei: 0n, data, chainId: this.#chainId, description },
    };
  }

  #translateTransfer(record: Record<string, unknown>, raw: string, translatedAt: number): TranslatedIntent {
    let to: Address;
    try {
      to = requireAddress(record.to, "to");
    } catch (error) {
      throw new IntentTranslationError("INVALID_PARAMETER", (error as Error).message);
    }
    const valueWei = this.#readValue(record, null);
    if (valueWei === 0n) {
      throw new IntentTranslationError("INVALID_PARAMETER", "a transfer needs a valueWei greater than zero");
    }
    return {
      action: "transfer",
      raw,
      translatedAt,
      intent: {
        to,
        valueWei,
        data: "0x",
        chainId: this.#chainId,
        description: `Transfer ${valueWei.toString()} wei to ${to}`,
      },
    };
  }

  /** Reads `valueWei` as a decimal string of wei, bounded by the caller's limit. */
  #readValue(record: Record<string, unknown>, fallback: bigint | null): bigint {
    const value = record.valueWei;
    if (value === undefined) {
      if (fallback === null) {
        throw new IntentTranslationError("INVALID_PARAMETER", "valueWei is required for this action");
      }
      return fallback;
    }
    if (typeof value !== "string") {
      throw new IntentTranslationError(
        "INVALID_PARAMETER",
        `valueWei must be a decimal integer string of wei, got ${describeValue(value)}; a JSON number cannot carry ` +
          "wei without losing precision, so the schema refuses numbers",
      );
    }
    if (!new RegExp(`^(0|[1-9][0-9]{0,${MAX_WEI_DIGITS - 1}})$`).test(value)) {
      throw new IntentTranslationError(
        "INVALID_PARAMETER",
        `valueWei must be a canonical non-negative integer decimal string, got ${JSON.stringify(value)}`,
      );
    }
    const amount = BigInt(value);
    if (amount > this.#maxValueWei) {
      throw new IntentTranslationError(
        "AMOUNT_OUT_OF_BOUNDS",
        `valueWei ${value} exceeds the translator limit of ${this.#maxValueWei.toString()} wei`,
      );
    }
    return amount;
  }
}

function requireAddress(value: unknown, label: string): Address {
  if (typeof value !== "string") {
    throw new RangeError(`${label} must be a 20-byte hex address, got ${describeValue(value)}`);
  }
  try {
    return normalizeAddress(value);
  } catch (error) {
    throw new RangeError(`${label} is not a usable address: ${(error as Error).message}`);
  }
}

function requireText(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== "string") {
    throw new IntentTranslationError("INVALID_PARAMETER", `${label} must be a string, got ${describeValue(value)}`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new IntentTranslationError("INVALID_PARAMETER", `${label} must not be empty`);
  }
  if (trimmed.includes("\u0000")) {
    throw new IntentTranslationError("INVALID_PARAMETER", `${label} must not contain a NUL byte`);
  }
  const bytes = Buffer.byteLength(trimmed, "utf8");
  if (bytes > maxBytes) {
    throw new IntentTranslationError("INVALID_PARAMETER", `${label} is ${bytes} bytes; the limit is ${maxBytes}`);
  }
  return trimmed;
}

function requireSymbol(value: unknown): string {
  if (typeof value !== "string" || !new RegExp(`^[A-Za-z0-9]{1,${MAX_SYMBOL_LENGTH}}$`).test(value)) {
    throw new IntentTranslationError(
      "INVALID_PARAMETER",
      `symbol must be 1-${MAX_SYMBOL_LENGTH} characters of A-Z, a-z or 0-9, got ${describeValue(value)}`,
    );
  }
  return value;
}

function requireHexText(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value) || value.length % 2 !== 0) {
    throw new IntentTranslationError("INVALID_PARAMETER", `${label} must be even-length 0x hex, got ${describeValue(value)}`);
  }
  return value.toLowerCase() as Hex;
}

/** Shortens a hex value for a human-facing description without changing it. */
function shortHex(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function describeValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  return typeof value;
}
