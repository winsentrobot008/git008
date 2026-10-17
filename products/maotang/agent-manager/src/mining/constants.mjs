/**
 * Shared mining constants: the off-chain twin of `contracts/src/MaoTangMining.sol`.
 *
 * Anything that exists on both sides (proof-type tags, reward rates, proximity band, emission cap)
 * is declared once here and asserted equal to the Solidity source by `test/mining_e2e.py`, so the
 * worker and the contract can never silently drift apart.
 *
 * Amounts are BigInt micro-units, exactly like the chain. $mHUMAN has 6 decimals, so
 * `1_000_000n * 10n ** 6n` is one whole HUMAN in micro-HUMAN.
 */

/** ASCII "maotang.mining.ble-ping.v1", right-padded with zeros to 32 bytes. */
export const PROOF_TYPE_BLE_PING = "0x6d616f74616e672e6d696e696e672e626c652d70696e672e7631000000000000";

/** ASCII "maotang.mining.zk-compute.v1", right-padded with zeros to 32 bytes. */
export const PROOF_TYPE_ZK_COMPUTE = "0x6d616f74616e672e6d696e696e672e7a6b2d636f6d707574652e763100000000";

export const ASCII_PROOF_TAG_BLE_PING = "maotang.mining.ble-ping.v1";
export const ASCII_PROOF_TAG_ZK_COMPUTE = "maotang.mining.zk-compute.v1";

/** Fixed ABI payload width: 6 words. */
export const PROOF_DATA_BYTES = 6 * 32;

/** Micro-HUMAN micro-units paid per accepted proof unit. */
export const BLE_REWARD_PER_PING = 1_000n * 10n ** 6n;
export const COMPUTE_REWARD_PER_TASK = 5_000n * 10n ** 6n;

/** Batch bounds. */
export const MAX_BLE_PINGS_PER_PROOF = 64;
export const MAX_COMPUTE_TASKS_PER_PROOF = 64;
export const MIN_COMPUTE_UNITS = 1_000;

/** Physical proximity band, in dBm. */
export const MIN_BLE_RSSI = -100;
export const MAX_BLE_RSSI = -20;

/** A proof's newest observation must be no older than this. */
export const MAX_PROOF_AGE_MS = 15 * 60 * 1000;

/** Emission epoch and its hard cap (one human quota per epoch). */
export const EPOCH_MS = 24 * 60 * 60 * 1000;
export const MAX_EPOCH_REWARD = 1_000_000n * 10n ** 6n;

/** One human quota, in micro-units. */
export const MICRO_UNITS_PER_HUMAN = 1_000_000n * 10n ** 6n;

/**
 * Ethereum function selectors, hardcoded because no keccak256 is available to the standard
 * library. `FUNCTION_SIGNATURES` documents the preimage of each one, and `test/mining_e2e.py`
 * recomputes every selector from its signature with a vector-checked keccak256 and fails if this
 * table ever diverges.
 */
export const SELECTORS = Object.freeze({
  submitMiningProof: "0x784ea2b7",
  claimMiningRewards: "0x9a983025",
  fundRewardVault: "0xa946706b",
  rewardVaultBalance: "0x1ca09961",
});

export const FUNCTION_SIGNATURES = Object.freeze({
  submitMiningProof: "submitMiningProof(bytes32,bytes)",
  claimMiningRewards: "claimMiningRewards()",
  fundRewardVault: "fundRewardVault(uint256)",
  rewardVaultBalance: "rewardVaultBalance()",
});

export const PROOF_TYPE_TAGS = Object.freeze([
  { name: "BLE_PING", proofType: PROOF_TYPE_BLE_PING, ascii: ASCII_PROOF_TAG_BLE_PING },
  { name: "ZK_COMPUTE", proofType: PROOF_TYPE_ZK_COMPUTE, ascii: ASCII_PROOF_TAG_ZK_COMPUTE },
]);

/** Encodes an ASCII tag into a right-zero-padded bytes32 hex string (no hashing involved). */
export function proofTypeFromAscii(tag) {
  const bytes = Buffer.from(String(tag), "utf8");
  if (bytes.length === 0 || bytes.length > 32) {
    throw new RangeError(`proof-type tag must be 1..32 bytes, received ${bytes.length}`);
  }
  return `0x${Buffer.concat([bytes, Buffer.alloc(32 - bytes.length)]).toString("hex")}`;
}

/** `bytes32` proof type -> the ASCII tag it encodes, or null if it is not an ASCII tag. */
export function asciiFromProofType(proofType) {
  const hex = String(proofType ?? "").replace(/^0x/, "").toLowerCase();
  if (hex.length !== 64 || !/^[0-9a-f]+$/.test(hex)) return null;
  const bytes = Buffer.from(hex, "hex");
  const end = bytes.indexOf(0);
  const ascii = bytes.subarray(0, end === -1 ? bytes.length : end);
  if (ascii.length === 0 || !/^[\x20-\x7e]+$/.test(ascii.toString("latin1"))) return null;
  return ascii.toString("utf8");
}

/** Reward, in micro-units, that `units` proof units earn before the per-epoch cap. */
export function rewardFor(proofType, units) {
  const count = toBigInt(units);
  if (count < 0n) throw new RangeError("units cannot be negative");
  if (proofType === PROOF_TYPE_BLE_PING) return BLE_REWARD_PER_PING * count;
  if (proofType === PROOF_TYPE_ZK_COMPUTE) return COMPUTE_REWARD_PER_TASK * count;
  throw new RangeError(`unknown proof type ${proofType}`);
}

export function isKnownProofType(proofType) {
  return proofType === PROOF_TYPE_BLE_PING || proofType === PROOF_TYPE_ZK_COMPUTE;
}

/** Accepts a BigInt, a safe integer or a decimal string (JSON has no BigInt). */
export function toBigInt(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError(`not a safe integer: ${value}`);
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  throw new TypeError(`not an integer: ${String(value)}`);
}