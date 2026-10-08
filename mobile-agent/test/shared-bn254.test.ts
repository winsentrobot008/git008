/**
 * Cross-language drift guard for the BN254 constants.
 *
 * The TypeScript mirror in `shared/bn254.ts` and the Solidity constants in
 * `contracts/src/Groth16Verifier.sol` are two copies of the same numbers, and a silent divergence would be
 * invisible: an out-of-range nullifier does not revert in the verifier, it just makes the proof verify
 * `false`, so an off-by-one in the scalar field would look like "personhood proofs stopped working" rather
 * than like a constant bug. This test parses the Solidity source instead of trusting either copy.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FIELD_MODULUS,
  GROTH16_PROOF_BYTES,
  SCALAR_FIELD,
  WORD_BYTES,
  isCanonicalScalar,
  wordToBigInt,
} from "../shared/bn254.js";
import { readWorkspaceFile } from "./helpers/repo.js";

const SOLIDITY_SOURCE = readWorkspaceFile("contracts", "src", "Groth16Verifier.sol");

/** Reads `uint256 public constant NAME = <digits>;` out of the verifier source. */
function solidityUintConstant(name: string): bigint {
  const match = new RegExp(`${name}\\s*=\\s*([0-9]+)\\s*;`).exec(SOLIDITY_SOURCE);
  assert.ok(match, `constant ${name} was not found in contracts/src/Groth16Verifier.sol`);
  return BigInt(match[1]);
}

function word(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

test("the BN254 moduli in TypeScript match the deployed verifier", () => {
  assert.equal(solidityUintConstant("FIELD_MODULUS"), FIELD_MODULUS, "FIELD_MODULUS drifted from Groth16Verifier.sol");
  assert.equal(solidityUintConstant("SCALAR_FIELD"), SCALAR_FIELD, "SCALAR_FIELD drifted from Groth16Verifier.sol");
});

test("the Groth16 proof blob size matches the verifier's PROOF_LIMBS", () => {
  assert.equal(Number(solidityUintConstant("PROOF_LIMBS")) * WORD_BYTES, GROTH16_PROOF_BYTES);
  assert.equal(GROTH16_PROOF_BYTES, 256);
  assert.equal(WORD_BYTES, 32);
});

test("the scalar field is strictly below the base field, as BN254 requires", () => {
  assert.ok(SCALAR_FIELD < FIELD_MODULUS);
});

test("isCanonicalScalar accepts only non-zero scalars strictly below the field", () => {
  assert.equal(isCanonicalScalar(word(1n)), true);
  assert.equal(isCanonicalScalar(word(SCALAR_FIELD - 1n)), true, "field - 1 is the largest legal scalar");
  assert.equal(isCanonicalScalar(word(SCALAR_FIELD)), false, "the modulus itself is out of range");
  assert.equal(isCanonicalScalar(word(SCALAR_FIELD + 1n)), false);
  assert.equal(isCanonicalScalar(word(0n)), false, "HumanToken rejects a zero nullifier with InvalidPersonhoodProof");
  assert.equal(isCanonicalScalar(`0x${"f".repeat(64)}`), false, "2^256-1 is far above the scalar field");
  assert.equal(isCanonicalScalar("0x00"), false, "wrong length");
  assert.equal(isCanonicalScalar("0x"), false);
  assert.equal(isCanonicalScalar("not hex"), false);
  assert.equal(isCanonicalScalar(`0x${"0".repeat(63)}1`), true, "any 32-byte word below the field is legal");
});

test("isCanonicalScalar insists on a full 32-byte word even when the value is small", () => {
  assert.equal(isCanonicalScalar("0x1"), false, "a short word would be left-padded differently on chain");
});

test("wordToBigInt round-trips a 32-byte word and rejects anything else", () => {
  assert.equal(wordToBigInt(word(0xdeadbeefn)), 0xdeadbeefn);
  assert.equal(wordToBigInt(word(0n)), 0n);
  assert.throws(() => wordToBigInt("0x1234"), RangeError);
  assert.throws(() => wordToBigInt(`0x${"z".repeat(64)}`), RangeError);
});
