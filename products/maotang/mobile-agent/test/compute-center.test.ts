/**
 * The hybrid-compute offload seam: heavy work may leave the phone, authority never does.
 *
 * The compute center below is entirely scripted, so a malicious payload needs no socket. The point of
 * these tests is the boundary, not the transport: an off-device response is untrusted input, so a
 * custody-shaped field is refused on sight, an unknown field is refused rather than ignored, and a
 * well-formed but *tampered* candidate is forwarded untouched to the local M2 wallet - where the spend
 * policy intercepts it before the enclave is ever asked to sign. The last test drives the whole hybrid
 * path with the real translator and the real wallet and checks the signature against the public key.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { SELECTOR_CREATE_MEME_TOKEN, encodeCreateMemeToken } from "../signer/abi.js";
import { DevEnclave } from "../signer/enclave.js";
import { PolicyViolationError, SpendWindowLedger, type PolicyDenialCode, type SpendPolicy } from "../signer/policy.js";
import type {
  Address,
  AuthorizationGate,
  AuthorizationGrant,
  AuthorizationRequest,
  Hex,
} from "../signer/types.js";
import { AutonomousWallet, verifySignedIntent } from "../signer/wallet.js";
import {
  ComputeCenterError,
  NonCustodialViolationError,
  RemoteComputeAdapter,
  createHttpComputeCenterTransport,
  type ComputeCenterRequest,
  type ComputeCenterTransport,
  type Groth16ProofArtifact,
  type UnsignedCandidateTransaction,
} from "../slm/compute-center-adapter.js";
import { IntentTranslationError, IntentTranslator, type IntentTranslationCode } from "../slm/intent-translator.js";
import type { SlmInput } from "../slm/slm-engine.js";

const CHAIN_ID = 31337;
const FACTORY = "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853" as Address;
const HUMAN_TOKEN = "0x9bd03768a7dcc129555de410ff8e85528a4f88b5" as Address;
/** Deliberately absent from the wallet policy: the classic tampered destination. */
const HACKER = "0x00000000000000000000000000000000deadbeef" as Address;
const NOW = 1_700_000_000;
const ETH = 10n ** 18n;
/** 256 bytes: `abi.encode(uint256[8])`, the exact blob `IZKVerifier` consumes. */
const PROOF = `0x${"ab".repeat(256)}` as Hex;
/** Non-zero, strictly below SCALAR_FIELD. */
const NULLIFIER = `0x${"0".repeat(63)}7` as Hex;
const UTTERANCE: SlmInput = { kind: "utterance", text: "Mint 0.05 ETH worth of Mao Tang token" };

// ---------------------------------------------------------------------------------------------------------
// Collaborators: a scripted compute center and the real local wallet over a dev enclave.
// ---------------------------------------------------------------------------------------------------------

/** TEST ONLY: a compute center whose every reply is scripted, so a hostile payload needs no socket. */
class ScriptedTransport implements ComputeCenterTransport {
  readonly calls: ComputeCenterRequest[] = [];
  readonly #reply: (request: ComputeCenterRequest) => unknown | Promise<unknown>;

  constructor(reply: (request: ComputeCenterRequest) => unknown | Promise<unknown>) {
    this.#reply = reply;
  }

  async send(request: ComputeCenterRequest): Promise<unknown> {
    this.calls.push(request);
    return this.#reply(request);
  }
}

interface ComputeHarness {
  readonly adapter: RemoteComputeAdapter;
  readonly transport: ScriptedTransport;
  /** Advances the adapter's millisecond clock, so a latency is deterministic. */
  advance(ms: number): void;
}

function scripted(reply: (request: ComputeCenterRequest) => unknown | Promise<unknown>): ComputeHarness {
  const transport = new ScriptedTransport(reply);
  let clock = 0;
  const adapter = new RemoteComputeAdapter({
    transport,
    modelId: "compute-center-test",
    clockMs: () => clock,
  });
  return { adapter, transport, advance: (ms: number) => (clock += ms) };
}

/** TEST ONLY: records that it was asked, so a test can prove the policy denied *before* authorization. */
class RecordingGate implements AuthorizationGate {
  calls = 0;

  async authorize(request: AuthorizationRequest): Promise<AuthorizationGrant> {
    this.calls += 1;
    return {
      method: "simulated",
      keyId: request.keyId,
      challenge: request.challenge,
      grantedAt: NOW,
      hardwareBacked: false,
      detail: "test-only stub",
    };
  }
}

interface WalletHarness {
  readonly wallet: AutonomousWallet;
  readonly gate: RecordingGate;
  readonly ledger: SpendWindowLedger;
}

function buildWallet(): WalletHarness {
  const gate = new RecordingGate();
  const ledger = new SpendWindowLedger(3600);
  const policy: SpendPolicy = {
    chainId: CHAIN_ID,
    maxValueWeiPerTransaction: ETH,
    maxValueWeiPerWindow: 2n * ETH,
    windowSeconds: 3600,
    allowedDestinations: [FACTORY, HUMAN_TOKEN],
    allowedSelectors: [SELECTOR_CREATE_MEME_TOKEN],
    // 0n means "every leg needs an authorization": the strongest setting, so a policy denial shows up
    // as the gate never being called at all.
    biometricThresholdWei: 0n,
    requireHardwareBackedAuthorization: false,
  };
  const wallet = new AutonomousWallet({
    enclave: new DevEnclave(),
    keyAlias: "maotang.compute.test",
    policy,
    ledger,
    authorization: gate,
    now: () => NOW,
  });
  return { wallet, gate, ledger };
}

function expectPolicyDenial(operation: () => Promise<unknown>, code: PolicyDenialCode): Promise<void> {
  return assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof PolicyViolationError, `expected a PolicyViolationError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

// ---------------------------------------------------------------------------------------------------------
// Non-custodial constraint: signing material is refused before it is read.
// ---------------------------------------------------------------------------------------------------------

test("a response carrying a top-level signature is refused as custody material", async () => {
  const { adapter } = scripted(() => ({
    action: "createMemeToken",
    to: FACTORY,
    valueWei: "0",
    chainId: CHAIN_ID,
    data: "0x",
    signature: "0xdeadbeef",
  }));

  await assert.rejects(
    () => adapter.propose({ input: UTTERANCE }),
    (error: unknown) => {
      assert.ok(error instanceof NonCustodialViolationError, `expected a custody refusal, got ${String(error)}`);
      assert.equal(error.code, "NON_CUSTODIAL_PAYLOAD");
      return true;
    },
  );
});

test("custody material nested anywhere in a response is refused", async () => {
  for (const payload of [
    { text: "hi", meta: { privateKey: "0x01" } },
    { text: "hi", enclave: { signedTx: "0x02" } },
    { text: "hi", candidates: [{ seed_phrase: "..." }] },
  ]) {
    const { adapter } = scripted(() => payload);
    await assert.rejects(
      () => adapter.infer(UTTERANCE),
      (error: unknown) => error instanceof NonCustodialViolationError,
      `payload ${JSON.stringify(payload)} should have been refused`,
    );
  }
});

test("an unknown field is refused rather than ignored", async () => {
  const { adapter } = scripted(() => ({
    action: "transfer",
    to: FACTORY,
    valueWei: "0",
    chainId: CHAIN_ID,
    data: "0x",
    nonce: 5,
  }));

  await assert.rejects(
    () => adapter.propose({ input: UTTERANCE }),
    (error: unknown) => {
      assert.ok(error instanceof ComputeCenterError);
      assert.equal(error.code, "UNKNOWN_FIELD");
      return true;
    },
  );
});

// ---------------------------------------------------------------------------------------------------------
// The tampered-candidate test: the local M2 policy intercepts before any signature exists.
// ---------------------------------------------------------------------------------------------------------

test("a tampered candidate is intercepted by the local M2 policy before the enclave is asked", async () => {
  const { wallet, gate } = buildWallet();

  const cases: ReadonlyArray<{
    readonly label: string;
    readonly reply: Record<string, unknown>;
    readonly code: PolicyDenialCode;
  }> = [
    {
      label: "a destination outside the allow-list",
      reply: { action: "transfer", to: HACKER, valueWei: "1000000000000000000", data: "0x", chainId: CHAIN_ID },
      code: "DESTINATION_NOT_ALLOWED",
    },
    {
      label: "a value above the per-transaction cap",
      reply: { action: "createMemeToken", to: FACTORY, valueWei: "2000000000000000000", data: "0x", chainId: CHAIN_ID },
      code: "VALUE_CAP_EXCEEDED",
    },
    {
      label: "a selector outside the allow-list",
      reply: { action: "createMemeToken", to: FACTORY, valueWei: "0", data: "0xdeadbeef", chainId: CHAIN_ID },
      code: "SELECTOR_NOT_ALLOWED",
    },
    {
      label: "a chain the policy is not bound to",
      reply: { action: "createMemeToken", to: FACTORY, valueWei: "0", data: "0x", chainId: 1 },
      code: "CHAIN_MISMATCH",
    },
  ];

  for (const current of cases) {
    const { adapter } = scripted(() => current.reply);
    const candidate: UnsignedCandidateTransaction = await adapter.propose({ input: UTTERANCE });

    // 1. The adapter forwards the payload as a *proposal* - it does not pretend to be the policy.
    assert.equal(candidate.intent.to, String(current.reply.to), current.label);
    // 2. The candidate is structurally unsigned: there is no field a signature could occupy.
    assert.equal("signature" in candidate, false, current.label);
    assert.equal("signature" in candidate.intent, false, current.label);
    // 3. The local wallet refuses before the enclave and before the authorization prompt.
    await expectPolicyDenial(() => adapter.authorizeLocally(wallet, candidate), current.code);
    assert.equal(gate.calls, 0, `${current.label}: authorization must not be reached`);
  }
});

test("a refused candidate consumes no window budget", async () => {
  const { wallet, ledger } = buildWallet();
  const { adapter } = scripted(() => ({
    action: "transfer",
    to: HACKER,
    valueWei: "1000000000000000000",
    data: "0x",
    chainId: CHAIN_ID,
  }));

  const candidate = await adapter.propose({ input: UTTERANCE });
  await expectPolicyDenial(() => adapter.authorizeLocally(wallet, candidate), "DESTINATION_NOT_ALLOWED");
  assert.equal(ledger.spentAt(NOW), 0n);
});

// ---------------------------------------------------------------------------------------------------------
// The honest path: a candidate the policy allows is signed *locally* and verifies.
// ---------------------------------------------------------------------------------------------------------

test("a candidate the policy allows is signed by the local enclave and verifies", async () => {
  const { wallet, gate } = buildWallet();
  const calldata = encodeCreateMemeToken("Mao Tang", "MAOTANG");
  const { adapter, transport } = scripted(() => ({
    action: "createMemeToken",
    to: FACTORY,
    valueWei: "0",
    data: calldata,
    chainId: CHAIN_ID,
    description: "Create the Mao Tang meme token",
  }));

  const candidate = await adapter.propose({ input: UTTERANCE });
  assert.equal(transport.calls[0].endpoint, "propose");
  assert.equal(candidate.proof, null);

  const signed = await adapter.authorizeLocally(wallet, candidate);
  assert.equal(signed.intent.to, FACTORY);
  assert.equal(signed.intent.data, calldata);
  assert.equal(gate.calls, 1);
  assert.equal(verifySignedIntent(signed), true);
  assert.equal(wallet.spendSnapshot().spentWei, 0n);
});

// ---------------------------------------------------------------------------------------------------------
// Off-device inference and proof generation are data, never authority.
// ---------------------------------------------------------------------------------------------------------

test("infer returns untrusted text and round-trips latency, signing nothing", async () => {
  const { adapter, transport, advance } = scripted((request) => {
    assert.equal(request.endpoint, "infer");
    advance(37);
    return { text: '{"action":"unsupported"}', tokensGenerated: 12, truncated: false };
  });

  const result = await adapter.infer(UTTERANCE);
  assert.equal(result.text, '{"action":"unsupported"}');
  assert.equal(result.backend, "compute-center");
  assert.equal(result.mode, "hybrid");
  assert.equal(result.latencyMs, 37);
  assert.equal(result.tokensGenerated, 12);
  assert.equal(transport.calls.length, 1);
});

test("generateProof accepts a canonical Groth16 artifact and rejects a malformed one", async () => {
  const good = scripted(() => ({ proof: PROOF, nullifierHash: NULLIFIER, publicSignals: [NULLIFIER] }));
  const artifact: Groth16ProofArtifact = await good.adapter.generateProof({
    circuitId: "human-quota",
    witness: { secret: "0x01" },
  });
  assert.equal(artifact.scheme, "groth16");
  assert.equal(artifact.proof, PROOF);
  assert.equal(artifact.publicSignals.length, 1);

  const shortProof = scripted(() => ({ proof: "0x" + "ab".repeat(64), nullifierHash: NULLIFIER }));
  await assert.rejects(
    () => shortProof.adapter.generateProof({ circuitId: "human-quota", witness: {} }),
    (error: unknown) => error instanceof ComputeCenterError && error.code === "MALFORMED_PROOF",
  );

  const badNullifier = scripted(() => ({ proof: PROOF, nullifierHash: "0x00" }));
  await assert.rejects(
    () => badNullifier.adapter.generateProof({ circuitId: "human-quota", witness: {} }),
    (error: unknown) => error instanceof ComputeCenterError && error.code === "MALFORMED_PROOF",
  );
});

test("a claimHumanQuota candidate without a proof artifact is refused", async () => {
  const { adapter } = scripted(() => ({
    action: "claimHumanQuota",
    to: HUMAN_TOKEN,
    valueWei: "0",
    data: "0x3e958aad",
    chainId: CHAIN_ID,
  }));

  await assert.rejects(
    () => adapter.propose({ input: UTTERANCE }),
    (error: unknown) => error instanceof ComputeCenterError && error.code === "MALFORMED_CANDIDATE",
  );
});

test("health reports latency when reachable and a refusal when the transport fails", async () => {
  const up = scripted((request) => {
    assert.equal(request.endpoint, "health");
    up.advance(11);
    return { status: "ok" };
  });
  const reachable = await up.adapter.health();
  assert.equal(reachable.reachable, true);
  assert.equal(reachable.latencyMs, 11);

  const down = scripted(() => {
    throw new ComputeCenterError("TRANSPORT_UNAVAILABLE", "connection refused");
  });
  const unreachable = await down.adapter.health();
  assert.equal(unreachable.reachable, false);
  assert.equal(unreachable.latencyMs, null);
  assert.match(unreachable.detail, /connection refused/);
});

// ---------------------------------------------------------------------------------------------------------
// The HTTP transport: a URL is built, a non-ok answer is a refusal, and no path is echoed.
// ---------------------------------------------------------------------------------------------------------

test("the HTTP transport posts to the configured endpoint", async () => {
  const seen: Array<{ readonly url: string; readonly method: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    seen.push({ url: String(input), method: String(init?.method) });
    return new Response(JSON.stringify({ text: "hello" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const transport = createHttpComputeCenterTransport({ endpoint: "https://relayer.example/api/compute/", fetchImpl });

  const payload = await transport.send({ endpoint: "infer", body: { modelId: "m" } });
  assert.deepEqual(payload, { text: "hello" });
  assert.equal(seen[0].url, "https://relayer.example/api/compute/infer");
  assert.equal(seen[0].method, "POST");
});

test("the HTTP transport maps a non-ok answer to HTTP_ERROR without echoing the path", async () => {
  const fetchImpl: typeof fetch = async () => new Response("nope", { status: 502 });
  const transport = createHttpComputeCenterTransport({
    endpoint: "https://relayer.example/secret-token-path",
    fetchImpl,
  });

  await assert.rejects(
    () => transport.send({ endpoint: "health", body: {} }),
    (error: unknown) => {
      assert.ok(error instanceof ComputeCenterError);
      assert.equal(error.code, "HTTP_ERROR");
      assert.equal(error.message.includes("secret-token-path"), false, "the endpoint path must not be echoed");
      return true;
    },
  );
});

// ---------------------------------------------------------------------------------------------------------
// The hybrid inference path still runs through the local M1 schema gate.
// ---------------------------------------------------------------------------------------------------------

test("off-device inference text still has to pass the local M1 schema gate", async () => {
  const translator = new IntentTranslator({
    catalog: { chainId: CHAIN_ID, contracts: { HumanToken: HUMAN_TOKEN, MaoTangFactory: FACTORY } },
    limits: { maxValueWeiPerIntent: ETH },
    now: () => NOW,
  });
  const { wallet } = buildWallet();

  const honest = scripted(() => ({
    text: JSON.stringify({ action: "createMemeToken", name: "Mao Tang", symbol: "MAOTANG", valueWei: "0" }),
  }));
  const inferred = await honest.adapter.infer(UTTERANCE);
  const translated = translator.translate(inferred.text);
  const signed = await honest.adapter.authorizeLocally(wallet, {
    action: translated.action,
    intent: translated.intent,
    proof: null,
    modelId: "compute-center-test",
    latencyMs: inferred.latencyMs,
    provenance: { source: "compute-center", receivedAt: NOW },
  });
  assert.equal(verifySignedIntent(signed), true);

  const hallucinated = scripted(() => ({ text: '{"action":"drainWallet","to":"0x1"}' }));
  const hostile = await hallucinated.adapter.infer(UTTERANCE);
  assert.throws(
    () => translator.translate(hostile.text),
    (error: unknown) => {
      assert.ok(error instanceof IntentTranslationError);
      assert.equal((error as IntentTranslationError).code satisfies IntentTranslationCode, "UNKNOWN_ACTION");
      return true;
    },
  );
});