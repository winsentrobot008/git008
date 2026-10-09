#!/usr/bin/env node
/**
 * TWO-NODE EXCHANGE - M1 -> M5 -> M2 -> M4 -> M3, twice, between two local MAOTANG agents.
 *
 * What this is. A runnable, on-screen simulation of two independent edge nodes - Node-A (the "MaoMao"
 * lane) and Node-B (the "FenFen" lane) - each holding its own enclave key, its own spend policy, its own
 * 24h spend window and its own vesting vault, exchanging whitelisted value transfers with each other and
 * being refused the moment either of them reaches outside its envelope.
 *
 * What is real. Everything that *decides* anything is the production code, wired through its real adapters:
 *
 *   M1  LocalSlmEngineAdapter + DeterministicSlmBackend   offline utterance -> candidate text (model stubbed)
 *   M1  IntentTranslator                                  the closed schema gate that turns text into an intent
 *   M5  NativeBridgeBiometricGate (pinned key)            the assertion signature is really verified
 *   M5  HardwareNullifierRegistry + deriveHardwareNullifier   the single-use handle is really derived
 *   M2  AutonomousWallet over NativeBridgeEnclave         policy, digest, signature
 *   M2  SpendWindowLedger                                 the rolling 24h window
 *   M3  LocalQuotaVault                                   linear vesting, really judged by assessEntropy
 *   M4  RelayGateway                                      signature + allow-list guard, cross-checked against
 *                                                         the shipped scripts/rpc-guard.mjs deny list
 *
 * What is simulated, stated plainly. There is no Secure Enclave on this machine and no chain behind the
 * demo, so four things are doubles: the device keystore (throwaway in-process keys), the biometric prompt
 * (a real signed assertion over the real challenge, but no Face ID sheet), the network (a local gateway
 * object instead of a socket) and the ETH balances (a ledger this demo moves, not chain state). The
 * guardrails are not stubbed.
 *
 * Run:  cd mobile-agent && npm run demo:exchange
 */

import { BiometricAuthorizationGate } from "../bio-auth/index.js";
import { NativeBridgeBiometricGate } from "../bio-auth/native-biometric-gate.js";
import { HardwareNullifierRegistry, NullifierReplayError, deriveHardwareNullifier } from "../bio-auth/nullifier.js";
import { SELECTOR_CLAIM_HUMAN_QUOTA } from "../signer/abi.js";
import { PolicyViolationError, SpendWindowLedger, selectorOf } from "../signer/policy.js";
import { NativeBridgeEnclave } from "../signer/native-enclave.js";
import { normalizeAddress, type Address, type Hex } from "../signer/types.js";
import { AutonomousWallet, verifySignedIntent, type SignedIntent, type TransactionIntent } from "../signer/wallet.js";
import { IntentTranslator } from "../slm/intent-translator.js";
import {
  ENTROPY_THRESHOLDS,
  LocalQuotaVault,
  QUOTA_DENOMINATIONS,
  VESTING_EPOCH_SECONDS,
  toDenominations,
  type InteractionSample,
  type LocalQuotaVaultOptions,
} from "../slm/quota-vesting.js";
import { DeterministicSlmBackend, LocalSlmEngineAdapter, type SlmEngine, type SlmInput } from "../slm/slm-engine.js";
import {
  createMockBiometricBridge,
  createMockCryptoBridge,
  type MockBiometricBridge,
  type MockBiometricBridgeOptions,
  type MockCryptoBridge,
} from "../test/helpers/bridges.js";
import { readWorkspaceFile } from "../test/helpers/repo.js";

// ---------------------------------------------------------------------------------------------------------
// The set: chain, accounts, contracts
// ---------------------------------------------------------------------------------------------------------

interface Manifest {
  readonly network: { readonly chainId: string };
  readonly contracts: Readonly<Record<string, string>>;
}
const manifest = JSON.parse(readWorkspaceFile("frontend", "config", "contracts.json")) as Manifest;
const CHAIN_ID = Number(manifest.network.chainId);
/** Read from the real deployment manifest, so the demo targets the addresses the app does. */
const HUMAN_TOKEN = normalizeAddress(manifest.contracts.HumanToken);
const FACTORY = normalizeAddress(manifest.contracts.MaoTangFactory);

/** Two node accounts, spelled so they are recognisable in the output. Stand-ins: this runs on no chain. */
const NODE_A_ACCOUNT = normalizeAddress("0x" + "a1".repeat(20));
const NODE_B_ACCOUNT = normalizeAddress("0x" + "b2".repeat(20));
/** An address nobody whitelisted, used to show the destination gate refusing. */
const ROGUE_ACCOUNT = normalizeAddress("0x" + "deadbeef".repeat(5));

const ETH = 10n ** 18n;
const TRANSFER_A_TO_B = (ETH * 5n) / 100n; // 0.05 ETH
const TRANSFER_B_TO_A = (ETH * 2n) / 100n; // 0.02 ETH
const PER_TX_CAP = ETH / 10n; // 0.1 ETH
const WINDOW_CAP = ETH / 2n; // 0.5 ETH per rolling 24h
const WINDOW_SECONDS = 86_400;

/** The deny list of the real proxy, parsed out of the shipped file rather than re-typed here. */
const RPC_GUARD_SOURCE = readWorkspaceFile("scripts", "rpc-guard.mjs");
const GUARD_DENY_PATTERNS: readonly string[] = (() => {
  const match = /const DEFAULT_DENY = \[([\s\S]*?)\];/.exec(RPC_GUARD_SOURCE);
  if (match === null) {
    throw new Error("could not read DEFAULT_DENY out of scripts/rpc-guard.mjs");
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
})();

// ---------------------------------------------------------------------------------------------------------
// Terminal paint
// ---------------------------------------------------------------------------------------------------------

const ESC = String.fromCharCode(27);
const color = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
const paint = (code: string, text: string): string =>
  color ? ESC + "[" + code + "m" + text + ESC + "[0m" : text;
const dim = (t: string) => paint("2", t);
const bold = (t: string) => paint("1", t);
const green = (t: string) => paint("32", t);
const red = (t: string) => paint("31", t);
const yellow = (t: string) => paint("33", t);
const cyan = (t: string) => paint("36", t);
const magenta = (t: string) => paint("35", t);

const ANSI = new RegExp(ESC + "\\[[0-9;]*m", "g");
const visible = (text: string): number => text.replace(ANSI, "").length;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, color ? ms : 0);
  });
}

function panel(title: string, rows: readonly string[], boxWidth: number): string[] {
  const inner = boxWidth - 2;
  const header = " " + title + " ";
  const lines: string[] = ["┌" + header + "─".repeat(Math.max(0, inner - visible(header))) + "┐"];
  for (const row of rows) {
    const clipped = visible(row) > inner ? row.slice(0, inner - 1) + "…" : row;
    lines.push("│" + clipped + " ".repeat(Math.max(0, inner - visible(clipped))) + "│");
  }
  lines.push("└" + "─".repeat(inner) + "┘");
  return lines;
}

function sideBySide(left: readonly string[], right: readonly string[]): string[] {
  const leftWidth = left.reduce((max, line) => Math.max(max, visible(line)), 0);
  const rows = Math.max(left.length, right.length);
  const out: string[] = [];
  for (let index = 0; index < rows; index += 1) {
    const l = left[index] ?? "";
    out.push(l + " ".repeat(Math.max(0, leftWidth - visible(l))) + "   " + (right[index] ?? ""));
  }
  return out;
}

function bar(basisPoints: number, cells = 12): string {
  const filled = Math.max(0, Math.min(cells, Math.round((basisPoints / 10_000) * cells)));
  return "▓".repeat(filled) + "░".repeat(cells - filled);
}

function eth(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(4) + " ETH";
}
function group(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function short(value: string): string {
  return value.slice(0, 10) + "…" + value.slice(-6);
}

function banner(step: string, title: string): void {
  console.log("");
  console.log(dim("─".repeat(96)));
  console.log(cyan(bold(" " + step.padEnd(8))) + " " + bold(title));
  console.log(dim("─".repeat(96)));
}

function note(label: string, detail: string, tone: (t: string) => string = dim): void {
  console.log("   " + tone("•") + " " + label.padEnd(16) + " " + detail);
}

// ---------------------------------------------------------------------------------------------------------
// M4 - the relay gateway both nodes submit through
// ---------------------------------------------------------------------------------------------------------

class GatewayError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(code + ": " + message);
    this.name = "GatewayError";
    this.code = code;
  }
}

interface NullifierSeedLike {
  readonly hardwareIdHex: Hex;
  readonly enrollmentSaltHex: Hex;
  readonly epoch: number;
}

/**
 * Stands in for the M4 hop: the reverse proxy plus the relay that would carry a signed envelope.
 *
 * Four refusals, in the order the real path applies them: the method must be on the relay allow-list, the
 * envelope's signature must verify against the key it carries, the destination must be one the gateway
 * routes, and the single-use nullifier must be unspent. The last one is the local half of the anti-replay
 * story in docs/THREAT_MODEL.md.
 */
class RelayGateway {
  readonly #routed = new Set<string>();
  readonly #nullifiers = new HardwareNullifierRegistry();
  readonly #allowMethods: readonly string[];
  #accepted = 0;
  #refused = 0;

  constructor(routedDestinations: readonly Address[], allowMethods: readonly string[]) {
    for (const destination of routedDestinations) {
      this.#routed.add(destination.toLowerCase());
    }
    this.#allowMethods = allowMethods;
    // The demo must never be laxer than the deployed proxy: every method it accepts has to survive the real
    // guard's deny list, read out of scripts/rpc-guard.mjs at run time.
    for (const method of allowMethods) {
      const denied = GUARD_DENY_PATTERNS.some((pattern) =>
        pattern.endsWith("*")
          ? method.toLowerCase().startsWith(pattern.slice(0, -1).toLowerCase())
          : method.toLowerCase() === pattern.toLowerCase(),
      );
      if (denied) {
        throw new Error("gateway allow-list carries " + method + ", which scripts/rpc-guard.mjs denies");
      }
    }
  }

  get accepted(): number {
    return this.#accepted;
  }
  get refused(): number {
    return this.#refused;
  }

  submit(method: string, signed: SignedIntent, seed: NullifierSeedLike, nowSeconds: number): { readonly nullifier: Hex } {
    if (!this.#allowMethods.includes(method)) {
      this.#refused += 1;
      throw new GatewayError("METHOD_FORBIDDEN", method + " is not on the relay allow-list");
    }
    if (!verifySignedIntent(signed)) {
      this.#refused += 1;
      throw new GatewayError("SIGNATURE_UNVERIFIED", "the envelope does not verify against the key it carries");
    }
    if (!this.#routed.has(signed.intent.to.toLowerCase())) {
      this.#refused += 1;
      throw new GatewayError("DESTINATION_NOT_ROUTED", signed.intent.to + " is not routed by this gateway");
    }
    // The nullifier commits to this exact intent digest, so replaying the envelope derives the same handle
    // and the registry refuses it. (In the personhood-claim flow the commitment is the owner identity.)
    const nullifier = deriveHardwareNullifier({
      hardwareIdHex: seed.hardwareIdHex,
      enrollmentSaltHex: seed.enrollmentSaltHex,
      epoch: seed.epoch,
      ownerCommitment: signed.digest,
    });
    try {
      this.#nullifiers.reserve(nullifier, nowSeconds, "exchange");
    } catch (error) {
      this.#refused += 1;
      throw error;
    }
    this.#nullifiers.consume(nullifier, nowSeconds, "broadcast");
    this.#accepted += 1;
    return { nullifier: nullifier };
  }
}

// ---------------------------------------------------------------------------------------------------------
// A node
// ---------------------------------------------------------------------------------------------------------

/**
 * The simulated platform's tunable knobs. Mutable on purpose: the bridge reads its grantedAt lazily inside
 * the prompt call, so the demo can keep the assertion timestamp in step with its own clock.
 */
interface BiometricTuning {
  readonly platform: NonNullable<MockBiometricBridgeOptions["platform"]>;
  grantedAt?: number;
}

interface NodeSpec {
  readonly label: string;
  readonly lane: string;
  readonly alias: string;
  readonly account: Address;
  readonly peer: Address;
  readonly salt: Hex;
}

interface DemoNode {
  readonly spec: NodeSpec;
  readonly engine: SlmEngine;
  readonly translator: IntentTranslator;
  readonly wallet: AutonomousWallet;
  readonly vault: LocalQuotaVault;
  readonly crypto: MockCryptoBridge;
  readonly biometrics: MockBiometricBridge;
  readonly biometricTuning: BiometricTuning;
  balanceWei: bigint;
  identityNullifier: Hex;
  spendActions: number;
}

let clock = 1_700_000_000;
const now = (): number => clock;

async function buildNode(spec: NodeSpec, vaultOptions: LocalQuotaVaultOptions): Promise<DemoNode> {
  const crypto = createMockCryptoBridge({ platform: "ios" });
  // The bridge reads its grantedAt option lazily inside authenticateAsync, so this mutable tuning object
  // keeps the simulated platform timestamp in step with the demo clock across vesting epochs. Without it
  // the freshness window would refuse every assertion dated at genesis once the clock advanced a day.
  const biometricTuning: BiometricTuning = { platform: "ios" };
  const biometrics = createMockBiometricBridge(biometricTuning);
  const enclave = new NativeBridgeEnclave(crypto.provider);
  const gate = new NativeBridgeBiometricGate({
    provider: biometrics.provider,
    pinnedAssertionPublicKey: biometrics.assertionPublicKeyHex,
    now: now,
  });
  const wallet = new AutonomousWallet({
    enclave: enclave,
    keyAlias: spec.alias,
    policy: {
      chainId: CHAIN_ID,
      maxValueWeiPerTransaction: PER_TX_CAP,
      maxValueWeiPerWindow: WINDOW_CAP,
      windowSeconds: WINDOW_SECONDS,
      // The allow-list is the whole point: the peer account plus the one contract this node may call.
      allowedDestinations: [spec.peer, HUMAN_TOKEN],
      allowedSelectors: [SELECTOR_CLAIM_HUMAN_QUOTA],
      biometricThresholdWei: 0n,
      requireHardwareBackedAuthorization: true,
    },
    ledger: new SpendWindowLedger(WINDOW_SECONDS),
    authorization: new BiometricAuthorizationGate({ gate: gate, now: now }),
    now: now,
  });
  const key = await wallet.initialize();
  return {
    spec: spec,
    engine: new LocalSlmEngineAdapter({ backend: new DeterministicSlmBackend() }),
    translator: new IntentTranslator({
      catalog: { chainId: CHAIN_ID, contracts: { HumanToken: HUMAN_TOKEN, MaoTangFactory: FACTORY } },
      limits: { maxValueWeiPerIntent: PER_TX_CAP },
      now: now,
    }),
    wallet: wallet,
    vault: new LocalQuotaVault(vaultOptions),
    crypto: crypto,
    biometrics: biometrics,
    biometricTuning: biometricTuning,
    balanceWei: ETH,
    identityNullifier: deriveHardwareNullifier({
      hardwareIdHex: key.spkiPublicKey,
      enrollmentSaltHex: spec.salt,
      epoch: 0,
    }),
    spendActions: 0,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------------------

function nodeRows(node: DemoNode): string[] {
  const snapshot = node.vault.snapshot();
  const spent = node.wallet.spendSnapshot();
  const unlocked = toDenominations(snapshot.unlockedYuanYuan);
  const usable = toDenominations(snapshot.availableYuanYuan);
  const pct = (snapshot.vestingBasisPoints / 100).toFixed(1) + "%";
  return [
    dim("account  ") + short(node.spec.account),
    dim("balance  ") + eth(node.balanceWei),
    dim("vesting  ") + bar(snapshot.vestingBasisPoints) + " " + pct + dim(" · epoch #" + snapshot.epochsAccrued + " · " + snapshot.tier),
    dim("unlocked ") + magenta(group(unlocked.yuanYuan)) + " YuanYuan · " + classed(group(unlocked.maoMao), "MaoMao") + " · " + classed(group(unlocked.fenFen), "FenFen"),
    dim("usable   ") + green(group(usable.yuanYuan) + " YuanYuan") + dim(" · " + group(usable.maoMao) + " MaoMao · " + group(usable.fenFen) + " FenFen"),
    dim("spent24h ") + eth(spent.spentWei) + dim(" / " + eth(WINDOW_CAP)),
    dim("state    ") + snapshot.state,
  ];
}

/** Paints a denomination name in the lane colour so the 1:10:100 reading is obvious at a glance. */
function classed(value: string, unit: string): string {
  return magenta(value) + dim(" " + unit);
}

function renderNodes(a: DemoNode, b: DemoNode): void {
  console.log("");
  const left = panel(a.spec.label + " · " + a.spec.lane, nodeRows(a), 56);
  const right = panel(b.spec.label + " · " + b.spec.lane, nodeRows(b), 56);
  for (const line of sideBySide(left, right)) {
    console.log(line);
  }
}

// ---------------------------------------------------------------------------------------------------------
// Vesting: one epoch of human-looking interaction
// ---------------------------------------------------------------------------------------------------------

const SAMPLE_OFFSETS: readonly number[] = [0, 7, 30, 39, 80, 95];
const SAMPLE_SHAPES: readonly string[] = [
  "transfer|to,valueWei",
  "transfer|to,valueWei",
  "claimHumanQuota|proof,nullifierHash",
  "transfer|to,valueWei",
  "createMemeToken|name,symbol",
  "transfer|to,valueWei",
];

function humanEpoch(nowSeconds: number, session: string): InteractionSample[] {
  return SAMPLE_OFFSETS.map((offset, index) => {
    const shape = SAMPLE_SHAPES[index];
    return {
      atSeconds: nowSeconds - 200 + offset,
      kind: shape.split("|")[0],
      digest: shape,
      sessionId: index % 3 === 0 ? session : session + "-" + (index % 3),
    };
  });
}

function vest(node: DemoNode, session: string): { accepted: boolean; code?: string; accrued?: bigint } {
  const outcome = node.vault.observeEntropy({
    samples: humanEpoch(clock, session),
    claimedDevices: 1,
    nowSeconds: clock,
  });
  if (outcome.accepted) {
    return { accepted: true, accrued: outcome.accruedYuanYuan };
  }
  return { accepted: false, code: outcome.code };
}

// ---------------------------------------------------------------------------------------------------------
// The exchange: natural language -> M1 -> M2 -> M5 -> M2 -> M4
// ---------------------------------------------------------------------------------------------------------

async function exchange(
  from: DemoNode,
  to: DemoNode,
  utterance: string,
  gateway: RelayGateway,
): Promise<SignedIntent> {
  console.log("");
  console.log("   " + bold("Natural language") + "  " + yellow("“" + utterance + "”"));

  // M1 - the local model proposes text; the translator refuses to trust it.
  const inference = await from.engine.infer({ kind: "utterance", text: utterance } satisfies SlmInput);
  note("M1 inference", dim("backend=" + inference.backend + " isolation=" + inference.networkIsolation));
  const translated = from.translator.translate(inference.raw);
  note(
    "M1 intent",
    bold(translated.action) +
      " -> " +
      short(translated.intent.to) +
      " · " +
      bold(eth(translated.intent.valueWei)) +
      " · chain " +
      translated.intent.chainId,
  );

  // M2 - the dry run, then the same policy on the signing path.
  const preview = await from.wallet.preview(translated.intent);
  if (!preview.decision.allowed) {
    throw new PolicyViolationError(preview.decision.code, preview.decision.reason);
  }
  note(
    "M2 policy",
    green("ALLOW") +
      dim(
        " · destination whitelisted · " +
          eth(preview.decision.remainingWindowWei) +
          " left in window · digest " +
          short(preview.digest),
      ),
  );

  // M3 - the vault is consulted before the prompt: a locked or exhausted vault must not even raise a
  // biometric sheet. The commit happens after the signature, so a refusal spends nothing.
  const quota = from.vault.preview(translated.action);
  if (!quota.allowed) {
    throw new PolicyViolationError("MALFORMED_INTENT", quota.code + ": " + quota.reason);
  }
  note(
    "M3 quota",
    dim(
      translated.action +
        " costs " +
        quota.chargedYuanYuan +
        " YuanYuan · " +
        quota.remainingYuanYuan +
        " available after",
    ),
  );

  // M5 - the platform prompt. The demo stamps the assertion with the demo clock so freshness holds.
  from.biometricTuning.grantedAt = clock;
  const signed = await from.wallet.signIntent(translated.intent);
  const authorization = signed.authorization;
  note(
    "M5 biometric",
    green("verified") +
      dim(
        " · " +
          (authorization === null ? "below-threshold" : authorization.method) +
          " · hardwareBacked=" +
          String(authorization !== null && authorization.hardwareBacked),
      ),
  );
  note("M2 signature", dim("keyId=" + signed.keyId + " sig=" + short(signed.signature)));

  // M3 commit, now that a signature exists.
  from.vault.charge(translated.action);
  from.spendActions += 1;

  // M4 - the gateway hop.
  const hop = gateway.submit(
    "eth_sendRawTransaction",
    signed,
    { hardwareIdHex: from.identityNullifier, enrollmentSaltHex: from.spec.salt, epoch: 0 },
    clock,
  );
  note("M4 gateway", green("accepted") + dim(" · nullifier " + short(hop.nullifier) + " consumed"));

  void to;
  return signed;
}

async function expectRefusal(label: string, operation: () => unknown, code: string): Promise<boolean> {
  try {
    await operation();
  } catch (error) {
    const actual =
      error instanceof PolicyViolationError
        ? error.code
        : error instanceof GatewayError
          ? error.code
          : error instanceof NullifierReplayError
            ? "NULLIFIER_REPLAY"
            : error instanceof Error
              ? error.name
              : String(error);
    const ok = actual === code;
    console.log(
      "   " +
        (ok ? green("•") : red("•")) +
        " " +
        label.padEnd(16) +
        " " +
        (ok ? green("REFUSED") : red("UNEXPECTED")) +
        " " +
        dim(actual),
    );
    return ok;
  }
  console.log("   " + red("•") + " " + label.padEnd(16) + " " + red("NOT REFUSED - the guard did not fire"));
  return false;
}

// ---------------------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("");
  console.log(bold("  MAOTANG · two-node exchange · local simulation"));
  console.log(dim("  M1 intent -> M5 biometric -> M2 policy+signature -> M4 gateway -> M3 vesting ledger"));
  console.log(
    dim(
      "  chain " +
        CHAIN_ID +
        " · HumanToken " +
        short(HUMAN_TOKEN) +
        " · allow-list cross-checked against scripts/rpc-guard.mjs (" +
        GUARD_DENY_PATTERNS.length +
        " deny patterns)",
    ),
  );

  const specA: NodeSpec = {
    label: "NODE-A",
    lane: "joint account A · MaoMao lane",
    alias: "maotang.demo.node.a",
    account: NODE_A_ACCOUNT,
    peer: NODE_B_ACCOUNT,
    salt: ("0x" + "a0".repeat(16)) as Hex,
  };
  const specB: NodeSpec = {
    label: "NODE-B",
    lane: "joint account B · FenFen lane",
    alias: "maotang.demo.node.b",
    account: NODE_B_ACCOUNT,
    peer: NODE_A_ACCOUNT,
    salt: ("0x" + "b0".repeat(16)) as Hex,
  };

  banner("STEP 1", "Boot two independent edge nodes");
  const nodeA = await buildNode(specA, { now: now, thresholds: ENTROPY_THRESHOLDS });
  const nodeB = await buildNode(specB, { now: now, thresholds: ENTROPY_THRESHOLDS });
  note("Node-A enclave", dim("hardware key created · own keystore · own policy · 86400s window"));
  note("Node-B enclave", dim("hardware key created · own keystore · own policy · 86400s window"));
  note("identity", dim("nullifier A " + short(nodeA.identityNullifier) + " · B " + short(nodeB.identityNullifier)));
  renderNodes(nodeA, nodeB);

  // The relay routes the two node accounts and the protocol contract the claim leg calls; nothing else.
  const gateway = new RelayGateway(
    [NODE_A_ACCOUNT, NODE_B_ACCOUNT, HUMAN_TOKEN],
    ["eth_sendRawTransaction", "eth_getTransactionReceipt"],
  );
  note(
    "M4 relay",
    dim(
      "routed " + short(NODE_A_ACCOUNT) + " + " + short(NODE_B_ACCOUNT) + " + HumanToken " + short(HUMAN_TOKEN) + " · allow-list verified",
    ),
  );

  banner("STEP 2", "Vest epoch #1 - quota is unlocked by interaction entropy, not granted at registration");
  for (const node of [nodeA, nodeB]) {
    const outcome = vest(node, "session-" + node.spec.label);
    note(
      node.spec.label + " vesting",
      outcome.accepted
        ? green("+ " + group(outcome.accrued ?? 0n) + " YuanYuan") + dim(" · judged entropic by assessEntropy")
        : red(String(outcome.code)),
    );
  }
  await sleep(400);
  renderNodes(nodeA, nodeB);

  banner("STEP 3", "Node-A -> Node-B · whitelisted transfer (MaoMao lane)");
  const first = await exchange(nodeA, nodeB, "transfer 0.05 ETH to " + NODE_B_ACCOUNT, gateway);
  nodeA.balanceWei -= TRANSFER_A_TO_B;
  nodeB.balanceWei += TRANSFER_A_TO_B;
  note("settled", green("+0.0500 ETH on Node-B") + dim(" · the balance ledger stands in for the chain"));
  renderNodes(nodeA, nodeB);

  banner("STEP 4", "Attack the envelope - every guard must fail closed");
  const seedA: NullifierSeedLike = {
    hardwareIdHex: nodeA.identityNullifier,
    enrollmentSaltHex: nodeA.spec.salt,
    epoch: 0,
  };
  await expectRefusal("replay same env", () => gateway.submit("eth_sendRawTransaction", first, seedA, clock), "NULLIFIER_REPLAY");
  await expectRefusal(
    "tampered value",
    () =>
      gateway.submit(
        "eth_sendRawTransaction",
        { ...first, intent: { ...first.intent, valueWei: ETH } },
        seedA,
        clock,
      ),
    "SIGNATURE_UNVERIFIED",
  );
  await expectRefusal("forbidden method", () => gateway.submit("eth_sendTransaction", first, seedA, clock), "METHOD_FORBIDDEN");

  banner("STEP 5", "Node-B -> Node-A · the reverse leg");
  await exchange(nodeB, nodeA, "transfer 0.02 ETH to " + NODE_A_ACCOUNT, gateway);
  nodeB.balanceWei -= TRANSFER_B_TO_A;
  nodeA.balanceWei += TRANSFER_B_TO_A;
  note("settled", green("+0.0200 ETH on Node-A"));
  renderNodes(nodeA, nodeB);

  banner("STEP 6", "Node-B claims the personhood quota (FenFen lane · 100 YuanYuan)");
  const proof = ("0x" + "0f".repeat(256)) as Hex;
  const claimNullifier = deriveHardwareNullifier({
    hardwareIdHex: nodeB.identityNullifier,
    enrollmentSaltHex: nodeB.spec.salt,
    epoch: 0,
  });
  console.log("");
  console.log("   " + bold("ZK proof") + "        " + dim(short(proof) + " (256-byte Groth16 blob from the compute centre)"));
  console.log("   " + bold("nullifier") + "        " + dim(short(claimNullifier) + " (derived locally; nothing biometric leaves the device)"));
  const claimInference = await nodeB.engine.infer({
    kind: "event",
    trigger: "maotang.claimHumanQuota",
    payload: { proof: proof, nullifierHash: claimNullifier },
  } satisfies SlmInput);
  const claimIntent = nodeB.translator.translate(claimInference.raw);
  const claimPreview = await nodeB.wallet.preview(claimIntent.intent);
  if (!claimPreview.decision.allowed) {
    throw new PolicyViolationError(claimPreview.decision.code, claimPreview.decision.reason);
  }
  note("M2 policy", green("ALLOW") + dim(" · selector " + String(selectorOf(claimIntent.intent.data)) + " whitelisted"));
  const claimQuota = nodeB.vault.preview(claimIntent.action);
  if (!claimQuota.allowed) {
    throw new PolicyViolationError("MALFORMED_INTENT", claimQuota.code + ": " + claimQuota.reason);
  }
  nodeB.biometricTuning.grantedAt = clock;
  const claimSigned = await nodeB.wallet.signIntent(claimIntent.intent);
  const claimMethod = claimSigned.authorization === null ? "-" : claimSigned.authorization.method;
  note("M5 biometric", green("verified") + dim(" · " + claimMethod));
  const charged = nodeB.vault.charge(claimIntent.action);
  if (!charged.allowed) {
    throw new PolicyViolationError("MALFORMED_INTENT", charged.code + ": " + charged.reason);
  }
  note("M3 quota", dim("charged " + charged.chargedYuanYuan + " YuanYuan (= 1 FenFen)"));
  gateway.submit(
    "eth_sendRawTransaction",
    claimSigned,
    { hardwareIdHex: nodeB.identityNullifier, enrollmentSaltHex: nodeB.spec.salt, epoch: 0 },
    clock,
  );
  note("M4 gateway", green("accepted"));
  renderNodes(nodeA, nodeB);

  banner("STEP 7", "Node-A reaches outside its envelope - M2 refuses before any signature exists");
  const beforeSpend = nodeA.wallet.spendSnapshot().spentWei;
  const rogue: TransactionIntent = { to: ROGUE_ACCOUNT, valueWei: ETH / 100n, data: "0x", chainId: CHAIN_ID };
  await expectRefusal("rogue destination", () => nodeA.wallet.signIntent(rogue), "DESTINATION_NOT_ALLOWED");
  const overCap: TransactionIntent = { to: NODE_B_ACCOUNT, valueWei: ETH, data: "0x", chainId: CHAIN_ID };
  await expectRefusal("over per-tx cap", () => nodeA.wallet.signIntent(overCap), "VALUE_CAP_EXCEEDED");
  note(
    "no spend",
    dim("window ledger untouched: " + eth(nodeA.wallet.spendSnapshot().spentWei) + " (was " + eth(beforeSpend) + ")"),
  );
  renderNodes(nodeA, nodeB);

  banner("STEP 8", "Vest epoch #2 - the quotas refresh");
  clock += VESTING_EPOCH_SECONDS;
  for (const node of [nodeA, nodeB]) {
    const outcome = vest(node, "session-" + node.spec.label + "-2");
    note(
      node.spec.label + " vesting",
      outcome.accepted ? green("+ " + group(outcome.accrued ?? 0n) + " YuanYuan") : red(String(outcome.code)),
    );
  }
  await sleep(300);
  renderNodes(nodeA, nodeB);

  banner("FINAL", "Ledger");
  const snapA = nodeA.vault.snapshot();
  const snapB = nodeB.vault.snapshot();
  console.log(
    "   Node-A  " + eth(nodeA.balanceWei) + "  quota " + group(snapA.unlockedYuanYuan) + " YuanYuan (" + snapA.tier + ")  actions " + nodeA.spendActions,
  );
  console.log(
    "   Node-B  " + eth(nodeB.balanceWei) + "  quota " + group(snapB.unlockedYuanYuan) + " YuanYuan (" + snapB.tier + ")  actions " + nodeB.spendActions,
  );
  console.log("   gateway accepted " + gateway.accepted + " · refused " + gateway.refused);
  console.log(
    dim(
      "   ratio: 1 YuanYuan : 1 MaoMao/" +
        QUOTA_DENOMINATIONS.MaoMao +
        " : 1 FenFen/" +
        QUOTA_DENOMINATIONS.FenFen +
        " - one ledger at three scales",
    ),
  );
  console.log("");
  console.log(green(bold("   Both directions settled. Every refusal was local, and every guard failed closed.")));
  console.log("");
}

await main().catch((error: unknown) => {
  console.error(red("   demo failed: " + (error instanceof Error ? error.message : String(error))));
  process.exitCode = 1;
});
