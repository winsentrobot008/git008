// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AIAgentRegistry} from "../src/AIAgentRegistry.sol";
import {HumanToken} from "../src/HumanToken.sol";

/// @dev $mHUMAN is agent-native: every quota is claimed by a registered AI agent and minted into the
/// wallet of the human that agent was registered for.
contract MicroHumanTest is Test {
    /// @dev 1,000,000 whole tokens at 6 decimals.
    uint256 internal constant QUOTA = 1_000_000 * 10 ** 6;

    /// @dev 8.3 billion humans, one quota each.
    uint256 internal constant MAX_SUPPLY = 8_300_000_000 * 1_000_000 * 10 ** 6;

    AIAgentRegistry internal registry;
    HumanToken internal token;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    bytes32 internal constant ALICE_KEY = keccak256("alice-agent-key");
    bytes32 internal constant BOB_KEY = keccak256("bob-agent-key");

    address internal aliceAgent;
    address internal bobAgent;

    function setUp() public {
        registry = new AIAgentRegistry();
        token = new HumanToken(address(registry));
        aliceAgent = _registerAgent(alice, ALICE_KEY, "alice-hardware");
        bobAgent = _registerAgent(bob, BOB_KEY, "bob-hardware");
    }

    function _registerAgent(address owner, bytes32 agentPubKey, string memory hardware)
        internal
        returns (address agent)
    {
        vm.prank(owner);
        agent = registry.registerAgent(agentPubKey, abi.encodePacked(hardware));
    }

    function _claim(address agent, uint256 identity) internal {
        vm.prank(agent);
        token.claimHumanQuota(abi.encodePacked("personhood-", identity));
    }

    function test_DecimalsAreStrictlySix() public view {
        assertEq(uint256(token.decimals()), 6);
        assertEq(uint256(token.DECIMALS()), 6);
        assertEq(token.HUMAN_QUOTA(), QUOTA);
        assertEq(token.HUMAN_QUOTA(), 1_000_000 * 10 ** uint256(token.DECIMALS()));
    }

    /// @dev The smallest amount the token can move is exactly 1 micro-unit.
    function test_TransferMovesSingleMicroUnit() public {
        _claim(aliceAgent, 1);
        assertEq(token.balanceOf(alice), QUOTA);

        // Read the unit before the prank: an argument call would consume it first.
        uint256 unit = token.MICRO_UNIT();

        vm.prank(alice);
        assertTrue(token.transfer(bob, unit));

        assertEq(token.balanceOf(bob), 1);
        assertEq(token.balanceOf(alice), QUOTA - 1);
        assertEq(token.totalSupply(), QUOTA);
    }

    function test_TransferMovesIntegerMicroUnitAmounts() public {
        _claim(aliceAgent, 1);

        uint256[] memory amounts = new uint256[](4);
        amounts[0] = 1;
        amounts[1] = 999_999;
        amounts[2] = 1_000_000;
        amounts[3] = QUOTA / 2;

        for (uint256 i = 0; i < amounts.length; i++) {
            vm.prank(alice);
            token.transfer(bob, amounts[i]);
        }

        uint256 moved = 1 + 999_999 + 1_000_000 + QUOTA / 2;
        assertEq(token.balanceOf(bob), moved);
        assertEq(token.balanceOf(alice), QUOTA - moved);
    }

    function test_ClaimMintsExactlyOneHumanQuota() public {
        _claim(aliceAgent, 1);

        assertEq(token.totalSupply(), QUOTA);
        assertEq(token.balanceOf(alice), QUOTA);
        // The agent authorizes the claim but never custodies the quota.
        assertEq(token.balanceOf(aliceAgent), 0);
        assertEq(token.remainingHumanQuota(), 8_300_000_000 - 1);
    }

    /// @dev AI-agent native: a human wallet cannot claim on its own.
    function test_HumanCannotClaimWithoutARegisteredAgent() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AIAgentRegistry.UnauthorizedAgent.selector, alice));
        token.claimHumanQuota(abi.encodePacked("personhood-", uint256(1)));
    }

    /// @dev One proof, one claim: the same identity cannot be replayed.
    function test_ClaimCannotBeReplayedWithSameProof() public {
        bytes memory proof = abi.encodePacked("personhood-", uint256(42));

        vm.prank(aliceAgent);
        token.claimHumanQuota(proof);

        vm.prank(aliceAgent);
        vm.expectRevert(HumanToken.QuotaAlreadyClaimed.selector);
        token.claimHumanQuota(proof);

        assertEq(token.totalSupply(), QUOTA);
    }

    /// @dev A consumed identity cannot be replayed through another agent either.
    function test_ConsumedIdentityCannotClaimFromAnotherAgent() public {
        bytes memory proof = abi.encodePacked("personhood-", uint256(7));

        vm.prank(aliceAgent);
        token.claimHumanQuota(proof);

        vm.prank(bobAgent);
        vm.expectRevert(HumanToken.QuotaAlreadyClaimed.selector);
        token.claimHumanQuota(proof);

        assertEq(token.balanceOf(bob), 0);
    }

    function test_ClaimRejectsEmptyProof() public {
        vm.prank(aliceAgent);
        vm.expectRevert(HumanToken.EmptyProof.selector);
        token.claimHumanQuota("");
    }

    /// @dev Minted supply scales exactly as 8.3B humans * 1M units * 10^6.
    function test_TotalMintedSupplyScalesToFullHumanity() public {
        assertEq(token.MAX_GLOBAL_SUPPLY(), MAX_SUPPLY);
        assertEq(token.MAX_GLOBAL_SUPPLY(), 8_300_000_000 * QUOTA);
        assertEq(token.MAX_GLOBAL_SUPPLY() / QUOTA, 8_300_000_000);

        uint256 humans = 8;
        for (uint256 i = 0; i < humans; i++) {
            address human = address(uint160(0x2000 + i));
            address agent =
                _registerAgent(human, keccak256(abi.encodePacked("scale-key", i)), string(abi.encodePacked("scale-hw", i)));
            _claim(agent, i);
        }

        assertEq(token.totalSupply(), humans * QUOTA);
        assertEq(token.totalSupply(), humans * 1_000_000 * 10 ** 6);
        assertEq(token.remainingHumanQuota(), 8_300_000_000 - humans);
    }

    function testFuzz_MintedSupplyScalesLinearlyWithHumans(uint16 humans) public {
        humans = uint16(bound(humans, 1, 200));

        for (uint256 i = 0; i < humans; i++) {
            address human = address(uint160(0x3000 + i));
            address agent =
                _registerAgent(human, keccak256(abi.encodePacked("fuzz-key", i)), string(abi.encodePacked("fuzz-hw", i)));
            _claim(agent, 1_000_000 + i);
        }

        assertEq(token.totalSupply(), uint256(humans) * QUOTA);
    }
}