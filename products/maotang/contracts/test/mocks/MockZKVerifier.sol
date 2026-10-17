// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IZKVerifier} from "../../src/interfaces/IZKVerifier.sol";

/// @dev Test-only {IZKVerifier} double.
/// @notice Accepts any proof whose keccak256 hash equals the claimed nullifier.
/// @dev This is deliberately NOT a zero-knowledge verifier: it exists so the token and registry
/// plumbing (nullifier bookkeeping, replay rejection, agent gating, multi-identity scaling) can be
/// unit-tested without generating a proving key per identity. The real Groth16 pairing check is
/// exercised end to end by `Groth16Verifier.t.sol` and `ZKPersonhoodClaim.t.sol`, which use genuine
/// Circom/SnarkJS artifacts. Never deploy this contract.
contract MockNullifierVerifier is IZKVerifier {
    /// @inheritdoc IZKVerifier
    function verifyProof(bytes calldata proof, bytes32 nullifierHash) external pure returns (bool) {
        return keccak256(proof) == nullifierHash;
    }
}