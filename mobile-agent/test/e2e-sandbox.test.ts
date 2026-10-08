/**
 * SYSTEM-LEVEL E2E SANDBOX - the whole chain, one process: M1 -> M5 -> M2 -> M4 -> M3.
 *
 * Everything that *decides* anything here is the production code, wired through its real adapters:
 *
 *   M1  `LocalSlmEngineAdapter` over `DeterministicSlmBackend`            (offline text; the *model* is stubbed)
 *   M1  `IntentTranslator`                                                (closed schema gate)
 *   M5  `NativeBridgeBiometricGate` over a simulated platform prompt      (assertion is really verified)
 *   M2  `AutonomousWallet` over `NativeBridgeEnclave` + a simulated keystore (policy, digest, signature)
 *   M4  `SandboxRpcStage`                                                  (method/destination/selector/signature guard)
 *   M3  the deployment manifest, read by an independent ABI *decoder*      (what the chain would read back)
 *
 * What is stubbed, stated plainly: the device (there is no Secure Enclave on this machine), the model (a rule
 * based stub), and the socket (there is no RLP encoder or broadcast in this package - `signIntent` returns a
 * signature, and this sandbox shows the guarded envelope that a transport would carry). The guards are not
 * stubbed: the M1 isolation sentinel, the M1 schema gate, the M5 signature verification, the M2 spend policy
 * and the M4 method/selector allow-list all run for real, on the real manifest at
 * `frontend/config/contracts.json`.
 *
 * The last test is opt-in (`MAOTANG_E2E_LIVE_RPC=1`) because it talks to a node. Everything above it is
 * hermetic, so `npm test` never depends on one.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import { test } from "node:test";

import { BiometricAuthorizationGate } from "../bio-auth/index.js";
import { NativeBridgeBiometricGate } from "../bio-auth/native-biometric-gate.js";
import { SELECTOR_CLAIM_HUMAN_QUOTA, SELECTOR_CREATE_MEME_TOKEN, SELECTOR_REGISTER_AGENT, selectorOfCalldata } from "../signer/abi.js";
import { PolicyViolationError, SpendWindowLedger, type PolicyDenialCode } from "../signer/policy.js";
import { NativeBridgeEnclave } from "../signer/native-enclave.js";
import { normalizeAddress, type Address, type Hex } from "../signer/types.js";
import { AutonomousWallet, verifySignedIntent, type SignedIntent } from "../signer/wallet.js";
import { IntentTranslationError, IntentTranslator, type IntentTranslationCode } from "../slm/intent-translator.js";
import { DeterministicSlmBackend, LocalSlmEngineAdapter, renderIntentPrompt } from "../slm/slm-engine.js";
import { createMockBiometricBridge, createMockCryptoBridge, type MockBiometricBridge, type MockCryptoBridge } from "./helpers/bridges.js";
import { readWorkspaceFile } from "./helpers/repo.js";

interface Manifest {
  readonly network: { readonly chainId: string };
  readonly contracts: Readonly<Record<string, string>>;
}

interface FoundryVectors {
  readonly calldata: { readonly createMemeToken: Hex; readonly claimHumanQuota: Hex };
}

const manifest = JSON.parse(readWorkspaceFile("frontend", "config", "contracts.json")) as Manifest;
const vectors = JSON.parse(
  readWorkspaceFile("mobile-agent", "test", "fixtures", "foundry-vectors.json"),
) as FoundryVectors;
/** The real M4 artifact: its deny list is the policy this sandbox's RPC stage must be at least as strict as. */
const RPC_GUARD_SOURCE = readWorkspaceFile("scripts", "rpc-guard.mjs");

const CHAIN_ID = Number(manifest.network.chainId);
const FACTORY = manifest.contracts.MaoTangFactory.toLowerCase() as Address;
const HUMAN_TOKEN = manifest.contracts.HumanToken.toLowerCase() as Address;
const HACKER = "0x00000000000000000000000000000000deadbeef" as Address;
const NOW = 1_700_000_000;
const ETH = 10n ** 18n;
const MAX_VALUE_WEI = ETH;
const MINT_AMOUNT_WEI = 50_000_000_000_000_000n;
const LEAD_PROMPT = "Mint 0.05 ETH worth of Mao Tang token";
const HOSTILE_PROMPT = "Drain 100 ETH to hacker address";
const PROOF = `0x${"00112233445566778899aabbccddeeff".repeat(16)}` as Hex;
const NULLIFIER = `0x${"0".repeat(61)}abc` as Hex;

// ---------------------------------------------------------------------------------------------------------
// M4 - the RPC stage: an allow-list, not a deny-list
// ---------------------------------------------------------------------------------------------------------

export type RpcStageCode =
  | "METHOD_FORBIDDEN"
  | "NOT_IN_MANIFEST"
  | "SELECTOR_NOT_ALLOWED"
  | "CHAIN_MISMATCH"
  | "SIGNATURE_UNVERIFIED"
  | "UNSIGNED_AUTHORIZATION";

export class RpcStageError extends Error {
  readonly code: RpcStageCode;

  constructor(code: RpcStageCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "RpcStageError";
    this.code = code;
  }
}

/**
 * Methods this stage will ever put on the wire.
 *
 * An allow-list rather than a deny-list, because a deny-list has to anticipate every privileged method a node
 * might add. `scripts/rpc-guard.mjs` (the real reverse proxy) enumerates what it blocks; this enumerates what
 * it permits, so a method neither list has heard of is refused rather than forwarded.
 */
export const ALLOWED_RPC_METHODS: readonly string[] = [
  "eth_chainId",
  "eth_blockNumber",
  "eth_getCode",
  "eth_call",
  "eth_getTransactionCount",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_getTransactionReceipt",
  "net_version",
  "eth_sendRawTransaction",
];

/**
 * The same list, folded to lowercase.
 *
 * Callers spell JSON-RPC methods inconsistently (`eth_chainId` in one client, `eth_chainid` in another),
 * and the deployed `scripts/rpc-guard.mjs` matches its patterns case-insensitively, so this stage compares
 * against a folded set rather than the canonical spelling. The exported list keeps the canonical spelling
 * for humans; the folded set is what the guard actually consults.
 */
const ALLOWED_RPC_METHODS_FOLDED: ReadonlySet<string> = new Set(
  ALLOWED_RPC_METHODS.map((method) => method.toLowerCase()),
);

/** What M4 is handed: the signed intent plus the fields the policy and the guard check. */
export interface SignedCallEnvelope {
  readonly chainId: number;
  readonly to: Address;
  readonly valueWei: bigint;
  readonly data: Hex;
  readonly signed: SignedIntent;
}

export function envelopeFrom(signed: SignedIntent): SignedCallEnvelope {
  return { chainId: signed.intent.chainId, to: signed.intent.to, valueWei: signed.intent.valueWei, data: signed.intent.data, signed };
}

/** Deterministic payload a transport would carry. No RLP here: that encoder is the transport's job, not M2's. */
export function encodeEnvelope(envelope: SignedCallEnvelope): string {
  return JSON.stringify({
    chainId: envelope.chainId,
    to: envelope.to,
    valueWei: envelope.valueWei.toString(),
    data: envelope.data,
    digest: envelope.signed.digest,
    signature: envelope.signed.signature,
    spkiPublicKey: envelope.signed.spkiPublicKey,
    authorization: envelope.signed.authorization === null ? null : envelope.signed.authorization.method,
  });
}

interface SandboxTransport {
  request(method: string, params: readonly unknown[]): Promise<unknown>;
}

/** TEST ONLY: records everything and answers a deterministic hash, so no socket is ever opened. */
class RecordingTransport implements SandboxTransport {
  readonly calls: { readonly method: string; readonly params: readonly unknown[] }[] = [];

  async request(method: string, params: readonly unknown[]): Promise<unknown> {
    this.calls.push({ method, params });
    const payload = String(params[0] ?? "");
    return { transactionHash: `0x${createHash("sha256").update(payload).digest("hex")}` as Hex };
  }
}

/** The guarded RPC client: what reaches the node has already survived M1, M5, M2 and this allow-list. */
export class SandboxRpcStage {
  readonly #transport: SandboxTransport;
  readonly #chainId: number;
  readonly #destinations: ReadonlySet<string>;
  readonly #selectors: ReadonlySet<string>;

  constructor(options: { readonly transport: SandboxTransport; readonly manifest?: Manifest } = { transport: new RecordingTransport() }) {
    const source = options.manifest ?? manifest;
    this.#chainId = Number(source.network.chainId);
    this.#destinations = new Set(Object.values(source.contracts).map((value) => value.toLowerCase()));
    this.#selectors = new Set([SELECTOR_CREATE_MEME_TOKEN, SELECTOR_CLAIM_HUMAN_QUOTA, SELECTOR_REGISTER_AGENT]);
    this.#transport = options.transport;
  }

  get chainId(): number {
    return this.#chainId;
  }

  assertMethodAllowed(method: string): void {
    const name = String(method).toLowerCase();
    if (!ALLOWED_RPC_METHODS_FOLDED.has(name)) {
      throw new RpcStageError(
        "METHOD_FORBIDDEN",
        `${name} is not on the M4 allow-list; a wallet never administers the node it reads from`,
      );
    }
  }

  async submit(envelope: SignedCallEnvelope): Promise<{ readonly payload: string; readonly result: unknown }> {
    this.assertMethodAllowed("eth_sendRawTransaction");
    if (envelope.chainId !== this.#chainId) {
      throw new RpcStageError("CHAIN_MISMATCH", `envelope targets chain ${envelope.chainId}, this stage is bound to ${this.#chainId}`);
    }
    if (!this.#destinations.has(envelope.to.toLowerCase())) {
      throw new RpcStageError("NOT_IN_MANIFEST", `${envelope.to} is not a deployed contract in the manifest`);
    }
    let selector: Hex | null;
    try {
      selector = selectorOfCalldata(envelope.data);
    } catch (error) {
      throw new RpcStageError("SELECTOR_NOT_ALLOWED", `calldata is unusable: ${(error as Error).message}`);
    }
    if (selector === null || !this.#selectors.has(selector)) {
      throw new RpcStageError("SELECTOR_NOT_ALLOWED", `selector ${String(selector)} is not a deployed entrypoint`);
    }
    if (!verifySignedIntent(envelope.signed)) {
      throw new RpcStageError("SIGNATURE_UNVERIFIED", "the envelope's signature does not cover its own intent");
    }
    if (envelope.signed.authorization === null || !envelope.signed.authorization.hardwareBacked) {
      throw new RpcStageError("UNSIGNED_AUTHORIZATION", "the envelope carries no hardware-backed authorization grant");
    }
    const payload = encodeEnvelope(envelope);
    const result = await this.#transport.request("eth_sendRawTransaction", [payload]);
    return { payload, result };
  }
}

// ---------------------------------------------------------------------------------------------------------
// M3 - an independent decoder, so "the chain would read this" is checked outside the encoder
// ---------------------------------------------------------------------------------------------------------

function argumentBlock(data: Hex): string {
  const body = data.slice(2);
  if (body.length < 8 || body.length % 2 !== 0) {
    throw new Error(`calldata is not a selector plus whole bytes: ${data}`);
  }
  return body.slice(8);
}

function wordAt(args: string, index: number): string {
  const word = args.slice(index * 64, index * 64 + 64);
  if (word.length !== 64) {
    throw new Error(`calldata is missing head word ${index}`);
  }
  return word;
}

function dynamicAt(args: string, offsetWord: string): string {
  const offset = Number.parseInt(offsetWord, 16);
  if (!Number.isSafeInteger(offset) || offset * 2 + 64 > args.length) {
    throw new Error(`ABI offset ${offset} points outside the argument block`);
  }
  const length = Number.parseInt(args.slice(offset * 2, offset * 2 + 64), 16);
  const end = offset * 2 + 64 + length * 2;
  if (!Number.isSafeInteger(length) || end > args.length) {
    throw new Error(`ABI length ${length} runs past the argument block`);
  }
  return args.slice(offset * 2 + 64, end);
}

/** Reads `createMemeToken(string,string)` back out of calldata, without touching `signer/abi.ts`. */
export function decodeCreateMemeToken(data: Hex): { readonly selector: Hex; readonly name: string; readonly symbol: string } {
  const args = argumentBlock(data);
  const name = Buffer.from(dynamicAt(args, wordAt(args, 0)), "hex").toString("utf8");
  const symbol = Buffer.from(dynamicAt(args, wordAt(args, 1)), "hex").toString("utf8");
  return { selector: `0x${data.slice(2, 10)}` as Hex, name, symbol };
}

/** Reads `claimHumanQuota(bytes,bytes32)` back out of calldata. */
export function decodeClaimHumanQuota(data: Hex): {
  readonly selector: Hex;
  readonly nullifierHash: Hex;
  readonly proofBytes: number;
} {
  const args = argumentBlock(data);
  const proofHex = dynamicAt(args, wordAt(args, 0));
  return {
    selector: `0x${data.slice(2, 10)}` as Hex,
    nullifierHash: `0x${wordAt(args, 1)}` as Hex,
    proofBytes: proofHex.length / 2,
  };
}

/** Reads the single `string` argument out of a `SymbolAlreadyUsed(string)` revert. */
function decodeSingleStringArgument(revertData: Hex): string {
  const args = argumentBlock(revertData);
  return Buffer.from(dynamicAt(args, wordAt(args, 0)), "hex").toString("utf8");
}

// ---------------------------------------------------------------------------------------------------------
// The sandbox itself
// ---------------------------------------------------------------------------------------------------------

interface Sandbox {
  readonly engine: LocalSlmEngineAdapter;
  readonly translator: IntentTranslator;
  readonly wallet: AutonomousWallet;
  readonly enclave: NativeBridgeEnclave;
  readonly gate: NativeBridgeBiometricGate;
  readonly crypto: MockCryptoBridge;
  readonly biometrics: MockBiometricBridge;
  readonly transport: RecordingTransport;
  readonly rpc: SandboxRpcStage;
  readonly keyAlias: string;
}

function sandbox(
  options: { readonly maxTranslatorWei?: bigint; readonly maxValueWeiPerTransaction?: bigint } = {},
): Sandbox {
  const crypto = createMockCryptoBridge();
  const biometrics = createMockBiometricBridge();
  const keyAlias = "maotang.e2e.owner";
  const enclave = new NativeBridgeEnclave(crypto.provider);
  const gate = new NativeBridgeBiometricGate({
    provider: biometrics.provider,
    pinnedAssertionPublicKey: biometrics.assertionPublicKeyHex,
    now: () => NOW,
  });
  const transport = new RecordingTransport();
  return {
    keyAlias,
    crypto,
    biometrics,
    enclave,
    gate,
    transport,
    engine: new LocalSlmEngineAdapter({ backend: new DeterministicSlmBackend() }),
    translator: new IntentTranslator({
      catalog: { chainId: CHAIN_ID, contracts: { HumanToken: HUMAN_TOKEN, MaoTangFactory: FACTORY } },
      limits: { maxValueWeiPerIntent: options.maxTranslatorWei ?? MAX_VALUE_WEI },
      now: () => NOW,
    }),
    wallet: new AutonomousWallet({
      enclave,
      keyAlias,
      policy: {
        chainId: CHAIN_ID,
        maxValueWeiPerTransaction: options.maxValueWeiPerTransaction ?? MAX_VALUE_WEI,
        maxValueWeiPerWindow: MAX_VALUE_WEI,
        windowSeconds: 3600,
        allowedDestinations: [FACTORY, HUMAN_TOKEN],
        allowedSelectors: [SELECTOR_CREATE_MEME_TOKEN, SELECTOR_CLAIM_HUMAN_QUOTA],
        biometricThresholdWei: 0n,
        requireHardwareBackedAuthorization: true,
      },
      ledger: new SpendWindowLedger(3600),
      authorization: new BiometricAuthorizationGate({ gate, now: () => NOW }),
      now: () => NOW,
    }),
    rpc: new SandboxRpcStage({ transport }),
  };
}

function expectTranslationError(operation: () => unknown, code: IntentTranslationCode): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof IntentTranslationError, `expected an IntentTranslationError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

async function expectViolation(promise: Promise<unknown>, code: PolicyDenialCode): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PolicyViolationError, `expected a PolicyViolationError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

/** Nothing was signed and nothing was sent: the two facts every fail-closed case must establish. */
function assertNothingLeftTheDevice(box: Sandbox): void {
  assert.equal(box.transport.calls.length, 0, "no envelope reached the RPC stage");
  assert.ok(!box.crypto.calls.includes("signAsync"), "the enclave was never asked to sign");
  assert.ok(!box.crypto.calls.includes("generateKeyAsync"), "not even a key was created");
  assert.equal(box.wallet.spendSnapshot().spentWei, 0n, "no spend was recorded");
}

const RPC_URL = process.env.MAOTANG_E2E_RPC_URL ?? "http://127.0.0.1:8545";
const LIVE = process.env.MAOTANG_E2E_LIVE_RPC === "1";

function jsonRpc(url: string, method: string, params: readonly unknown[]): Promise<{ readonly result?: unknown; readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown } }> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    const target = new URL(url);
    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        timeout: 5000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(new Error(`the endpoint did not answer JSON: ${(error as Error).message}`));
          }
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error(`no answer from ${url} within 5000ms`)));
    request.on("error", reject);
    request.end(body);
  });
}

// ---------------------------------------------------------------------------------------------------------
// Happy path: one prompt, all five modules
// ---------------------------------------------------------------------------------------------------------

test("M1 -> M5 -> M2 -> M4 end to end, and the chain-side decode equals what the human asked for", async () => {
  const box = sandbox();

  // M1.a - the offline engine turns the prompt into a candidate.
  const inference = await box.engine.infer({ kind: "utterance", text: LEAD_PROMPT });
  assert.equal(inference.networkIsolation, "enforced");
  assert.equal(inference.backend, "mock");
  assert.deepEqual(JSON.parse(inference.raw), {
    action: "createMemeToken",
    name: "Mao Tang",
    symbol: "MAOTANG",
    valueWei: MINT_AMOUNT_WEI.toString(),
  });

  // M1.b - the schema gate turns the candidate into an intent, or refuses it.
  const translated = box.translator.translate(inference.raw);
  assert.equal(translated.intent.to, FACTORY, "the destination comes from the manifest, never the model");
  assert.equal(translated.intent.chainId, CHAIN_ID);

  // M2.a - the policy clears it, and the digest it will sign is known before anything is signed.
  const preview = await box.wallet.preview(translated.intent);
  assert.equal(preview.decision.allowed, true);
  assert.equal(preview.decision.allowed && preview.decision.requiresAuthorization, true, "a threshold of 0n makes every leg a human decision");
  assert.equal(preview.decision.allowed && preview.decision.remainingWindowWei, MAX_VALUE_WEI - MINT_AMOUNT_WEI);
  assert.equal(box.wallet.spendSnapshot().spentWei, 0n, "a preview spends nothing");

  // M5 - the human is asked about that exact digest, and the assertion is verified, not trusted.
  const assertion = await box.gate.authenticate({
    keyId: "maotang.e2e.owner",
    purpose: "authorize-intent",
    challenge: preview.digest,
    reason: "sandbox: launch a meme token",
    to: FACTORY,
    valueWei: MINT_AMOUNT_WEI,
    selector: SELECTOR_CREATE_MEME_TOKEN,
  });
  assert.equal(assertion.hardwareBacked, true, "the device bridge reports a hardware-backed key");
  assert.equal(assertion.challenge, preview.digest, "the grant is bound to this digest and no other");
  assert.equal(assertion.method, "biometric");
  assert.match(assertion.detail, /matches the pinned key/);

  // M2.b - the one signing path. The policy runs again, M5 is consulted again, and only then is a signature made.
  const signed = await box.wallet.signIntent(translated.intent);
  assert.equal(verifySignedIntent(signed), true, "the raw signature re-verifies from the carried SPKI alone");
  assert.equal(signed.digest, preview.digest, "the signed digest is the one the human authorised");
  assert.equal(signed.signature.length, 2 + 64 * 2);
  assert.equal(signed.spkiPublicKey, box.crypto.spkiHexFor(box.keyAlias), "the device key signed");
  assert.equal(signed.authorization?.challenge, signed.digest);
  assert.equal(signed.authorization?.method, "biometric");
  assert.equal(signed.authorization?.hardwareBacked, true, "requireHardwareBackedAuthorization is satisfied by the bridge");
  assert.equal(box.biometrics.prompts.length, 2, "M5 was asked once directly and once by the wallet");
  assert.equal(box.enclave.mode, "hardware");

  // M3 - an independent decoder reads the calldata the way the contract would.
  assert.equal(signed.intent.data, vectors.calldata.createMemeToken, "byte-identical to the Foundry vector");
  assert.equal((signed.intent.data.length - 2) / 2, 196);
  const call = decodeCreateMemeToken(signed.intent.data);
  assert.equal(call.selector, SELECTOR_CREATE_MEME_TOKEN);
  assert.equal(call.name, "Mao Tang");
  assert.equal(call.symbol, "MAOTANG");

  // M2.c - the policy limits pass cleanly and the spend is accounted for.
  assert.equal(box.wallet.spendSnapshot().spentWei, MINT_AMOUNT_WEI);

  // M4 - the guarded envelope leaves the device, and it still carries exactly what was signed.
  const { payload, result } = await box.rpc.submit(envelopeFrom(signed));
  assert.equal(box.transport.calls.length, 1);
  assert.equal(box.transport.calls[0].method, "eth_sendRawTransaction");
  const carried = JSON.parse(payload) as Record<string, string>;
  assert.equal(carried.digest, signed.digest);
  assert.equal(carried.signature, signed.signature);
  assert.equal(carried.data, signed.intent.data);
  assert.equal(carried.to, FACTORY);
  assert.equal(carried.valueWei, MINT_AMOUNT_WEI.toString());
  assert.equal(carried.authorization, "biometric");
  assert.match(String((result as { transactionHash: string }).transactionHash), /^0x[0-9a-f]{64}$/);
});

test("a personhood claim travels the same pipeline and decodes on the chain side", async () => {
  const box = sandbox();
  const inference = await box.engine.infer({
    kind: "event",
    trigger: "maotang.claimHumanQuota",
    payload: { proof: PROOF, nullifierHash: NULLIFIER },
  });
  const translated = box.translator.translate(inference.raw);
  const signed = await box.wallet.signIntent(translated.intent);
  const { payload } = await box.rpc.submit(envelopeFrom(signed));

  assert.equal(verifySignedIntent(signed), true);
  assert.equal(signed.intent.to, HUMAN_TOKEN);
  assert.equal(signed.intent.valueWei, 0n, "a quota claim sends no native value");
  assert.equal(signed.intent.data, vectors.calldata.claimHumanQuota);
  const claim = decodeClaimHumanQuota(signed.intent.data);
  assert.equal(claim.selector, SELECTOR_CLAIM_HUMAN_QUOTA);
  assert.equal(claim.nullifierHash, NULLIFIER);
  assert.equal(claim.proofBytes, 256);
  // The nullifier is a word *inside* the calldata, not a standalone JSON field, and ABI encoding puts no
  // `0x` marker in front of a word - so the check is against the bare 32-byte hex, not the prefixed form.
  assert.ok(signed.intent.data.includes(NULLIFIER.slice(2)), "the nullifier word is in the calldata");
  assert.ok(payload.includes(NULLIFIER.slice(2)), "and the envelope a transport would carry still holds it");
});

test("the rolling window counts earlier legs and still refuses past the cap", async () => {
  const box = sandbox();
  for (const _leg of [0, 1]) {
    const inference = await box.engine.infer({ kind: "utterance", text: LEAD_PROMPT });
    await box.wallet.signIntent(box.translator.translate(inference.raw).intent);
  }
  assert.equal(box.wallet.spendSnapshot().spentWei, 2n * MINT_AMOUNT_WEI);
  assert.equal(box.transport.calls.length, 0, "nothing is submitted until the pipeline chooses to submit");

  const big = box.translator.translate(
    JSON.stringify({ action: "transfer", to: FACTORY, valueWei: (MAX_VALUE_WEI - MINT_AMOUNT_WEI).toString() }),
  );
  await expectViolation(box.wallet.signIntent(big.intent), "WINDOW_CAP_EXCEEDED");
  assert.equal(box.wallet.spendSnapshot().spentWei, 2n * MINT_AMOUNT_WEI, "a refusal does not change the window");
});

// ---------------------------------------------------------------------------------------------------------
// Failure injection: a malicious prompt, and a compromised model
// ---------------------------------------------------------------------------------------------------------

test("a malicious prompt is refused by the M1 schema gate and never reaches M2, M5 or the network", async () => {
  const box = sandbox();
  const inference = await box.engine.infer({ kind: "utterance", text: HOSTILE_PROMPT });

  // The stub is honest about not understanding the request; a model that guessed anyway is covered below.
  assert.equal(JSON.parse(inference.raw).action, "unsupported");
  expectTranslationError(() => box.translator.translate(inference.raw), "UNSUPPORTED_REQUEST");
  assertNothingLeftTheDevice(box);
});

test("a compromised model that does emit a spend still fails closed at M2, before signing or sending", async () => {
  const box = sandbox({ maxTranslatorWei: 1000n * ETH });
  const drain = JSON.stringify({ action: "transfer", to: HACKER, valueWei: (100n * ETH).toString() });
  const overCap = JSON.stringify({ action: "transfer", to: FACTORY, valueWei: (100n * ETH).toString() });
  const creep = JSON.stringify({ action: "transfer", to: HACKER, valueWei: (ETH / 2n).toString() });
  const hallucination = JSON.stringify({ action: "anvil_setBalance", to: HACKER, valueWei: "0" });

  // The translator refuses a method the protocol does not have...
  expectTranslationError(() => box.translator.translate(hallucination), "UNKNOWN_ACTION");
  // ...and accepts the shape of a spend, because judging a spend is M2's job and not the schema gate's.
  const drainIntent = box.translator.translate(drain).intent;
  const overCapIntent = box.translator.translate(overCap).intent;
  const creepIntent = box.translator.translate(creep).intent;
  assert.equal(drainIntent.to, HACKER);

  // M2 then refuses each one on the first guardrail that fits, and never reaches the enclave:
  //   - a stranger destination, which the allow-list catches before the value cap is even consulted;
  await expectViolation(box.wallet.signIntent(drainIntent), "DESTINATION_NOT_ALLOWED");
  //   - a legitimate destination carrying a value over the per-transaction cap;
  await expectViolation(box.wallet.signIntent(overCapIntent), "VALUE_CAP_EXCEEDED");
  //   - and the same stranger destination just under the cap, which the cap alone would have allowed.
  await expectViolation(box.wallet.signIntent(creepIntent), "DESTINATION_NOT_ALLOWED");

  // The M1 bound is a second, earlier refusal for the same prompt when it is configured tightly.
  expectTranslationError(() => sandbox().translator.translate(drain), "AMOUNT_OUT_OF_BOUNDS");

  assertNothingLeftTheDevice(box);
});

// ---------------------------------------------------------------------------------------------------------
// M4 guard: the method allow-list, and forged envelopes
// ---------------------------------------------------------------------------------------------------------

test("M4 refuses privileged methods, unknown selectors, foreign destinations and unsigned envelopes", async () => {
  const box = sandbox();
  const inference = await box.engine.infer({ kind: "utterance", text: LEAD_PROMPT });
  const signed = await box.wallet.signIntent(box.translator.translate(inference.raw).intent);
  const envelope = envelopeFrom(signed);

  for (const method of ["anvil_impersonateAccount", "anvil_setBalance", "evm_mine", "personal_unlockAccount", "eth_accounts", "eth_sendTransaction", "eth_sign", "debug_traceCall"]) {
    assert.throws(() => box.rpc.assertMethodAllowed(method), (error: unknown) => {
      assert.ok(error instanceof RpcStageError);
      assert.equal(error.code, "METHOD_FORBIDDEN");
      return true;
    });
  }
  assert.doesNotThrow(() => box.rpc.assertMethodAllowed("eth_sendRawTransaction"));

  const rejection = async (candidate: SignedCallEnvelope, code: RpcStageCode) => {
    await assert.rejects(box.rpc.submit(candidate), (error: unknown) => {
      assert.ok(error instanceof RpcStageError, `expected an RpcStageError, got ${String(error)}`);
      assert.equal(error.code, code);
      return true;
    });
  };
  await rejection({ ...envelope, data: "0xdeadbeef" }, "SELECTOR_NOT_ALLOWED");
  await rejection({ ...envelope, to: HACKER }, "NOT_IN_MANIFEST");
  await rejection({ ...envelope, chainId: 1 }, "CHAIN_MISMATCH");
  await rejection({ ...envelope, signed: { ...signed, intent: { ...signed.intent, valueWei: 1n } } }, "SIGNATURE_UNVERIFIED");
  await rejection({ ...envelope, signed: { ...signed, authorization: null } }, "UNSIGNED_AUTHORIZATION");

  assert.equal(box.transport.calls.length, 0, "every refusal happened before the socket");
  assert.equal((await box.rpc.submit(envelope)).payload.length > 0, true, "the untampered envelope is accepted");
  assert.equal(box.transport.calls.length, 1);
});

test("the M4 allow-list is at least as strict as the deployed rpc-guard deny list", () => {
  const declared = /const DEFAULT_DENY = \[([\s\S]*?)\];/.exec(RPC_GUARD_SOURCE);
  assert.ok(declared !== null, "scripts/rpc-guard.mjs must still declare DEFAULT_DENY for this drift check to mean anything");
  const patterns = [...declared[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(patterns.length >= 10, `expected the guard to deny a real list, found ${patterns.length}`);
  assert.ok(patterns.some((pattern) => pattern.startsWith("anvil_")), "the guard still denies anvil_*");
  assert.ok(patterns.some((pattern) => pattern.startsWith("evm_")), "the guard still denies evm_*");

  const box = sandbox();
  for (const pattern of patterns) {
    const probe = pattern.endsWith("*") ? `${pattern.slice(0, -1)}probe` : pattern;
    assert.throws(
      () => box.rpc.assertMethodAllowed(probe),
      RpcStageError,
      `the guard denies ${pattern}, so the sandbox must refuse ${probe}`,
    );
  }
  for (const method of ALLOWED_RPC_METHODS) {
    assert.doesNotThrow(() => box.rpc.assertMethodAllowed(method));
  }
});

// ---------------------------------------------------------------------------------------------------------
// Optional live leg: the same pipeline against a running node (opt-in, so `npm test` stays hermetic)
// ---------------------------------------------------------------------------------------------------------

test(
  "live M4/M3: the manifest addresses answer and the produced calldata decodes on chain",
  { skip: LIVE ? false : `set MAOTANG_E2E_LIVE_RPC=1 to run against ${RPC_URL}` },
  async () => {
    const chainId = await jsonRpc(RPC_URL, "eth_chainId", []);
    assert.equal(Number.parseInt(String(chainId.result), 16), CHAIN_ID, "the node serves the manifest's chain");

    for (const name of ["MaoTangFactory", "HumanToken"]) {
      const code = await jsonRpc(RPC_URL, "eth_getCode", [manifest.contracts[name], "latest"]);
      assert.ok(String(code.result ?? "").length > 2, `${name} has no bytecode at ${manifest.contracts[name]}`);
    }

    // A real ABI call the package knows about: `decimals()` is 6 for the micro-unit HumanToken.
    const decimals = await jsonRpc(RPC_URL, "eth_call", [{ to: HUMAN_TOKEN, data: "0x313ce567" }, "latest"]);
    assert.equal(Number.parseInt(String(decimals.result), 16), 6);

    // The decisive check: the *deployed* factory decodes the calldata this pipeline produced.
    const box = sandbox();
    const inference = await box.engine.infer({ kind: "utterance", text: LEAD_PROMPT });
    const signed = await box.wallet.signIntent(box.translator.translate(inference.raw).intent);
    const call = await jsonRpc(RPC_URL, "eth_call", [
      { from: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", to: FACTORY, data: signed.intent.data },
      "latest",
    ]);
    if (call.result !== undefined) {
      assert.match(String(call.result), /^0x[0-9a-fA-F]*$/, "the factory accepted the call and returned a token address");
      return;
    }
    const revertData = String((call.error?.data as { data?: string } | undefined)?.data ?? call.error?.data ?? "");
    assert.ok(revertData.length >= 10, `the deployed factory answered ${JSON.stringify(call.error)} - it did not decode the call`);
    if (revertData.startsWith("0xc77f66f5")) {
      // SymbolAlreadyUsed(string): the contract decoded both strings and read MAOTANG back out of the payload.
      assert.equal(decodeSingleStringArgument(revertData as Hex), "MAOTANG");
    }
    assert.ok(true, `the deployed factory refused a duplicate symbol at ${revertData.slice(0, 10)}`);
  },
);