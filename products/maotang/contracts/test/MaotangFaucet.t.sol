// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MaotangFaucetToken} from "../src/MaotangFaucetToken.sol";
import {MaotangFaucet} from "../src/MaotangFaucet.sol";

contract MaotangFaucetTest is Test {
    MaotangFaucetToken internal token;
    MaotangFaucet internal faucet;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal mallory = address(0xBAD);

    uint256 internal constant REWARD = 10e18;
    uint256 internal constant MAX_REWARD = 100e18;

    bytes32 internal constant ALICE_HASH = keccak256("alice-credential");
    bytes32 internal constant BOB_HASH = keccak256("bob-credential");

    function setUp() public {
        token = new MaotangFaucetToken(address(this));
        faucet = new MaotangFaucet(address(token), address(this), REWARD, MAX_REWARD, address(this));
        token.setMinter(address(faucet));
        token.lockMinter();
    }

    function test_OneClaimPerIdentityHash() public {
        faucet.claim(alice, ALICE_HASH, REWARD);

        assertEq(token.balanceOf(alice), REWARD);
        assertEq(token.totalSupply(), REWARD);
        assertTrue(faucet.hasClaimed(ALICE_HASH));
        assertEq(faucet.totalClaims(), 1);

        vm.expectRevert(abi.encodeWithSelector(MaotangFaucet.AlreadyClaimed.selector, ALICE_HASH));
        faucet.claim(bob, ALICE_HASH, REWARD);

        faucet.claim(bob, BOB_HASH, REWARD);
        assertEq(token.balanceOf(bob), REWARD);
        assertEq(token.totalSupply(), REWARD * 2);
    }

    function test_OnlyMintAuthorityCanClaim() public {
        vm.prank(mallory);
        vm.expectRevert(MaotangFaucet.NotMintAuthority.selector);
        faucet.claim(mallory, ALICE_HASH, REWARD);
    }

    function test_PauseStopsClaims() public {
        faucet.setPaused(true);
        vm.expectRevert(MaotangFaucet.ContractPaused.selector);
        faucet.claim(alice, ALICE_HASH, REWARD);
    }

    function test_RejectsZeroIdentityAndRecipient() public {
        vm.expectRevert(MaotangFaucet.InvalidIdentityHash.selector);
        faucet.claim(alice, bytes32(0), REWARD);

        vm.expectRevert(MaotangFaucet.ZeroAddress.selector);
        faucet.claim(address(0), ALICE_HASH, REWARD);
    }

    function test_RejectsAmountAboveCap() public {
        vm.expectRevert(abi.encodeWithSelector(MaotangFaucet.InvalidAmount.selector, MAX_REWARD + 1, MAX_REWARD));
        faucet.claim(alice, ALICE_HASH, MAX_REWARD + 1);
    }

    function test_DefaultClaimUsesConfiguredReward() public {
        faucet.claimDefault(alice, ALICE_HASH);
        assertEq(token.balanceOf(alice), REWARD);
        assertEq(faucet.rewardUnits(), REWARD);
    }

    function test_MinterLockIsPermanent() public {
        vm.expectRevert(MaotangFaucetToken.MinterIsLocked.selector);
        token.setMinter(address(this));
    }

    function test_TransferBurnsPreviewedAmount() public {
        faucet.claim(alice, ALICE_HASH, REWARD);

        (uint256 received, uint256 burned) = token.previewTransfer(REWARD);
        assertEq(burned, REWARD / 1_000);
        assertEq(received, REWARD - burned);

        vm.prank(alice);
        token.transfer(bob, REWARD);

        assertEq(token.balanceOf(alice), 0);
        assertEq(token.balanceOf(bob), received);
        assertEq(token.totalBurned(), burned);
        assertEq(token.totalSupply(), REWARD - burned);
    }

    function test_SmallMicroPaymentRoundsBurnDownToZero() public {
        faucet.claim(alice, ALICE_HASH, REWARD);

        uint256 microPayment = 999;
        (uint256 received, uint256 burned) = token.previewTransfer(microPayment);
        assertEq(burned, 0);
        assertEq(received, microPayment);

        vm.prank(alice);
        token.transfer(bob, microPayment);
        assertEq(token.balanceOf(bob), microPayment);
    }

    function test_BurnAndBurnFromReduceSupply() public {
        faucet.claim(alice, ALICE_HASH, REWARD);
        uint256 burnAmount = 1e18;

        vm.prank(alice);
        token.approve(bob, burnAmount);

        vm.prank(bob);
        token.burnFrom(alice, burnAmount);

        assertEq(token.balanceOf(alice), REWARD - burnAmount);
        assertEq(token.totalSupply(), REWARD - burnAmount);
        assertEq(token.totalBurned(), burnAmount);

        vm.prank(alice);
        token.burn(1e18);
        assertEq(token.totalSupply(), REWARD - burnAmount - 1e18);
    }

    function test_MintCannotExceedMaxSupply() public {
        MaotangFaucetToken capped = new MaotangFaucetToken(address(this));
        capped.mint(address(this), capped.MAX_SUPPLY());

        assertEq(capped.totalSupply(), capped.MAX_SUPPLY());
        assertEq(capped.totalMinted(), capped.MAX_SUPPLY());

        vm.expectRevert(abi.encodeWithSelector(MaotangFaucetToken.SupplyCapExceeded.selector, 1, 0));
        capped.mint(address(this), 1);
    }

    function test_OwnershipCanMoveWithoutUnlockingMinter() public {
        MaotangFaucetToken owned = new MaotangFaucetToken(address(this));
        owned.lockMinter();
        owned.transferOwnership(alice);

        assertEq(owned.owner(), alice);
        vm.prank(alice);
        vm.expectRevert(MaotangFaucetToken.MinterIsLocked.selector);
        owned.setMinter(alice);
    }
}
