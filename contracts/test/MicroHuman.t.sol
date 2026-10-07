// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AIAgentRegistry} from "../src/AIAgentRegistry.sol";
import {HumanToken} from "../src/HumanToken.sol";
import {MockNullifierVerifier} from "./mocks/MockZKVerifier.sol";

/// @dev $mHUMAN is agent-native: every quota is claimed by a registered AI agent and minted into the
/// wallet of the human that agent was registered for. The claim now requires a zero-knowledge
/// personhood proof - this suite stubs {IZKVerifier} so the nullifier plumbing can be exercised for
/// many identities; the real Groth16 pairing check is covered by `Groth16Verifier.t.sol` and
/// `ZKPersonhoodClaim.t.sol`.
contract MicroHumanTest is Test {
    /// @dev 1,000,000 whole tokens at 6 decimals.
    uint256 internal constant QUOTA = 1_000_000 * 10 ** 6;

    /// @dev 8.3 billion humans, one quota each.
    uint256 internal constant MAX_SUPPLY = 8_300_000_000 * 1_000_000 * 10 ** 6;

    MockNullifierVerifier internal verifier;
    AIAgentRegistry internal registry;
    HumanToken internal token;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    bytes32 internal constant ALICE_KEY = keccak256("alice-agent-key");
    bytes32 internal constant BOB_KEY = keccak256("bob-agent-key");

    address internal aliceAgent;
    address internal bobAgent;

    function setUp() public {
        verifier = new MockNullifierVerifier();
        registry = new AIAgentRegistry(address(verifier));
        token = new HumanToken(address(registry), address(verifier));
        aliceAgent = _registerAgent(alice, ALICE_KEY, "alice-hardware");
        bobAgent = _registerAgent(bob, BOB_KEY, "bob-hardware");
    }

    function _registerAgent(address owner, bytes32 agentPubKey, string memory hardware)
        internal
        returns (address agent)
    {
        bytes memory hardwareProof = abi.encodePacked(hardware);
        bytes32 hardwareNullifier = keccak256(hardwareProof);
        vm.prank(owner);
        agent = registry.registerAgent(agentPubKey, hardwareProof, hardwareNullifier);
    }

    /// @dev The stub verifier accepts any proof whose keccak256 equals the claimed nullifier, so the
    /// single-use identity handle behaves exactly as it does with a real circuit.
    function _claim(address agent, uint256 identity) internal {
        bytes memory proof = abi.encodePacked("personhood-", identity);
        vm.prank(agent);
        token.claimHumanQuota(proof, keccak256(proof));
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

    /// @dev The claim consumes exactly the nullifier the proof was verified against.
    function test_ClaimMarksTheVerifiedNullifierUsed() public {
        bytes memory proof = abi.encodePacked("personhood-", uint256(3));
        bytes32 nullifier = keccak256(proof);

        assertFalse(token.nullifierUsed(nullifier));

        vm.prank(aliceAgent);
        token.claimHumanQuota(proof, nullifier);

        assertTrue(token.nullifierUsed(nullifier));
    }

    /// @dev AI-agent native: a human wallet cannot claim on its own.
    function test_HumanCannotClaimWithoutARegisteredAgent() public {
        bytes memory proof = abi.encodePacked("personhood-", uint256(1));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AIAgentRegistry.UnauthorizedAgent.selector, alice));
        token.claimHumanQuota(proof, keccak256(proof));
    }

    /// @dev One proof, one claim: the same identity cannot be replayed.
    function test_ClaimCannotBeReplayedWithSameProof() public {
        bytes memory proof = abi.encodePacked("personhood-", uint256(42));
        bytes32 nullifier = keccak256(proof);

        vm.prank(aliceAgent);
        token.claimHumanQuota(proof, nullifier);

        vm.prank(aliceAgent);
        vm.expectRevert(abi.encodeWithSelector(HumanToken.QuotaAlreadyClaimed.selector, nullifier));
        token.claimHumanQuota(proof, nullifier);

        assertEq(token.totalSupply(), QUOTA);
    }

    /// @dev A consumed identity cannot be replayed through another agent either.
    function test_ConsumedIdentityCannotClaimFromAnotherAgent() public {
        bytes memory proof = abi.encodePacked("personhood-", uint256(7));
        bytes32 nullifier = keccak256(proof);

        vm.prank(aliceAgent);
        token.claimHumanQuota(proof, nullifier);

        vm.prank(bobAgent);
        vm.expectRevert(abi.encodeWithSelector(HumanToken.QuotaAlreadyClaimed.selector, nullifier));
        token.claimHumanQuota(proof, nullifier);

        assertEq(token.balanceOf(bob), 0);
    }

    function test_ClaimRejectsEmptyProof() public {
        bytes32 nullifier = keccak256("unused-nullifier");

        vm.prank(aliceAgent);
        vm.expectRevert(HumanToken.EmptyProof.selector);
        token.claimHumanQuota("", nullifier);
    }

    /// @dev A proof the verifier rejects must neither mint nor burn the nullifier.
    function test_ClaimRejectsUnverifiedProof() public {
        bytes memory proof = abi.encodePacked("personhood-", uint256(9));
        bytes32 nullifier = keccak256("a-different-identity");

        vm.prank(aliceAgent);
        vm.expectRevert(abi.encodeWithSelector(HumanToken.InvalidPersonhoodProof.selector, nullifier));
        token.claimHumanQuota(proof, nullifier);

        assertFalse(token.nullifierUsed(nullifier));
        assertEq(token.totalSupply(), 0);
    }

    function test_ClaimRejectsZeroNullifier() public {
        bytes memory proof = abi.encodePacked("personhood-", uint256(10));

        vm.prank(aliceAgent);
        vm.expectRevert(abi.encodeWithSelector(HumanToken.InvalidPersonhoodProof.selector, bytes32(0)));
        token.claimHumanQuota(proof, bytes32(0));
    }

    function test_ConstructorRejectsZeroVerifier() public {
        vm.expectRevert(HumanToken.InvalidZKVerifier.selector);
        new HumanToken(address(registry), address(0));
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