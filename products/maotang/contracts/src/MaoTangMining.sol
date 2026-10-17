// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentGated} from "./AIAgentRegistry.sol";
import {HumanToken} from "./HumanToken.sol";

/// @title MaoTangMining
/// @notice DePIN reward surface: registered AI agents turn local physical work (BLE proximity
/// pings from nearby beacons) and local compute work (offloaded NPU ZK-proof generation) into
/// $mHUMAN micro-unit rewards.
/// @dev Mining is agent-native: every entry point goes through {AgentGated}, so only an agent
/// registered in the AIAgentRegistry can submit proofs, and rewards are disbursed to that agent's
/// own contract account (its smart-account address), never to an arbitrary caller-supplied wallet.
///
/// Two proof types are accepted:
///   * {PROOF_TYPE_BLE_PING}  - Type 1: a batch of physical-proximity BLE observations. The batch is
///     only accepted when the strongest signal in the window is genuinely close, the observations
///     are recent, and the node-signed telemetry digest is present.
///   * {PROOF_TYPE_ZK_COMPUTE} - Type 2: a batch of NPU tasks whose results carry a ZK proof digest.
///
/// Both payloads are a fixed 6-word (192 byte) ABI blob, so a malformed submission is rejected by
/// length before any decoding happens.
contract MaoTangMining is AgentGated {
    /// @dev ASCII "maotang.mining.ble-ping.v1", right-padded with zeros.
    bytes32 public constant PROOF_TYPE_BLE_PING = 0x6d616f74616e672e6d696e696e672e626c652d70696e672e7631000000000000;

    /// @dev ASCII "maotang.mining.zk-compute.v1", right-padded with zeros.
    bytes32 public constant PROOF_TYPE_ZK_COMPUTE = 0x6d616f74616e672e6d696e696e672e7a6b2d636f6d707574652e763100000000;

    /// @notice Fixed payload width: 6 ABI words. Rejects garbage before decoding.
    uint256 public constant PROOF_DATA_BYTES = 6 * 32;

    /// @notice Micro-HUMAN micro-units paid per accepted BLE proximity ping.
    uint256 public constant BLE_REWARD_PER_PING = 1_000 * 10 ** 6;

    /// @notice Micro-HUMAN micro-units paid per accepted NPU compute task.
    uint256 public constant COMPUTE_REWARD_PER_TASK = 5_000 * 10 ** 6;

    /// @notice Upper bound on observations a single BLE proof may batch.
    uint256 public constant MAX_BLE_PINGS_PER_PROOF = 64;

    /// @notice Upper bound on tasks a single compute proof may batch.
    uint256 public constant MAX_COMPUTE_TASKS_PER_PROOF = 64;

    /// @notice Minimum attested NPU work units a single compute proof must carry.
    uint256 public constant MIN_COMPUTE_UNITS = 1_000;

    /// @notice Weakest signal (dBm) still considered "physically near".
    int256 public constant MIN_BLE_RSSI = -100;

    /// @notice Strongest signal (dBm) accepted; anything louder is treated as a replay of a local file.
    int256 public constant MAX_BLE_RSSI = -20;

    /// @notice How old the newest observation in a proof may be.
    uint256 public constant MAX_PROOF_AGE = 15 minutes;

    /// @notice Emission epoch length.
    uint256 public constant EPOCH_SECONDS = 1 days;

    /// @notice Hard ceiling on rewards accrued in one epoch: one human quota.
    uint256 public constant MAX_EPOCH_REWARD = 1_000_000 * 10 ** 6;

    /// @notice $mHUMAN token that backs mining rewards.
    HumanToken public immutable mhuman;

    /// @notice Total micro-units ever accrued through mining (before claims).
    uint256 public totalMiningRewardsEmitted;

    /// @notice Total micro-units ever disbursed to agents.
    uint256 public totalMiningRewardsClaimed;

    /// @notice Accrued-but-unclaimed micro-units per agent.
    mapping(address agent => uint256 amount) public pendingMiningRewards;

    /// @notice Proof nullifiers that were already scored, so no proof can be submitted twice.
    mapping(bytes32 nullifier => bool consumed) public consumedMiningProof;

    /// @notice Rewards already accrued inside each epoch.
    mapping(uint256 epoch => uint256 amount) public epochRewardPaid;

    /// @notice Type 1: a batch of BLE proximity observations, abstracted to a fixed 6-word blob.
    struct BleBatch {
        uint256 pingCount;
        /// @dev Strongest (least negative) RSSI seen in the batch; must sit in the proximity band.
        int256 strongestRssi;
        uint256 windowStart;
        uint256 windowEnd;
        bytes32 beaconSetHash;
        bytes32 telemetryDigest;
    }

    /// @notice Type 2: a batch of offloaded NPU tasks, abstracted to a fixed 6-word blob.
    struct ComputeBatch {
        uint256 taskCount;
        uint256 computeUnits;
        uint256 windowStart;
        uint256 windowEnd;
        bytes32 taskSetHash;
        bytes32 proofDigest;
    }

    event MiningProofAccepted(
        address indexed agent, bytes32 indexed proofType, bytes32 indexed nullifier, uint256 units, uint256 reward
    );
    event MiningRewardsClaimed(address indexed agent, uint256 amount);
    event RewardVaultFunded(address indexed funder, uint256 amount);

    error InvalidMiningDependencies();
    error UnknownProofType(bytes32 proofType);
    error MalformedProof(uint256 length, uint256 expected);
    error ReplayProof(bytes32 nullifier);
    error InvalidBatchSize(uint256 units, uint256 max);
    error EmptyProofDigest();
    error MissingAttestation();
    error OutOfProximityRange(int256 rssi, int256 floor, int256 ceiling);
    error InvalidProofWindow(uint256 windowStart, uint256 windowEnd);
    error ProofFromTheFuture(uint256 windowEnd, uint256 now);
    error StaleProof(uint256 windowEnd, uint256 now, uint256 maxAge);
    error InsufficientCompute(uint256 provided, uint256 required);
    error EpochEmissionCapExceeded(uint256 epoch, uint256 requested, uint256 remaining);
    error NothingToClaim(address agent);
    error InsufficientRewardVault(uint256 requested, uint256 available);
    error RewardTransferFailed();
    error ZeroAmount();

    /// @param agentRegistry_ AIAgentRegistry that authorizes miners.
    /// @param mhuman_ $mHUMAN token that funds the reward vault.
    constructor(address agentRegistry_, address mhuman_) AgentGated(agentRegistry_) {
        if (agentRegistry_ == address(0) || mhuman_ == address(0)) revert InvalidMiningDependencies();
        mhuman = HumanToken(mhuman_);
    }

    /// @notice Submits one mining proof (physical proximity or NPU compute) for the calling agent.
    /// @dev The proof is scored immediately and the reward is accrued to the agent; the agent then
    /// pulls it with {claimMiningRewards}. A proof is single-use: its nullifier is written before
    /// accrual, so replaying the same bytes reverts.
    /// @param proofType {PROOF_TYPE_BLE_PING} or {PROOF_TYPE_ZK_COMPUTE}.
    /// @param proofData 192-byte ABI blob described by {BleBatch} / {ComputeBatch}.
    /// @return reward Micro-units accrued to the calling agent.
    function submitMiningProof(bytes32 proofType, bytes memory proofData)
        external
        onlyAuthorizedAgent
        returns (uint256 reward)
    {
        if (proofData.length != PROOF_DATA_BYTES) revert MalformedProof(proofData.length, PROOF_DATA_BYTES);

        address agent = msg.sender;
        bytes32 nullifier = miningProofNullifier(proofType, agent, proofData);
        if (consumedMiningProof[nullifier]) revert ReplayProof(nullifier);

        uint256 units;
        if (proofType == PROOF_TYPE_BLE_PING) {
            (reward, units) = _scoreBleBatch(proofData);
        } else if (proofType == PROOF_TYPE_ZK_COMPUTE) {
            (reward, units) = _scoreComputeBatch(proofData);
        } else {
            revert UnknownProofType(proofType);
        }

        uint256 epoch = block.timestamp / EPOCH_SECONDS;
        uint256 paid = epochRewardPaid[epoch];
        if (paid + reward > MAX_EPOCH_REWARD) {
            revert EpochEmissionCapExceeded(epoch, reward, MAX_EPOCH_REWARD - paid);
        }

        consumedMiningProof[nullifier] = true;
        epochRewardPaid[epoch] = paid + reward;
        pendingMiningRewards[agent] += reward;
        totalMiningRewardsEmitted += reward;

        emit MiningProofAccepted(agent, proofType, nullifier, units, reward);
    }

    /// @notice Disburses the calling agent's accrued rewards from the protocol reward vault.
    /// @dev The vault is this contract's own $mHUMAN balance, funded through {fundRewardVault}; there
    /// is no mint privilege here, so mining can never dilute holders past what was deposited.
    /// @return amount Micro-units transferred to the agent's contract account.
    function claimMiningRewards() external onlyAuthorizedAgent returns (uint256 amount) {
        address agent = msg.sender;
        amount = pendingMiningRewards[agent];
        if (amount == 0) revert NothingToClaim(agent);

        uint256 available = mhuman.balanceOf(address(this));
        if (amount > available) revert InsufficientRewardVault(amount, available);

        pendingMiningRewards[agent] = 0;
        totalMiningRewardsClaimed += amount;

        if (!mhuman.transfer(agent, amount)) revert RewardTransferFailed();
        emit MiningRewardsClaimed(agent, amount);
    }

    /// @notice Tops up the reward vault with `amount` micro-units pulled from the caller.
    /// @dev Callers must {approve} this contract first. Anyone may fund the vault; nobody may mint.
    function fundRewardVault(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (!mhuman.transferFrom(msg.sender, address(this), amount)) revert RewardTransferFailed();
        emit RewardVaultFunded(msg.sender, amount);
    }

    /// @notice $mHUMAN micro-units currently available to disburse.
    function rewardVaultBalance() external view returns (uint256) {
        return mhuman.balanceOf(address(this));
    }

    /// @notice Reward a given number of units would earn for a proof type (before caps).
    function quoteMiningReward(bytes32 proofType, uint256 units) external pure returns (uint256) {
        if (proofType == PROOF_TYPE_BLE_PING) return BLE_REWARD_PER_PING * units;
        if (proofType == PROOF_TYPE_ZK_COMPUTE) return COMPUTE_REWARD_PER_TASK * units;
        revert UnknownProofType(proofType);
    }

    /// @notice Single-use handle for a proof, bound to the agent that submitted it.
    function miningProofNullifier(bytes32 proofType, address agent, bytes memory proofData)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(proofType, agent, proofData));
    }

    function _scoreBleBatch(bytes memory proofData) private view returns (uint256 reward, uint256 units) {
        (
            uint256 pingCount,
            int256 strongestRssi,
            uint256 windowStart,
            uint256 windowEnd,
            bytes32 beaconSetHash,
            bytes32 telemetryDigest
        ) = abi.decode(proofData, (uint256, int256, uint256, uint256, bytes32, bytes32));

        if (pingCount == 0 || pingCount > MAX_BLE_PINGS_PER_PROOF) {
            revert InvalidBatchSize(pingCount, MAX_BLE_PINGS_PER_PROOF);
        }
        if (beaconSetHash == bytes32(0)) revert EmptyProofDigest();
        if (telemetryDigest == bytes32(0)) revert MissingAttestation();
        if (strongestRssi < MIN_BLE_RSSI || strongestRssi > MAX_BLE_RSSI) {
            revert OutOfProximityRange(strongestRssi, MIN_BLE_RSSI, MAX_BLE_RSSI);
        }
        _requireFreshWindow(windowStart, windowEnd);

        return (BLE_REWARD_PER_PING * pingCount, pingCount);
    }

    function _scoreComputeBatch(bytes memory proofData) private view returns (uint256 reward, uint256 units) {
        (
            uint256 taskCount,
            uint256 computeUnits,
            uint256 windowStart,
            uint256 windowEnd,
            bytes32 taskSetHash,
            bytes32 proofDigest
        ) = abi.decode(proofData, (uint256, uint256, uint256, uint256, bytes32, bytes32));

        if (taskCount == 0 || taskCount > MAX_COMPUTE_TASKS_PER_PROOF) {
            revert InvalidBatchSize(taskCount, MAX_COMPUTE_TASKS_PER_PROOF);
        }
        if (computeUnits < MIN_COMPUTE_UNITS) revert InsufficientCompute(computeUnits, MIN_COMPUTE_UNITS);
        if (taskSetHash == bytes32(0)) revert EmptyProofDigest();
        if (proofDigest == bytes32(0)) revert MissingAttestation();
        _requireFreshWindow(windowStart, windowEnd);

        return (COMPUTE_REWARD_PER_TASK * taskCount, taskCount);
    }

    function _requireFreshWindow(uint256 windowStart, uint256 windowEnd) private view {
        if (windowEnd < windowStart) revert InvalidProofWindow(windowStart, windowEnd);
        if (windowEnd > block.timestamp) revert ProofFromTheFuture(windowEnd, block.timestamp);
        if (block.timestamp - windowEnd > MAX_PROOF_AGE) revert StaleProof(windowEnd, block.timestamp, MAX_PROOF_AGE);
    }
}