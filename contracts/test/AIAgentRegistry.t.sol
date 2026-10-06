// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AIAgentRegistry} from "../src/AIAgentRegistry.sol";

contract AIAgentRegistryTest is Test {
    AIAgentRegistry internal registry;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal ghost = address(0xDEAD);

    bytes32 internal constant ALICE_KEY = keccak256("alice-agent-key");
    bytes32 internal constant BOB_KEY = keccak256("bob-agent-key");

    function setUp() public {
        registry = new AIAgentRegistry();
    }

    function test_RegisterAgentBindsDerivedAddressToHuman() public {
        vm.prank(alice);
        address agent = registry.registerAgent(ALICE_KEY, abi.encodePacked("alice-hardware"));

        assertEq(agent, registry.agentAddress(ALICE_KEY));
        assertTrue(registry.isAuthorizedAgent(agent));
        assertEq(registry.requireAuthorizedAgent(agent), alice);
        assertEq(registry.agentByKey(ALICE_KEY), agent);
        assertEq(registry.agentRecord(agent).owner, alice);
    }

    function test_AgentAddressIsDeterministicAndKeySpecific() public view {
        assertEq(registry.agentAddress(ALICE_KEY), registry.agentAddress(ALICE_KEY));
        assertTrue(registry.agentAddress(ALICE_KEY) != registry.agentAddress(BOB_KEY));
    }

    function test_CannotRegisterTheSameKeyTwice() public {
        vm.prank(alice);
        registry.registerAgent(ALICE_KEY, abi.encodePacked("alice-hardware"));

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(AIAgentRegistry.AgentAlreadyRegistered.selector, registry.agentAddress(ALICE_KEY))
        );
        registry.registerAgent(ALICE_KEY, abi.encodePacked("bob-hardware"));
    }

    function test_CannotReuseHardwareProof() public {
        vm.prank(alice);
        registry.registerAgent(ALICE_KEY, abi.encodePacked("shared-hardware"));

        vm.prank(bob);
        vm.expectRevert();
        registry.registerAgent(BOB_KEY, abi.encodePacked("shared-hardware"));
    }

    function test_InvalidInputsAreRejected() public {
        vm.prank(alice);
        vm.expectRevert(AIAgentRegistry.InvalidAgentKey.selector);
        registry.registerAgent(bytes32(0), abi.encodePacked("hw"));

        vm.prank(alice);
        vm.expectRevert(AIAgentRegistry.InvalidHardwareProof.selector);
        registry.registerAgent(ALICE_KEY, "");
    }

    function test_UnregisteredAgentIsRejected() public {
        assertFalse(registry.isAuthorizedAgent(ghost));
        vm.expectRevert(abi.encodeWithSelector(AIAgentRegistry.UnauthorizedAgent.selector, ghost));
        registry.requireAuthorizedAgent(ghost);
    }

    function test_OnlyTheHumanOwnerCanRevoke() public {
        vm.prank(alice);
        address agent = registry.registerAgent(ALICE_KEY, abi.encodePacked("alice-hardware"));

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(AIAgentRegistry.NotAgentOwner.selector, agent, bob));
        registry.revokeAgent(agent);
    }

    function test_RevokedAgentIsNoLongerAuthorized() public {
        vm.prank(alice);
        address agent = registry.registerAgent(ALICE_KEY, abi.encodePacked("alice-hardware"));

        vm.prank(alice);
        registry.revokeAgent(agent);

        assertFalse(registry.isAuthorizedAgent(agent));
        vm.expectRevert(abi.encodeWithSelector(AIAgentRegistry.UnauthorizedAgent.selector, agent));
        registry.requireAuthorizedAgent(agent);
    }
}