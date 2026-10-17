/**
 * Execution-provider planning and the ONNX fallback ladder.
 *
 * The ONNX runtime is optional and its accelerators are device-specific, so the engine must degrade
 * to CPU kernels instead of throwing when a provider is missing. These tests inject a fake
 * `onnxruntime-node` module (see `fixtures/fake-onnx-runtime.ts`) that only accepts `["cpu"]`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { SlmRuntimeUnavailableError, type SlmModelSpec } from "../src/slm/index.js";
import {
  CPU_FALLBACK_PROVIDERS,
  DEFAULT_EXECUTION_PROVIDERS,
  OnnxEngine,
  detectAvailableProviders,
  executionProviderLadder,
  normalizeProvider,
  planExecutionProviders,
} from "../src/slm/onnx.js";
import { resetFixture, attempts, released, runs, SCRIPTED_TOKENS } from "./fixtures/fake-onnx-runtime.js";

/** The compiled test tree keeps the relative specifier below stable. */
const FAKE_MODULE = "../../test/fixtures/fake-onnx-runtime.js";
const MISSING_MODULE = "../../test/fixtures/no-such-runtime.js";

const ONNX_SPEC: SlmModelSpec = {
  id: "qwen2.5-0.5b-instruct-int4-onnx",
  family: "qwen2.5",
  parametersB: 0.5,
  quantization: "int4",
  format: "onnx",
  approxFileBytes: 320 * 1024 * 1024,
  contextSize: 4096,
  hiddenSize: 896,
  layers: 24,
  attentionHeads: 14,
  keyValueHeads: 2,
  headDim: 64,
};

/** Maps the fixture's scripted tokens to text, with token 1 as EOS. */
const TOKENIZER = {
  encode: (text: string) => [10, Math.min(text.length, 20)],
  decode: (tokens: number[]) => tokens.map((token) => ({ 2: "al", 3: "pha" })[token] ?? "").join(""),
  eosTokenId: 1,
};

test("provider names are normalized the way ONNX Runtime spells them", () => {
  assert.equal(normalizeProvider("QNNExecutionProvider"), "qnn");
  assert.equal(normalizeProvider("CPU"), "cpu");
  assert.equal(normalizeProvider("xnnpack"), "xnnpack");
});

test("planExecutionProviders orders NPU first and always ends with cpu", () => {
  const planned = planExecutionProviders();
  assert.equal(planned[0], "qnn");
  assert.ok(planned.includes("xnnpack"));
  assert.equal(planned[planned.length - 1], "cpu");
  assert.deepEqual([...planned].sort(), [...new Set(planned)].sort());

  assert.deepEqual(planExecutionProviders({ available: ["cpu"] }), ["cpu"]);
  assert.deepEqual(planExecutionProviders({ available: ["nnapi", "cpu"] }), ["nnapi", "cpu"]);
  // An explicit preference is honoured as given, with `cpu` still last.
  assert.deepEqual(planExecutionProviders({ preferred: ["cuda"] }), ["cuda", "cpu"]);
  assert.deepEqual(planExecutionProviders({ preferred: ["cpu"] }), ["cpu"]);
  // An unknown provider name is kept: the runtime, not this planner, decides what it supports.
  assert.deepEqual(planExecutionProviders({ preferred: ["vermeer"] }), ["vermeer", "cpu"]);
  assert.ok(DEFAULT_EXECUTION_PROVIDERS.includes("xnnpack"));
  assert.ok(CPU_FALLBACK_PROVIDERS.includes("xnnpack"));
});

test("the ladder always bottoms out at cpu and never repeats an attempt", () => {
  const ladder = executionProviderLadder(planExecutionProviders());
  assert.ok(ladder.some((attempt) => attempt.join(",") === "cpu"));
  for (const attempt of ladder) {
    assert.equal(attempt[attempt.length - 1], "cpu");
  }
  assert.equal(new Set(ladder.map((attempt) => attempt.join(","))).size, ladder.length);
  assert.ok(ladder.length <= 3);

  assert.deepEqual(executionProviderLadder(["cpu"]), [["cpu"], [...CPU_FALLBACK_PROVIDERS]]);
  assert.deepEqual(executionProviderLadder([]), [["cpu"], [...CPU_FALLBACK_PROVIDERS]]);
});

test("detectAvailableProviders tolerates a runtime without the helper", () => {
  assert.equal(detectAvailableProviders({}), undefined);
  assert.deepEqual(detectAvailableProviders({ getAvailableExecutionProviders: () => ["QNNExecutionProvider", "cpu"] }), [
    "qnn",
    "cpu",
  ]);
  assert.equal(
    detectAvailableProviders({
      getAvailableExecutionProviders: () => {
        throw new Error("provider probe blew up");
      },
    }),
    undefined,
  );
});

test("load() falls back to CPU kernels and reports the fallback", async () => {
  resetFixture();
  const engine = new OnnxEngine({
    modelPath: "/models/qwen2.5-0.5b-int4.onnx",
    spec: ONNX_SPEC,
    contextSize: 512,
    tokenizer: TOKENIZER,
    moduleName: FAKE_MODULE,
  });

  const info = await engine.load();
  assert.equal(info.loaded, true);
  assert.deepEqual(info.providers, ["cpu"]);
  assert.equal(attempts.length, 3, "the whole ladder must be walked before CPU-only succeeds");
  assert.ok(attempts[0].length > 1);
  assert.deepEqual(attempts[1], ["xnnpack", "cpu"]);
  assert.deepEqual(attempts[2], ["cpu"]);

  const fallback = engine.providerFallback;
  assert.ok(fallback !== null);
  assert.deepEqual(fallback?.to, ["cpu"]);
  assert.match(String(fallback?.reason), /no session for providers/);

  const result = await engine.generate({ prompt: "attest", maxTokens: 8, stop: ["<stop>"] });
  assert.deepEqual(SCRIPTED_TOKENS.slice(0, 2), [2, 3]);
  assert.equal(result.text, "alpha");
  assert.equal(result.outputTokens, 2);
  assert.ok(runs >= 2);

  await engine.unload();
  assert.equal(released, 1);
  assert.deepEqual(engine.providers, []);
  assert.equal(engine.isLoaded(), false);
});

test("a runtime that accepts the accelerated plan reports no fallback", async () => {
  resetFixture();
  const engine = new OnnxEngine({
    modelPath: "/models/x.onnx",
    spec: ONNX_SPEC,
    contextSize: 128,
    tokenizer: TOKENIZER,
    moduleName: FAKE_MODULE,
    executionProviders: ["cpu"],
  });
  const info = await engine.load();
  assert.deepEqual(info.providers, ["cpu"]);
  assert.equal(engine.providerFallback, null);
  assert.equal(attempts.length, 1);
});

test("a missing or unusable onnxruntime-node surfaces as a typed error", async () => {
  const engine = new OnnxEngine({
    modelPath: "/models/x.onnx",
    spec: ONNX_SPEC,
    contextSize: 128,
    tokenizer: TOKENIZER,
    moduleName: MISSING_MODULE,
  });
  await assert.rejects(engine.load(), (error: unknown) => {
    assert.ok(error instanceof SlmRuntimeUnavailableError);
    assert.match((error as Error).message, /no-such-runtime/);
    return true;
  });

  const noTokenizer = new OnnxEngine({
    modelPath: "/models/x.onnx",
    spec: ONNX_SPEC,
    contextSize: 128,
    moduleName: FAKE_MODULE,
  });
  await noTokenizer.load();
  await assert.rejects(noTokenizer.generate({ prompt: "x" }), SlmRuntimeUnavailableError);
});
