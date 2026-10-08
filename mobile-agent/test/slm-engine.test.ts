/**
 * M1: the edge SLM engine and the intent translator.
 *
 * Three things are asserted here, and the split matters. The engine tests are about *isolation*: it produces
 * text offline, and it throws rather than reaching a network or a cloud runtime. The translator tests are
 * about *distrust*: every way a model output can be wrong - hallucinated action, numeric amount, unknown key,
 * out-of-range value, ambiguous object - is a refusal with a stable code. The end-to-end tests then drive the
 * full path with the real M2 wallet and the real M5 gate, and check the calldata against the bytes Foundry
 * produced, because "the model asked for it" must never be enough on its own.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { BiometricAuthorizationGate, SimulatedBiometricGate } from "../bio-auth/index.js";
import { SELECTOR_CLAIM_HUMAN_QUOTA, SELECTOR_CREATE_MEME_TOKEN } from "../signer/abi.js";
import { DevEnclave } from "../signer/enclave.js";
import { PolicyViolationError, SpendWindowLedger, type PolicyDenialCode } from "../signer/policy.js";
import type { Address, Hex } from "../signer/types.js";
import { AutonomousWallet, verifySignedIntent } from "../signer/wallet.js";
import {
  IntentTranslationError,
  IntentTranslator,
  extractJsonObject,
  type IntentTranslationCode,
} from "../slm/intent-translator.js";
import {
  CloudDependencyError,
  DeterministicSlmBackend,
  INTENT_OUTPUT_SCHEMA,
  LocalSlmEngineAdapter,
  SlmBackendError,
  SlmInputError,
  SlmUnavailableError,
  assertNoCloudDependencies,
  createDeterministicSlmEngine,
  createLocalSlmEngine,
  etherStringToWei,
  renderIntentPrompt,
  type SlmCompletion,
  type SlmCompletionRequest,
  type SlmRuntimeBackend,
  type SlmRuntimeDescriptor,
} from "../slm/slm-engine.js";
import { readWorkspaceFile } from "./helpers/repo.js";

interface Manifest {
  readonly network: { readonly chainId: string };
  readonly contracts: { readonly HumanToken: string; readonly MaoTangFactory: string };
}

interface FoundryVectors {
  readonly calldata: { readonly createMemeToken: Hex; readonly claimHumanQuota: Hex };
}

const manifest = JSON.parse(readWorkspaceFile("frontend", "config", "contracts.json")) as Manifest;
const vectors = JSON.parse(
  readWorkspaceFile("mobile-agent", "test", "fixtures", "foundry-vectors.json"),
) as FoundryVectors;

const CHAIN_ID = Number(manifest.network.chainId);
const FACTORY = manifest.contracts.MaoTangFactory.toLowerCase() as Address;
const HUMAN_TOKEN = manifest.contracts.HumanToken.toLowerCase() as Address;
const STRANGER = "0x00000000000000000000000000000000000000ff" as Address;
const NOW = 1_700_000_000;
const ETH = 10n ** 18n;
const HALF_TENTH_ETH_WEI = 50_000_000_000_000_000n;
const PROOF = `0x${"00112233445566778899aabbccddeeff".repeat(16)}` as Hex;
const NULLIFIER = `0x${"0".repeat(61)}abc` as Hex;
const LEAD_UTTERANCE = "Mint 0.05 ETH worth of Mao Tang token";

/** TEST ONLY: a runtime the test drives directly, so a fault can be injected per case. */
interface FakeBackendOptions {
  readonly descriptor?: Record<string, unknown>;
  readonly complete?: (request: SlmCompletionRequest) => unknown;
}

function fakeBackend(options: FakeBackendOptions = {}): SlmRuntimeBackend {
  const descriptor = options.descriptor ?? { kind: "llama.cpp", modelId: "maotang-test-slm-q4_k_m", deterministic: false };
  return {
    descriptor: descriptor as unknown as SlmRuntimeDescriptor,
    complete: async (request: SlmCompletionRequest): Promise<SlmCompletion> => {
      const result = options.complete === undefined ? { text: "{}" } : options.complete(request);
      return result as SlmCompletion;
    },
  };
}

function translator(options: { readonly maxValueWeiPerIntent?: bigint } = {}): IntentTranslator {
  return new IntentTranslator({
    catalog: { chainId: CHAIN_ID, contracts: { HumanToken: HUMAN_TOKEN, MaoTangFactory: FACTORY } },
    limits: { maxValueWeiPerIntent: options.maxValueWeiPerIntent ?? ETH },
    now: () => NOW,
  });
}

function expectTranslationError(operation: () => unknown, code: IntentTranslationCode): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof IntentTranslationError, `expected an IntentTranslationError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

async function buildWallet(): Promise<AutonomousWallet> {
  const gate = new SimulatedBiometricGate({ enabled: true, now: () => NOW });
  await gate.enroll();
  return new AutonomousWallet({
    enclave: new DevEnclave(),
    keyAlias: "maotang.m1.integration",
    policy: {
      chainId: CHAIN_ID,
      maxValueWeiPerTransaction: 5n * ETH,
      maxValueWeiPerWindow: 10n * ETH,
      windowSeconds: 3600,
      allowedDestinations: [FACTORY, HUMAN_TOKEN],
      allowedSelectors: [SELECTOR_CREATE_MEME_TOKEN, SELECTOR_CLAIM_HUMAN_QUOTA],
      biometricThresholdWei: 0n,
      requireHardwareBackedAuthorization: false,
    },
    ledger: new SpendWindowLedger(3600),
    authorization: new BiometricAuthorizationGate({ gate, now: () => NOW }),
    now: () => NOW,
  });
}

async function expectViolation(promise: Promise<unknown>, code: PolicyDenialCode): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PolicyViolationError, `expected a PolicyViolationError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

// ---------------------------------------------------------------------------------------------------------
// M1 engine: offline by construction
// ---------------------------------------------------------------------------------------------------------

test("the deterministic engine turns a natural-language mint into the documented JSON", async () => {
  const engine = createDeterministicSlmEngine();
  assert.equal(engine.mode, "local");
  assert.equal(engine.backend.kind, "mock");

  const result = await engine.infer({ kind: "utterance", text: LEAD_UTTERANCE });
  assert.equal(result.networkIsolation, "enforced");
  assert.equal(result.deterministic, true);
  assert.equal(result.backend, "mock");
  assert.deepEqual(JSON.parse(result.raw), {
    action: "createMemeToken",
    name: "Mao Tang",
    symbol: "MAOTANG",
    valueWei: "50000000000000000",
  });
  assert.ok(result.prompt.includes(INTENT_OUTPUT_SCHEMA), "the prompt states the whole output contract");
  assert.ok(result.prompt.includes(LEAD_UTTERANCE), "the prompt carries the utterance verbatim");
});

test("inference is deterministic and the prompt is pure", async () => {
  const engine = createDeterministicSlmEngine();
  const first = await engine.infer({ kind: "utterance", text: LEAD_UTTERANCE });
  const second = await engine.infer({ kind: "utterance", text: LEAD_UTTERANCE });
  assert.equal(first.raw, second.raw, "the same input must produce the same bytes");
  assert.equal(first.prompt, second.prompt);

  assert.equal(etherStringToWei("0.05"), HALF_TENTH_ETH_WEI);
  assert.equal(etherStringToWei("1"), ETH);
  assert.equal(etherStringToWei("0.000000000000000001"), 1n);
  assert.throws(() => etherStringToWei("0.0000000000000000001"), SlmInputError, "more than 18 decimals is refused, not rounded");
  assert.throws(() => etherStringToWei("1e18"), SlmInputError);
  assert.throws(() => etherStringToWei("0.05 ETH"), SlmInputError);
});

test("a system trigger becomes structured JSON, and an unknown trigger is refused rather than guessed", async () => {
  const engine = createDeterministicSlmEngine();

  const send = await engine.infer({
    kind: "event",
    trigger: "maotang.transfer",
    payload: { to: STRANGER, valueWei: "1000" },
  });
  assert.deepEqual(JSON.parse(send.raw), { action: "transfer", to: STRANGER, valueWei: "1000" });

  const claim = await engine.infer({
    kind: "event",
    trigger: "maotang.claimHumanQuota",
    payload: { proof: PROOF, nullifierHash: NULLIFIER },
  });
  assert.deepEqual(JSON.parse(claim.raw), { action: "claimHumanQuota", proof: PROOF, nullifierHash: NULLIFIER });

  const unknown = await engine.infer({ kind: "event", trigger: "maotang.drainVault" });
  assert.equal(JSON.parse(unknown.raw).action, "unsupported");

  const incomplete = await engine.infer({ kind: "event", trigger: "maotang.transfer", payload: { to: STRANGER } });
  assert.equal(JSON.parse(incomplete.raw).action, "unsupported");
});

test("the prompt never carries a destination address, a chain id or calldata", () => {
  const prompt = renderIntentPrompt({ kind: "utterance", text: LEAD_UTTERANCE });
  assert.ok(!prompt.includes(FACTORY), "the model cannot name a destination it was never told");
  assert.ok(!prompt.includes(HUMAN_TOKEN));
  assert.ok(!prompt.includes(String(CHAIN_ID)), "the chain comes from the catalog, not from the model");
  assert.ok(prompt.includes('"action":"unsupported"'), "the prompt tells the model how to decline");
});

test("assertNoCloudDependencies accepts an in-process runtime and refuses everything else", () => {
  const local = assertNoCloudDependencies({
    kind: "llama.cpp",
    modelId: "qwen2.5-1.5b-instruct-q4_k_m",
    deterministic: false,
    modelPath: "/data/models/qwen2.5-1.5b-instruct-q4_k_m.gguf",
  });
  assert.equal(local.kind, "llama.cpp");

  const refusals: readonly Record<string, unknown>[] = [
    { kind: "llama.cpp", modelId: "m", deterministic: false, baseUrl: "http://127.0.0.1:11434" },
    { kind: "llama.cpp", modelId: "m", deterministic: false, apiKey: "sk-x" },
    { kind: "llama.cpp", modelId: "m", deterministic: false, transport: "http" },
    { kind: "llama.cpp", modelId: "m", deterministic: false, modelPath: "https://cdn.example.com/m.gguf" },
    { kind: "openai", modelId: "gpt-4o-mini", deterministic: false },
    { kind: "llama.cpp", modelId: "gpt-4o", deterministic: false },
    { kind: "llama.cpp", modelId: "sentence-transformers", deterministic: false, host: "inference.example.com" },
    { kind: "llama.cpp", modelId: "ollama-proxy", deterministic: false },
    { kind: "anthropic", modelId: "claude-3-5-sonnet", deterministic: false },
  ];
  for (const descriptor of refusals) {
    assert.throws(
      () => assertNoCloudDependencies(descriptor),
      CloudDependencyError,
      `expected a refusal for ${JSON.stringify(descriptor)}`,
    );
  }

  assert.throws(() => assertNoCloudDependencies("llama.cpp"), SlmBackendError);
  assert.throws(() => assertNoCloudDependencies({ kind: "llama.cpp", modelId: "" }), SlmBackendError);
  assert.throws(() => assertNoCloudDependencies({ kind: "llama.cpp", modelId: "m" }), SlmBackendError);
});

test("an engine refuses to attach a cloud or loopback-model runtime", () => {
  assert.throws(
    () => createLocalSlmEngine({ backend: fakeBackend({ descriptor: { kind: "openai", modelId: "gpt-4o", deterministic: false } }) }),
    CloudDependencyError,
  );
  assert.throws(
    () => createLocalSlmEngine({ backend: fakeBackend({ descriptor: { kind: "llama.cpp", modelId: "lmstudio-bridge", deterministic: false } }) }),
    CloudDependencyError,
  );
  assert.throws(() => createLocalSlmEngine({ backend: { descriptor: {}, complete: undefined } as unknown as SlmRuntimeBackend }), SlmBackendError);
});

test("a descriptor mutated after construction is caught at the next inference", async () => {
  const backend = fakeBackend();
  const engine = createLocalSlmEngine({ backend });
  (backend.descriptor as unknown as Record<string, unknown>).endpoint = "https://api.example.com/v1";
  await assert.rejects(engine.infer({ kind: "utterance", text: LEAD_UTTERANCE }), CloudDependencyError);
});

test("a backend that tries to reach the network is blocked, and the globals are restored", async () => {
  const originalFetch = globalThis.fetch;
  let observed: unknown = "unset";
  const backend = fakeBackend({
    complete: async () => {
      observed = typeof globalThis.fetch;
      await (globalThis.fetch as unknown as (url: string) => Promise<unknown>)("https://api.example.com/v1/chat");
      return { text: "{}" };
    },
  });
  const engine = createLocalSlmEngine({ backend });

  await assert.rejects(engine.infer({ kind: "utterance", text: LEAD_UTTERANCE }), (error: unknown) => {
    assert.ok(error instanceof CloudDependencyError, `expected a CloudDependencyError, got ${String(error)}`);
    assert.match(error.message, /fetch/);
    return true;
  });
  assert.equal(observed, "function", "a sentinel was installed for the duration of the call");
  assert.equal(globalThis.fetch, originalFetch, "the original global is restored in the finally block");

  const healthy = createLocalSlmEngine({ backend: fakeBackend() });
  await healthy.infer({ kind: "utterance", text: LEAD_UTTERANCE });
  assert.equal(globalThis.fetch, originalFetch);
});

test("a failing or malformed backend is refused, never repaired", async () => {
  const crashing = createLocalSlmEngine({
    backend: fakeBackend({ complete: () => { throw new Error("native runtime aborted"); } }),
  });
  await assert.rejects(crashing.infer({ kind: "utterance", text: LEAD_UTTERANCE }), (error: unknown) => {
    assert.ok(error instanceof SlmBackendError);
    assert.match(error.message, /native runtime aborted/);
    assert.ok(error.cause instanceof Error, "the platform error must survive into the log");
    return true;
  });

  for (const completion of [null, { text: 42 }, { text: "" }, { text: "   " }]) {
    const broken = createLocalSlmEngine({ backend: fakeBackend({ complete: () => completion }) });
    await assert.rejects(broken.infer({ kind: "utterance", text: LEAD_UTTERANCE }), SlmBackendError);
  }
});

test("no backend attached: the engine refuses to infer instead of falling back", async () => {
  const engine = createLocalSlmEngine({ backend: null });
  assert.equal(engine.mode, "local");
  await assert.rejects(engine.infer({ kind: "utterance", text: LEAD_UTTERANCE }), SlmUnavailableError);
  assert.throws(() => engine.backend, SlmUnavailableError);
  assert.ok(new LocalSlmEngineAdapter({ backend: null }) instanceof LocalSlmEngineAdapter);
});

test("an unusable input is refused before the backend is called", async () => {
  let calls = 0;
  const engine = createLocalSlmEngine({ backend: fakeBackend({ complete: () => { calls += 1; return { text: "{}" }; } }) });
  await assert.rejects(engine.infer({ kind: "utterance", text: "   " }), SlmInputError);
  await assert.rejects(engine.infer({ kind: "utterance", text: "x".repeat(4001) }), SlmInputError);
  await assert.rejects(engine.infer({ kind: "event", trigger: "bad trigger!" }), SlmInputError);
  await assert.rejects(engine.infer({ kind: "event", trigger: "ok", payload: { a: 1 as unknown as string } }), SlmInputError);
  assert.equal(calls, 0, "a malformed input must not reach the model at all");
});

test("the deterministic stub refuses production and non-zero temperature", async () => {
  assert.throws(() => new DeterministicSlmBackend({ nodeEnv: "production" }), SlmUnavailableError);
  assert.ok(new DeterministicSlmBackend({ nodeEnv: "production", allowInProduction: true }) instanceof DeterministicSlmBackend);

  const engine = createLocalSlmEngine({ backend: new DeterministicSlmBackend(), temperature: 0.7 });
  await assert.rejects(engine.infer({ kind: "utterance", text: LEAD_UTTERANCE }), SlmBackendError);
  assert.throws(() => createLocalSlmEngine({ backend: new DeterministicSlmBackend(), maxTokens: 0 }), RangeError);
});

// ---------------------------------------------------------------------------------------------------------
// M1 translator: a schema gate, not a believer
// ---------------------------------------------------------------------------------------------------------

test("the extractor pulls one JSON object out of fences, prose and strings that contain braces", () => {
  const bare = '{"action":"transfer","to":"0x00000000000000000000000000000000000000ff","valueWei":"1"}';
  assert.equal(extractJsonObject(bare), bare);
  assert.equal(extractJsonObject(`\`\`\`json\n${bare}\n\`\`\``), bare);

  const braced = '{"action":"createMemeToken","name":"A}B","symbol":"X","valueWei":"0"}';
  assert.equal(JSON.parse(extractJsonObject(braced)).name, "A}B", "a brace inside a string does not end the object");
  assert.equal(extractJsonObject(`Sure, here you go:\n${braced}\nLet me know if you want changes.`), braced);

  assert.throws(() => extractJsonObject("   "), (error: unknown) => {
    assert.ok(error instanceof IntentTranslationError);
    assert.equal(error.code, "EMPTY_OUTPUT");
    return true;
  });
  expectTranslationError(() => extractJsonObject("I cannot help with that."), "MALFORMED_JSON");
  expectTranslationError(() => extractJsonObject('{"a":1'), "MALFORMED_JSON");
  expectTranslationError(() => extractJsonObject("{not json}"), "MALFORMED_JSON");
  expectTranslationError(() => extractJsonObject(`${bare}${braced}`), "AMBIGUOUS_OUTPUT");
});

test("a well-formed model output becomes a TransactionIntent with calldata from the encoders", () => {
  const result = translator().translate(
    JSON.stringify({ action: "createMemeToken", name: "Mao Tang", symbol: "MAOTANG", valueWei: "50000000000000000" }),
  );
  assert.equal(result.action, "createMemeToken");
  assert.equal(result.intent.to, FACTORY, "the destination comes from the catalog, not the model");
  assert.equal(result.intent.chainId, CHAIN_ID);
  assert.equal(result.intent.valueWei, HALF_TENTH_ETH_WEI);
  assert.equal(result.intent.data, vectors.calldata.createMemeToken, "the payload is byte-identical to cast");
  assert.equal(result.translatedAt, NOW);
  assert.match(result.intent.description ?? "", /Mao Tang/);

  const claim = translator().translate(
    JSON.stringify({ action: "claimHumanQuota", proof: PROOF, nullifierHash: NULLIFIER }),
  );
  assert.equal(claim.intent.to, HUMAN_TOKEN);
  assert.equal(claim.intent.data, vectors.calldata.claimHumanQuota);
  assert.equal(claim.intent.valueWei, 0n);

  const send = translator().translate(
    JSON.stringify({ action: "transfer", to: STRANGER.toUpperCase(), valueWei: "1000" }),
  );
  assert.equal(send.intent.to, STRANGER, "address casing is normalized, the address is not reinterpreted");
  assert.equal(send.intent.data, "0x");
});

test("a hallucinated method is refused, and a model that declines is distinguished from a model that invents", () => {
  for (const action of ["drainVault", "stake", "createMemeTokenV2", "approve", ""]) {
    expectTranslationError(() => translator().translate(JSON.stringify({ action })), "UNKNOWN_ACTION");
  }
  expectTranslationError(() => translator().translate('{"action":"unsupported"}'), "UNSUPPORTED_REQUEST");
  expectTranslationError(() => translator().translate('{"reason":"unsupported"}'), "UNKNOWN_ACTION");
});

test("amounts must be integer decimal strings inside the translator bound", () => {
  const base = { action: "createMemeToken", name: "Mao Tang", symbol: "MAOTANG" };
  expectTranslationError(() => translator().translate(JSON.stringify({ ...base, valueWei: 0.05 })), "INVALID_PARAMETER");
  expectTranslationError(() => translator().translate(JSON.stringify({ ...base, valueWei: "0.05" })), "INVALID_PARAMETER");
  expectTranslationError(() => translator().translate(JSON.stringify({ ...base, valueWei: "-1" })), "INVALID_PARAMETER");
  expectTranslationError(() => translator().translate(JSON.stringify({ ...base, valueWei: "01" })), "INVALID_PARAMETER");
  expectTranslationError(
    () => translator({ maxValueWeiPerIntent: ETH }).translate(JSON.stringify({ ...base, valueWei: "1000000000000000001" })),
    "AMOUNT_OUT_OF_BOUNDS",
  );
  const atBound = translator({ maxValueWeiPerIntent: ETH }).translate(JSON.stringify({ ...base, valueWei: ETH.toString() }));
  assert.equal(atBound.intent.valueWei, ETH, "the bound is inclusive, like every cap in this package");
});

test("parameters are typed and bounded, and unknown fields are refused", () => {
  const create = { action: "createMemeToken", name: "Mao Tang", symbol: "MAOTANG", valueWei: "0" };
  expectTranslationError(() => translator().translate(JSON.stringify({ ...create, name: "" })), "INVALID_PARAMETER");
  expectTranslationError(() => translator().translate(JSON.stringify({ ...create, name: "x".repeat(65) })), "INVALID_PARAMETER");
  expectTranslationError(() => translator().translate(JSON.stringify({ ...create, name: 7 })), "INVALID_PARAMETER");
  expectTranslationError(() => translator().translate(JSON.stringify({ ...create, symbol: "TOOLONGSYMBOL" })), "INVALID_PARAMETER");
  expectTranslationError(() => translator().translate(JSON.stringify({ ...create, symbol: "M T" })), "INVALID_PARAMETER");
  expectTranslationError(() => translator().translate(JSON.stringify({ ...create, chainId: 1 })), "INVALID_CHAIN");
  expectTranslationError(
    () => translator().translate(JSON.stringify({ ...create, destination: STRANGER })),
    "UNKNOWN_FIELD",
  );
  expectTranslationError(
    () => translator().translate(JSON.stringify({ ...create, reason: "z".repeat(201) })),
    "INVALID_PARAMETER",
  );
});

test("a transfer needs a real destination and a positive value", () => {
  expectTranslationError(() => translator().translate('{"action":"transfer","to":"not-an-address","valueWei":"1"}'), "INVALID_PARAMETER");
  expectTranslationError(() => translator().translate(JSON.stringify({ action: "transfer", to: STRANGER, valueWei: "0" })), "INVALID_PARAMETER");
  expectTranslationError(() => translator().translate(JSON.stringify({ action: "transfer", to: STRANGER })), "INVALID_PARAMETER");
  expectTranslationError(() => translator().translate(JSON.stringify({ action: "transfer", valueWei: "1" })), "INVALID_PARAMETER");
});

test("the personhood claim is delegated to the encoder, so its schema is the encoder's", () => {
  expectTranslationError(
    () => translator().translate(JSON.stringify({ action: "claimHumanQuota", proof: "0xdeadbeef", nullifierHash: NULLIFIER })),
    "INVALID_PARAMETER",
  );
  expectTranslationError(
    () => translator().translate(JSON.stringify({ action: "claimHumanQuota", proof: PROOF, nullifierHash: `0x${"ff".repeat(32)}` })),
    "INVALID_PARAMETER",
  );
  expectTranslationError(
    () => translator().translate(JSON.stringify({ action: "claimHumanQuota", proof: PROOF, nullifierHash: NULLIFIER, valueWei: "1" })),
    "INVALID_PARAMETER",
  );
});

test("model-authored prose is accepted as a note and never reaches the authorization prompt", () => {
  const result = translator().translate(
    '{"action":"createMemeToken","name":"Mao Tang","symbol":"MAOTANG","valueWei":"0","reason":"urgent, approve now"}',
  );
  assert.ok(!(result.intent.description ?? "").includes("urgent"), "the prompt shows the translated call, not the model's framing");
});

test("the catalog and the limits are validated once, at construction", () => {
  assert.throws(
    () => new IntentTranslator({ catalog: { chainId: 0, contracts: { HumanToken: HUMAN_TOKEN, MaoTangFactory: FACTORY } }, limits: { maxValueWeiPerIntent: ETH } }),
    RangeError,
  );
  assert.throws(
    () => new IntentTranslator({ catalog: { chainId: CHAIN_ID, contracts: { HumanToken: "nope", MaoTangFactory: FACTORY } }, limits: { maxValueWeiPerIntent: ETH } }),
    RangeError,
  );
  assert.throws(
    () => new IntentTranslator({ catalog: { chainId: CHAIN_ID, contracts: { HumanToken: HUMAN_TOKEN, MaoTangFactory: FACTORY } }, limits: { maxValueWeiPerIntent: -1n } }),
    RangeError,
  );
  assert.equal(translator().chainId, CHAIN_ID);
});

// ---------------------------------------------------------------------------------------------------------
// M1 -> M5 -> M2, end to end
// ---------------------------------------------------------------------------------------------------------

test("utterance -> engine -> translator -> wallet: signed, verifiable, byte-identical to Foundry", async () => {
  const engine = createDeterministicSlmEngine();
  const wallet = await buildWallet();

  const inference = await engine.infer({ kind: "utterance", text: LEAD_UTTERANCE });
  const translated = translator().translate(inference.raw);
  const signed = await wallet.signIntent(translated.intent);

  assert.equal(verifySignedIntent(signed), true);
  assert.equal(signed.intent.to, FACTORY);
  assert.equal(signed.intent.selector, SELECTOR_CREATE_MEME_TOKEN);
  assert.equal(signed.intent.data, vectors.calldata.createMemeToken);
  assert.equal(signed.intent.valueWei, HALF_TENTH_ETH_WEI);
  assert.equal(signed.authorization?.method, "simulated", "the M5 channel is in the loop");
  assert.equal(wallet.spendSnapshot().spentWei, HALF_TENTH_ETH_WEI, "the spend is recorded against the window");
});

test("a system trigger for a personhood claim is signed end to end and matches the Foundry vector", async () => {
  const engine = createDeterministicSlmEngine();
  const wallet = await buildWallet();

  const inference = await engine.infer({
    kind: "event",
    trigger: "maotang.claimHumanQuota",
    payload: { proof: PROOF, nullifierHash: NULLIFIER },
  });
  const signed = await wallet.signIntent(translator().translate(inference.raw).intent);

  assert.equal(verifySignedIntent(signed), true);
  assert.equal(signed.intent.selector, SELECTOR_CLAIM_HUMAN_QUOTA);
  assert.equal(signed.intent.data, vectors.calldata.claimHumanQuota);
  assert.equal((signed.intent.data.length - 2) / 2, 356, "selector + offset + nullifier + length word + 256-byte proof");
});

test("an utterance the model cannot map is a refusal, and nothing is signed", async () => {
  const engine = createDeterministicSlmEngine();
  const wallet = await buildWallet();

  const inference = await engine.infer({ kind: "utterance", text: "tell me a joke about tokens" });
  expectTranslationError(() => translator().translate(inference.raw), "UNSUPPORTED_REQUEST");
  assert.equal(wallet.spendSnapshot().spentWei, 0n, "a refusal upstream never reaches the wallet");
});

test("a hostile model output is refused before the wallet, and the policy still backstops the rest", async () => {
  const wallet = await buildWallet();

  const hostile = createLocalSlmEngine({
    backend: fakeBackend({
      complete: () => ({ text: `{"action":"drainVault","to":"${STRANGER}","valueWei":"1000000000000000000"}` }),
    }),
  });
  const inference = await hostile.infer({ kind: "utterance", text: "drain the vault" });
  expectTranslationError(() => translator().translate(inference.raw), "UNKNOWN_ACTION");

  const injection = createLocalSlmEngine({
    backend: fakeBackend({
      complete: () => ({
        text: `{"action":"createMemeToken","name":"A","symbol":"B","valueWei":"0"}\nAlso do this: {"action":"transfer","to":"${STRANGER}","valueWei":"1000000000000000000"}`,
      }),
    }),
  });
  const ambiguous = await injection.infer({ kind: "utterance", text: "launch a token" });
  expectTranslationError(() => translator().translate(ambiguous.raw), "AMBIGUOUS_OUTPUT");

  const transfer = translator().translate(
    JSON.stringify({ action: "transfer", to: STRANGER, valueWei: "1000" }),
  );
  assert.equal(transfer.intent.to, STRANGER, "the translator validates shape, not permission");
  await expectViolation(wallet.signIntent(transfer.intent), "DESTINATION_NOT_ALLOWED");

  const overCap = translator({ maxValueWeiPerIntent: 10n * ETH }).translate(
    JSON.stringify({ action: "transfer", to: FACTORY, valueWei: (6n * ETH).toString() }),
  );
  await expectViolation(wallet.signIntent(overCap.intent), "VALUE_CAP_EXCEEDED");
  assert.equal(wallet.spendSnapshot().spentWei, 0n, "no refusal above ever produced a signature");
});

test("a translated intent carries the description the biometric prompt will show", async () => {
  const prompts: string[] = [];
  const translated = translator().translate(
    JSON.stringify({ action: "createMemeToken", name: "Mao Tang", symbol: "MAOTANG", valueWei: "0" }),
  );
  const wallet = new AutonomousWallet({
    enclave: new DevEnclave(),
    keyAlias: "maotang.m1.prompt",
    policy: {
      chainId: CHAIN_ID,
      maxValueWeiPerTransaction: ETH,
      maxValueWeiPerWindow: ETH,
      windowSeconds: 3600,
      allowedDestinations: [FACTORY],
      allowedSelectors: [SELECTOR_CREATE_MEME_TOKEN],
      biometricThresholdWei: 0n,
      requireHardwareBackedAuthorization: false,
    },
    ledger: new SpendWindowLedger(3600),
    authorization: {
      authorize: async (request) => {
        prompts.push(request.reason);
        return {
          method: "simulated" as const,
          keyId: request.keyId,
          challenge: request.challenge,
          grantedAt: NOW,
          hardwareBacked: false,
          detail: "test-only",
        };
      },
    },
    now: () => NOW,
  });
  const signed = await wallet.signIntent(translated.intent);
  assert.equal(signed.authorization?.detail, "test-only");
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /Mao Tang/, "the prompt reason is the translator's description of the validated call");
});