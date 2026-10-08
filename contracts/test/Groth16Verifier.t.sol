// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Groth16Verifier} from "../src/Groth16Verifier.sol";
import {NullifierFixture} from "./fixtures/NullifierFixture.sol";

/// @dev Exercises the Groth16 pairing check itself against genuine Circom / SnarkJS artifacts:
/// a real proof must verify, and every perturbation of it must not.
contract Groth16VerifierTest is Test {
    Groth16Verifier internal verifier;

    address internal admin = address(0xAD);
    address internal attacker = address(0xB0B);

    function setUp() public {
        verifier = new Groth16Verifier(admin);
    }

    function _installFixtureKey() internal {
        vm.prank(admin);
        verifier.setVerificationKey(NullifierFixture.verificationKey());
    }

    function test_UnconfiguredVerifierFailsClosed() public view {
        assertFalse(verifier.isConfigured());
        assertEq(verifier.verificationKeyHash(), bytes32(0));
        assertFalse(verifier.verifyProof(abi.encode(NullifierFixture.proofA()), NullifierFixture.nullifierA()));
    }

    /// @dev The proof produced by `snarkjs groth16 prove` verifies on chain.
    function test_RealCircomProofsVerify() public {
        _installFixtureKey();

        assertTrue(verifier.isConfigured());
        assertTrue(verifier.verifyProof(abi.encode(NullifierFixture.proofA()), NullifierFixture.nullifierA()));
        assertTrue(verifier.verifyProof(abi.encode(NullifierFixture.proofB()), NullifierFixture.nullifierB()));
    }

    /// @dev A valid proof is only valid for the public input it was generated for.
    function test_ProofIsBoundToItsPublicInput() public {
        _installFixtureKey();

        assertFalse(verifier.verifyProof(abi.encode(NullifierFixture.proofA()), NullifierFixture.nullifierB()));
        assertFalse(verifier.verifyProof(abi.encode(NullifierFixture.proofB()), NullifierFixture.nullifierA()));
    }

    /// @dev Every single-bit change to any proof limb must break the pairing equation.
    function test_TamperedProofsAreRejected() public {
        _installFixtureKey();

        uint256[8] memory honest = NullifierFixture.proofA();
        for (uint256 i = 0; i < 8; i++) {
            uint256[8] memory tampered = honest;
            tampered[i] = tampered[i] ^ 1;
            assertFalse(
                verifier.verifyProof(abi.encode(tampered), NullifierFixture.nullifierA()),
                "a tampered proof limb was accepted"
            );
        }
    }

    function test_MalformedProofLengthIsRejected() public {
        _installFixtureKey();

        bytes memory tooShort = new bytes(255);
        bytes memory tooLong = new bytes(288);

        assertFalse(verifier.verifyProof("", NullifierFixture.nullifierA()));
        assertFalse(verifier.verifyProof(tooShort, NullifierFixture.nullifierA()));
        assertFalse(verifier.verifyProof(tooLong, NullifierFixture.nullifierA()));
        assertFalse(verifier.verifyProof(abi.encode(NullifierFixture.proofA(), uint256(0)), NullifierFixture.nullifierA()));
    }

    /// @dev Non-canonical scalars are rejected so two encodings cannot alias one nullifier.
    function test_NonCanonicalPublicInputIsRejected() public {
        _installFixtureKey();

        uint256 scalarField = verifier.SCALAR_FIELD();
        bytes memory proof = abi.encode(NullifierFixture.proofA());

        assertFalse(verifier.verifyProof(proof, bytes32(scalarField)));
        assertFalse(verifier.verifyProof(proof, bytes32(scalarField + 1)));
        assertFalse(verifier.verifyProof(proof, bytes32(type(uint256).max)));
    }

    /// @dev Coordinates at or above the base field modulus are not valid field elements.
    function test_OutOfRangeProofCoordinateIsRejected() public {
        _installFixtureKey();

        uint256[8] memory honest = NullifierFixture.proofA();
        uint256[8] memory outOfRange = honest;
        outOfRange[0] = verifier.FIELD_MODULUS();

        assertFalse(verifier.verifyProof(abi.encode(outOfRange), NullifierFixture.nullifierA()));
    }

    function test_OnlyOwnerCanInstallOrLockTheKey() public {
        Groth16Verifier.VerificationKey memory key = NullifierFixture.verificationKey();

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Groth16Verifier.NotOwner.selector, attacker));
        verifier.setVerificationKey(key);

        _installFixtureKey();

        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Groth16Verifier.NotOwner.selector, attacker));
        verifier.lockVerificationKey();
    }

    function test_KeyDigestIsDeterministicAndAuditable() public {
        _installFixtureKey();
        bytes32 digest = verifier.verificationKeyHash();
        assertTrue(digest != bytes32(0));

        // Re-installing the same key reproduces the same digest.
        _installFixtureKey();
        assertEq(verifier.verificationKeyHash(), digest);
    }

    function test_LockedKeyCannotBeReplaced() public {
        _installFixtureKey();
        bytes32 digest = verifier.verificationKeyHash();

        vm.prank(admin);
        verifier.lockVerificationKey();
        assertTrue(verifier.verificationKeyLocked());

        Groth16Verifier.VerificationKey memory key = NullifierFixture.verificationKey();
        vm.prank(admin);
        vm.expectRevert(Groth16Verifier.VerificationKeyAlreadyLocked.selector);
        verifier.setVerificationKey(key);

        // The pinned key keeps verifying after the lock.
        assertEq(verifier.verificationKeyHash(), digest);
        assertTrue(verifier.verifyProof(abi.encode(NullifierFixture.proofA()), NullifierFixture.nullifierA()));
    }

    function test_LockingRequiresAnInstalledKey() public {
        vm.prank(admin);
        vm.expectRevert(Groth16Verifier.InvalidVerificationKey.selector);
        verifier.lockVerificationKey();
    }

    function test_WrongArityKeyIsRejected() public {
        Groth16Verifier.VerificationKey memory key = NullifierFixture.verificationKey();
        key.ic = new uint256[2][](2 + 1);
        key.ic[0] = [uint256(1), uint256(2)];
        key.ic[1] = [uint256(1), uint256(2)];
        key.ic[2] = [uint256(1), uint256(2)];

        vm.prank(admin);
        vm.expectRevert(Groth16Verifier.InvalidVerificationKey.selector);
        verifier.setVerificationKey(key);
    }

    function test_OutOfRangeKeyIsRejected() public {
        Groth16Verifier.VerificationKey memory key = NullifierFixture.verificationKey();
        key.alpha1[0] = verifier.FIELD_MODULUS();

        vm.prank(admin);
        vm.expectRevert(Groth16Verifier.InvalidVerificationKey.selector);
        verifier.setVerificationKey(key);
    }

    function test_ConstructorRejectsZeroOwner() public {
        vm.expectRevert(Groth16Verifier.InvalidOwner.selector);
        new Groth16Verifier(address(0));
    }
}