/**
 * The ABI encoder is checked against bytes produced by Foundry, not against itself.
 *
 * `test/fixtures/foundry-vectors.json` holds the exact output of the `cast` commands recorded in it, so a
 * change to `signer/abi.ts` that reorders a head, forgets a padding word or miscomputes a dynamic offset
 * fails here instead of producing calldata the deployed contracts would decode as a different call.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { SCALAR_FIELD } from "../shared/bn254.js";
import {
  AbiEncodingError,
  SELECTOR_CLAIM_HUMAN_QUOTA,
  SELECTOR_CREATE_MEME_TOKEN,
  SELECTOR_REGISTER_AGENT,
  encodeClaimHumanQuota,
  encodeCreateMemeToken,
  encodeRegisterAgent,
  encodeUintWord,
  selectorOfCalldata,
  utf8Body,
} from "../signer/abi.js";
import type { Hex } from "../signer/types.js";
import { readWorkspaceFile } from "./helpers/repo.js";

interface FoundryVectors {
  readonly generatedBy: string;
  readonly selectors: {
    readonly claimHumanQuota: string;
    readonly createMemeToken: string;
    readonly registerAgent: string;
  };
  readonly inputs: {
    readonly proof256: Hex;
    readonly nullifier: Hex;
    readonly agentPubKey: Hex;
    readonly hardwareProof: Hex;
    readonly memeName: string;
    readonly memeSymbol: string;
    readonly paddedMemeName: string;
    readonly multiWordMemeName: string;
  };
  readonly calldata: {
    readonly createMemeToken: Hex;
    readonly createMemeTokenPadded: Hex;
    readonly createMemeTokenMultiWord: Hex;
    readonly claimHumanQuota: Hex;
    readonly registerAgent: Hex;
  };
}

const vectors = JSON.parse(
  readWorkspaceFile("mobile-agent", "test", "fixtures", "foundry-vectors.json"),
) as FoundryVectors;

function byteLength(hex: string): number {
  return (hex.length - 2) / 2;
}

test("the selector constants are the ones Foundry derives from the signatures", () => {
  assert.equal(SELECTOR_CLAIM_HUMAN_QUOTA, vectors.selectors.claimHumanQuota);
  assert.equal(SELECTOR_CREATE_MEME_TOKEN, vectors.selectors.createMemeToken);
  assert.equal(SELECTOR_REGISTER_AGENT, vectors.selectors.registerAgent);
  assert.equal(SELECTOR_CLAIM_HUMAN_QUOTA, "0x3e958aad");
  assert.equal(SELECTOR_CREATE_MEME_TOKEN, "0x5cc3c5b2");
  assert.equal(SELECTOR_REGISTER_AGENT, "0x8876f277");
});

test("createMemeToken calldata matches cast byte for byte", () => {
  const encoded = encodeCreateMemeToken(vectors.inputs.memeName, vectors.inputs.memeSymbol);
  assert.equal(encoded, vectors.calldata.createMemeToken);
  assert.equal(byteLength(encoded), 4 + 32 + 32 + (32 + 32) + (32 + 32), "selector + offset head + two length-word-plus-word tails");
});

test("createMemeToken pads a name that fills part of a word exactly as cast does", () => {
  const encoded = encodeCreateMemeToken(vectors.inputs.paddedMemeName, vectors.inputs.memeSymbol);
  assert.equal(encoded, vectors.calldata.createMemeTokenPadded);
  assert.equal(byteLength(encoded), 196, "a 20-byte name still fits in one padded word");
});

test("createMemeToken pads a name longer than one word exactly as cast does", () => {
  const encoded = encodeCreateMemeToken(vectors.inputs.multiWordMemeName, vectors.inputs.memeSymbol);
  assert.equal(encoded, vectors.calldata.createMemeTokenMultiWord);
  assert.equal(byteLength(encoded), 4 + 32 + 32 + (32 + 64) + (32 + 32), "a 41-byte name occupies two words");
});

test("claimHumanQuota calldata matches cast byte for byte", () => {
  const encoded = encodeClaimHumanQuota(vectors.inputs.proof256, vectors.inputs.nullifier);
  assert.equal(encoded, vectors.calldata.claimHumanQuota);
  assert.equal(byteLength(encoded), 4 + 32 + 32 + 32 + 256, "selector + offset + nullifier + length word + proof");
});

test("registerAgent calldata matches cast byte for byte", () => {
  const encoded = encodeRegisterAgent(vectors.inputs.agentPubKey, vectors.inputs.hardwareProof, vectors.inputs.nullifier);
  assert.equal(encoded, vectors.calldata.registerAgent);
  assert.equal(byteLength(encoded), 4 + 32 + 32 + 32 + 32 + 32);
});

test("claimHumanQuota refuses a proof that is not the 256-byte Groth16 blob", () => {
  assert.throws(() => encodeClaimHumanQuota("0x1122", vectors.inputs.nullifier), AbiEncodingError);
  assert.throws(
    () => encodeClaimHumanQuota(`0x${"00".repeat(255)}` as Hex, vectors.inputs.nullifier),
    AbiEncodingError,
  );
  assert.throws(() => encodeClaimHumanQuota("0x" as Hex, vectors.inputs.nullifier), AbiEncodingError);
});

test("claimHumanQuota refuses a nullifier the verifier would reject", () => {
  const zero = `0x${"0".repeat(64)}` as Hex;
  const modulus = `0x${SCALAR_FIELD.toString(16).padStart(64, "0")}` as Hex;
  const above = `0x${(SCALAR_FIELD + 1n).toString(16).padStart(64, "0")}` as Hex;
  assert.throws(() => encodeClaimHumanQuota(vectors.inputs.proof256, zero), AbiEncodingError);
  assert.throws(() => encodeClaimHumanQuota(vectors.inputs.proof256, modulus), AbiEncodingError);
  assert.throws(() => encodeClaimHumanQuota(vectors.inputs.proof256, above), AbiEncodingError);
  assert.throws(() => encodeClaimHumanQuota(vectors.inputs.proof256, "0xabc" as Hex), AbiEncodingError);
  // The largest legal scalar still encodes, so the refusal above is a range check and not a blanket one.
  assert.ok(
    encodeClaimHumanQuota(vectors.inputs.proof256, `0x${(SCALAR_FIELD - 1n).toString(16).padStart(64, "0")}` as Hex)
      .startsWith(SELECTOR_CLAIM_HUMAN_QUOTA),
  );
});

test("createMemeToken refuses arguments Solidity would decode as something else", () => {
  assert.throws(() => encodeCreateMemeToken("", "MAOTANG"), AbiEncodingError);
  assert.throws(() => encodeCreateMemeToken("Mao Tang", ""), AbiEncodingError);
  assert.throws(() => encodeCreateMemeToken("Mao\0Tang", "MAOTANG"), AbiEncodingError);
  assert.throws(() => encodeCreateMemeToken("Mao Tang", "MAO\0TANG"), AbiEncodingError);
});

test("utf8Body encodes multibyte characters by their UTF-8 bytes", () => {
  assert.equal(utf8Body("Mao Tang"), "4d616f2054616e67");
  assert.equal(utf8Body("猫糖"), "e78cabe7b396");
  assert.throws(() => utf8Body(""), AbiEncodingError);
});

test("encodeUintWord bounds the uint256 range", () => {
  assert.equal(encodeUintWord(0n), "0".repeat(64));
  assert.equal(encodeUintWord(64n), `${"0".repeat(62)}40`);
  assert.throws(() => encodeUintWord(-1n), AbiEncodingError);
  assert.throws(() => encodeUintWord(1n << 256n), AbiEncodingError);
});

test("selectorOfCalldata reads the prefix and refuses a truncated blob", () => {
  assert.equal(selectorOfCalldata("0x" as Hex), null);
  assert.equal(selectorOfCalldata("0x12345678" as Hex), "0x12345678");
  assert.equal(
    selectorOfCalldata(vectors.calldata.createMemeToken),
    SELECTOR_CREATE_MEME_TOKEN,
  );
  assert.throws(() => selectorOfCalldata("0x1234" as Hex), AbiEncodingError);
});
