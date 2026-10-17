// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AIAgentRegistry} from "../src/AIAgentRegistry.sol";
import {MockNullifierVerifier} from "./mocks/MockZKVerifier.sol";

/// @dev Registration is gated by a hardware-attestation proof. This suite stubs {IZKVerifier} so the
/// binding rules (one key, one hardware nullifier, owner-only revocation) can be tested directly; the
/// real Groth16 proof path is covered by `Groth16Verifier.t.sol` and `ZKPersonhoodClaim.t.sol`.
contract AIAgentRegistryTest is Test {
    MockNullifierVerifier internal verifier;
    AIAgentRegistry internal registry;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal ghost = address(0xDEAD);

    bytes32 internal constant ALICE_KEY = keccak256("alice-agent-key");
    bytes32 internal constant BOB_KEY = keccak256("bob-agent-key");

    function setUp() public {
        verifier = new MockNullifierVerifier();
        registry = new AIAgentRegistry(address(verifier));
    }

    /// @dev Builds a (proof, nullifier) pair the stub verifier accepts.
    function _attestation(string memory hardware) internal pure returns (bytes memory proof, bytes32 nullifier) {
        proof = abi.encodePacked(hardware);
        nullifier = keccak256(proof);
    }

    function _register(address human, bytes32 key, string memory hardware) internal returns (address agent) {
        (bytes memory proof, bytes32 nullifier) = _attestation(hardware);
        vm.prank(human);
        agent = registry.registerAgent(key, proof, nullifier);
    }

    function test_RegisterAgentBindsDerivedAddressToHuman() public {
        (bytes memory proof, bytes32 nullifier) = _attestation("alice-hardware");

        vm.prank(alice);
        address agent = registry.registerAgent(ALICE_KEY, proof, nullifier);

        assertEq(agent, registry.agentAddress(ALICE_KEY));
        assertTrue(registry.isAuthorizedAgent(agent));
        assertEq(registry.requireAuthorizedAgent(agent), alice);
        assertEq(registry.agentByKey(ALICE_KEY), agent);
        assertEq(registry.agentRecord(agent).owner, alice);
        assertEq(registry.agentRecord(agent).hardwareNullifier, nullifier);
        assertEq(registry.hardwareBinding(nullifier), agent);
    }

    function test_AgentAddressIsDeterministicAndKeySpecific() public view {
        assertEq(registry.agentAddress(ALICE_KEY), registry.agentAddress(ALICE_KEY));
        assertTrue(registry.agentAddress(ALICE_KEY) != registry.agentAddress(BOB_KEY));
    }

    function test_CannotRegisterTheSameKeyTwice() public {
        _register(alice, ALICE_KEY, "alice-hardware");
        (bytes memory proof, bytes32 nullifier) = _attestation("bob-hardware");
        address expected = registry.agentAddress(ALICE_KEY);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(AIAgentRegistry.AgentAlreadyRegistered.selector, expected));
        registry.registerAgent(ALICE_KEY, proof, nullifier);
    }

    function test_CannotReuseHardwareProof() public {
        _register(alice, ALICE_KEY, "shared-hardware");
        (bytes memory proof, bytes32 nullifier) = _attestation("shared-hardware");

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(AIAgentRegistry.HardwareAlreadyBound.selector, nullifier, registry.agentAddress(ALICE_KEY))
        );
        registry.registerAgent(BOB_KEY, proof, nullifier);
    }

    function test_InvalidInputsAreRejected() public {
        (bytes memory proof,) = _attestation("hw");

        vm.prank(alice);
        vm.expectRevert(AIAgentRegistry.InvalidAgentKey.selector);
        registry.registerAgent(bytes32(0), proof, keccak256(proof));
    }

    function test_EmptyProofIsRejected() public {
        vm.prank(alice);
        vm.expectRevert(AIAgentRegistry.InvalidHardwareProof.selector);
        registry.registerAgent(ALICE_KEY, "", keccak256("whatever"));
    }

    function test_ZeroHardwareNullifierIsRejected() public {
        (bytes memory proof,) = _attestation("alice-hardware");

        vm.prank(alice);
        vm.expectRevert(AIAgentRegistry.InvalidHardwareProof.selector);
        registry.registerAgent(ALICE_KEY, proof, bytes32(0));
    }

    /// @dev A hardware proof the verifier rejects must not bind anything.
    function test_UnverifiedHardwareProofIsRejected() public {
        (bytes memory proof,) = _attestation("alice-hardware");

        vm.prank(alice);
        vm.expectRevert(AIAgentRegistry.InvalidHardwareProof.selector);
        registry.registerAgent(ALICE_KEY, proof, keccak256("a-different-machine"));

        assertEq(registry.hardwareBinding(keccak256("a-different-machine")), address(0));
    }

    function test_ConstructorRejectsZeroVerifier() public {
        vm.expectRevert(AIAgentRegistry.InvalidZKVerifier.selector);
        new AIAgentRegistry(address(0));
    }

    function test_UnregisteredAgentIsRejected() public {
        assertFalse(registry.isAuthorizedAgent(ghost));
        vm.expectRevert(abi.encodeWithSelector(AIAgentRegistry.UnauthorizedAgent.selector, ghost));
        registry.requireAuthorizedAgent(ghost);
    }

    function test_OnlyTheHumanOwnerCanRevoke() public {
        address agent = _register(alice, ALICE_KEY, "alice-hardware");

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(AIAgentRegistry.NotAgentOwner.selector, agent, bob));
        registry.revokeAgent(agent);
    }

    function test_RevokedAgentIsNoLongerAuthorized() public {
        address agent = _register(alice, ALICE_KEY, "alice-hardware");

        vm.prank(alice);
        registry.revokeAgent(agent);

        assertFalse(registry.isAuthorizedAgent(agent));
        vm.expectRevert(abi.encodeWithSelector(AIAgentRegistry.UnauthorizedAgent.selector, agent));
        registry.requireAuthorizedAgent(agent);
    }
}