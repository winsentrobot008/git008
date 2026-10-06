import { MAOTANG_TOOLS, toolSchemasForPrompt, type ToolDefinition } from "./tools.js";

export const CHATML_START = "<|im_start|>";
export const CHATML_END = "<|im_end|>";

/** Values the agent injects locally so the model never has to invent them. */
export interface ToolCallContext {
  nullifier_hash?: string;
  zk_proof?: string;
  wallet?: string;
  price_wei_per_token?: string;
  max_slippage_bps?: number;
}

export interface ToolCallPromptOptions {
  tools?: readonly ToolDefinition[];
  context?: ToolCallContext;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const MAOTANG_TOOL_SYSTEM_PROMPT = [
  "You are the local MAOTANG agent runtime running entirely on this machine.",
  "Translate the user's request into exactly one executable JSON tool call.",
  "",
  "Rules:",
  '1. Reply with a single JSON object and nothing else: {"name": <tool name>, "arguments": {...}}.',
  "2. Use only the tools listed below. Never invent a tool, an argument or a value.",
  "3. Copy nullifier_hash, zk_proof and price_wei_per_token verbatim from the context block.",
  "4. amount_in and min_out are base-unit decimal strings: wei for buy, micro-units for sell.",
  "5. If no tool fits, reply with the unsupported tool. Never ask a follow-up question.",
  "6. There is no cloud API. Do not attempt any network call.",
].join("\n");

const EXAMPLES = [
  'User: "Claim my 1M micro-HUMAN tokens"',
  '{"name":"claim_mhuman_quota","arguments":{"nullifier_hash":"<context.nullifier_hash>","zk_proof":"<context.zk_proof>"}}',
  "",
  'User: "Swap 0.5 ETH for micro-HUMAN"',
  '{"name":"swap_micro_human","arguments":{"amount_in":"500000000000000000","min_out":"<quote minus slippage>","direction":"buy"}}',
  "",
  'User: "Sell 1000 mHUMAN for ETH"',
  '{"name":"swap_micro_human","arguments":{"amount_in":"1000000000","min_out":"<quote minus slippage>","direction":"sell"}}',
].join("\n");

/** Builds the system + user turns sent to the local model. */
export function buildToolCallMessages(
  userText: string,
  options: ToolCallPromptOptions = {},
): ChatMessage[] {
  const tools = options.tools ?? MAOTANG_TOOLS;
  const context = options.context ?? {};

  const system = [
    MAOTANG_TOOL_SYSTEM_PROMPT,
    "",
    "Tools (strict JSON Schema):",
    "```json tools",
    toolSchemasForPrompt(tools),
    "```",
    "",
    "Context (copy these exact values when a tool needs them):",
    "```json context",
    JSON.stringify(context),
    "```",
    "",
    "Examples:",
    EXAMPLES,
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: userText },
  ];
}

/** Renders messages in Qwen2.5 ChatML and opens the assistant turn. */
export function renderChatMl(messages: readonly ChatMessage[]): string {
  const turns = messages
    .map((message) => `${CHATML_START}${message.role}\n${message.content}${CHATML_END}\n`)
    .join("");
  return `${turns}${CHATML_START}assistant\n`;
}

/** Convenience: user text in, full ChatML prompt out. */
export function buildToolCallPrompt(userText: string, options: ToolCallPromptOptions = {}): string {
  return renderChatMl(buildToolCallMessages(userText, options));
}