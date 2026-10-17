/**
 * Minimal ABI encoder for the two deployed entry points the mobile agent calls.
 *
 * Deliberately tiny, exactly like `agent-manager/src/mining/abi.mjs`: the wallet needs to build
 * calldata for `HumanToken.claimHumanQuota` and `MaoTangFactory.createMemeToken`, not a general ABI
 * codec. Function selectors are constants (documented with their signatures) because a runtime
 * keccak256 is not in the Node standard library - the same constraint `telemetry.ts` documents.
 *
 * Selectors and the encoders below were verified against Foundry on 2026-10-08:
 *
 *   cast sig    "claimHumanQuota(bytes,bytes32)"     -> 0x3e958aad
 *   cast sig    "createMemeToken(string,string)"     -> 0x5cc3c5b2
 *   cast sig    "registerAgent(bytes32,bytes,bytes32)" -> 0x8876f277
 *   cast calldata "createMemeToken(string,string)" "Mao Tang" "MAOTANG"
 *
 * The two calldata vectors are asserted byte-for-byte in `test/signer-abi.test.ts`, so a change here
 * cannot silently produce a payload the contracts would decode differently.
 */

import { GROTH16_PROOF_BYTES, isCanonicalScalar } from "../shared/bn254.js";
import { hexByteLength, type Hex } from "./types.js";

/** `claimHumanQuota(bytes,bytes32)` on `HumanToken`. */
export const SELECTOR_CLAIM_HUMAN_QUOTA: Hex = "0x3e958aad";

/** `createMemeToken(string,string)` on `MaoTangFactory`. */
export const SELECTOR_CREATE_MEME_TOKEN: Hex = "0x5cc3c5b2";

/** `registerAgent(bytes32,bytes,bytes32)` on `AIAgentRegistry`. */
export const SELECTOR_REGISTER_AGENT: Hex = "0x8876f277";

/** Thrown when a value cannot be encoded without producing calldata the contract would reject. */
export class AbiEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbiEncodingError";
  }
}

/** Hex body (no `0x`) of an even-length hex string, validated. */
function bodyOf(value: string, label: string): string {
  let bytes: number;
  try {
    bytes = hexByteLength(value);
  } catch (error) {
    throw new AbiEncodingError(`${label} must be 0x hex: ${(error as Error).message}`);
  }
  if (bytes === 0) {
    throw new AbiEncodingError(`${label} must not be empty`);
  }
  return value.slice(2);
}

/** uint256 -> one 32-byte big-endian word (hex, no `0x`). */
export function encodeUintWord(value: bigint): string {
  if (value < 0n) {
    throw new AbiEncodingError("uint256 cannot be negative");
  }
  if (value > (1n << 256n) - 1n) {
    throw new AbiEncodingError("uint256 overflow");
  }
  return value.toString(16).padStart(64, "0");
}

/** bytes32 -> one 32-byte word (hex, no `0x`). */
export function encodeBytes32Word(value: string): string {
  const body = bodyOf(value, "bytes32");
  if (body.length !== 64) {
    throw new AbiEncodingError(`bytes32 must be exactly 32 bytes, got ${body.length / 2}`);
  }
  return body;
}

/** Pads a hex body with zero bytes up to the next whole ABI word. */
function padToWord(body: string): string {
  const remainder = body.length % 64;
  return remainder === 0 ? body : body + "0".repeat(64 - remainder);
}

/** A dynamic `bytes`/`string` tail: a length word followed by the zero-padded payload. */
export function encodeDynamicTail(body: string): string {
  return encodeUintWord(BigInt(body.length / 2)) + padToWord(body);
}

/** UTF-8 hex body of a Solidity `string` argument. */
export function utf8Body(value: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AbiEncodingError("string argument must be non-empty");
  }
  if (value.includes("\u0000")) {
    throw new AbiEncodingError("string argument must not contain a NUL byte");
  }
  return Buffer.from(value, "utf8").toString("hex");
}

/**
 * `HumanToken.claimHumanQuota(bytes proof, bytes32 nullifierHash)`.
 *
 * The nullifier is checked for scalar-range canonically here because `Groth16Verifier` answers `false`
 * (rather than reverting) for a non-canonical public input: signing such a call would burn gas on a
 * claim that can never succeed.
 */
export function encodeClaimHumanQuota(proof: Hex, nullifierHash: Hex): Hex {
  const proofBody = bodyOf(proof, "proof");
  if (proofBody.length / 2 !== GROTH16_PROOF_BYTES) {
    throw new AbiEncodingError(`proof must be the ${GROTH16_PROOF_BYTES}-byte abi.encode(uint256[8]) Groth16 blob, got ${proofBody.length / 2} bytes`);
  }
  if (!isCanonicalScalar(nullifierHash)) {
    throw new AbiEncodingError("nullifierHash must be a non-zero canonical BN254 scalar (strictly below SCALAR_FIELD)");
  }
  const head = encodeUintWord(64n) + encodeBytes32Word(nullifierHash);
  return `${SELECTOR_CLAIM_HUMAN_QUOTA}${head}${encodeDynamicTail(proofBody)}` as Hex;
}

/** `MaoTangFactory.createMemeToken(string name, string symbol)`. */
export function encodeCreateMemeToken(name: string, symbol: string): Hex {
  const nameTail = encodeDynamicTail(utf8Body(name));
  const symbolTail = encodeDynamicTail(utf8Body(symbol));
  const symbolOffset = 64n + BigInt(nameTail.length / 2);
  const head = encodeUintWord(64n) + encodeUintWord(symbolOffset);
  return `${SELECTOR_CREATE_MEME_TOKEN}${head}${nameTail}${symbolTail}` as Hex;
}

/** `AIAgentRegistry.registerAgent(bytes32 agentPubKey, bytes proof, bytes32 hardwareNullifier)`. */
export function encodeRegisterAgent(agentPubKey: Hex, hardwareProof: Hex, hardwareNullifier: Hex): Hex {
  const proofBody = bodyOf(hardwareProof, "hardwareProof");
  if (!isCanonicalScalar(hardwareNullifier)) {
    throw new AbiEncodingError("hardwareNullifier must be a non-zero canonical BN254 scalar");
  }
  const keyWord = encodeBytes32Word(agentPubKey);
  const proofTail = encodeDynamicTail(proofBody);
  const nullifierWord = encodeBytes32Word(hardwareNullifier);
  const proofOffset = 96n;
  return `${SELECTOR_REGISTER_AGENT}${keyWord}${encodeUintWord(proofOffset)}${nullifierWord}${proofTail}` as Hex;
}

/** Selector of a calldata blob, or `null` when it carries no call data. */
export function selectorOfCalldata(data: Hex): Hex | null {
  if (data === "0x") {
    return null;
  }
  if (data.length < 10) {
    throw new AbiEncodingError(`calldata is shorter than a 4-byte selector: ${data}`);
  }
  return data.slice(0, 10) as Hex;
}
