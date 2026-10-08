/**
 * BN254 (alt_bn128) field constants, mirrored from `contracts/src/Groth16Verifier.sol`.
 *
 * They live in `shared/` rather than in either module because both need them: M2 validates that the
 * `bytes32 nullifierHash` it is about to sign over is a canonical scalar (otherwise `claimHumanQuota`
 * reverts on the range check), and M5 lays out a Groth16-shaped proof for the same curve.
 *
 * `test/shared-bn254.test.ts` parses the Solidity source and asserts the numbers match, so these two
 * copies cannot drift the way `agent-manager/test/mining_e2e.py` prevents for the mining constants.
 */

/** Base field modulus (Fp) of BN254, used by the verifier to range-check proof points. */
export const FIELD_MODULUS = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

/** Scalar field modulus (Fr) of BN254; every scalar, including the public input, must be below it. */
export const SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Bytes in one ABI word. */
export const WORD_BYTES = 32;

/** Bytes in a BN254 G1 point in uncompressed form. */
export const G1_BYTES = 64;

/** Bytes in a BN254 G2 point in the EIP-197 wire order. */
export const G2_BYTES = 128;

/** Bytes of an 8-word Groth16 proof exactly as `IZKVerifier` expects it (`abi.encode(uint256[8])`). */
export const GROTH16_PROOF_BYTES = 8 * WORD_BYTES;

/** Parses a 32-byte `0x` hex string as an unsigned integer. Throws on anything that is not 32 bytes. */
export function wordToBigInt(value: string): bigint {
  const body = value.startsWith("0x") ? value.slice(2) : value;
  if (body.length !== 64 || !/^[0-9a-fA-F]+$/.test(body)) {
    throw new RangeError(`expected a 32-byte hex word, got ${value}`);
  }
  return BigInt(`0x${body}`);
}

/**
 * True when `value` is strictly below the scalar field modulus.
 *
 * The deployed verifier returns false (never reverts) for a non-canonical public input, so building
 * calldata with an out-of-range nullifier produces a transaction that is guaranteed to fail. Checking
 * it locally turns a wasted broadcast into an immediate refusal.
 */
export function isCanonicalScalar(value: string): boolean {
  try {
    const parsed = wordToBigInt(value);
    return parsed > 0n && parsed < SCALAR_FIELD;
  } catch {
    return false;
  }
}
