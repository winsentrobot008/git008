// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AIAgentRegistry} from "../src/AIAgentRegistry.sol";
import {MockNullifierVerifier} from "./mocks/MockZKVerifier.sol";
import {MockErc20} from "./mocks/MockErc20.sol";
import {HumanToken} from "../src/HumanToken.sol";
import {MaoTangSustenanceVault} from "../src/MaoTangSustenanceVault.sol";

/// @dev Covers Whitepaper v2.2 section 5.1: swap (0.5%) and graduation (1.00%) fees aggregate in one
/// vault, an immutable protocol authority routes them to human principals, and only a registered
/// agent may withdraw - always into the human wallet, never the agent's own account.
contract MaoTangSustenanceVaultTest is Test {
    MockNullifierVerifier internal verifier;
    AIAgentRegistry internal registry;
    MaoTangSustenanceVault internal vault;
    HumanToken internal mhuman;

    address internal alice = address(0xA11CE);
    address internal authority = address(0xA00);
    address internal ghostAgent = address(0xDEAD);
    address internal treasury = address(0x7E50);
    address internal agent;

    uint256 internal constant ONE = 1 ether;

    function setUp() public {
        verifier = new MockNullifierVerifier();
        registry = new AIAgentRegistry(address(verifier));
        vault = new MaoTangSustenanceVault(address(registry), authority);
        mhuman = new HumanToken(address(registry), address(verifier));

        vm.prank(alice);
        bytes memory hardwareProof = abi.encodePacked("alice-hardware");
        agent = registry.registerAgent(keccak256("alice-agent-key"), hardwareProof, keccak256(hardwareProof));

        vm.deal(address(this), 100 ether);
    }

    function test_DepositFeeRecordsNativePerSource() public {
        vault.depositFee{value: ONE}(MaoTangSustenanceVault.FeeSource.Swap);
        vault.depositFee{value: 2 * ONE}(MaoTangSustenanceVault.FeeSource.Graduation);

        assertEq(vault.nativeFeesReceived(), 3 * ONE);
        assertEq(vault.availableNative(), 3 * ONE);
    }

    function test_DepositFeeEmitsFeeReceived() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit MaoTangSustenanceVault.FeeReceived(
            address(this), MaoTangSustenanceVault.FeeSource.Swap, address(0), ONE
        );
        vault.depositFee{value: ONE}(MaoTangSustenanceVault.FeeSource.Swap);
    }

    function test_PlainTransferIsRecordedAsSwapFee() public {
        (bool ok,) = address(vault).call{value: ONE}("");
        assertTrue(ok);
        assertEq(vault.nativeFeesReceived(), ONE);
    }

    function test_QuoteFeeMirrorsSpecRates() public view {
        assertEq(vault.feeRateBps(MaoTangSustenanceVault.FeeSource.Swap), 50);
        assertEq(vault.feeRateBps(MaoTangSustenanceVault.FeeSource.Graduation), 100);

        assertEq(vault.quoteFee(MaoTangSustenanceVault.FeeSource.Swap, ONE), 0.005 ether);
        assertEq(vault.quoteFee(MaoTangSustenanceVault.FeeSource.Graduation, ONE), 0.01 ether);
    }

    function test_ZeroFeeIsRejected() public {
        vm.expectRevert(MaoTangSustenanceVault.ZeroAmount.selector);
        vault.depositFee{value: 0}(MaoTangSustenanceVault.FeeSource.Swap);
    }

    function test_AuthorityCreditsAndAgentWithdrawsNative() public {
        vault.depositFee{value: ONE}(MaoTangSustenanceVault.FeeSource.Swap);

        vm.prank(authority);
        vault.creditNativeSustenance(alice, ONE);

        assertEq(vault.pendingSustenance(alice, address(0)), ONE);
        assertEq(vault.availableNative(), 0);

        uint256 balanceBefore = alice.balance;

        vm.prank(agent);
        uint256 paid = vault.withdrawSustenance(address(0));

        assertEq(paid, ONE);
        assertEq(alice.balance, balanceBefore + ONE);
        assertEq(vault.pendingSustenance(alice, address(0)), 0);
    }

    function test_WithdrawEmitsSustenanceDisbursed() public {
        vault.depositFee{value: ONE}(MaoTangSustenanceVault.FeeSource.Swap);

        vm.prank(authority);
        vault.creditNativeSustenance(alice, ONE);

        vm.expectEmit(true, true, true, true, address(vault));
        emit MaoTangSustenanceVault.SustenanceDisbursed(agent, alice, address(0), ONE);

        vm.prank(agent);
        vault.withdrawSustenance(address(0));
    }

    function test_CannotCreditMoreThanReceived() public {
        vault.depositFee{value: ONE}(MaoTangSustenanceVault.FeeSource.Swap);

        vm.prank(authority);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceVault.InsufficientVaultBalance.selector, 2 * ONE, ONE)
        );
        vault.creditNativeSustenance(alice, 2 * ONE);
    }

    function test_OnlyAuthorityCanCredit() public {
        vault.depositFee{value: ONE}(MaoTangSustenanceVault.FeeSource.Swap);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MaoTangSustenanceVault.NotOwner.selector, alice));
        vault.creditNativeSustenance(alice, ONE);
    }

    function test_UnregisteredAgentCannotWithdraw() public {
        vault.depositFee{value: ONE}(MaoTangSustenanceVault.FeeSource.Swap);

        vm.prank(authority);
        vault.creditNativeSustenance(alice, ONE);

        vm.prank(ghostAgent);
        vm.expectRevert();
        vault.withdrawSustenance(address(0));
    }

    function test_NothingToWithdrawIsRejected() public {
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceVault.NothingToWithdraw.selector, alice, address(0))
        );
        vault.withdrawSustenance(address(0));
    }

    function test_TokenFeesFlowToPrincipalThroughVault() public {
        vm.prank(agent);
        bytes memory personhoodProof = abi.encodePacked("alice-personhood");
        mhuman.claimHumanQuota(personhoodProof, keccak256(personhoodProof));

        uint256 quota = mhuman.balanceOf(alice);
        assertGt(quota, 0);

        vm.prank(alice);
        mhuman.approve(address(vault), quota);

        vm.prank(alice);
        vault.depositFeeToken(MaoTangSustenanceVault.FeeSource.Swap, address(mhuman), quota);

        assertEq(vault.tokenFeesReceived(address(mhuman)), quota);
        assertEq(mhuman.balanceOf(address(vault)), quota);

        vm.prank(authority);
        vault.creditTokenSustenance(alice, address(mhuman), quota);

        vm.prank(agent);
        uint256 paid = vault.withdrawSustenance(address(mhuman));

        assertEq(paid, quota);
        assertEq(mhuman.balanceOf(alice), quota);
        assertEq(mhuman.balanceOf(address(vault)), 0);
    }

    function test_NativeSentinelIsRejectedForTokenDeposits() public {
        vm.expectRevert(MaoTangSustenanceVault.NativeAssetRequiresDepositFee.selector);
        vault.depositFeeToken(MaoTangSustenanceVault.FeeSource.Swap, address(0), ONE);
    }

    // --------------------------------------------------------------- operator revenue beneficiary

    function test_SetOwnerSustenanceTargetRejectsNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MaoTangSustenanceVault.NotOwner.selector, alice));
        vault.setOwnerSustenanceTarget(treasury);
    }

    function test_SetOwnerSustenanceTargetRejectsZero() public {
        vm.prank(authority);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceVault.InvalidSustenanceTarget.selector, address(0))
        );
        vault.setOwnerSustenanceTarget(address(0));
    }

    function test_SetOwnerSustenanceTargetStoresAndEmits() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit MaoTangSustenanceVault.OwnerSustenanceTargetSet(treasury);

        vm.prank(authority);
        vault.setOwnerSustenanceTarget(treasury);

        assertEq(vault.ownerSustenanceTarget(), treasury);
    }

    function test_WithdrawOwnerRevenueRequiresAConfiguredTarget() public {
        vm.prank(authority);
        vm.expectRevert(MaoTangSustenanceVault.NoSustenanceTarget.selector);
        vault.withdrawOwnerRevenue(address(0));
    }

    function test_WithdrawOwnerRevenuePaysOnlyTheResidual() public {
        vault.depositFee{value: 10 ether}(MaoTangSustenanceVault.FeeSource.Swap);

        vm.prank(authority);
        vault.fundDripBudget(4 ether);
        vm.prank(authority);
        vault.creditNativeSustenance(alice, 1 ether);
        vm.prank(authority);
        vault.setOwnerSustenanceTarget(treasury);

        assertEq(vault.unreservedNative(), 5 ether);

        vm.expectEmit(true, true, true, true, address(vault));
        emit MaoTangSustenanceVault.OwnerRevenueWithdrawn(address(0), treasury, 5 ether);

        vm.prank(authority);
        uint256 paid = vault.withdrawOwnerRevenue(address(0));

        assertEq(paid, 5 ether);
        assertEq(treasury.balance, 5 ether);
        assertEq(vault.nativeOwnerRevenuePaid(), 5 ether);
        assertEq(vault.unreservedNative(), 0);
        assertEq(vault.availableNative(), 4 ether);
        assertEq(vault.unspentDripNative(), 4 ether);
        assertEq(vault.pendingSustenance(alice, address(0)), 1 ether);
        assertEq(address(vault).balance, 5 ether);
    }

    function test_WithdrawOwnerRevenueRevertsWhenNothingIsReserved() public {
        vm.prank(authority);
        vault.setOwnerSustenanceTarget(treasury);

        vm.prank(authority);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceVault.NothingToWithdraw.selector, treasury, address(0))
        );
        vault.withdrawOwnerRevenue(address(0));
    }

    function test_WithdrawOwnerRevenueRoutesTokenResidualToTheBeneficiary() public {
        MockErc20 feeToken = new MockErc20();
        feeToken.mint(address(this), 10 ether);
        feeToken.approve(address(vault), 10 ether);
        vault.depositFeeToken(MaoTangSustenanceVault.FeeSource.Graduation, address(feeToken), 10 ether);

        vm.prank(authority);
        vault.setOwnerSustenanceTarget(treasury);

        vm.prank(authority);
        uint256 paid = vault.withdrawOwnerRevenue(address(feeToken));

        assertEq(paid, 10 ether);
        assertEq(feeToken.balanceOf(treasury), 10 ether);
        assertEq(vault.tokenOwnerRevenuePaid(address(feeToken)), 10 ether);
        assertEq(vault.availableToken(address(feeToken)), 0);
        assertEq(vault.unreservedToken(address(feeToken)), 0);
    }
}
