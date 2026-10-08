/**
 * The guardrails of the one signing path.
 *
 * `AutonomousWallet.signIntent` is the only method that produces a signature, so these tests focus on the
 * two failure modes that would matter: a refusal that still costs a signature or a window budget, and an
 * authorization that is accepted without being bound to the transaction it approved. The stubs below are
 * test-only collaborators - they exist because the *refusing* implementations are the ones that ship.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { SELECTOR_CREATE_MEME_TOKEN, encodeCreateMemeToken } from "../signer/abi.js";
import {
  DevEnclave,
  EnclaveUnavailableError,
  HardwareEnclave,
  createSecureEnclave,
  verifyDigest,
} from "../signer/enclave.js";
import {
  PolicyViolationError,
  SpendWindowLedger,
  type PolicyDenialCode,
  type SpendPolicy,
} from "../signer/policy.js";
import type {
  Address,
  AuthorizationGate,
  AuthorizationGrant,
  AuthorizationMethod,
  AuthorizationRequest,
  Hex,
  SecureEnclave,
} from "../signer/index.js";
import {
  AutonomousWallet,
  INTENT_DIGEST_BYTES,
  type TransactionIntent,
  type WalletLogEvent,
  verifySignedIntent,
} from "../signer/wallet.js";

const CHAIN_ID = 31337;
const FACTORY = "0xa513e6e4b8f2a923d98304ec87f64353c4d5c853" as Address;
const CURVE = "0x9bd03768a7dcc129555de410ff8e85528a4f88b5" as Address;
const STRANGER = "0x00000000000000000000000000000000000000ff" as Address;
const CREATE_SELECTOR = SELECTOR_CREATE_MEME_TOKEN;
const NOW = 1_700_000_000;
const ETH = 10n ** 18n;

/** TEST ONLY: approves every request, optionally lying about the challenge, the key or the hardware backing. */
class AllowAllGate implements AuthorizationGate {
  readonly #options: {
    readonly hardwareBacked?: boolean;
    readonly challenge?: Hex;
    readonly keyId?: string;
    readonly grantedAt?: number;
  };

  constructor(options: { hardwareBacked?: boolean; challenge?: Hex; keyId?: string; grantedAt?: number } = {}) {
    this.#options = options;
  }

  async authorize(request: AuthorizationRequest): Promise<AuthorizationGrant> {
    const hardwareBacked = this.#options.hardwareBacked ?? false;
    const method: AuthorizationMethod = hardwareBacked ? "biometric" : "simulated";
    return {
      method,
      keyId: this.#options.keyId ?? request.keyId,
      challenge: this.#options.challenge ?? request.challenge,
      grantedAt: this.#options.grantedAt ?? NOW,
      hardwareBacked,
      detail: "test-only stub",
    };
  }
}

/** TEST ONLY: the human said no. The signature must not be produced and the ledger must stay untouched. */
class RefusingGate implements AuthorizationGate {
  async authorize(): Promise<AuthorizationGrant> {
    throw new Error("the human cancelled the authorization prompt");
  }
}

interface Harness {
  readonly wallet: AutonomousWallet;
  readonly enclave: SecureEnclave;
  readonly ledger: SpendWindowLedger;
  readonly logs: WalletLogEvent[];
}

function harness(
  options: {
    readonly gate?: AuthorizationGate;
    readonly enclave?: SecureEnclave;
    readonly policy?: Partial<SpendPolicy>;
    readonly now?: () => number;
  } = {},
): Harness {
  const policy: SpendPolicy = {
    chainId: CHAIN_ID,
    maxValueWeiPerTransaction: 2n * ETH,
    maxValueWeiPerWindow: 5n * ETH,
    windowSeconds: 3600,
    allowedDestinations: [FACTORY],
    allowedSelectors: [CREATE_SELECTOR],
    biometricThresholdWei: ETH / 2n,
    requireHardwareBackedAuthorization: false,
    ...options.policy,
  };
  const ledger = new SpendWindowLedger(policy.windowSeconds);
  const logs: WalletLogEvent[] = [];
  const enclave = options.enclave ?? new DevEnclave();
  const wallet = new AutonomousWallet({
    enclave,
    keyAlias: "maotang.test.owner",
    policy,
    ledger,
    authorization: options.gate ?? new AllowAllGate(),
    now: options.now ?? (() => NOW),
    logger: (event) => logs.push(event),
  });
  return { wallet, enclave, ledger, logs };
}

function intent(overrides: Partial<TransactionIntent> = {}): TransactionIntent {
  return {
    to: FACTORY,
    valueWei: 0n,
    data: encodeCreateMemeToken("Mao Tang", "MAOTANG"),
    chainId: CHAIN_ID,
    ...overrides,
  };
}

async function expectViolation(promise: Promise<unknown>, code: PolicyDenialCode): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PolicyViolationError, `expected a PolicyViolationError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

test("a below-threshold call is signed and the signature verifies", async () => {
  const { wallet, logs } = harness();
  const signed = await wallet.signIntent(intent());

  assert.equal(signed.authorization, null, "below the threshold no human authorization is recorded");
  assert.equal(signed.intent.to, FACTORY);
  assert.equal(signed.intent.selector, CREATE_SELECTOR);
  assert.equal((signed.signature.length - 2) / 2, 64, "raw r||s secp256k1 signature");
  assert.equal((signed.digest.length - 2) / 2, INTENT_DIGEST_BYTES);
  assert.ok(signed.spkiPublicKey.startsWith("0x04") || signed.spkiPublicKey.length > 100);
  assert.equal(verifySignedIntent(signed), true);
  assert.equal(verifyDigest(signed.spkiPublicKey, signed.digest, signed.signature), true);
  assert.equal(logs.at(-1)?.event, "wallet.signed");
  assert.equal(logs.at(-1)?.authorized, "below-threshold");
});

test("a call at the threshold demands a human authorization and records it", async () => {
  const { wallet } = harness();
  const signed = await wallet.signIntent(intent({ valueWei: ETH / 2n }));
  assert.notEqual(signed.authorization, null);
  assert.equal(signed.authorization?.challenge, signed.digest);
  assert.equal(signed.authorization?.keyId, signed.keyId);
  assert.equal(verifySignedIntent(signed), true);
});

test("an authorization bound to a different digest is refused", async () => {
  const other = `0x${"11".repeat(32)}` as Hex;
  const { wallet, ledger, logs } = harness({ gate: new AllowAllGate({ challenge: other }) });
  await expectViolation(wallet.signIntent(intent({ valueWei: ETH })), "AUTHORIZATION_CHALLENGE_MISMATCH");
  assert.equal(ledger.spentAt(NOW), 0n, "a refused approval leaves the window untouched");
  assert.equal(logs.filter((line) => line.event === "wallet.signed").length, 0, "no signature was released");
});

test("an authorization from a different key is refused", async () => {
  const { wallet } = harness({ gate: new AllowAllGate({ keyId: "some-other-key" }) });
  await expectViolation(wallet.signIntent(intent({ valueWei: ETH })), "AUTHORIZATION_CHALLENGE_MISMATCH");
});

test("a strict policy refuses a non-hardware-backed authorization", async () => {
  const strict = { requireHardwareBackedAuthorization: true };
  const soft = harness({ gate: new AllowAllGate({ hardwareBacked: false }), policy: strict });
  await expectViolation(soft.wallet.signIntent(intent({ valueWei: ETH })), "AUTHORIZATION_NOT_HARDWARE_BACKED");

  const hard = harness({ gate: new AllowAllGate({ hardwareBacked: true }), policy: strict });
  const signed = await hard.wallet.signIntent(intent({ valueWei: ETH }));
  assert.equal(signed.authorization?.hardwareBacked, true);
  assert.equal(signed.authorization?.method, "biometric");
});

test("a policy denial produces no signature and consumes no window budget", async () => {
  const { wallet, enclave, ledger, logs } = harness();
  await expectViolation(wallet.signIntent(intent({ to: STRANGER })), "DESTINATION_NOT_ALLOWED");
  await expectViolation(wallet.signIntent(intent({ valueWei: 2n * ETH + 1n })), "VALUE_CAP_EXCEEDED");

  assert.equal(ledger.spentAt(NOW), 0n, "a denial must not count against the rolling window");
  assert.deepEqual(await enclave.listKeys(), []);
  const denials = logs.filter((line) => line.event === "wallet.denied");
  assert.equal(denials.length, 2);
  assert.deepEqual(
    denials.map((line) => line.code),
    ["DESTINATION_NOT_ALLOWED", "VALUE_CAP_EXCEEDED"],
  );
});

test("a refused authorization produces no signature and consumes no window budget", async () => {
  const { wallet, ledger } = harness({ gate: new RefusingGate() });
  await assert.rejects(wallet.signIntent(intent({ valueWei: ETH })), /cancelled the authorization prompt/);
  assert.equal(ledger.spentAt(NOW), 0n);
});

test("a signed intent is recorded in the rolling window and cannot exceed it", async () => {
  const { wallet, ledger } = harness();
  await wallet.signIntent(intent({ valueWei: 2n * ETH }));
  assert.equal(ledger.spentAt(NOW), 2n * ETH);

  const second = await wallet.signIntent(intent({ valueWei: 2n * ETH }));
  assert.equal(verifySignedIntent(second), true);
  await expectViolation(wallet.signIntent(intent({ valueWei: 2n * ETH })), "WINDOW_CAP_EXCEEDED");
});

test("preview reports the digest that signIntent would sign and signs nothing", async () => {
  const { wallet, enclave, ledger } = harness();
  const preview = await wallet.preview(intent({ valueWei: ETH }));
  assert.equal(preview.decision.allowed, true);
  assert.deepEqual(await enclave.listKeys(), [], "a preview creates no key");
  assert.equal(ledger.spentAt(NOW), 0n, "a preview spends nothing");

  const signed = await wallet.signIntent(intent({ valueWei: ETH }));
  assert.equal(preview.digest, signed.digest, "the approved digest is the signed digest");
});

test("the digest covers every field, and address casing is normalized first", async () => {
  const { wallet } = harness();
  const base = await wallet.preview(intent());
  const upper = await wallet.preview(intent({ to: FACTORY.toUpperCase() as Address }));
  assert.equal(upper.digest, base.digest, "the same transaction has one digest regardless of input casing");
  assert.equal(upper.intent.to, FACTORY, "and the intent is canonicalized to lowercase");

  const otherTo = await wallet.preview(intent({ to: CURVE }));
  const otherValue = await wallet.preview(intent({ valueWei: 1n }));
  const otherData = await wallet.preview(intent({ data: "0x" }));
  const otherChain = await wallet.preview(intent({ chainId: 1 }));
  for (const [label, preview] of [["to", otherTo], ["value", otherValue], ["data", otherData], ["chainId", otherChain]] as const) {
    assert.notEqual(preview.digest, base.digest, `changing ${label} must change the digest`);
  }
});

test("a tampered signed intent no longer verifies", async () => {
  const { wallet } = harness();
  const signed = await wallet.signIntent(intent({ valueWei: 1n }));
  assert.equal(verifySignedIntent(signed), true);

  assert.equal(verifySignedIntent({ ...signed, intent: { ...signed.intent, valueWei: 2n } }), false);
  assert.equal(verifySignedIntent({ ...signed, intent: { ...signed.intent, to: CURVE } }), false);
  assert.equal(verifySignedIntent({ ...signed, digest: `0x${"11".repeat(32)}` as Hex }), false);

  const lastNibble = signed.signature.slice(-1);
  const tamperedSignature = `${signed.signature.slice(0, -1)}${lastNibble === "0" ? "1" : "0"}` as Hex;
  assert.equal(verifySignedIntent({ ...signed, signature: tamperedSignature }), false);
});

test("initialize is idempotent and reuses the enclave key", async () => {
  const { wallet, enclave } = harness();
  const first = await wallet.initialize();
  const second = await wallet.initialize();
  assert.equal(first.keyId, second.keyId);
  assert.deepEqual(await enclave.listKeys(), ["maotang.test.owner"]);
  const attestation = await wallet.attest();
  assert.equal(attestation.hardwareBacked, false, "the dev enclave must never claim hardware backing");
});

test("the default enclave refuses to sign instead of falling back to software", async () => {
  const { wallet } = harness({ enclave: new HardwareEnclave() });
  await assert.rejects(wallet.signIntent(intent()), EnclaveUnavailableError);
  assert.equal(createSecureEnclave().mode, "hardware");
  assert.ok(createSecureEnclave({ mode: "dev" }) instanceof DevEnclave);
  assert.throws(() => createSecureEnclave({ mode: "dev", nodeEnv: "production" }), EnclaveUnavailableError);
  assert.ok(createSecureEnclave({ mode: "dev", nodeEnv: "production", allowDevInProduction: true }) instanceof DevEnclave);
});
