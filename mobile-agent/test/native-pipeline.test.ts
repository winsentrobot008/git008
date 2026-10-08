/**
 * M2 x M5 over the native hardware bridges: the whole guardrail pipeline, with nothing faked but the
 * device itself.
 *
 * `signer-integration.test.ts` wires the dev enclave and the simulated biometric gate. This file wires
 * `NativeBridgeEnclave` and `NativeBridgeBiometricGate` in their place, over simulated native bridges, and
 * asserts that a signature still only appears after the policy, the pinned-key check and the before-release
 * verification have all passed. Addresses come from `frontend/config/contracts.json` and the calldata is
 * compared with the bytes Foundry produced, exactly as the dev-enclave integration test does.
 */

import assert from "node:assert/strict";
import { createHash, sign as signWithKey } from "node:crypto";
import { test } from "node:test";

import { BiometricAuthorizationGate, BiometricDeniedError } from "../bio-auth/index.js";
import {
  createNativeBiometricGate,
  type NativeBiometricAssertion,
  type NativeBiometricProvider,
} from "../bio-auth/native-biometric-gate.js";
import {
  SELECTOR_CLAIM_HUMAN_QUOTA,
  SELECTOR_CREATE_MEME_TOKEN,
  encodeClaimHumanQuota,
  encodeCreateMemeToken,
} from "../signer/abi.js";
import { createNativeEnclave } from "../signer/native-enclave.js";
import { PolicyViolationError, SpendWindowLedger, type PolicyDenialCode } from "../signer/policy.js";
import { isAddress, type Address, type Hex } from "../signer/types.js";
import { AutonomousWallet, verifySignedIntent, type TransactionIntent } from "../signer/wallet.js";
import {
  createMockBiometricBridge,
  createMockCryptoBridge,
  generateMockDeviceKey,
  publicSpkiHex,
  type MockCryptoBridge,
} from "./helpers/bridges.js";
import { readWorkspaceFile } from "./helpers/repo.js";

interface Manifest {
  readonly network: { readonly chainId: string };
  readonly contracts: { readonly HumanToken: string; readonly MaoTangFactory: string };
}

interface FoundryVectors {
  readonly calldata: { readonly createMemeToken: Hex; readonly claimHumanQuota: Hex };
}

/** Addresses and chain id come from the deployment manifest, not from a hard-coded copy. */
const manifest = JSON.parse(readWorkspaceFile("frontend", "config", "contracts.json")) as Manifest;
const vectors = JSON.parse(
  readWorkspaceFile("mobile-agent", "test", "fixtures", "foundry-vectors.json"),
) as FoundryVectors;

const CHAIN_ID = Number(manifest.network.chainId);
const HUMAN_TOKEN = manifest.contracts.HumanToken.toLowerCase() as Address;
const FACTORY = manifest.contracts.MaoTangFactory.toLowerCase() as Address;

const NOW = 1_700_000_000;
const ETH = 10n ** 18n;
const OWNER_ALIAS = "maotang.native.owner";
const STRANGER = "0x00000000000000000000000000000000000000ff" as Address;
const PROOF = `0x${"00112233445566778899aabbccddeeff".repeat(16)}` as Hex;
const NULLIFIER = `0x${"0".repeat(61)}abc` as Hex;

interface Harness {
  readonly wallet: AutonomousWallet;
  readonly device: MockCryptoBridge;
  readonly promptCount: () => number;
}

/**
 * TEST ONLY: a prompt that produces a valid signature over the *wrong* challenge.
 *
 * This is the "captured FaceID tap" the design is built to defeat: the platform really signed, with a real
 * key, but for a different transaction. Nothing about the assertion looks malformed, so only verifying the
 * signature against the challenge the wallet asked about can stop it.
 */
function substituteChallengeProvider(provider: NativeBiometricProvider, otherChallenge: Hex): NativeBiometricProvider {
  const key = generateMockDeviceKey("prime256v1");
  const spki = publicSpkiHex(key);
  return {
    platform: provider.platform,
    isEnrolledAsync: () => provider.isEnrolledAsync(),
    enrollAsync: () => provider.enrollAsync(),
    revokeAsync: () => provider.revokeAsync(),
    async authenticateAsync(): Promise<NativeBiometricAssertion> {
      const digest = createHash("sha256").update(Buffer.from(otherChallenge.slice(2), "hex")).digest();
      const signature = signWithKey(null, digest, { key, dsaEncoding: "der" });
      return {
        signatureHex: `0x${signature.toString("hex")}` as Hex,
        publicKeySpkiHex: spki,
        format: "der",
        payloadMode: "message",
        hardwareBacked: true,
        method: "biometric",
        grantedAt: NOW,
      };
    },
  };
}

function buildWallet(
  options: {
    readonly requireHardwareBackedAuthorization?: boolean;
    readonly biometricProvider?: NativeBiometricProvider;
    readonly pin?: boolean;
  } = {},
): Harness {
  const device = createMockCryptoBridge();
  const biometrics = createMockBiometricBridge();
  const wallet = new AutonomousWallet({
    enclave: createNativeEnclave(device.provider),
    keyAlias: OWNER_ALIAS,
    policy: {
      chainId: CHAIN_ID,
      maxValueWeiPerTransaction: 5n * ETH,
      maxValueWeiPerWindow: 10n * ETH,
      windowSeconds: 3600,
      allowedDestinations: [HUMAN_TOKEN, FACTORY],
      allowedSelectors: [SELECTOR_CLAIM_HUMAN_QUOTA, SELECTOR_CREATE_MEME_TOKEN],
      biometricThresholdWei: 0n,
      requireHardwareBackedAuthorization: options.requireHardwareBackedAuthorization ?? false,
    },
    ledger: new SpendWindowLedger(3600),
    authorization: new BiometricAuthorizationGate({
      gate: createNativeBiometricGate({
        provider: options.biometricProvider ?? biometrics.provider,
        pinnedAssertionPublicKey: options.pin === false ? undefined : biometrics.assertionPublicKeyHex,
        now: () => NOW,
      }),
      now: () => NOW,
    }),
    now: () => NOW,
  });
  return { wallet, device, promptCount: () => biometrics.prompts.length };
}

function intent(overrides: Partial<TransactionIntent> = {}): TransactionIntent {
  return { to: FACTORY, valueWei: 0n, data: encodeCreateMemeToken("Mao Tang", "MAOTANG"), chainId: CHAIN_ID, ...overrides };
}

async function expectViolation(promise: Promise<unknown>, code: PolicyDenialCode): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PolicyViolationError, `expected a PolicyViolationError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

test("the deployment manifest provides usable addresses on a known chain", () => {
  assert.ok(Number.isSafeInteger(CHAIN_ID) && CHAIN_ID > 0, `chainId must be a positive integer, got ${manifest.network.chainId}`);
  assert.ok(isAddress(HUMAN_TOKEN), "HumanToken address must be a 20-byte hex address");
  assert.ok(isAddress(FACTORY), "MaoTangFactory address must be a 20-byte hex address");
});

test("a launch is signed through both native bridges and its calldata equals the Foundry vector", async () => {
  const { wallet, device, promptCount } = buildWallet();
  const signed = await wallet.signIntent(intent({ valueWei: ETH }));

  assert.equal(verifySignedIntent(signed), true, "the raw signature re-verifies from the carried SPKI alone");
  assert.equal((signed.signature.length - 2) / 2, 64);
  assert.equal((signed.digest.length - 2) / 2, 32);
  assert.equal(signed.spkiPublicKey, device.spkiHexFor(OWNER_ALIAS), "the intent names the device key that signed");
  assert.equal(signed.intent.selector, SELECTOR_CREATE_MEME_TOKEN);
  assert.equal(signed.intent.data, vectors.calldata.createMemeToken, "the launch payload is byte-identical to cast");
  assert.equal(signed.authorization?.method, "biometric");
  assert.equal(signed.authorization?.hardwareBacked, true, "the device bridge reports hardware backing");
  assert.equal(signed.authorization?.challenge, signed.digest, "the prompt was bound to the digest that was signed");
  assert.equal(promptCount(), 1, "the value at the threshold (0n) forces exactly one prompt");
  assert.equal(wallet.spendSnapshot().spentWei, ETH, "the launch is recorded against the rolling window");

  const attestation = await wallet.attest();
  assert.equal(attestation.kind, "secure-enclave");
  assert.equal(attestation.hardwareBacked, true);
});

test("a personhood claim is signed through both native bridges and matches the Foundry vector", async () => {
  const { wallet } = buildWallet();
  const signed = await wallet.signIntent({
    to: HUMAN_TOKEN,
    valueWei: 0n,
    data: encodeClaimHumanQuota(PROOF, NULLIFIER),
    chainId: CHAIN_ID,
    description: "claimHumanQuota(personhoodProof)",
  });

  assert.equal(verifySignedIntent(signed), true);
  assert.equal(signed.intent.selector, SELECTOR_CLAIM_HUMAN_QUOTA);
  assert.equal(signed.intent.data, vectors.calldata.claimHumanQuota);
  assert.equal((signed.intent.data.length - 2) / 2, 356, "selector + offset + nullifier + length word + 256-byte proof");
  assert.equal(signed.authorization?.hardwareBacked, true);
});

test("a policy that demands hardware backing is satisfied by the native bridge", async () => {
  const { wallet } = buildWallet({ requireHardwareBackedAuthorization: true });
  const signed = await wallet.signIntent(intent({ valueWei: ETH }));
  assert.equal(signed.authorization?.hardwareBacked, true);
  assert.equal(verifySignedIntent(signed), true);
});

test("an approval the hardware signed over a different challenge cannot release a signature", async () => {
  const biometrics = createMockBiometricBridge();
  const other = `0x${"cd".repeat(32)}` as Hex;
  const { wallet } = buildWallet({ biometricProvider: substituteChallengeProvider(biometrics.provider, other) });

  await assert.rejects(wallet.signIntent(intent({ valueWei: ETH })), BiometricDeniedError);
  assert.equal(wallet.spendSnapshot().spentWei, 0n, "a refused approval spends nothing and consumes no window budget");
});

test("an unpinned native gate still signs, verifying against the key the bridge reports", async () => {
  const { wallet } = buildWallet({ pin: false });
  const signed = await wallet.signIntent(intent({ valueWei: ETH }));
  assert.equal(signed.authorization?.hardwareBacked, true);
  assert.equal(verifySignedIntent(signed), true);
});

test("the policy guardrails still bind the wallet when the native bridges are in place", async () => {
  const { wallet } = buildWallet();
  await expectViolation(wallet.signIntent(intent({ chainId: 1 })), "CHAIN_MISMATCH");
  await expectViolation(wallet.signIntent(intent({ to: STRANGER })), "DESTINATION_NOT_ALLOWED");
  await expectViolation(wallet.signIntent(intent({ data: "0xdeadbeef" })), "SELECTOR_NOT_ALLOWED");
  assert.equal(wallet.spendSnapshot().spentWei, 0n, "a denial never reaches the enclave");
});

test("a tampered signed intent no longer verifies", async () => {
  const { wallet } = buildWallet();
  const signed = await wallet.signIntent(intent({ valueWei: ETH }));
  assert.equal(verifySignedIntent(signed), true);

  assert.equal(verifySignedIntent({ ...signed, intent: { ...signed.intent, valueWei: 2n * ETH } }), false);
  assert.equal(verifySignedIntent({ ...signed, intent: { ...signed.intent, to: STRANGER } }), false);
  assert.equal(verifySignedIntent({ ...signed, signature: `0x${"00".repeat(64)}` as Hex }), false);
});