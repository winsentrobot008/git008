// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MaotangPaymaster} from "../src/MaotangPaymaster.sol";

contract MaotangPaymasterTest is Test {
    MaotangPaymaster internal paymaster;
    address internal entryPoint = address(0xE);
    address internal sender = address(0x5E4D);
    address internal otherSender = address(0x07E4);
    uint256 internal authorizerKey = 0xA11CE;
    address internal authorizer;

    function setUp() public {
        authorizer = vm.addr(authorizerKey);
        paymaster = new MaotangPaymaster(entryPoint, authorizer, address(this));
        paymaster.setAllowedSender(sender, true);
    }

    function _signature(address who, uint256 validUntil, uint256 nonce) internal view returns (bytes memory) {
        bytes32 digest = paymaster.authorizationDigest(who, validUntil, nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(authorizerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _op(address who, uint256 nonce, uint256 validUntil)
        internal
        view
        returns (MaotangPaymaster.PackedUserOperation memory)
    {
        bytes memory signature = _signature(who, validUntil, nonce);
        bytes memory data = abi.encode(validUntil, nonce, signature);
        bytes memory paymasterAndData = abi.encodePacked(address(paymaster), uint128(200_000), uint128(50_000), data);
        return MaotangPaymaster.PackedUserOperation({
            sender: who,
            nonce: nonce,
            initCode: hex"",
            callData: hex"",
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: paymasterAndData,
            signature: hex""
        });
    }

    function _validate(MaotangPaymaster.PackedUserOperation memory op) internal returns (uint256 validationData) {
        vm.prank(entryPoint);
        (, validationData) = paymaster.validatePaymasterUserOp(op, keccak256("userop"), 0);
    }

    function test_ValidAuthorizationIsSponsored() public {
        uint256 validUntil = block.timestamp + 10 minutes;
        uint256 validationData = _validate(_op(sender, 1, validUntil));
        assertEq(validationData, validUntil << 160);
        assertTrue(paymaster.usedNonce(sender, 1));

        (uint256 used, uint256 remaining,,) = paymaster.quotaOf(sender);
        assertEq(used, 1);
        assertEq(remaining, 99);
    }

    function test_NonceCannotBeReplayed() public {
        uint256 validUntil = block.timestamp + 10 minutes;
        _validate(_op(sender, 7, validUntil));

        MaotangPaymaster.PackedUserOperation memory replay = _op(sender, 7, validUntil);
        vm.prank(entryPoint);
        vm.expectRevert(abi.encodeWithSelector(MaotangPaymaster.NonceAlreadyUsed.selector, sender, 7));
        paymaster.validatePaymasterUserOp(replay, keccak256("userop"), 0);
    }

    function test_ExpiredAuthorizationIsRejected() public {
        vm.warp(1_000_000);
        uint256 validUntil = block.timestamp - 1;
        MaotangPaymaster.PackedUserOperation memory expired = _op(sender, 1, validUntil);
        vm.prank(entryPoint);
        vm.expectRevert(
            abi.encodeWithSelector(MaotangPaymaster.AuthorizationExpired.selector, validUntil, block.timestamp)
        );
        paymaster.validatePaymasterUserOp(expired, keccak256("userop"), 0);
    }

    function test_WrongSignerIsRejected() public {
        uint256 validUntil = block.timestamp + 10 minutes;
        bytes32 digest = paymaster.authorizationDigest(sender, validUntil, 2);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xB0B, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        bytes memory paymasterAndData = abi.encodePacked(
            address(paymaster), uint128(200_000), uint128(50_000), abi.encode(validUntil, uint256(2), signature)
        );
        MaotangPaymaster.PackedUserOperation memory op = _op(sender, 2, validUntil);
        op.paymasterAndData = paymasterAndData;

        vm.prank(entryPoint);
        vm.expectRevert(MaotangPaymaster.InvalidAuthorization.selector);
        paymaster.validatePaymasterUserOp(op, keccak256("userop"), 0);
    }

    function test_UnlistedSenderIsRejected() public {
        paymaster.setAllowlistEnabled(true);
        uint256 validUntil = block.timestamp + 10 minutes;
        MaotangPaymaster.PackedUserOperation memory blocked = _op(otherSender, 1, validUntil);
        vm.prank(entryPoint);
        vm.expectRevert(abi.encodeWithSelector(MaotangPaymaster.SenderNotAllowed.selector, otherSender));
        paymaster.validatePaymasterUserOp(blocked, keccak256("userop"), 0);
    }

    function test_AllowlistIsOffByDefaultAndCanBeEnabledAsAnIncidentControl() public {
        assertFalse(paymaster.allowlistEnabled());

        uint256 validUntil = block.timestamp + 10 minutes;
        _validate(_op(otherSender, 1, validUntil));

        paymaster.setAllowlistEnabled(true);
        MaotangPaymaster.PackedUserOperation memory blocked = _op(otherSender, 2, validUntil);
        vm.prank(entryPoint);
        vm.expectRevert(abi.encodeWithSelector(MaotangPaymaster.SenderNotAllowed.selector, otherSender));
        paymaster.validatePaymasterUserOp(blocked, keccak256("userop"), 0);
    }

    function test_RollingLimitIsOneHundredPerSender() public {
        uint256 validUntil = block.timestamp + 30 minutes;
        for (uint256 nonce = 0; nonce < paymaster.DAILY_LIMIT(); nonce++) {
            _validate(_op(sender, nonce, validUntil));
        }

        (uint256 used, uint256 remaining,,) = paymaster.quotaOf(sender);
        assertEq(used, 100);
        assertEq(remaining, 0);

        MaotangPaymaster.PackedUserOperation memory blocked = _op(sender, 100, validUntil);
        vm.prank(entryPoint);
        vm.expectRevert();
        paymaster.validatePaymasterUserOp(blocked, keccak256("userop"), 0);

        // The window resets only after the full 24h has elapsed.
        vm.warp(block.timestamp + paymaster.WINDOW() + 1);
        _validate(_op(sender, 200, block.timestamp + 10 minutes));
        (uint256 usedAfter,,,) = paymaster.quotaOf(sender);
        assertEq(usedAfter, 1);
    }

    function test_QuotaIsUnknownAfterEveryTimestampExpires() public {
        uint256 validUntil = block.timestamp + 30 minutes;
        for (uint256 nonce = 0; nonce < paymaster.DAILY_LIMIT(); nonce++) {
            _validate(_op(sender, nonce, validUntil));
        }

        vm.warp(block.timestamp + paymaster.WINDOW() + 1);
        (uint256 used, uint256 remaining,,) = paymaster.quotaOf(sender);
        assertEq(used, 0);
        assertEq(remaining, 100);
    }

    function test_SlidingWindowReleasesOnlyExpiredOperations() public {
        uint256 firstBatchUntil = block.timestamp + 30 minutes;
        for (uint256 nonce = 0; nonce < 50; nonce++) {
            _validate(_op(sender, nonce, firstBatchUntil));
        }

        vm.warp(block.timestamp + 1 hours);
        uint256 secondBatchUntil = block.timestamp + 30 minutes;
        for (uint256 nonce = 50; nonce < 100; nonce++) {
            _validate(_op(sender, nonce, secondBatchUntil));
        }

        vm.warp(block.timestamp + 23 hours + 1);
        // The first 50 operations are now older than 24h; the second 50 are still live.
        (uint256 used, uint256 remaining,,) = paymaster.quotaOf(sender);
        assertEq(used, 50);
        assertEq(remaining, 50);

        _validate(_op(sender, 100, block.timestamp + 10 minutes));
        (used, remaining,,) = paymaster.quotaOf(sender);
        assertEq(used, 51);
        assertEq(remaining, 49);

        for (uint256 nonce = 101; nonce < 150; nonce++) {
            _validate(_op(sender, nonce, block.timestamp + 10 minutes));
        }
        (used, remaining,,) = paymaster.quotaOf(sender);
        assertEq(used, 100);
        assertEq(remaining, 0);

        MaotangPaymaster.PackedUserOperation memory blocked = _op(sender, 150, block.timestamp + 10 minutes);
        vm.prank(entryPoint);
        vm.expectRevert();
        paymaster.validatePaymasterUserOp(blocked, keccak256("userop"), 0);
    }

    function test_EntryPointOnly() public {
        uint256 validUntil = block.timestamp + 10 minutes;
        MaotangPaymaster.PackedUserOperation memory op = _op(sender, 1, validUntil);
        vm.expectRevert(MaotangPaymaster.NotEntryPoint.selector);
        paymaster.validatePaymasterUserOp(op, keccak256("userop"), 0);
    }
}
