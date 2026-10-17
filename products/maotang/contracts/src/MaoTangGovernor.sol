// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HumanToken} from "./HumanToken.sol";
import {INodePowerSource} from "./interfaces/INodePowerSource.sol";

/// @title MaoTangGovernor
/// @notice Proposal, voting and execution lifecycle for protocol parameters, weighted by `$mHUMAN`.
/// @dev Whitepaper v2.2 section 5.4. The protocol has exactly one authority address today
/// (`MaoTangSustenanceVault.owner` and friends), which is fine while the launch set is small and
/// untenable afterwards. This contract replaces unilateral parameter changes with a vote:
///
///   `propose` -> `Pending` -> `Active` -> `Succeeded`/`Defeated` -> `execute`
///
/// Voting weight is `mHuman.balanceOf(voter)` plus, when configured, whatever an
/// {INodePowerSource} reports for that account - so a human who runs infrastructure can carry more
/// weight than their single personhood quota. Votes are read live at the moment of voting rather than
/// snapshot at proposal creation: `HumanToken` implements no checkpoints, so a snapshot would have to
/// be fabricated. The consequence is honest and documented - `$mHUMAN` is transferable, so voting
/// power can be acquired after a proposal opens. Section 15 of the architecture document records this
/// as the main P4 limitation, and the migration path (ERC20Votes-style checkpoints plus a snapshot
/// block) as the follow-up.
///
/// Every governance parameter, including the optional node power source, is changeable only through a
/// passed proposal ({NotSelfGoverned}), so the deployer cannot tighten or loosen the rules afterwards.
/// The constructor only seeds the initial values.
contract MaoTangGovernor {
    /// @notice Basis point denominator for {quorumBps}.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Longest voting delay the governor will accept, to bound a proposal freeze.
    uint256 public constant MAX_VOTING_DELAY = 30 days;

    /// @notice Shortest voting period the governor will accept.
    uint256 public constant MIN_VOTING_PERIOD = 1 hours;

    /// @notice Longest voting period the governor will accept.
    uint256 public constant MAX_VOTING_PERIOD = 60 days;

    /// @notice Where a proposal is in its lifecycle.
    /// @dev `Unknown` is never returned by {state}; an unknown id reverts with {UnknownProposal}.
    enum ProposalState {
        Unknown,
        Pending,
        Active,
        Defeated,
        Succeeded,
        Executed
    }

    /// @notice How a voter voted. `Abstain` counts toward quorum but not toward either side.
    enum VoteSupport {
        Against,
        For,
        Abstain
    }

    /// @notice A proposal and its running tally.
    struct Proposal {
        address proposer;
        uint256 voteStart;
        uint256 voteEnd;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        bool executed;
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
        string description;
    }

    /// @notice One account vote on one proposal.
    struct Receipt {
        bool hasVoted;
        uint8 support;
        uint256 weight;
    }

    /// @notice Personhood token that provides the base voting weight.
    HumanToken public immutable mHuman;

    /// @notice Seconds between proposal creation and the start of voting.
    uint256 public votingDelay;

    /// @notice Seconds voting stays open.
    uint256 public votingPeriod;

    /// @notice Weight, in `$mHUMAN` micro-units, required to open a proposal.
    uint256 public proposalThreshold;

    /// @notice Share of `$mHUMAN` total supply that must vote for a result to be valid.
    uint256 public quorumBps;

    /// @notice Optional contract reporting staked or attested node power. Zero disables it.
    address public nodePowerSource;

    /// @notice Vote receipts, per proposal and voter.
    mapping(uint256 proposalId => mapping(address voter => Receipt receipt)) public receipts;

    mapping(uint256 proposalId => Proposal proposal) private _proposals;

    /// @notice Emitted when a proposal is opened.
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        address[] targets,
        uint256[] values,
        bytes[] calldatas,
        uint256 voteStart,
        uint256 voteEnd,
        string description
    );

    /// @notice Emitted on every vote.
    event VoteCast(address indexed voter, uint256 indexed proposalId, uint8 support, uint256 weight);

    /// @notice Emitted once a successful proposal has been executed.
    event ProposalExecuted(uint256 indexed proposalId, address indexed executor, uint256 calls);

    /// @notice Emitted when governance changes its own voting parameters.
    event VotingParamsUpdated(uint256 votingDelay, uint256 votingPeriod, uint256 proposalThreshold, uint256 quorumBps);

    /// @notice Emitted when governance wires in or removes a node power source.
    event NodePowerSourceSet(address indexed source);

    error ZeroAddress();
    error InvalidProposal();
    error InvalidVotingParams();
    error BelowProposalThreshold(address proposer, uint256 power, uint256 required);
    error ProposalAlreadyExists(uint256 proposalId);
    error UnknownProposal(uint256 proposalId);
    error ProposalNotActive(uint256 proposalId, ProposalState current);
    error ProposalNotSucceeded(uint256 proposalId, ProposalState current);
    error AlreadyVoted(address voter, uint256 proposalId);
    error InvalidSupport(uint8 support);
    error NoVotingPower(address voter);
    error NotSelfGoverned(address caller);
    error CallFailed(uint256 index, address target, bytes returndata);

    /// @param mHuman_ Personhood token providing base voting weight.
    /// @param votingDelay_ Seconds between proposal creation and the start of voting.
    /// @param votingPeriod_ Seconds voting stays open.
    /// @param proposalThreshold_ `$mHUMAN` micro-units required to propose.
    /// @param quorumBps_ Share of total supply that must vote, in basis points.
    constructor(
        address mHuman_,
        uint256 votingDelay_,
        uint256 votingPeriod_,
        uint256 proposalThreshold_,
        uint256 quorumBps_
    ) {
        if (mHuman_ == address(0)) revert ZeroAddress();
        _validateVotingParams(votingDelay_, votingPeriod_, quorumBps_);

        mHuman = HumanToken(mHuman_);
        votingDelay = votingDelay_;
        votingPeriod = votingPeriod_;
        proposalThreshold = proposalThreshold_;
        quorumBps = quorumBps_;
    }

    /// @notice Voting power of `account`: `$mHUMAN` balance plus optional node power.
    function votingPower(address account) public view returns (uint256 power) {
        power = mHuman.balanceOf(account);
        address source = nodePowerSource;
        if (source != address(0)) {
            power += INodePowerSource(source).votingPower(account);
        }
    }

    /// @notice Votes required for a result to be valid, at the current total supply.
    function quorum() public view returns (uint256) {
        return (mHuman.totalSupply() * quorumBps) / BPS_DENOMINATOR;
    }

    /// @notice Deterministic id of a proposal with these exact contents.
    /// @dev Contents-only, mirroring Compound: an identical proposal can only exist once, and a
    /// defeated proposal can only be retried with a changed description or payload.
    function proposalIdFor(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        string calldata description
    ) public view returns (uint256) {
        return uint256(keccak256(abi.encode(block.chainid, address(this), targets, values, calldatas, description)));
    }

    /// @notice Opens a proposal. Requires {proposalThreshold} voting power.
    /// @param targets Contracts the proposal calls on execution.
    /// @param values Native value sent with each call.
    /// @param calldatas Calldata for each call. All three arrays must be the same non-zero length.
    /// @param description Human-readable summary, also hashed into the proposal id.
    /// @return proposalId Deterministic id of the new proposal.
    function propose(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        string calldata description
    ) external returns (uint256 proposalId) {
        _requireProposalShape(targets, values, calldatas);
        _requireProposalThreshold();

        proposalId = proposalIdFor(targets, values, calldatas, description);
        if (_proposals[proposalId].proposer != address(0)) revert ProposalAlreadyExists(proposalId);

        Proposal storage proposal = _proposals[proposalId];
        proposal.proposer = msg.sender;
        proposal.voteStart = block.timestamp + votingDelay;
        proposal.voteEnd = proposal.voteStart + votingPeriod;
        proposal.description = description;
        _storeCalls(proposal, targets, values, calldatas);

        emit ProposalCreated(
            proposalId,
            msg.sender,
            targets,
            values,
            calldatas,
            proposal.voteStart,
            proposal.voteEnd,
            description
        );
    }

    function _requireProposalShape(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas
    ) private pure {
        uint256 length = targets.length;
        if (length == 0 || values.length != length || calldatas.length != length) revert InvalidProposal();
    }

    function _requireProposalThreshold() private view {
        uint256 power = votingPower(msg.sender);
        if (power < proposalThreshold) revert BelowProposalThreshold(msg.sender, power, proposalThreshold);
    }

    function _storeCalls(
        Proposal storage proposal,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas
    ) private {
        uint256 length = targets.length;
        for (uint256 i = 0; i < length; i++) {
            proposal.targets.push(targets[i]);
            proposal.values.push(values[i]);
            proposal.calldatas.push(calldatas[i]);
        }
    }


    /// @notice Casts a vote. Weight is read live from {votingPower}.
    /// @param proposalId Proposal being voted on.
    /// @param support 0 against, 1 for, 2 abstain.
    /// @return weight Voting weight recorded for the caller.
    function castVote(uint256 proposalId, uint8 support) external returns (uint256 weight) {
        ProposalState current = state(proposalId);
        if (current != ProposalState.Active) revert ProposalNotActive(proposalId, current);
        if (support > uint8(VoteSupport.Abstain)) revert InvalidSupport(support);

        Receipt storage receipt = receipts[proposalId][msg.sender];
        if (receipt.hasVoted) revert AlreadyVoted(msg.sender, proposalId);

        weight = votingPower(msg.sender);
        if (weight == 0) revert NoVotingPower(msg.sender);

        receipt.hasVoted = true;
        receipt.support = support;
        receipt.weight = weight;

        Proposal storage proposal = _proposals[proposalId];
        if (support == uint8(VoteSupport.For)) {
            proposal.forVotes += weight;
        } else if (support == uint8(VoteSupport.Against)) {
            proposal.againstVotes += weight;
        } else {
            proposal.abstainVotes += weight;
        }

        emit VoteCast(msg.sender, proposalId, support, weight);
    }

    /// @notice Lifecycle state of a proposal.
    /// @dev A proposal succeeds when it leads and quorum is met; abstentions count toward quorum,
    /// which is the Compound convention and keeps a neutral voter useful.
    function state(uint256 proposalId) public view returns (ProposalState) {
        Proposal storage proposal = _requireProposal(proposalId);
        if (proposal.executed) {
            return ProposalState.Executed;
        }
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < proposal.voteStart) {
            return ProposalState.Pending;
        }
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp <= proposal.voteEnd) {
            return ProposalState.Active;
        }
        if (proposal.forVotes <= proposal.againstVotes) {
            return ProposalState.Defeated;
        }
        if (proposal.forVotes + proposal.abstainVotes < quorum()) {
            return ProposalState.Defeated;
        }
        return ProposalState.Succeeded;
    }

    /// @notice Executes a succeeded proposal.
    /// @dev Any address may execute; the vote already decided. A failing call reverts the whole
    /// execution, so a proposal is all-or-nothing rather than partially applied.
    /// @param proposalId Proposal to execute.
    /// @return calls Number of calls executed.
    function execute(uint256 proposalId) external payable returns (uint256 calls) {
        ProposalState current = state(proposalId);
        if (current != ProposalState.Succeeded) revert ProposalNotSucceeded(proposalId, current);

        Proposal storage proposal = _requireProposal(proposalId);
        proposal.executed = true;

        calls = proposal.targets.length;
        for (uint256 i = 0; i < calls; i++) {
            // The destination and payload come from the passed proposal, which is the entire point
            // of the contract, and the vote is the authorization; the loop is the executor. Both
            // advisories are false positives here.
            // forge-lint: disable-next-line(arbitrary-send-eth, calls-loop)
            (bool ok, bytes memory returndata) = proposal.targets[i].call{value: proposal.values[i]}(proposal.calldatas[i]);
            // A failing call reverts the whole execution, so reverting inside the loop is the
            // atomicity guarantee rather than a footgun.
            // forge-lint: disable-next-line(require-revert-in-loop)
            if (!ok) revert CallFailed(i, proposal.targets[i], returndata);
        }

        // forge-lint: disable-next-line(reentrancy-events)
        emit ProposalExecuted(proposalId, msg.sender, calls);
    }

    /// @notice Voting parameters of a proposal.
    function proposalInfo(uint256 proposalId)
        external
        view
        returns (
            address proposer,
            uint256 voteStart,
            uint256 voteEnd,
            uint256 forVotes,
            uint256 againstVotes,
            uint256 abstainVotes,
            bool executed,
            string memory description
        )
    {
        Proposal storage proposal = _requireProposal(proposalId);
        return (
            proposal.proposer,
            proposal.voteStart,
            proposal.voteEnd,
            proposal.forVotes,
            proposal.againstVotes,
            proposal.abstainVotes,
            proposal.executed,
            proposal.description
        );
    }

    /// @notice Calls a proposal would make on execution.
    function proposalCalls(uint256 proposalId)
        external
        view
        returns (address[] memory targets, uint256[] memory values, bytes[] memory calldatas)
    {
        Proposal storage proposal = _requireProposal(proposalId);
        return (proposal.targets, proposal.values, proposal.calldatas);
    }

    /// @notice Changes the voting parameters. Only reachable through a passed proposal.
    /// @param votingDelay_ Seconds between proposal creation and the start of voting.
    /// @param votingPeriod_ Seconds voting stays open.
    /// @param proposalThreshold_ `$mHUMAN` micro-units required to propose.
    /// @param quorumBps_ Share of total supply that must vote, in basis points.
    function setVotingParams(
        uint256 votingDelay_,
        uint256 votingPeriod_,
        uint256 proposalThreshold_,
        uint256 quorumBps_
    ) external {
        if (msg.sender != address(this)) revert NotSelfGoverned(msg.sender);
        _validateVotingParams(votingDelay_, votingPeriod_, quorumBps_);

        votingDelay = votingDelay_;
        votingPeriod = votingPeriod_;
        proposalThreshold = proposalThreshold_;
        quorumBps = quorumBps_;

        emit VotingParamsUpdated(votingDelay_, votingPeriod_, proposalThreshold_, quorumBps_);
    }

    /// @notice Wires in or removes a node power source. Only reachable through a passed proposal.
    /// @param source Contract implementing {INodePowerSource}, or the zero address to remove it.
    // Zero is the documented "disable" sentinel rather than a mistake, so the advisory is a false
    // positive.
    // forge-lint: disable-next-line(missing-zero-check)
    function setNodePowerSource(address source) external {
        if (msg.sender != address(this)) revert NotSelfGoverned(msg.sender);
        nodePowerSource = source;
        emit NodePowerSourceSet(source);
    }

    function _validateVotingParams(uint256 votingDelay_, uint256 votingPeriod_, uint256 quorumBps_) private pure {
        if (votingDelay_ > MAX_VOTING_DELAY) revert InvalidVotingParams();
        if (votingPeriod_ < MIN_VOTING_PERIOD || votingPeriod_ > MAX_VOTING_PERIOD) revert InvalidVotingParams();
        if (quorumBps_ == 0 || quorumBps_ > BPS_DENOMINATOR) revert InvalidVotingParams();
    }

    function _requireProposal(uint256 proposalId) private view returns (Proposal storage proposal) {
        proposal = _proposals[proposalId];
        if (proposal.proposer == address(0)) revert UnknownProposal(proposalId);
    }
}
