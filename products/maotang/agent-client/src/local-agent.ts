import { parseToolCall, type ToolCall } from "./intents/parser.js";
import { buildToolCallPrompt, type ToolCallContext } from "./intents/prompts.js";
import { MAOTANG_TOOLS, type ToolDefinition } from "./intents/tools.js";
import type { SlmRuntime } from "./slm/runtime.js";
import type { SlmEngineInfo } from "./slm/types.js";

/** ChatML stop token; Qwen2.5 emits it after the JSON payload. */
export const DEFAULT_STOP_TOKENS = ["<|im_end|>", "<|im_start|>"];

export interface LocalAgentOptions {
  tools?: readonly ToolDefinition[];
  /** Values the model is allowed to copy into tool calls (nullifier, proof, quotes). */
  context?: ToolCallContext;
  maxTokens?: number;
  temperature?: number;
  stop?: readonly string[];
}

/**
 * Wires a local SLM runtime to the MAOTANG tool-calling contract: natural language in, validated
 * JSON tool call out. Everything runs in-process against the local model — no cloud round trip.
 */
export class LocalAgent {
  readonly runtime: SlmRuntime;

  private readonly tools: readonly ToolDefinition[];
  private readonly context: ToolCallContext;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly stopTokens: readonly string[];
  private prompt: string | undefined;

  constructor(runtime: SlmRuntime, options: LocalAgentOptions = {}) {
    this.runtime = runtime;
    this.tools = options.tools ?? MAOTANG_TOOLS;
    this.context = options.context ?? {};
    this.maxTokens = options.maxTokens ?? 256;
    this.temperature = options.temperature ?? 0;
    this.stopTokens = options.stop ?? DEFAULT_STOP_TOKENS;
    this.prompt = undefined;
  }

  /** Loads the local model into memory. */
  async start(): Promise<SlmEngineInfo> {
    return this.runtime.load();
  }

  /** Releases the model and its KV cache. */
  async stop(): Promise<void> {
    await this.runtime.unload();
  }

  /** Parses one natural-language request into a schema-validated tool call. */
  async handle(userText: string): Promise<ToolCall> {
    const prompt = buildToolCallPrompt(userText, { tools: this.tools, context: this.context });
    this.prompt = prompt;

    const result = await this.runtime.generate({
      prompt,
      maxTokens: this.maxTokens,
      temperature: this.temperature,
      stop: [...this.stopTokens],
    });

    return parseToolCall(result.text, this.tools);
  }

  /** Last prompt sent to the model, for debugging and tests. */
  lastPrompt(): string | undefined {
    return this.prompt;
  }
}