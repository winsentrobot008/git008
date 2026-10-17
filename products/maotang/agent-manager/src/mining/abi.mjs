/**
 * Minimal ABI encoder for the MaoTangMining calldata the background worker needs.
 *
 * This is deliberately tiny: the two mining payloads are fixed 6-word blobs, so there is no need
 * for a general-purpose ABI codec (and therefore no need for keccak256 at runtime - the four
 * selectors are constants in ./constants.mjs, each documented with its signature).
 *
 * Layout of `proofData` (192 bytes, 6 x 32-byte words, big-endian):
 *
 *   BLE_PING   : [pingCount, strongestRssi, windowStart, windowEnd, beaconSetHash, telemetryDigest]
 *   ZK_COMPUTE : [taskCount, computeUnits,   windowStart, windowEnd, taskSetHash,   proofDigest]
 *
 * `windowStart`/`windowEnd` are Unix *seconds* so they can be compared against `block.timestamp`.
 */
import { PROOF_DATA_BYTES, SELECTORS } from "./constants.mjs";

const MAX_UINT256 = (1n << 256n) - 1n;
const INT256_MIN = -(1n << 255n);
const INT256_MAX = (1n << 255n) - 1n;

function asHex(value) {
  return String(value ?? "").replace(/^0x/i, "").toLowerCase();
}

function assertWordHex(value, label) {
  const hex = asHex(value);
  if (hex.length !== 64 || !/^[0-9a-f]+$/.test(hex)) {
    throw new RangeError(`${label} must be a 32-byte hex value`);
  }
  return hex;
}

/** uint256 -> 32-byte big-endian word (hex, no 0x). */
export function encodeUint(value) {
  const n = typeof value === "bigint" ? value : BigInt(value);
  if (n < 0n) throw new RangeError("uint256 cannot be negative");
  if (n > MAX_UINT256) throw new RangeError("uint256 overflow");
  return n.toString(16).padStart(64, "0");
}

/** int256 -> 32-byte two's-complement word (hex, no 0x). */
export function encodeInt(value) {
  const n = typeof value === "bigint" ? value : BigInt(value);
  if (n < INT256_MIN || n > INT256_MAX) throw new RangeError("int256 out of range");
  return (n < 0n ? (1n << 256n) + n : n).toString(16).padStart(64, "0");
}

/** bytes32 -> 32-byte word (hex, no 0x). */
export function encodeBytes32(value) {
  return assertWordHex(value, "bytes32");
}

/** Six words -> the 192-byte payload the contract abi.decode()s. */
function joinWords(words) {
  const payload = `0x${words.join("")}`;
  if (countBytes(payload) !== PROOF_DATA_BYTES) {
    throw new Error(`proof payload must be ${PROOF_DATA_BYTES} bytes`);
  }
  return payload;
}

export function countBytes(hex) {
  const clean = String(hex ?? "").replace(/^0x/i, "");
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(clean)) throw new RangeError("not a hex byte string");
  return clean.length / 2;
}

export function encodeBleBatch(batch) {
  return joinWords([
    encodeUint(batch.pingCount),
    encodeInt(batch.strongestRssi),
    encodeUint(batch.windowStart),
    encodeUint(batch.windowEnd),
    encodeBytes32(batch.beaconSetHash),
    encodeBytes32(batch.telemetryDigest),
  ]);
}

export function encodeComputeBatch(batch) {
  return joinWords([
    encodeUint(batch.taskCount),
    encodeUint(batch.computeUnits),
    encodeUint(batch.windowStart),
    encodeUint(batch.windowEnd),
    encodeBytes32(batch.taskSetHash),
    encodeBytes32(batch.proofDigest),
  ]);
}

/** Decodes a proof payload back into its six words. Used to verify the encoder, never to trust input. */
export function decodeBatch(proofData) {
  const hex = asHex(proofData);
  if (hex.length !== PROOF_DATA_BYTES * 2) {
    throw new RangeError(`expected a ${PROOF_DATA_BYTES}-byte payload, received ${hex.length / 2}`);
  }
  const words = [];
  for (let index = 0; index < 6; index++) {
    words.push(BigInt(`0x${hex.slice(index * 64, index * 64 + 64)}`));
  }
  return words;
}

/** Reinterprets a decoded 32-byte word as a signed int256. */
export function asInt256(word) {
  const value = typeof word === "bigint" ? word : BigInt(word);
  const half = 1n << 255n;
  return value >= half ? value - (1n << 256n) : value;
}

/** Calldata for `submitMiningProof(bytes32 proofType, bytes proofData)`. */
export function encodeSubmitMiningProof(proofType, proofData) {
  const typeWord = assertWordHex(proofType, "proofType");
  const payload = asHex(proofData);
  if (payload.length !== PROOF_DATA_BYTES * 2) {
    throw new RangeError(`proofData must be ${PROOF_DATA_BYTES} bytes`);
  }
  const head = `${typeWord}${encodeUint(BigInt(64))}${encodeUint(BigInt(PROOF_DATA_BYTES))}`;
  return `${SELECTORS.submitMiningProof}${head}${payload}`;
}

/** Calldata for `claimMiningRewards()`. */
export function encodeClaimMiningRewards() {
  return SELECTORS.claimMiningRewards;
}

/** Calldata for `fundRewardVault(uint256 amount)`. */
export function encodeFundRewardVault(amount) {
  return `${SELECTORS.fundRewardVault}${encodeUint(amount)}`;
}

export { encodeUint as encodeWord };