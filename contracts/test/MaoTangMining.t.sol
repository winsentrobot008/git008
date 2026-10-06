// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AIAgentRegistry} from "../src/AIAgentRegistry.sol";
import {HumanToken} from "../src/HumanToken.sol";
import {MaoTangMining} from "../src/MaoTangMining.sol";

/// @dev Mining is agent-native: proofs are scored for a registered agent, and the reward is
/// disbursed from the contract's own $mHUMAN vault to that agent's contract account.
contract MaoTangMiningTest is Test {
    uint256 internal constant QUOTA = 1_000_000 * 10 ** 6;
    uint256 internal constant MAX_EPOCH_REWARD = 1_000_000 * 10 ** 6;
    uint256 internal constant BLE_REWARD_PER_PING = 1_000 * 10 ** 6;
    uint256 internal constant COMPUTE_REWARD_PER_TASK = 5_000 * 10 ** 6;
    uint256 internal constant NOW = 1_700_000_000;

    AIAgentRegistry internal registry;
    HumanToken internal token;
    MaoTangMining internal mining;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal ghost = address(0xDEAD);

    bytes32 internal constant ALICE_KEY = keccak256("alice-agent-key");
    bytes32 internal constant BOB_KEY = keccak256("bob-agent-key");

    address internal aliceAgent;
    address internal bobAgent;

    function setUp() public {
        vm.warp(NOW);

        registry = new AIAgentRegistry();
        token = new HumanToken(address(registry));
        mining = new MaoTangMining(address(registry), address(token));

        aliceAgent = _registerAgent(alice, ALICE_KEY, "alice-hardware");
        bobAgent = _registerAgent(bob, BOB_KEY, "bob-hardware");

        // One human quota, minted through the agent, funds the reward vault used across tests.
        vm.prank(aliceAgent);
        token.claimHumanQuota(abi.encodePacked("personhood-", uint256(1)));
    }

    // ------------------------------------------------------------------------------- happy paths

    function test_BleBatchAccruesRewardAndClaimDisbursesToAgent() public {
        _fundVault(QUOTA);

        uint256 reward = _submitBle(aliceAgent, 4, -45, NOW - 60, bytes32(uint256(1)), bytes32(uint256(2)));

        assertEq(reward, 4 * BLE_REWARD_PER_PING);
        assertEq(mining.pendingMiningRewards(aliceAgent), reward);
        assertEq(mining.totalMiningRewardsEmitted(), reward);
        assertEq(mining.rewardVaultBalance(), QUOTA);

        vm.prank(aliceAgent);
        uint256 amount = mining.claimMiningRewards();

        assertEq(amount, reward);
        // The reward lands in the agent's own contract account, not in the human wallet.
        assertEq(token.balanceOf(aliceAgent), reward);
        assertEq(token.balanceOf(alice), QUOTA - reward);
        assertEq(mining.pendingMiningRewards(aliceAgent), 0);
        assertEq(mining.totalMiningRewardsClaimed(), reward);
        assertEq(mining.rewardVaultBalance(), QUOTA - reward);
    }

    function test_ComputeBatchAccruesReward() public {
        uint256 reward = _submitCompute(aliceAgent, 3, 5_000, NOW - 30, bytes32(uint256(3)), bytes32(uint256(4)));

        assertEq(reward, 3 * COMPUTE_REWARD_PER_TASK);
        assertEq(mining.pendingMiningRewards(aliceAgent), reward);
    }

    function test_AgentsAccrueIndependently() public {
        _submitBle(aliceAgent, 1, -50, NOW, bytes32(uint256(11)), bytes32(uint256(12)));
        _submitCompute(bobAgent, 2, 2_000, NOW, bytes32(uint256(13)), bytes32(uint256(14)));

        assertEq(mining.pendingMiningRewards(aliceAgent), BLE_REWARD_PER_PING);
        assertEq(mining.pendingMiningRewards(bobAgent), 2 * COMPUTE_REWARD_PER_TASK);
    }

    // ------------------------------------------------------------------------------------ gating

    function test_UnregisteredCallerCannotSubmit() public {
        vm.prank(ghost);
        vm.expectRevert(abi.encodeWithSelector(AIAgentRegistry.UnauthorizedAgent.selector, ghost));
        mining.submitMiningProof(mining.PROOF_TYPE_BLE_PING(), _bleProof(1, -50, NOW, bytes32(uint256(1)), bytes32(uint256(2))));
    }

    function test_UnregisteredCallerCannotClaim() public {
        vm.prank(ghost);
        vm.expectRevert(abi.encodeWithSelector(AIAgentRegistry.UnauthorizedAgent.selector, ghost));
        mining.claimMiningRewards();
    }

    function test_RevokedAgentCannotMine() public {
        vm.prank(alice);
        registry.revokeAgent(aliceAgent);

        vm.prank(aliceAgent);
        vm.expectRevert(abi.encodeWithSelector(AIAgentRegistry.UnauthorizedAgent.selector, aliceAgent));
        mining.claimMiningRewards();
    }

    // ------------------------------------------------------------------------------ proof rules

    function test_UnknownProofTypeReverts() public {
        bytes32 weird = keccak256("not-a-proof-type");
        vm.prank(aliceAgent);
        vm.expectRevert(abi.encodeWithSelector(MaoTangMining.UnknownProofType.selector, weird));
        mining.submitMiningProof(weird, _bleProof(1, -50, NOW, bytes32(uint256(1)), bytes32(uint256(2))));
    }

    function test_MalformedProofRejected() public {
        vm.prank(aliceAgent);
        vm.expectRevert(abi.encodeWithSelector(MaoTangMining.MalformedProof.selector, uint256(64), uint256(192)));
        mining.submitMiningProof(mining.PROOF_TYPE_BLE_PING(), abi.encode(uint256(1), int256(-50), NOW, NOW));
    }

    function test_ReplayProofRejected() public {
        bytes memory proof = _bleProof(2, -45, NOW, bytes32(uint256(1)), bytes32(uint256(2)));

        _submitBleRaw(aliceAgent, proof);

        vm.prank(aliceAgent);
        vm.expectRevert();
        mining.submitMiningProof(mining.PROOF_TYPE_BLE_PING(), proof);

        assertEq(mining.pendingMiningRewards(aliceAgent), 2 * BLE_REWARD_PER_PING);
    }

    /// @dev The nullifier is bound to the agent: the same telemetry from two agents is two proofs.
    function test_SameTelemetryFromAnotherAgentIsNotAReplay() public {
        bytes memory proof = _bleProof(1, -45, NOW, bytes32(uint256(1)), bytes32(uint256(2)));

        _submitBleRaw(aliceAgent, proof);
        _submitBleRaw(bobAgent, proof);

        assertEq(mining.pendingMiningRewards(aliceAgent), BLE_REWARD_PER_PING);
        assertEq(mining.pendingMiningRewards(bobAgent), BLE_REWARD_PER_PING);
        assertTrue(
            mining.miningProofNullifier(mining.PROOF_TYPE_BLE_PING(), aliceAgent, proof)
                != mining.miningProofNullifier(mining.PROOF_TYPE_BLE_PING(), bobAgent, proof)
        );
    }

    function test_DistantSignalRejected() public {
        vm.prank(aliceAgent);
        vm.expectRevert(abi.encodeWithSelector(MaoTangMining.OutOfProximityRange.selector, int256(-101), int256(-100), int256(-20)));
        mining.submitMiningProof(mining.PROOF_TYPE_BLE_PING(), _bleProof(1, -101, NOW, bytes32(uint256(1)), bytes32(uint256(2))));
    }

    function test_ImpossiblyStrongSignalRejected() public {
        vm.prank(aliceAgent);
        vm.expectRevert(abi.encodeWithSelector(MaoTangMining.OutOfProximityRange.selector, int256(0), int256(-100), int256(-20)));
        mining.submitMiningProof(mining.PROOF_TYPE_BLE_PING(), _bleProof(1, 0, NOW, bytes32(uint256(1)), bytes32(uint256(2))));
    }

    function test_StaleProofRejected() public {
        uint256 windowEnd = NOW - 16 minutes;
        vm.prank(aliceAgent);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangMining.StaleProof.selector, windowEnd, NOW, mining.MAX_PROOF_AGE())
        );
        mining.submitMiningProof(mining.PROOF_TYPE_BLE_PING(), _bleProof(1, -45, windowEnd, bytes32(uint256(1)), bytes32(uint256(2))));
    }

    function test_FutureWindowRejected() public {
        uint256 windowEnd = NOW + 1;
        vm.prank(aliceAgent);
        vm.expectRevert(abi.encodeWithSelector(MaoTangMining.ProofFromTheFuture.selector, windowEnd, NOW));
        mining.submitMiningProof(mining.PROOF_TYPE_BLE_PING(), _bleProof(1, -45, windowEnd, bytes32(uint256(1)), bytes32(uint256(2))));
    }

    function test_ZeroPingBatchRejected() public {
        vm.prank(aliceAgent);
        vm.expectRevert(abi.encodeWithSelector(MaoTangMining.InvalidBatchSize.selector, uint256(0), uint256(64)));
        mining.submitMiningProof(mining.PROOF_TYPE_BLE_PING(), _bleProof(0, -45, NOW, bytes32(uint256(1)), bytes32(uint256(2))));
    }

    function test_MissingAttestationRejected() public {
        vm.prank(aliceAgent);
        vm.expectRevert(MaoTangMining.MissingAttestation.selector);
        mining.submitMiningProof(mining.PROOF_TYPE_BLE_PING(), _bleProof(1, -45, NOW, bytes32(uint256(1)), bytes32(0)));

        vm.prank(aliceAgent);
        vm.expectRevert(MaoTangMining.EmptyProofDigest.selector);
        mining.submitMiningProof(mining.PROOF_TYPE_ZK_COMPUTE(), _computeProof(1, 2_000, NOW, bytes32(0), bytes32(uint256(5))));
    }

    function test_InsufficientComputeRejected() public {
        vm.prank(aliceAgent);
        vm.expectRevert(abi.encodeWithSelector(MaoTangMining.InsufficientCompute.selector, uint256(999), uint256(1_000)));
        mining.submitMiningProof(mining.PROOF_TYPE_ZK_COMPUTE(), _computeProof(1, 999, NOW, bytes32(uint256(1)), bytes32(uint256(2))));
    }

    // --------------------------------------------------------------------------- emission + vault

    function test_EpochEmissionCapIsEnforced() public {
        // 64-task compute proofs are worth 0.32 quotas, so the third exhausts most of the epoch.
        _submitCompute(aliceAgent, 64, 64_000, NOW, bytes32(uint256(1)), bytes32(uint256(101)));
        _submitCompute(aliceAgent, 64, 64_000, NOW, bytes32(uint256(2)), bytes32(uint256(102)));
        _submitCompute(aliceAgent, 64, 64_000, NOW, bytes32(uint256(3)), bytes32(uint256(103)));

        uint256 paid = 3 * 64 * COMPUTE_REWARD_PER_TASK;
        assertEq(paid, 960_000 * 10 ** 6);
        assertEq(mining.epochRewardPaid(NOW / 1 days), paid);

        uint256 requested = 64 * COMPUTE_REWARD_PER_TASK;
        vm.prank(aliceAgent);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangMining.EpochEmissionCapExceeded.selector, NOW / 1 days, requested, MAX_EPOCH_REWARD - paid)
        );
        mining.submitMiningProof(
            mining.PROOF_TYPE_ZK_COMPUTE(), _computeProof(64, 64_000, NOW, bytes32(uint256(4)), bytes32(uint256(104)))
        );
    }

    function test_EmissionBudgetResetsInTheNextEpoch() public {
        _submitCompute(aliceAgent, 64, 64_000, NOW, bytes32(uint256(1)), bytes32(uint256(101)));
        _submitCompute(aliceAgent, 64, 64_000, NOW, bytes32(uint256(2)), bytes32(uint256(102)));
        _submitCompute(aliceAgent, 64, 64_000, NOW, bytes32(uint256(3)), bytes32(uint256(103)));

        uint256 nextEpoch = NOW + 1 days;
        vm.warp(nextEpoch);
        uint256 reward = _submitCompute(aliceAgent, 64, 64_000, nextEpoch, bytes32(uint256(9)), bytes32(uint256(109)));

        assertEq(reward, 64 * COMPUTE_REWARD_PER_TASK);
        assertEq(mining.epochRewardPaid(nextEpoch / 1 days), reward);
    }

    function test_ClaimRevertsWhenVaultIsUnderfunded() public {
        _submitBle(aliceAgent, 1, -45, NOW, bytes32(uint256(1)), bytes32(uint256(2)));

        vm.prank(aliceAgent);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangMining.InsufficientRewardVault.selector, BLE_REWARD_PER_PING, uint256(0))
        );
        mining.claimMiningRewards();
    }

    function test_ClaimWithNothingAccruedReverts() public {
        vm.prank(aliceAgent);
        vm.expectRevert(abi.encodeWithSelector(MaoTangMining.NothingToClaim.selector, aliceAgent));
        mining.claimMiningRewards();
    }

    function test_FundRewardVaultPullsApprovedTokens() public {
        uint256 topUp = 500 * 10 ** 6;

        vm.prank(alice);
        token.approve(address(mining), topUp);
        vm.prank(alice);
        mining.fundRewardVault(topUp);

        assertEq(mining.rewardVaultBalance(), topUp);
        assertEq(token.balanceOf(alice), QUOTA - topUp);
    }

    function test_FundRewardVaultRejectsZero() public {
        vm.prank(alice);
        vm.expectRevert(MaoTangMining.ZeroAmount.selector);
        mining.fundRewardVault(0);
    }

    // ------------------------------------------------------------------------------------- views

    function test_QuoteMiningReward() public view {
        assertEq(mining.quoteMiningReward(mining.PROOF_TYPE_BLE_PING(), 3), 3 * BLE_REWARD_PER_PING);
        assertEq(mining.quoteMiningReward(mining.PROOF_TYPE_ZK_COMPUTE(), 3), 3 * COMPUTE_REWARD_PER_TASK);
    }

    function test_ProofTypesAreDistinctAndAsciiTagged() public view {
        assertTrue(mining.PROOF_TYPE_BLE_PING() != mining.PROOF_TYPE_ZK_COMPUTE());
        // ASCII "maotang.mining.ble-ping.v1" / "maotang.mining.zk-compute.v1", zero-padded.
        assertEq(mining.PROOF_TYPE_BLE_PING(), 0x6d616f74616e672e6d696e696e672e626c652d70696e672e7631000000000000);
        assertEq(mining.PROOF_TYPE_ZK_COMPUTE(), 0x6d616f74616e672e6d696e696e672e7a6b2d636f6d707574652e763100000000);
        assertEq(mining.PROOF_DATA_BYTES(), 192);
    }

    function testFuzz_BleRewardScalesLinearlyWithPings(uint8 pings) public {
        pings = uint8(bound(pings, 1, mining.MAX_BLE_PINGS_PER_PROOF()));

        uint256 reward = _submitBle(aliceAgent, pings, -45, NOW, bytes32(uint256(1)), bytes32(uint256(2)));

        assertEq(reward, uint256(pings) * BLE_REWARD_PER_PING);
        assertEq(mining.pendingMiningRewards(aliceAgent), uint256(pings) * BLE_REWARD_PER_PING);
    }

    function testFuzz_NullifierIsDeterministicAndAgentBound(bytes memory proofData) public view {
        bytes32 first = mining.miningProofNullifier(mining.PROOF_TYPE_BLE_PING(), aliceAgent, proofData);
        bytes32 again = mining.miningProofNullifier(mining.PROOF_TYPE_BLE_PING(), aliceAgent, proofData);
        bytes32 other = mining.miningProofNullifier(mining.PROOF_TYPE_BLE_PING(), bobAgent, proofData);
        assertEq(first, again);
        assertTrue(first != other);
    }

    // ---------------------------------------------------------------------------------- helpers

    function _registerAgent(address human, bytes32 key, string memory hardware) internal returns (address agent) {
        vm.prank(human);
        agent = registry.registerAgent(key, abi.encodePacked(hardware));
    }

    function _fundVault(uint256 amount) internal {
        vm.prank(alice);
        token.approve(address(mining), amount);
        vm.prank(alice);
        mining.fundRewardVault(amount);
    }

    function _bleProof(uint256 pingCount, int256 minRssi, uint256 windowEnd, bytes32 beaconSet, bytes32 telemetry)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(pingCount, minRssi, windowEnd - 5 minutes, windowEnd, beaconSet, telemetry);
    }

    function _computeProof(uint256 taskCount, uint256 computeUnits, uint256 windowEnd, bytes32 taskSet, bytes32 proof)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(taskCount, computeUnits, windowEnd - 5 minutes, windowEnd, taskSet, proof);
    }

    function _submitBle(address agent, uint256 pings, int256 minRssi, uint256 windowEnd, bytes32 beaconSet, bytes32 telemetry)
        internal
        returns (uint256 reward)
    {
        return _submitBleRaw(agent, _bleProof(pings, minRssi, windowEnd, beaconSet, telemetry));
    }

    function _submitBleRaw(address agent, bytes memory proof) internal returns (uint256 reward) {
        vm.prank(agent);
        reward = mining.submitMiningProof(mining.PROOF_TYPE_BLE_PING(), proof);
    }

    function _submitCompute(address agent, uint256 tasks, uint256 units, uint256 windowEnd, bytes32 taskSet, bytes32 proof)
        internal
        returns (uint256 reward)
    {
        vm.prank(agent);
        reward = mining.submitMiningProof(mining.PROOF_TYPE_ZK_COMPUTE(), _computeProof(tasks, units, windowEnd, taskSet, proof));
    }
}