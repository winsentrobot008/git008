/**
 * M2 x M5, wired end to end against the addresses the deployment actually uses.
 *
 * The point of this file is that nothing here is invented: the destinations and chain id come from
 * `frontend/config/contracts.json` (the repo's single source of truth for addresses), the calldata comes
 * from `signer/abi.ts`, and the calldata for `createMemeToken` is compared with the bytes Foundry produced.
 * The biometric adapter sits in the loop as a real collaborator - through `SimulatedBiometricGate`, which is
 * the *only* gate a test may use, and which can never satisfy a policy that demands hardware backing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BiometricAuthorizationGate,
  HardwareNullifierRegistry,
  NullifierReplayError,
  SimulatedBiometricGate,
  deriveHardwareNullifier,
  isCanonicalNullifier,
} from "../bio-auth/index.js";
import {
  SELECTOR_CLAIM_HUMAN_QUOTA,
  SELECTOR_CREATE_MEME_TOKEN,
  encodeClaimHumanQuota,
  encodeCreateMemeToken,
} from "../signer/abi.js";
import { DevEnclave } from "../signer/enclave.js";
import { PolicyViolationError, SpendWindowLedger, type PolicyDenialCode } from "../signer/policy.js";
import { isAddress, type Address, type Hex } from "../signer/types.js";
import { AutonomousWallet, verifySignedIntent, type TransactionIntent } from "../signer/wallet.js";
import { readWorkspaceFile } from "./helpers/repo.js";

interface Manifest {
  readonly network: { readonly chainId: string };
  readonly contracts: { readonly HumanToken: string; readonly MaoTangFactory: string };
}

interface FoundryVectors {
  readonly calldata: { readonly createMemeToken: Hex };
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
const PROOF = `0x${"00112233445566778899aabbccddeeff".repeat(16)}` as Hex;

/** TEST ONLY derivation material, so the expected nullifier is reproducible. */
const TEST_SEED = {
  hardwareIdHex: `0x${"aa".repeat(32)}` as Hex,
  enrollmentSaltHex: `0x${"bb".repeat(32)}` as Hex,
  epoch: 0,
};

async function buildWallet(options: { readonly requireHardwareBackedAuthorization?: boolean } = {}) {
  const gate = new SimulatedBiometricGate({ enabled: true, now: () => NOW });
  await gate.enroll();
  const wallet = new AutonomousWallet({
    enclave: new DevEnclave(),
    keyAlias: "maotang.integration.owner",
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
    authorization: new BiometricAuthorizationGate({ gate, now: () => NOW }),
    now: () => NOW,
  });
  return wallet;
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

test("a HumanToken personhood claim is signed, bound to a one-shot nullifier", async () => {
  const wallet = await buildWallet();
  const registry = new HardwareNullifierRegistry();
  const nullifier = deriveHardwareNullifier(TEST_SEED);
  assert.equal(isCanonicalNullifier(nullifier), true, "the derived nullifier is a legal public input");

  registry.reserve(nullifier, NOW, "integration claim");
  const signed = await wallet.signIntent({
    to: HUMAN_TOKEN,
    valueWei: 0n,
    data: encodeClaimHumanQuota(PROOF, nullifier),
    chainId: CHAIN_ID,
    description: "claimHumanQuota(personhoodProof)",
  });

  assert.equal(verifySignedIntent(signed), true);
  assert.equal(signed.intent.to, HUMAN_TOKEN);
  assert.equal(signed.intent.selector, SELECTOR_CLAIM_HUMAN_QUOTA);
  assert.equal((signed.intent.data.length - 2) / 2, 356, "selector + offset + nullifier + length word + 256-byte proof");
  assert.equal(signed.authorization?.method, "simulated", "the biometric adapter is in the loop because the threshold is 0");

  registry.consume(nullifier, NOW + 12);
  assert.throws(() => registry.reserve(nullifier, NOW + 13), NullifierReplayError, "one owner, one claim");
});

test("a MaoTangFactory launch is signed and its calldata equals the Foundry vector", async () => {
  const wallet = await buildWallet();
  const signed = await wallet.signIntent(intent({ valueWei: ETH }));

  assert.equal(verifySignedIntent(signed), true);
  assert.equal(signed.intent.selector, SELECTOR_CREATE_MEME_TOKEN);
  assert.equal(signed.intent.data, vectors.calldata.createMemeToken, "the launch payload is byte-identical to cast");
  assert.equal(signed.authorization?.hardwareBacked, false, "a simulated gate never claims hardware backing");
  assert.equal(wallet.spendSnapshot().spentWei, ETH, "the launch is recorded against the rolling window");
});

test("a policy that demands hardware backing refuses the simulated channel end to end", async () => {
  const strict = await buildWallet({ requireHardwareBackedAuthorization: true });
  await expectViolation(strict.signIntent(intent()), "AUTHORIZATION_NOT_HARDWARE_BACKED");
  assert.equal(strict.spendSnapshot().spentWei, 0n, "a refused authorization spends nothing");
});

test("the wallet is bound to the deployed chain and refuses another one", async () => {
  const wallet = await buildWallet();
  await expectViolation(wallet.signIntent(intent({ chainId: 1 })), "CHAIN_MISMATCH");
});

test("an address outside the allow-list cannot be reached from this wallet", async () => {
  const wallet = await buildWallet();
  await expectViolation(
    wallet.signIntent(intent({ to: "0x00000000000000000000000000000000000000ff" as Address })),
    "DESTINATION_NOT_ALLOWED",
  );
  await expectViolation(wallet.signIntent(intent({ to: FACTORY, data: "0xdeadbeef" })), "SELECTOR_NOT_ALLOWED");
});
