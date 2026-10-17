import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ToolCallParseError,
  UnsupportedToolError,
  buildToolCallPrompt,
  findTool,
  parseToolCall,
  validateToolCall,
  type ToolCallContext,
} from "../src/intents/index.js";
import { LocalAgent } from "../src/local-agent.js";
import {
  CloudDependencyError,
  DEFAULT_MEMORY_BUDGET_BYTES,
  MemoryBudgetExceededError,
  SlmNotLoadedError,
  SlmRuntime,
  SlmRuntimeUnavailableError,
  tryImportModule,
  type SlmRuntimeConfig,
} from "../src/slm/index.js";

const NULLIFIER = `0x${"1a".repeat(32)}`;
const PROOF = "0xabcd1234";
const MODEL_PATH = "/models/qwen2.5-0.5b-instruct-int4.gguf";

const CONTEXT: ToolCallContext = {
  nullifier_hash: NULLIFIER,
  zk_proof: PROOF,
  wallet: "0x1111111111111111111111111111111111111111",
  price_wei_per_token: "23954000000",
  max_slippage_bps: 100,
};

/** Simulated mode is the CI path: same pipeline, deterministic "model" output instead of weights. */
function createRuntime(overrides: Partial<SlmRuntimeConfig> = {}): SlmRuntime {
  return new SlmRuntime({ modelPath: MODEL_PATH, mode: "simulated", ...overrides });
}

function createAgent(overrides: Partial<SlmRuntimeConfig> = {}): { runtime: SlmRuntime; agent: LocalAgent } {
  const runtime = createRuntime(overrides);
  return { runtime, agent: new LocalAgent(runtime, { context: CONTEXT }) };
}

test("the prompt template embeds the tool schemas, the context and the ChatML turns", () => {
  const prompt = buildToolCallPrompt("Claim my 1M micro-HUMAN tokens", { context: CONTEXT });

  assert.ok(prompt.startsWith("<|im_start|>system\n"));
  assert.ok(prompt.includes("<|im_start|>user\nClaim my 1M micro-HUMAN tokens<|im_end|>"));
  assert.ok(prompt.trimEnd().endsWith("<|im_start|>assistant"));
  assert.ok(prompt.includes("claim_mhuman_quota"));
  assert.ok(prompt.includes("swap_micro_human"));
  assert.ok(prompt.includes('"additionalProperties": false'));
  assert.ok(prompt.includes("```json context"));
  assert.ok(prompt.includes(NULLIFIER));
  assert.ok(prompt.includes("no cloud API"));
});

test("tool schemas are strict about their arguments", () => {
  const claim = findTool("claim_mhuman_quota");
  const swap = findTool("swap_micro_human");
  assert.ok(claim);
  assert.ok(swap);

  assert.deepEqual(claim.function.parameters.required, ["nullifier_hash", "zk_proof"]);
  assert.equal(claim.function.parameters.additionalProperties, false);
  assert.deepEqual(swap.function.parameters.required, ["amount_in", "min_out", "direction"]);
  assert.deepEqual(swap.function.parameters.properties?.direction.enum, ["buy", "sell"]);
});

test("a natural-language claim produces a schema-valid claim_mhuman_quota payload", async () => {
  const { agent, runtime } = createAgent();
  const info = await agent.start();
  assert.equal(info.backend, "simulated");
  assert.equal(info.modelId, "qwen2.5-0.5b-instruct-int4");
  assert.equal(info.loaded, true);

  const call = await agent.handle("Claim my 1M micro-HUMAN tokens");

  assert.equal(call.name, "claim_mhuman_quota");
  assert.equal(call.arguments.nullifier_hash, NULLIFIER);
  assert.equal(call.arguments.zk_proof, PROOF);
  assert.deepEqual(validateToolCall(call), []);

  // the prompt really carried the tool contract into the local model
  assert.ok(agent.lastPrompt()?.includes("claim_mhuman_quota"));

  await agent.stop();
  assert.equal(runtime.isLoaded(), false);
});

test("natural-language swaps map to buy and sell tool calls", async () => {
  const { agent } = createAgent();
  await agent.start();

  const buy = await agent.handle("Swap 0.5 ETH for micro-HUMAN");
  assert.equal(buy.name, "swap_micro_human");
  assert.equal(buy.arguments.direction, "buy");
  assert.equal(buy.arguments.amount_in, "500000000000000000");
  assert.match(String(buy.arguments.min_out), /^[0-9]+$/);
  assert.ok(BigInt(String(buy.arguments.min_out)) > 0n);
  assert.deepEqual(validateToolCall(buy), []);

  const sell = await agent.handle("Sell 1000 mHUMAN for ETH");
  assert.equal(sell.name, "swap_micro_human");
  assert.equal(sell.arguments.direction, "sell");
  assert.equal(sell.arguments.amount_in, "1000000000");
  assert.equal(sell.arguments.min_out, "23714460000000");
  assert.deepEqual(validateToolCall(sell), []);
});

test("a prompt with no matching tool never becomes an executable call", async () => {
  const { agent } = createAgent();
  await agent.start();

  await assert.rejects(() => agent.handle("book me a flight to Oslo"), UnsupportedToolError);
});

test("malformed payloads are rejected by the schema", () => {
  const badDirection = validateToolCall({
    name: "swap_micro_human",
    arguments: { amount_in: "1", min_out: "0", direction: "long" },
  });
  assert.ok(badDirection.some((issue) => issue.path === "$.arguments.direction"));

  const missing = validateToolCall({ name: "claim_mhuman_quota", arguments: { nullifier_hash: NULLIFIER } });
  assert.ok(missing.some((issue) => issue.path === "$.arguments.zk_proof" && issue.message === "is required"));

  const shortNullifier = validateToolCall({
    name: "claim_mhuman_quota",
    arguments: { nullifier_hash: "0x1234", zk_proof: PROOF },
  });
  assert.ok(shortNullifier.some((issue) => issue.path === "$.arguments.nullifier_hash"));

  const extra = validateToolCall({
    name: "claim_mhuman_quota",
    arguments: { nullifier_hash: NULLIFIER, zk_proof: PROOF, amount: "999" },
  });
  assert.ok(extra.some((issue) => issue.message.includes("additionalProperties")));

  const unknownTool = validateToolCall({ name: "drain_wallet", arguments: {} });
  assert.ok(unknownTool.some((issue) => issue.path === "$.name"));
});

test("the parser tolerates fences and prose but refuses anything unparseable", () => {
  const payload = `{"name":"claim_mhuman_quota","arguments":{"nullifier_hash":"${NULLIFIER}","zk_proof":"${PROOF}"}}`;

  const fenced = parseToolCall(`Sure, here you go:\n\`\`\`json\n${payload}\n\`\`\`\n`);
  assert.equal(fenced.name, "claim_mhuman_quota");
  assert.equal(fenced.arguments.zk_proof, PROOF);

  const prose = parseToolCall(`I will claim now. ${payload} Done.`);
  assert.equal(prose.name, "claim_mhuman_quota");

  assert.throws(() => parseToolCall("I cannot help with that."), ToolCallParseError);
  assert.throws(() => parseToolCall('{"name":"claim_mhuman_quota",'), ToolCallParseError);
  assert.throws(() => parseToolCall('{"arguments":{}}'), ToolCallParseError);
});

test("the 0.5B preset stays inside the 500 MiB ceiling", () => {
  const runtime = createRuntime();

  assert.equal(runtime.model.id, "qwen2.5-0.5b-instruct-int4");
  assert.equal(runtime.model.parametersB, 0.5);
  assert.ok(runtime.memory.kvCacheBytes > 0, "the KV cache must be accounted for");
  assert.ok(
    runtime.memory.totalBytes <= DEFAULT_MEMORY_BUDGET_BYTES,
    `total ${runtime.memory.totalBytes} must fit ${DEFAULT_MEMORY_BUDGET_BYTES}`,
  );
  assert.equal(runtime.memory.withinBudget, true);
});

test("a 1.5B model is refused unless the budget is raised explicitly", () => {
  assert.throws(
    () => createRuntime({ model: "qwen2.5-1.5b-instruct-int4", modelPath: "/models/1.5b.gguf" }),
    MemoryBudgetExceededError,
  );

  const allowed = createRuntime({
    model: "qwen2.5-1.5b-instruct-int4",
    modelPath: "/models/1.5b.gguf",
    allowOverBudget: true,
  });
  assert.equal(allowed.memory.withinBudget, false);
  assert.ok(allowed.memory.totalBytes > DEFAULT_MEMORY_BUDGET_BYTES);
});

test("cloud endpoints and credentials are refused outright", () => {
  assert.throws(() => createRuntime({ endpoint: "https://api.openai.com/v1" }), CloudDependencyError);
  assert.throws(() => createRuntime({ apiKey: "sk-not-a-real-key" }), CloudDependencyError);
  assert.throws(() => createRuntime({ baseUrl: "https://example.invalid" }), CloudDependencyError);
});

test("native backends fail loudly instead of silently degrading", async (t) => {
  const probe = await tryImportModule("node-llama-cpp");
  if (probe.available) {
    t.skip("node-llama-cpp is installed; the unavailable path cannot be exercised here");
    return;
  }

  const runtime = createRuntime({ mode: "native" });
  assert.equal(runtime.backend, "llama.cpp");
  await assert.rejects(() => runtime.load(), SlmRuntimeUnavailableError);
  await assert.rejects(() => runtime.generate({ prompt: "hi" }), SlmNotLoadedError);
});

test("optional native modules resolve to an unavailable result, never a crash", async () => {
  const missing = await tryImportModule("maotang-not-a-real-module-xyz");
  assert.equal(missing.available, false);
  assert.equal(missing.module, null);
  assert.ok(typeof missing.error === "string");
});