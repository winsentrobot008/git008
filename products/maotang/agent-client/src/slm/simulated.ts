import { SlmNotLoadedError } from "./errors.js";
import { estimateTokens } from "./types.js";
import type { SlmBackend, SlmEngine, SlmEngineInfo, SlmGenerationRequest, SlmGenerationResult, SlmModelSpec } from "./types.js";

const CLAIM_TOOL = "claim_mhuman_quota";
const SWAP_TOOL = "swap_micro_human";
const MICRO_DECIMALS = 6;
const RESERVE_DECIMALS = 18;
const BPS = 10_000n;

export interface SimulatedEngineOptions {
  modelPath: string;
  spec: SlmModelSpec;
  contextSize: number;
}

export interface SimulatedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** Identity and quote values the prompt exposes to the model. */
export interface SimulatedPromptContext {
  nullifier_hash?: string;
  zk_proof?: string;
  price_wei_per_token?: string;
  max_slippage_bps?: number;
}

/** Extracts the last ChatML user turn from a rendered prompt. */
export function extractUserTurn(prompt: string): string {
  const marker = "<|im_start|>user";
  const index = prompt.lastIndexOf(marker);
  if (index === -1) {
    return prompt.trim();
  }
  const rest = prompt.slice(index + marker.length);
  const end = rest.indexOf("<|im_end|>");
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

/** Reads the ```json context block that carries nullifier, proof and quote values. */
export function extractPromptContext(prompt: string): SimulatedPromptContext {
  const blocks = prompt.matchAll(/```json context\r?\n([\s\S]*?)```/g);
  for (const block of blocks) {
    const raw = block[1];
    if (raw === undefined) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as SimulatedPromptContext;
      }
    } catch {
      // not the context block, keep scanning
    }
  }
  return {};
}

/** Decimal string to base units, without floating point. */
export function parseDecimalUnits(value: string, decimals: number): bigint {
  const parts = value.split(".");
  const whole = parts[0] ?? "0";
  const fraction = parts[1] ?? "";
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded === "" ? "0" : padded);
}

function applySlippage(value: bigint, bps: number): bigint {
  const clamped = BigInt(Math.max(0, Math.min(10_000, Math.trunc(bps))));
  return (value * (BPS - clamped)) / BPS;
}

function quoteMinOut(amountIn: bigint, context: SimulatedPromptContext, direction: "buy" | "sell"): bigint {
  const price = context.price_wei_per_token;
  if (price === undefined || !/^[0-9]+$/.test(price)) {
    return 0n;
  }
  const priceWei = BigInt(price);
  if (priceWei === 0n) {
    return 0n;
  }
  const gross =
    direction === "buy"
      ? (amountIn * 10n ** BigInt(MICRO_DECIMALS)) / priceWei
      : (amountIn * priceWei) / 10n ** BigInt(MICRO_DECIMALS);
  return applySlippage(gross, context.max_slippage_bps ?? 0);
}

function normalizeAsset(raw: string | undefined): "eth" | "mhuman" | null {
  if (raw === undefined) {
    return null;
  }
  const value = raw.toLowerCase();
  if (value === "eth") {
    return "eth";
  }
  return value.includes("human") ? "mhuman" : null;
}

/** Turns a rendered prompt into the JSON tool call the real model is asked to produce. */
export function buildSimulatedToolCall(prompt: string): SimulatedToolCall {
  const context = extractPromptContext(prompt);
  const text = extractUserTurn(prompt).toLowerCase();

  if (/\bclaim\b/.test(text) || /\bquota\b/.test(text)) {
    return {
      name: CLAIM_TOOL,
      arguments: {
        nullifier_hash: context.nullifier_hash ?? `0x${"0".repeat(64)}`,
        zk_proof: context.zk_proof ?? "0x00",
      },
    };
  }

  const match = /(\d+(?:\.\d+)?)\s*(eth|[\w-]*human)/i.exec(text);
  const amount = match?.[1] ?? /(\d+(?:\.\d+)?)/.exec(text)?.[1] ?? null;
  const asset = normalizeAsset(match?.[2]);

  if (amount !== null && (asset === "mhuman" || /\bsell\b/.test(text))) {
    const amountIn = parseDecimalUnits(amount, MICRO_DECIMALS);
    return {
      name: SWAP_TOOL,
      arguments: {
        amount_in: amountIn.toString(),
        min_out: quoteMinOut(amountIn, context, "sell").toString(),
        direction: "sell",
      },
    };
  }

  if (amount !== null && (/\bbuy\b/.test(text) || /\bswap\b/.test(text))) {
    const amountIn = parseDecimalUnits(amount, RESERVE_DECIMALS);
    return {
      name: SWAP_TOOL,
      arguments: {
        amount_in: amountIn.toString(),
        min_out: quoteMinOut(amountIn, context, "buy").toString(),
        direction: "buy",
      },
    };
  }

  return { name: "unsupported", arguments: { reason: "no MAOTANG tool matches this request" } };
}

/**
 * Deterministic stand-in for the local model.
 *
 * It exists so the tool-calling pipeline can be tested in CI on machines without a native runtime.
 * It is never selected implicitly: the runtime only uses it in `simulated` mode, and `native` mode
 * fails loudly instead of silently degrading to this engine.
 */
export class SimulatedSlmEngine implements SlmEngine {
  readonly id = "simulated-slm";
  readonly backend: SlmBackend = "simulated";

  private readonly options: SimulatedEngineOptions;
  private loaded = false;

  constructor(options: SimulatedEngineOptions) {
    this.options = options;
  }

  async load(): Promise<SlmEngineInfo> {
    this.loaded = true;
    return this.info();
  }

  async unload(): Promise<void> {
    this.loaded = false;
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  info(): SlmEngineInfo {
    return {
      id: this.id,
      backend: this.backend,
      modelId: this.options.spec.id,
      modelPath: this.options.modelPath,
      contextSize: this.options.contextSize,
      loaded: this.loaded,
    };
  }

  async generate(request: SlmGenerationRequest): Promise<SlmGenerationResult> {
    if (!this.loaded) {
      throw new SlmNotLoadedError(this.id);
    }
    const started = Date.now();
    const text = JSON.stringify(buildSimulatedToolCall(request.prompt));
    return {
      text,
      promptTokens: estimateTokens(request.prompt),
      outputTokens: estimateTokens(text),
      durationMs: Date.now() - started,
    };
  }
}