/**
 * AI-DRIVEN E2E POLICY FUZZER - an autonomous agent's intents driven straight at the local fail-closed
 * gates (M1 -> M2 -> M5 -> M4), including the intents an agent must never be able to satisfy.
 *
 * Why this file exists. The per-module suites each prove their own layer; none of them drives a *routed*
 * intent end to end the way an agent framework does. This one is that driver, and it is written
 * adversarially. The "agent" below is a duck-typed action provider - the shape @coinbase/agentkit and
 * permissionless.js expose - that names capabilities in the consumer vocabulary (YuanYuan / MaoMao /
 * FenFen). Every case ends by asserting what did *not* happen (no signature, no broadcast, no window
 * budget consumed), because "the guardrail held" is a negative claim and has to be asserted as one.
 *
 * The three scenarios are the three ways an agent route fails in production:
 *
 *   A. Peer activation - the route is legal and the device signs it locally, paying no gas.
 *   B. Excess-limit violation - a value or an asset the policy does not allow, with no human present.
 *      The route fails closed, all the way down to the enclave never being asked to sign.
 *   C. Upstream RPC fallback - the guarded node answers 502/530. The M4 read surface
 *      (scripts/rpc-guard.mjs) and the frontend read proxy (frontend/src/app/api/rpc/route.ts) degrade to
 *      a *verdict* the UI can render, never to an unhandled browser error.
 *
 * What is stubbed, stated plainly: the device (no Secure Enclave exists on this machine - see
 * ./helpers/bridges.ts), the model text (the deterministic M1 stub), and the socket (the M4 guard is
 * really spawned, but pointed at a port nothing listens on). The guards - the M1 schema gate, the M2
 * spend policy, the M5 assertion verification and the M4 method allow-list - are the production code.
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";

import { BiometricAuthorizationGate, BiometricDeniedError } from "../bio-auth/biometric-gate.js";
import { NativeBridgeBiometricGate, type NativeBiometricProvider } from "../bio-auth/native-biometric-gate.js";
import { SELECTOR_CLAIM_HUMAN_QUOTA, SELECTOR_CREATE_MEME_TOKEN } from "../signer/abi.js";
import { SpendWindowLedger, type PolicyDecision, type PolicyDenialCode } from "../signer/policy.js";
import { NativeBridgeEnclave } from "../signer/native-enclave.js";
import type { Address } from "../signer/types.js";
import { AutonomousWallet, verifySignedIntent } from "../signer/wallet.js";
import {
  AgentActionBridge,
  ExternalActionError,
  consumerActionNameFor,
  internalActionFor,
  type ExternalActionProposal,
  type ExternalActionProvider,
} from "../slm/agent-action-bridge.js";
import {
  ENTROPY_THRESHOLDS,
  LocalQuotaVault,
  NOMINAL_QUOTA_YUANYUAN,
  VESTING_EPOCH_SECONDS,
  assessEntropy,
  type EntropyObservation,
  type EntropyVerdict,
} from "../slm/quota-vesting.js";
import { IntentTranslationError, IntentTranslator, type IntentTranslationCode, type SlmAction } from "../slm/intent-translator.js";
import { DeterministicSlmBackend, LocalSlmEngineAdapter } from "../slm/slm-engine.js";
import {
  createMockBiometricBridge,
  createMockCryptoBridge,
  type MockBiometricBridge,
  type MockCryptoBridge,
} from "./helpers/bridges.js";
import { REPO_ROOT, readWorkspaceFile } from "./helpers/repo.js";

interface Manifest {
  readonly network: { readonly chainId: string };
  readonly contracts: Readonly<Record<string, string>>;
}

const manifest = JSON.parse(readWorkspaceFile("frontend", "config", "contracts.json")) as Manifest;
const CHAIN_ID = Number(manifest.network.chainId);
const FACTORY = manifest.contracts.MaoTangFactory.toLowerCase() as Address;
const HUMAN_TOKEN = manifest.contracts.HumanToken.toLowerCase() as Address;
/** The peer node this agent is allowed to activate. On the allow-list, so the cap is the only limit tested. */
const PEER_NODE = "0x1111111111111111111111111111111111111111" as Address;
const NOW = 1_700_000_000;
const ETH = 10n ** 18n;
/** The per-transaction cap the harness ships with: one ether. */
const MAX_VALUE_WEI = ETH;
const PEER_ACTIVATION_WEI = 1_000n;
const PEER_ACTIVATION_TEXT = "Send 1,000 YuanYuan to activate friend node";
const EXCESS_TEXT = "Route 100 BTC without biometrics";

// ---------------------------------------------------------------------------------------------------------
// The agent harness: a duck-typed provider over the production M1/M2/M5 modules.
// ---------------------------------------------------------------------------------------------------------

interface FuzzerHarness {
  readonly engine: LocalSlmEngineAdapter;
  readonly translator: IntentTranslator;
  readonly wallet: AutonomousWallet;
  readonly bridge: AgentActionBridge;
  readonly crypto: MockCryptoBridge;
  readonly biometrics: MockBiometricBridge;
}

function buildHarness(options: { readonly biometricsCancelled?: boolean } = {}): FuzzerHarness {
  const crypto = createMockCryptoBridge();
  const biometrics = createMockBiometricBridge();
  const provider: NativeBiometricProvider =
    options.biometricsCancelled === true ? cancellingProvider(biometrics.provider) : biometrics.provider;
  const keyAlias = "maotang.fuzzer.owner";
  const enclave = new NativeBridgeEnclave(crypto.provider);
  const gate = new NativeBridgeBiometricGate({
    provider,
    pinnedAssertionPublicKey: biometrics.assertionPublicKeyHex,
    now: () => NOW,
  });
  const wallet = new AutonomousWallet({
    enclave,
    keyAlias,
    policy: {
      chainId: CHAIN_ID,
      maxValueWeiPerTransaction: MAX_VALUE_WEI,
      maxValueWeiPerWindow: MAX_VALUE_WEI,
      windowSeconds: 3600,
      allowedDestinations: [FACTORY, HUMAN_TOKEN, PEER_NODE],
      allowedSelectors: [SELECTOR_CREATE_MEME_TOKEN, SELECTOR_CLAIM_HUMAN_QUOTA],
      biometricThresholdWei: 0n,
      requireHardwareBackedAuthorization: true,
    },
    ledger: new SpendWindowLedger(3600),
    authorization: new BiometricAuthorizationGate({ gate, now: () => NOW }),
    now: () => NOW,
  });
  return {
    crypto,
    biometrics,
    engine: new LocalSlmEngineAdapter({ backend: new DeterministicSlmBackend() }),
    translator: new IntentTranslator({
      catalog: { chainId: CHAIN_ID, contracts: { HumanToken: HUMAN_TOKEN, MaoTangFactory: FACTORY } },
      limits: { maxValueWeiPerIntent: MAX_VALUE_WEI },
      now: () => NOW,
    }),
    wallet,
    bridge: new AgentActionBridge({ wallet, allowedChainIds: [CHAIN_ID] }),
  };
}

/** A device whose human dismissed the Face ID / Touch ID sheet: the platform prompt is denied outright. */
function cancellingProvider(provider: NativeBiometricProvider): NativeBiometricProvider {
  return {
    ...provider,
    async authenticateAsync() {
      throw new BiometricDeniedError("the human dismissed the biometric prompt (simulated cancellation)");
    },
  };
}

/** An @coinbase/agentkit-shaped provider: it names capabilities and yields a call spec. It holds no key. */
function agentProvider(options: {
  readonly name?: string;
  readonly actions?: readonly string[];
  readonly emit: (input: unknown) => ExternalActionProposal | null;
}): ExternalActionProvider {
  return {
    name: options.name ?? "coinbase-agentkit-mock",
    actions: options.actions ?? ["YuanYuan", "MaoMao", "FenFen"],
    propose: options.emit,
  };
}

function expectTranslationError(operation: () => unknown, code: IntentTranslationCode): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof IntentTranslationError, "expected an IntentTranslationError, got " + String(error));
    assert.equal(error.code, code);
    return true;
  });
}

function expectExternalError(operation: () => unknown, code: string): void {
  assert.throws(operation, (error: unknown) => {
    assert.ok(error instanceof ExternalActionError, "expected an ExternalActionError, got " + String(error));
    assert.equal(error.code, code);
    return true;
  });
}

async function expectExternalRejection(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ExternalActionError, "expected an ExternalActionError, got " + String(error));
    assert.equal(error.code, code);
    return true;
  });
}

/** The machine-readable denial a policy decision carries, or null when it was allowed. */
function denialCode(decision: PolicyDecision): PolicyDenialCode | null {
  return decision.allowed ? null : decision.code;
}

// ---------------------------------------------------------------------------------------------------------
// Vesting & sybil fixtures: interaction shapes, expressed without their content.
// ---------------------------------------------------------------------------------------------------------

/** Irregular, unhurried offsets: what a person's epoch of use looks like. */
const HUMAN_OFFSETS = [0, 7, 23, 31, 58, 96];
/** Every interval identical: what a scheduler's epoch looks like. */
const METRONOME_OFFSETS = [0, 30, 60, 90, 120];
const EPOCH_BASE = NOW - 600;

function observationOf(
  offsets: readonly number[],
  nowSeconds: number = NOW,
  options: { readonly digest?: string; readonly claimedDevices?: number; readonly sessionId?: string } = {},
): EntropyObservation {
  return {
    samples: offsets.map((offset, index) => ({
      atSeconds: EPOCH_BASE + offset,
      kind: "utterance",
      digest: options.digest ?? "shape-" + String(index),
      sessionId: options.sessionId ?? "session-1",
    })),
    claimedDevices: options.claimedDevices ?? 1,
    nowSeconds,
  };
}

function humanEpoch(nowSeconds: number = NOW): EntropyObservation {
  return observationOf(HUMAN_OFFSETS, nowSeconds);
}

/** The judge's own label for an epoch: a sybil code, or "entropic" / "insufficient". */
function codeOf(verdict: EntropyVerdict): string {
  return verdict.kind === "sybil" ? verdict.code : verdict.kind;
}

// ---------------------------------------------------------------------------------------------------------
// The consumer vocabulary is presentation-only.
// ---------------------------------------------------------------------------------------------------------

test("the consumer vocabulary maps both ways and never widens the action catalog", () => {
  assert.equal(consumerActionNameFor("transfer"), "YuanYuan");
  assert.equal(consumerActionNameFor("createMemeToken"), "MaoMao");
  assert.equal(consumerActionNameFor("claimHumanQuota"), "FenFen");
  assert.equal(consumerActionNameFor("anvil_setBalance"), null, "an unknown action gets no consumer name");

  assert.equal(internalActionFor("yuanyuan"), "transfer");
  assert.equal(internalActionFor("  MaoMao "), "createMemeToken");
  assert.equal(internalActionFor("FenFen"), "claimHumanQuota");
  assert.equal(internalActionFor("Drain"), null, "a consumer name never invents an action");

  // On the wire the internal id is the vocabulary; the consumer name is only what the owner is shown.
  const box = buildHarness();
  const proposal = box.bridge.propose({ action: "transfer", to: PEER_NODE, valueWei: "1", chainId: CHAIN_ID });
  assert.equal(proposal.action, "transfer");
  assert.equal(proposal.consumerName, "YuanYuan");
});

test("an external provider cannot propose an action it does not advertise, and a null proposal is not an error", async () => {
  const box = buildHarness();

  const liar = agentProvider({
    name: "narrow-provider",
    actions: ["FenFen"],
    emit: () => ({ action: "YuanYuan", to: PEER_NODE, valueWei: "1", chainId: CHAIN_ID }),
  });
  await expectExternalRejection(box.bridge.proposeFrom(liar, {}), "UNKNOWN_ACTION");

  const quiet = agentProvider({ actions: ["YuanYuan"], emit: () => null });
  assert.equal(await box.bridge.proposeFrom(quiet, {}), null);

  const broken = { name: "", actions: [] } as unknown as ExternalActionProvider;
  await expectExternalRejection(box.bridge.proposeFrom(broken, {}), "MALFORMED_PROPOSAL");
});

// ---------------------------------------------------------------------------------------------------------
// Case A - peer activation
// ---------------------------------------------------------------------------------------------------------

test("A. peer activation: the routed intent is authorized and signed locally, and the device pays no gas", async () => {
  const box = buildHarness();

  // A.1 - the free-form sentence is not an authority. M1's deterministic stub recognises no
  // ETH-denominated action in it and the schema gate refuses to guess; nothing is signed.
  const inference = await box.engine.infer({ kind: "utterance", text: PEER_ACTIVATION_TEXT });
  assert.equal(inference.networkIsolation, "enforced");
  assert.equal(JSON.parse(inference.raw).action, "unsupported");
  expectTranslationError(() => box.translator.translate(inference.raw), "UNSUPPORTED_REQUEST");
  assert.equal(box.wallet.spendSnapshot().spentWei, 0n);

  // A.2 - the routed half: an agentkit-shaped provider proposes the activation as a structured call spec
  // in the consumer vocabulary. The bridge resolves YuanYuan -> transfer and hands it to M2/M5.
  const external: ExternalActionProposal = {
    action: "YuanYuan",
    to: PEER_NODE,
    valueWei: PEER_ACTIVATION_WEI.toString(),
    chainId: CHAIN_ID,
    description: "Peer node activation",
  };
  const provider = agentProvider({ emit: () => external });
  const proposal = await box.bridge.proposeFrom(provider, { utterance: PEER_ACTIVATION_TEXT });
  assert.ok(proposal !== null, "the provider proposed an action");
  assert.equal(proposal.action, "transfer");
  assert.equal(proposal.consumerName, "YuanYuan");
  assert.equal(proposal.intent.to, PEER_NODE);
  assert.equal(proposal.intent.valueWei, PEER_ACTIVATION_WEI);
  assert.equal(proposal.provider, "coinbase-agentkit-mock");

  // The same route written as M1 model output translates to the identical intent, so the two entry points
  // cannot disagree about what YuanYuan means.
  const translated = box.translator.translate(
    JSON.stringify({ action: "transfer", to: PEER_NODE, valueWei: PEER_ACTIVATION_WEI.toString() }),
  );
  assert.equal(translated.intent.to, proposal.intent.to);
  assert.equal(translated.intent.valueWei, proposal.intent.valueWei);

  // A.3 - the local pipeline authorizes and signs: M5 verified a hardware-backed assertion over this digest
  // and M2 recorded exactly the transferred value.
  const outcome = await box.bridge.authorize(external, { attemptSign: true });
  assert.equal(outcome.decision.allowed, true);
  assert.equal(outcome.refusal, null);
  assert.ok(outcome.signed !== null, "a signature was released");
  assert.equal(verifySignedIntent(outcome.signed), true, "the signature covers its own intent");
  assert.equal(outcome.signed.authorization?.hardwareBacked, true);
  assert.equal(outcome.signed.authorization?.method, "biometric");
  assert.equal(outcome.signed.intent.valueWei, PEER_ACTIVATION_WEI);
  assert.equal(box.wallet.spendSnapshot().spentWei, PEER_ACTIVATION_WEI);

  // A.4 - gasless, as far as *this device* is concerned, and asserted rather than assumed: the wallet never
  // folds a gas leg into the value it signs, and the read surface the console ships carries no self-paying
  // write (eth_sendTransaction is not on the allow-list), so the page cannot pay gas either. The sponsored
  // relay that turns this envelope into a mined transaction is the compute-center seam
  // (slm/compute-center-adapter.ts); it is modeled here, not executed, and no broadcaster exists in this
  // package on purpose.
  const rpcRoute = readWorkspaceFile("frontend", "src", "app", "api", "rpc", "route.ts");
  assert.ok(!rpcRoute.includes("eth_sendTransaction"), "the console's read surface cannot pay a gas leg");
  assert.ok(rpcRoute.includes("eth_getBalance"), "the read surface is the balance/state half only");
});

// ---------------------------------------------------------------------------------------------------------
// Case B - excess-limit violation, with no human present
// ---------------------------------------------------------------------------------------------------------

test("B. excess-limit violation: an asset-denominated or over-cap route fails closed, with no signature", async () => {
  const box = buildHarness();

  // B.1 - the free-form sentence never becomes an intent. M1 refuses to invent a BTC/wei rate (the stub
  // reports unsupported and the schema gate will not guess), which is the first place "100 BTC" dies.
  const inference = await box.engine.infer({ kind: "utterance", text: EXCESS_TEXT });
  assert.equal(JSON.parse(inference.raw).action, "unsupported");
  expectTranslationError(() => box.translator.translate(inference.raw), "UNSUPPORTED_REQUEST");

  // B.2 - naming an asset in M1 JSON is an unknown field, not a conversion: the schema has exactly one unit.
  expectTranslationError(
    () => box.translator.translate(JSON.stringify({ action: "transfer", to: PEER_NODE, asset: "BTC", amount: "100" })),
    "UNKNOWN_FIELD",
  );

  // B.3 - the same attempt through an external provider is refused by the bridge before any field is read.
  expectExternalError(
    () => box.bridge.propose({ action: "YuanYuan", to: PEER_NODE, valueWei: "100", asset: "BTC", chainId: CHAIN_ID }),
    "MALFORMED_PROPOSAL",
  );
  expectExternalError(
    () => box.bridge.propose({ action: "YuanYuan", to: PEER_NODE, valueWei: "100", chainId: CHAIN_ID, signedTx: "0x00" }),
    "CUSTODY_MATERIAL",
  );

  // B.4 - a structurally valid route that is simply too large is refused by the M2 per-transaction cap.
  const tooLarge: ExternalActionProposal = {
    action: "YuanYuan",
    to: PEER_NODE,
    valueWei: (100n * ETH).toString(),
    chainId: CHAIN_ID,
  };
  const capped = await box.bridge.authorize(tooLarge, { attemptSign: true });
  assert.equal(capped.decision.allowed, false);
  assert.equal(denialCode(capped.decision), "VALUE_CAP_EXCEEDED");
  assert.equal(capped.signed, null, "no signature was produced");
  assert.equal(capped.refusal, null, "a policy denial is a verdict, not a refused authorization");
  assert.equal(box.wallet.spendSnapshot().spentWei, 0n, "a refused route consumes no window budget");

  // B.5 - "without biometrics": a route one wei inside the cap is still refused, because the human never
  // authorized it. The only thing the device would release is a signature, and it does not.
  const noHuman = buildHarness({ biometricsCancelled: true });
  const withinCap: ExternalActionProposal = {
    action: "YuanYuan",
    to: PEER_NODE,
    valueWei: (ETH / 2n).toString(),
    chainId: CHAIN_ID,
  };
  const unsigned = await noHuman.bridge.authorize(withinCap, { attemptSign: true });
  assert.equal(unsigned.decision.allowed, true, "the policy allows the leg; only the human is missing");
  assert.equal(unsigned.signed, null, "no biometric grant, no signature");
  assert.ok(unsigned.refusal !== null, "the refusal is reported rather than thrown");
  assert.ok(unsigned.refusal.code.includes("BiometricDenied"), "the human cancelled the prompt");
  assert.ok(!noHuman.crypto.calls.includes("signAsync"), "the enclave was never asked to sign");
  assert.equal(noHuman.wallet.spendSnapshot().spentWei, 0n, "nothing was spent");

  // B.6 - and the allow-list still refuses a stranger destination even at a value the cap would permit.
  const stranger: ExternalActionProposal = {
    action: "YuanYuan",
    to: "0x00000000000000000000000000000000deadbeef",
    valueWei: "1",
    chainId: CHAIN_ID,
  };
  const refused = await box.bridge.authorize(stranger, { attemptSign: true });
  assert.equal(denialCode(refused.decision), "DESTINATION_NOT_ALLOWED");
  assert.equal(refused.signed, null);
  assert.ok(!box.crypto.calls.includes("signAsync"), "the enclave saw nothing");
});

// ---------------------------------------------------------------------------------------------------------
// Case C - upstream RPC fallback
// ---------------------------------------------------------------------------------------------------------

test("C. upstream RPC fallback: a 502/530 node degrades to a verdict the UI renders, never an unhandled error", async (t) => {
  const listenPort = await freePort();
  const deadPort = await freePort();
  const guard = path.join(REPO_ROOT, "scripts", "rpc-guard.mjs");
  const child = spawn(
    process.execPath,
    [guard, "--listen", "127.0.0.1:" + listenPort, "--target", "http://127.0.0.1:" + deadPort],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout?.resume();
  child.stderr?.resume();
  t.after(() => {
    child.kill();
  });

  await waitForHealth(listenPort);

  // A read the console legitimately issues: the guard forwards it, the node is gone, and the guard answers
  // its own JSON-RPC verdict (502 / -32603) instead of hanging, crashing or answering an empty body.
  const read = await rpc(listenPort, { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] });
  assert.equal(read.status, 502);
  assert.equal(read.body.error?.code, -32603);

  // A privileged method is refused by name, before any forward, as 403 / -32601.
  const blocked = await rpc(listenPort, { jsonrpc: "2.0", id: 2, method: "anvil_setBalance", params: [] });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error?.code, -32601);

  // The browser's CORS preflight is answered here (204), so a cross-origin read never becomes a red line.
  const preflight = await fetch("http://127.0.0.1:" + listenPort + "/", { method: "OPTIONS" });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");

  // The frontend read proxy is what turns those transport failures into a *business verdict* at HTTP 200,
  // which is the only way a browser stops logging them (ADR-041 / ADR-042). Assert the shipped source maps
  // each upstream failure to an error object at status 200 and never to a 5xx of its own.
  const route = readWorkspaceFile("frontend", "src", "app", "api", "rpc", "route.ts");
  assert.ok(route.includes("the node could not be reached"), "a fetch rejection becomes a verdict, not a throw");
  assert.ok(route.includes("the node did not answer within"), "a timeout becomes a verdict too");
  assert.ok(route.includes("the node answered HTTP ${upstream.status}"), "an upstream 502/530 is reported in the body");
  for (const status of [", 502)", ", 503)"]) {
    assert.ok(!route.includes(status), "no upstream failure may surface as " + status + " to the page");
  }
  const verdicts = (route.match(/, 200\)/g) ?? []).length;
  assert.ok(verdicts >= 3, "expected every well-formed-read verdict at 200, found " + verdicts);
});

// ---------------------------------------------------------------------------------------------------------
// Case D - linear compute vesting
// ---------------------------------------------------------------------------------------------------------

test("D. vesting: the nominal quota starts locked, one entropic epoch unlocks one slice, and each action draws its own weight", () => {
  const vault = new LocalQuotaVault({ now: () => NOW });

  const genesis = vault.snapshot();
  assert.equal(genesis.state, "locked");
  assert.equal(genesis.nominalYuanYuan, NOMINAL_QUOTA_YUANYUAN);
  assert.equal(genesis.nominalYuanYuan, 1_000_000n);
  assert.equal(genesis.unlockedYuanYuan, 0n);
  assert.equal(genesis.availableYuanYuan, 0n);
  assert.deepEqual(genesis.availableDenominations, { yuanYuan: 0n, maoMao: 0n, fenFen: 0n });
  assert.equal(genesis.vestingBasisPoints, 0);
  assert.equal(genesis.tier, "T0");
  assert.equal(genesis.windowDays, 100, "1,000,000 nominal at 10,000 an epoch is a 100-day linear vest");

  // Nothing can be charged while the quota is locked.
  const lockedCharge = vault.charge("transfer");
  assert.equal(lockedCharge.allowed, false);
  assert.equal(lockedCharge.allowed === false ? lockedCharge.code : null, "QUOTA_LOCKED");
  assert.equal(lockedCharge.allowed === false ? lockedCharge.remainingYuanYuan : null, 0n);

  // One entropic epoch unlocks exactly one slice - the whole point of vesting linearly.
  const accrued = vault.observeEntropy(humanEpoch());
  assert.equal(accrued.accepted, true);
  assert.equal(accrued.accepted === true ? accrued.accruedYuanYuan : null, 10_000n);

  const after = vault.snapshot();
  assert.equal(after.state, "vesting");
  assert.equal(after.unlockedYuanYuan, 10_000n);
  assert.equal(after.epochsAccrued, 1);
  assert.equal(after.tier, "T0", "one epoch is still probation");
  assert.equal(after.vestingBasisPoints, 100, "one per cent of the schedule");
  assert.deepEqual(
    after.availableDenominations,
    { yuanYuan: 10_000n, maoMao: 1_000n, fenFen: 100n },
    "10,000 YuanYuan is 1,000 MaoMao is 100 FenFen - the 1:10:100 ratio",
  );

  // Showing up twice in one epoch does not vest twice.
  const repeat = vault.observeEntropy(humanEpoch());
  assert.equal(repeat.accepted, false);
  assert.equal(repeat.accepted === false ? repeat.code : null, "EPOCH_ALREADY_ACCRUED");
  assert.equal(vault.snapshot().unlockedYuanYuan, 10_000n);

  // The next epoch does.
  const next = vault.observeEntropy(humanEpoch(NOW + VESTING_EPOCH_SECONDS));
  assert.equal(next.accepted, true);
  assert.equal(vault.snapshot().epochsAccrued, 2);

  // Each action draws the same ratio the denominations use: transfer 1, MaoMao 10, FenFen 100.
  const transfer = vault.charge("transfer");
  assert.equal(transfer.allowed === true ? transfer.chargedYuanYuan : null, 1n);
  const maoMao = vault.charge("createMemeToken");
  assert.equal(maoMao.allowed === true ? maoMao.chargedYuanYuan : null, 10n);
  const fenFen = vault.charge("claimHumanQuota");
  assert.equal(fenFen.allowed === true ? fenFen.chargedYuanYuan : null, 100n);
  assert.equal(vault.snapshot().consumedYuanYuan, 111n);
  assert.equal(vault.snapshot().availableYuanYuan, 20_000n - 111n);

  // An action outside the catalog has no weight, and is refused rather than priced at zero.
  const bogus = vault.preview("drain" as unknown as SlmAction);
  assert.equal(bogus.allowed === false ? bogus.code : null, "QUOTA_UNKNOWN_ACTION");

  // A preview never spends.
  const beforePreview = vault.snapshot().consumedYuanYuan;
  vault.preview("claimHumanQuota");
  assert.equal(vault.snapshot().consumedYuanYuan, beforePreview);
});

// ---------------------------------------------------------------------------------------------------------
// Case E - sybil slashing
// ---------------------------------------------------------------------------------------------------------

test("E. sybil slashing: machine cadence, a metronome, a replay loop and a virtual phone cluster all invalidate the quota locally", () => {
  // The judge names each farm signature on its own, without a ledger.
  assert.equal(codeOf(assessEntropy(observationOf([0, 1, 2, 3]))), "MACHINE_CADENCE");
  assert.equal(codeOf(assessEntropy(observationOf(METRONOME_OFFSETS))), "METRONOME_REGULARITY");
  assert.equal(codeOf(assessEntropy(observationOf([0, 50, 10]))), "CLOCK_ROLLBACK");
  assert.equal(
    codeOf(assessEntropy(observationOf([0, 25, 41, 96], NOW, { digest: "same-shape" }))),
    "REPLAY_REPETITION",
  );
  assert.equal(
    codeOf(assessEntropy(observationOf(HUMAN_OFFSETS, NOW, { claimedDevices: 50 }))),
    "VIRTUAL_DEVICE_CLUSTER",
    "fifty claimed phones driven from one session is a cluster",
  );
  assert.equal(
    codeOf(assessEntropy(observationOf(HUMAN_OFFSETS), { ...ENTROPY_THRESHOLDS, maxSamplesPerEpoch: 3 })),
    "BURST_DENSITY",
  );
  assert.equal(codeOf(assessEntropy(observationOf([0]))), "insufficient", "one sample is not a behaviour");
  assert.equal(codeOf(assessEntropy(humanEpoch())), "entropic");

  // The ledger fails closed on the first sybil epoch and stays invalidated.
  const vault = new LocalQuotaVault({ now: () => NOW });
  assert.equal(vault.observeEntropy(humanEpoch()).accepted, true);
  assert.equal(vault.snapshot().availableYuanYuan, 10_000n, "there is something to lose");

  const slashed = vault.observeEntropy(observationOf(METRONOME_OFFSETS));
  assert.equal(slashed.accepted, false);
  assert.equal(slashed.accepted === false ? slashed.code : null, "METRONOME_REGULARITY");
  assert.equal(slashed.accepted === false ? slashed.slashed : null, true);

  const after = vault.snapshot();
  assert.equal(after.state, "slashed");
  assert.equal(after.availableYuanYuan, 0n, "the usable balance is invalidated, not merely reduced");
  assert.equal(after.unlockedYuanYuan, 10_000n, "the history is kept; the gate refuses to spend it");
  assert.equal(after.tier, "T0");

  // Every path is refused while slashed, and the state is sticky.
  const charged = vault.charge("transfer");
  assert.equal(charged.allowed === false ? charged.code : null, "QUOTA_SLASHED");
  assert.equal(vault.observeEntropy(humanEpoch(NOW + VESTING_EPOCH_SECONDS)).accepted, false);
  assert.equal(vault.snapshot().state, "slashed");
  assert.equal(vault.recoverByOwnerAuthorization({ hardwareBacked: false }), false);

  // Only a hardware-backed owner authorization clears it.
  assert.equal(vault.snapshot().state, "slashed");
  assert.equal(vault.recoverByOwnerAuthorization({ hardwareBacked: true }), true);
  assert.equal(vault.snapshot().state, "vesting");
  assert.equal(vault.snapshot().availableYuanYuan, 10_000n);
});

// ---------------------------------------------------------------------------------------------------------
// Case F - the bridge consults the vesting gate before the enclave
// ---------------------------------------------------------------------------------------------------------

test("F. the bridge refuses a quota-denied action with no signature and no enclave call", async () => {
  const box = buildHarness();
  const vault = new LocalQuotaVault({ now: () => NOW });
  const gated = new AgentActionBridge({ wallet: box.wallet, allowedChainIds: [CHAIN_ID], quota: vault });
  const external: ExternalActionProposal = {
    action: "YuanYuan",
    to: PEER_NODE,
    valueWei: "1",
    chainId: CHAIN_ID,
  };

  // Locked at genesis: the spend policy is satisfied, the vesting gate refuses, nothing is signed.
  const denied = await gated.authorize(external, { attemptSign: true });
  assert.equal(denied.decision.allowed, true, "the spend policy itself allows the leg");
  assert.ok(denied.quotaRefusal !== null, "the refusal names the vesting gate");
  assert.equal(denied.quotaRefusal?.code, "QUOTA_LOCKED");
  assert.equal(denied.signed, null);
  assert.equal(denied.refusal, null, "a quota refusal is not a wallet refusal");
  assert.ok(!box.crypto.calls.includes("signAsync"), "the enclave was never asked to sign");
  assert.equal(box.wallet.spendSnapshot().spentWei, 0n);

  // After one entropic epoch the same leg is authorized and signed, and the charge is recorded.
  assert.equal(vault.observeEntropy(humanEpoch()).accepted, true);
  const allowed = await gated.authorize(external, { attemptSign: true });
  assert.equal(allowed.quotaRefusal, null);
  assert.ok(allowed.signed !== null);
  assert.equal(vault.snapshot().consumedYuanYuan, 1n);

  // A farm signature slashes, and the very next authorization fails closed again.
  assert.equal(vault.observeEntropy(observationOf(METRONOME_OFFSETS)).accepted, false);
  const afterSlash = await gated.authorize(external, { attemptSign: true });
  assert.equal(afterSlash.quotaRefusal?.code, "QUOTA_SLASHED");
  assert.equal(afterSlash.signed, null);
});

// ---------------------------------------------------------------------------------------------------------
// Socket helpers: reserve a port, wait for the guard, and speak JSON-RPC over loopback only.
// ---------------------------------------------------------------------------------------------------------

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        if (port === 0) {
          reject(new Error("could not reserve a loopback port"));
          return;
        }
        resolve(port);
      });
    });
  });
}

interface GuardReply {
  readonly status: number;
  readonly body: { readonly error?: { readonly code?: number; readonly message?: string } };
}

async function rpc(port: number, payload: unknown): Promise<GuardReply> {
  const response = await fetch("http://127.0.0.1:" + port + "/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { status: response.status, body: (await response.json()) as GuardReply["body"] };
}

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/healthz");
      if (response.ok) {
        return;
      }
    } catch {
      // the guard is not listening yet
    }
    if (Date.now() > deadline) {
      throw new Error("the rpc-guard did not answer on 127.0.0.1:" + port + " within 10s");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
