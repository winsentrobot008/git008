// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IZKVerifier
/// @notice Verification surface for the protocol's zero-knowledge nullifier proofs.
/// @dev Both personhood ($mHUMAN quota claims) and hardware attestation (AI agent registration) are
/// expressed as one public nullifier plus a proof that the caller knows a private witness binding
/// that nullifier. Consumers must treat `nullifierHash` as a single-use handle: verify, then record
/// it as consumed, before granting the capability.
interface IZKVerifier {
    /// @notice Verifies that `proof` binds the private witness to `nullifierHash`.
    /// @param proof ABI-encoded Groth16 proof: `abi.encode(uint256[8])` in SnarkJS limb order
    /// `[a.x, a.y, b.x.c0, b.x.c1, b.y.c0, b.y.c1, c.x, c.y]`, i.e. 256 bytes.
    /// @param nullifierHash The single public input; must be a canonical BN254 scalar field element.
    /// @return valid True only when the proof verifies against the configured verification key.
    /// @dev Implementations must fail closed: a malformed proof, an unconfigured key, an unknown
    /// public input or a failed pairing check all return false rather than a success sentinel.
    function verifyProof(bytes calldata proof, bytes32 nullifierHash) external view returns (bool valid);
}