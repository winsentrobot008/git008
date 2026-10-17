// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AIAgentRegistry} from "../src/AIAgentRegistry.sol";
import {HumanToken} from "../src/HumanToken.sol";
import {INodePowerSource} from "../src/interfaces/INodePowerSource.sol";
import {MaoTangGovernor} from "../src/MaoTangGovernor.sol";
import {MockNullifierVerifier} from "./mocks/MockZKVerifier.sol";

/// @dev Stand-in staking contract, used to prove the {INodePowerSource} wiring in
/// {MaoTangGovernor.votingPower}.
contract MockNodePowerSource is INodePowerSource {
    mapping(address account => uint256 power) public stakedPower;

    function setVotingPower(address account, uint256 amount) external {
        stakedPower[account] = amount;
    }

    function votingPower(address account) external view returns (uint256) {
        return stakedPower[account];
    }
}

/// @dev Covers the Phase P4 governance lifecycle (`docs/MAOTANG_ARCHITECTURE.md` section 15): a
/// proposal moves Pending -> Active -> Succeeded/Defeated -> Executed, weight is the voter $mHUMAN
/// balance plus whatever the wired node power source reports, quorum is a share of total supply, and
/// every protocol parameter - including the governor own voting parameters - changes only through a
/// passed proposal.
contract MaoTangGovernorTest is Test {
    MockNullifierVerifier internal verifier;
    AIAgentRegistry internal registry;
    HumanToken internal mhuman;
    MaoTangGovernor internal governor;
    MockNodePowerSource internal nodePower;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal aliceAgent;

    uint256 internal constant QUOTA = 1_000_000 * 10 ** 6;
    uint256 internal constant VOTING_DELAY = 1 days;
    uint256 internal constant VOTING_PERIOD = 1 weeks;
    uint256 internal constant START_TIMESTAMP = 1_700_000_000;
    uint256 internal clock;

    uint256 internal pingValue;
    uint256 internal pingCount;

    event VoteCast(address indexed voter, uint256 indexed proposalId, uint8 support, uint256 weight);

    function ping(uint256 value) external payable {
        pingValue = value;
        pingCount += 1;
    }

    function boom() external pure {
        revert("boom");
    }

    function setUp() public {
        clock = START_TIMESTAMP;
        vm.warp(clock);

        verifier = new MockNullifierVerifier();
        registry = new AIAgentRegistry(address(verifier));
        mhuman = new HumanToken(address(registry), address(verifier));
        governor = new MaoTangGovernor(address(mhuman), VOTING_DELAY, VOTING_PERIOD, 0, 1_000);
        nodePower = new MockNodePowerSource();

        aliceAgent = _giveQuota(registry, mhuman, alice, "alice");
    }

    // ------------------------------------------------------------------------------------- deployment

    function test_ConstructorSeedsParameters() public view {
        assertEq(address(governor.mHuman()), address(mhuman));
        assertEq(governor.votingDelay(), VOTING_DELAY);
        assertEq(governor.votingPeriod(), VOTING_PERIOD);
        assertEq(governor.proposalThreshold(), 0);
        assertEq(governor.quorumBps(), 1_000);
        assertEq(governor.nodePowerSource(), address(0));
    }

    function test_ConstructorRejectsInvalidParams() public {
        vm.expectRevert(MaoTangGovernor.ZeroAddress.selector);
        new MaoTangGovernor(address(0), VOTING_DELAY, VOTING_PERIOD, 0, 1_000);

        vm.expectRevert(MaoTangGovernor.InvalidVotingParams.selector);
        new MaoTangGovernor(address(mhuman), 31 days, VOTING_PERIOD, 0, 1_000);

        vm.expectRevert(MaoTangGovernor.InvalidVotingParams.selector);
        new MaoTangGovernor(address(mhuman), VOTING_DELAY, 30 minutes, 0, 1_000);

        vm.expectRevert(MaoTangGovernor.InvalidVotingParams.selector);
        new MaoTangGovernor(address(mhuman), VOTING_DELAY, VOTING_PERIOD, 0, 0);
    }

    function test_VotingPowerAndQuorumTrackTheHumanBalance() public view {
        assertEq(governor.votingPower(alice), QUOTA);
        assertEq(governor.votingPower(bob), 0);
        assertEq(governor.quorum(), QUOTA / 10);
    }

    // ---------------------------------------------------------------------------------- happy path

    function test_ProposalLifecycleExecutesTheCalls() public {
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _pingCalls(42);
        uint256 proposalId = governor.proposalIdFor(targets, values, calldatas, "ping 42");

        vm.prank(alice);
        assertEq(governor.propose(targets, values, calldatas, "ping 42"), proposalId);
        assertEq(uint256(governor.state(proposalId)), uint256(MaoTangGovernor.ProposalState.Pending));

        _advance(VOTING_DELAY);
        assertEq(uint256(governor.state(proposalId)), uint256(MaoTangGovernor.ProposalState.Active));

        vm.expectEmit(true, true, true, true, address(governor));
        emit VoteCast(alice, proposalId, uint8(MaoTangGovernor.VoteSupport.For), QUOTA);
        vm.prank(alice);
        assertEq(governor.castVote(proposalId, uint8(MaoTangGovernor.VoteSupport.For)), QUOTA);

        (bool hasVoted, uint8 support, uint256 recordedWeight) = governor.receipts(proposalId, alice);
        assertTrue(hasVoted);
        assertEq(uint8(support), uint8(MaoTangGovernor.VoteSupport.For));
        assertEq(recordedWeight, QUOTA);

        _advance(VOTING_PERIOD + 1);
        assertEq(uint256(governor.state(proposalId)), uint256(MaoTangGovernor.ProposalState.Succeeded));

        governor.execute(proposalId);
        assertEq(pingCount, 1);
        assertEq(pingValue, 42);
        assertEq(uint256(governor.state(proposalId)), uint256(MaoTangGovernor.ProposalState.Executed));

        vm.expectRevert(
            abi.encodeWithSelector(
                MaoTangGovernor.ProposalNotSucceeded.selector,
                proposalId,
                uint8(MaoTangGovernor.ProposalState.Executed)
            )
        );
        governor.execute(proposalId);
    }

    function test_ProposalCallsAndInfoReadBack() public {
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _pingCalls(11);

        vm.prank(alice);
        uint256 proposalId = governor.propose(targets, values, calldatas, "read back");

        (address[] memory readTargets, uint256[] memory readValues, bytes[] memory readCalldatas) =
            governor.proposalCalls(proposalId);
        assertEq(readTargets.length, 1);
        assertEq(readTargets[0], address(this));
        assertEq(readValues[0], 0);
        assertEq(readCalldatas[0], calldatas[0]);

        (address proposer, uint256 voteStart, uint256 voteEnd, , , , bool executed, string memory description) =
            governor.proposalInfo(proposalId);
        assertEq(proposer, alice);
        assertEq(voteStart, clock + VOTING_DELAY);
        assertEq(voteEnd, voteStart + VOTING_PERIOD);
        assertFalse(executed);
        assertEq(description, "read back");
    }

    function test_ProposalIdIsDeterministicAndDescriptionSensitive() public view {
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _pingCalls(1);

        uint256 first = governor.proposalIdFor(targets, values, calldatas, "one");
        assertEq(first, governor.proposalIdFor(targets, values, calldatas, "one"));
        assertTrue(first != governor.proposalIdFor(targets, values, calldatas, "two"));
    }

    // ------------------------------------------------------------------------------------ rejections

    function test_UnknownProposalReverts() public {
        vm.expectRevert(abi.encodeWithSelector(MaoTangGovernor.UnknownProposal.selector, 123));
        governor.state(123);

        vm.expectRevert(abi.encodeWithSelector(MaoTangGovernor.UnknownProposal.selector, 123));
        governor.proposalInfo(123);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MaoTangGovernor.UnknownProposal.selector, 123));
        governor.castVote(123, uint8(MaoTangGovernor.VoteSupport.For));

        vm.expectRevert(abi.encodeWithSelector(MaoTangGovernor.UnknownProposal.selector, 123));
        governor.execute(123);
    }

    function test_EmptyOrRaggedProposalRejected() public {
        address[] memory targets = new address[](0);
        uint256[] memory values = new uint256[](0);
        bytes[] memory calldatas = new bytes[](0);

        vm.prank(alice);
        vm.expectRevert(MaoTangGovernor.InvalidProposal.selector);
        governor.propose(targets, values, calldatas, "empty");

        address[] memory oneTarget = new address[](1);
        oneTarget[0] = address(this);
        uint256[] memory twoValues = new uint256[](2);
        bytes[] memory oneCall = new bytes[](1);
        oneCall[0] = abi.encodeWithSelector(this.ping.selector, 1);

        vm.prank(alice);
        vm.expectRevert(MaoTangGovernor.InvalidProposal.selector);
        governor.propose(oneTarget, twoValues, oneCall, "ragged");
    }

    function test_DuplicateProposalRejected() public {
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _pingCalls(1);

        vm.prank(alice);
        uint256 proposalId = governor.propose(targets, values, calldatas, "duplicate");

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangGovernor.ProposalAlreadyExists.selector, proposalId)
        );
        governor.propose(targets, values, calldatas, "duplicate");
    }

    function test_ProposalRejectedBelowThreshold() public {
        MaoTangGovernor gated = new MaoTangGovernor(address(mhuman), VOTING_DELAY, VOTING_PERIOD, QUOTA + 1, 1_000);
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _pingCalls(1);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangGovernor.BelowProposalThreshold.selector, alice, QUOTA, QUOTA + 1)
        );
        gated.propose(targets, values, calldatas, "gated");
    }

    function test_CastVoteWindowAndSupportGuards() public {
        uint256 proposalId = _openPingProposal(7);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                MaoTangGovernor.ProposalNotActive.selector,
                proposalId,
                uint8(MaoTangGovernor.ProposalState.Pending)
            )
        );
        governor.castVote(proposalId, uint8(MaoTangGovernor.VoteSupport.For));

        _advance(VOTING_DELAY);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MaoTangGovernor.InvalidSupport.selector, 3));
        governor.castVote(proposalId, 3);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MaoTangGovernor.NoVotingPower.selector, bob));
        governor.castVote(proposalId, uint8(MaoTangGovernor.VoteSupport.For));

        _advance(VOTING_PERIOD + 1);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                MaoTangGovernor.ProposalNotActive.selector,
                proposalId,
                uint8(MaoTangGovernor.ProposalState.Defeated)
            )
        );
        governor.castVote(proposalId, uint8(MaoTangGovernor.VoteSupport.For));
    }

    function test_CannotVoteTwice() public {
        uint256 proposalId = _openPingProposal(7);
        _advance(VOTING_DELAY);

        vm.prank(alice);
        governor.castVote(proposalId, uint8(MaoTangGovernor.VoteSupport.For));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MaoTangGovernor.AlreadyVoted.selector, alice, proposalId));
        governor.castVote(proposalId, uint8(MaoTangGovernor.VoteSupport.Against));
    }

    function test_UnvotedProposalIsDefeatedAndNotExecutable() public {
        uint256 proposalId = _openPingProposal(7);
        _advance(VOTING_DELAY + VOTING_PERIOD + 1);

        assertEq(uint256(governor.state(proposalId)), uint256(MaoTangGovernor.ProposalState.Defeated));

        vm.expectRevert(
            abi.encodeWithSelector(
                MaoTangGovernor.ProposalNotSucceeded.selector,
                proposalId,
                uint8(MaoTangGovernor.ProposalState.Defeated)
            )
        );
        governor.execute(proposalId);
    }

    function test_AgainstVotesDefeatAProposal() public {
        uint256 proposalId = _openPingProposal(7);
        _advance(VOTING_DELAY);

        vm.prank(alice);
        governor.castVote(proposalId, uint8(MaoTangGovernor.VoteSupport.Against));

        _advance(VOTING_PERIOD + 1);
        assertEq(uint256(governor.state(proposalId)), uint256(MaoTangGovernor.ProposalState.Defeated));
    }

    function test_QuorumIsRequiredForSuccess() public {
        MockNullifierVerifier freshVerifier = new MockNullifierVerifier();
        AIAgentRegistry freshRegistry = new AIAgentRegistry(address(freshVerifier));
        HumanToken freshToken = new HumanToken(address(freshRegistry), address(freshVerifier));
        MaoTangGovernor strict = new MaoTangGovernor(address(freshToken), VOTING_DELAY, VOTING_PERIOD, 0, 10_000);

        _giveQuota(freshRegistry, freshToken, alice, "quorum-alice");
        _giveQuota(freshRegistry, freshToken, bob, "quorum-bob");
        assertEq(strict.quorum(), 2 * QUOTA);

        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _pingCalls(9);
        vm.prank(alice);
        uint256 proposalId = strict.propose(targets, values, calldatas, "quorum");

        _advance(VOTING_DELAY);
        vm.prank(alice);
        strict.castVote(proposalId, uint8(MaoTangGovernor.VoteSupport.For));

        _advance(VOTING_PERIOD + 1);
        assertEq(uint256(strict.state(proposalId)), uint256(MaoTangGovernor.ProposalState.Defeated));
    }

    function test_ExecutePropagatesCallFailure() public {
        address[] memory targets = new address[](1);
        uint256[] memory values = new uint256[](1);
        bytes[] memory calldatas = new bytes[](1);
        targets[0] = address(this);
        calldatas[0] = abi.encodeWithSelector(this.boom.selector);

        vm.prank(alice);
        uint256 proposalId = governor.propose(targets, values, calldatas, "boom");
        _advance(VOTING_DELAY);
        vm.prank(alice);
        governor.castVote(proposalId, uint8(MaoTangGovernor.VoteSupport.For));
        _advance(VOTING_PERIOD + 1);

        vm.expectRevert();
        governor.execute(proposalId);
        assertEq(uint256(governor.state(proposalId)), uint256(MaoTangGovernor.ProposalState.Succeeded));
    }

    // --------------------------------------------------------------------------------- self governance

    function test_VotingParamsAreSelfGoverned() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MaoTangGovernor.NotSelfGoverned.selector, alice));
        governor.setVotingParams(VOTING_DELAY, 2 weeks, 5, 2_000);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MaoTangGovernor.NotSelfGoverned.selector, alice));
        governor.setNodePowerSource(address(nodePower));

        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _selfCalls(
            abi.encodeWithSelector(MaoTangGovernor.setVotingParams.selector, VOTING_DELAY, 2 weeks, 5, 2_000)
        );
        vm.prank(alice);
        uint256 proposalId = governor.propose(targets, values, calldatas, "retune");

        _advance(VOTING_DELAY);
        vm.prank(alice);
        governor.castVote(proposalId, uint8(MaoTangGovernor.VoteSupport.For));
        _advance(VOTING_PERIOD + 1);
        governor.execute(proposalId);

        assertEq(governor.votingDelay(), VOTING_DELAY);
        assertEq(governor.votingPeriod(), 2 weeks);
        assertEq(governor.proposalThreshold(), 5);
        assertEq(governor.quorumBps(), 2_000);
    }

    function test_SelfGovernedRetuneRejectsInvalidParams() public {
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _selfCalls(
            abi.encodeWithSelector(MaoTangGovernor.setVotingParams.selector, 31 days, 2 weeks, 0, 1_000)
        );
        vm.prank(alice);
        uint256 proposalId = governor.propose(targets, values, calldatas, "bad retune");

        _advance(VOTING_DELAY);
        vm.prank(alice);
        governor.castVote(proposalId, uint8(MaoTangGovernor.VoteSupport.For));
        _advance(VOTING_PERIOD + 1);

        vm.expectRevert();
        governor.execute(proposalId);
        assertEq(governor.votingDelay(), VOTING_DELAY);
    }

    function test_NodePowerSourceAddsVotingWeight() public {
        nodePower.setVotingPower(alice, 5_000_000);
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _selfCalls(
            abi.encodeWithSelector(MaoTangGovernor.setNodePowerSource.selector, address(nodePower))
        );

        vm.prank(alice);
        uint256 proposalId = governor.propose(targets, values, calldatas, "wire node power");

        _advance(VOTING_DELAY);
        assertEq(governor.votingPower(alice), QUOTA);

        vm.prank(alice);
        governor.castVote(proposalId, uint8(MaoTangGovernor.VoteSupport.For));
        _advance(VOTING_PERIOD + 1);
        governor.execute(proposalId);

        assertEq(governor.nodePowerSource(), address(nodePower));
        assertEq(governor.votingPower(alice), QUOTA + 5_000_000);
    }

    // ----------------------------------------------------------------------------------------- helpers

    /// @dev Advances the simulated clock. Tests never read `block.timestamp` inside `vm.warp`, which
    /// keeps the environment-read-across-mutation lint quiet and makes the timeline explicit.
    function _advance(uint256 seconds_) internal {
        clock += seconds_;
        vm.warp(clock);
    }

    function _pingCalls(uint256 value)
        internal
        view
        returns (address[] memory targets, uint256[] memory values, bytes[] memory calldatas)
    {
        targets = new address[](1);
        values = new uint256[](1);
        calldatas = new bytes[](1);
        targets[0] = address(this);
        calldatas[0] = abi.encodeWithSelector(this.ping.selector, value);
    }

    function _selfCalls(bytes memory data)
        internal
        view
        returns (address[] memory targets, uint256[] memory values, bytes[] memory calldatas)
    {
        targets = new address[](1);
        values = new uint256[](1);
        calldatas = new bytes[](1);
        targets[0] = address(governor);
        calldatas[0] = data;
    }

    function _openPingProposal(uint256 value) internal returns (uint256 proposalId) {
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _pingCalls(value);
        vm.prank(alice);
        proposalId = governor.propose(targets, values, calldatas, string.concat("ping ", vm.toString(value)));
    }

    /// @dev Registers an agent for `human` and mints one personhood quota through it, which is the only
    /// way `$mHUMAN` ever moves in the protocol.
    function _giveQuota(AIAgentRegistry registry_, HumanToken token_, address human, string memory tag)
        internal
        returns (address agent)
    {
        bytes memory hardwareProof = abi.encodePacked(tag, "-hardware");
        vm.prank(human);
        agent = registry_.registerAgent(
            keccak256(abi.encodePacked(tag, "-agent-key")), hardwareProof, keccak256(hardwareProof)
        );

        bytes memory personhoodProof = abi.encodePacked(tag, "-personhood");
        vm.prank(agent);
        token_.claimHumanQuota(personhoodProof, keccak256(personhoodProof));
    }
}
