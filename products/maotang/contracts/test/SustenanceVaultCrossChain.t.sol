// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MaoTangSustenanceVault} from "../src/MaoTangSustenanceVault.sol";
import {MockErc20} from "./mocks/MockErc20.sol";

/// @dev Covers the Phase P3 cross-chain intake on the hub vault: only the owner may register a remote
/// spoke or a bridge adapter, and only an owner-trusted adapter naming the spoke registered for the
/// origin chain can have yield attributed to that chain. Delivered yield joins the same accounting the
/// single-chain fee streams use, so principal routing stays bounded by what the vault actually holds.
contract SustenanceVaultCrossChainTest is Test {
    MaoTangSustenanceVault internal vault;
    MockErc20 internal token;

    address internal authority = address(0xA00);
    address internal stranger = address(0xB0B);
    address internal bridge = address(0xB21D6E);
    address internal spoke = address(0x5F0CE1);
    address internal otherSpoke = address(0x5F0CE2);
    address internal alice = address(0xA11CE);

    uint256 internal constant ORIGIN_CHAIN = 8453;
    uint256 internal constant ONE = 1 ether;
    uint256 internal constant TOKEN_AMOUNT = 500 ether;

    function setUp() public {
        // The registry is never consulted by the cross-chain paths, so a stand-in address is enough.
        vault = new MaoTangSustenanceVault(address(0xA9E47), authority);
        token = new MockErc20();

        vm.prank(authority);
        vault.setRemoteSpoke(ORIGIN_CHAIN, spoke);

        vm.prank(authority);
        vault.setTrustedBridgeAdapter(bridge, true);
    }

    function test_SetRemoteSpokeIsOwnerOnly() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(MaoTangSustenanceVault.NotOwner.selector, stranger));
        vault.setRemoteSpoke(ORIGIN_CHAIN, otherSpoke);

        assertEq(vault.remoteSpokes(ORIGIN_CHAIN), spoke);
    }

    function test_SetTrustedBridgeAdapterIsOwnerOnly() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(MaoTangSustenanceVault.NotOwner.selector, stranger));
        vault.setTrustedBridgeAdapter(stranger, true);

        assertFalse(vault.trustedBridgeAdapters(stranger));
    }

    function test_SetRemoteSpokeRejectsZeroChainId() public {
        vm.prank(authority);
        vm.expectRevert(MaoTangSustenanceVault.InvalidChainId.selector);
        vault.setRemoteSpoke(0, spoke);
    }

    function test_SetTrustedBridgeAdapterRejectsZeroAddress() public {
        vm.prank(authority);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceVault.InvalidBridgeAdapter.selector, address(0))
        );
        vault.setTrustedBridgeAdapter(address(0), true);
    }

    function test_SetRemoteSpokeRegistersAndEmits() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit MaoTangSustenanceVault.RemoteSpokeSet(10, otherSpoke);

        vm.prank(authority);
        vault.setRemoteSpoke(10, otherSpoke);

        assertEq(vault.remoteSpokes(10), otherSpoke);
        assertEq(vault.remoteSpokes(ORIGIN_CHAIN), spoke);
    }

    function test_SetTrustedBridgeAdapterRegistersAndEmits() public {
        vm.expectEmit(true, true, true, true, address(vault));
        emit MaoTangSustenanceVault.TrustedBridgeAdapterSet(otherSpoke, true);

        vm.prank(authority);
        vault.setTrustedBridgeAdapter(otherSpoke, true);

        assertTrue(vault.trustedBridgeAdapters(otherSpoke));

        vm.expectEmit(true, true, true, true, address(vault));
        emit MaoTangSustenanceVault.TrustedBridgeAdapterSet(otherSpoke, false);

        vm.prank(authority);
        vault.setTrustedBridgeAdapter(otherSpoke, false);

        assertFalse(vault.trustedBridgeAdapters(otherSpoke));
    }

    function test_ReceiveBridgedYieldRejectsUntrustedBridge() public {
        vm.deal(stranger, ONE);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceVault.UntrustedBridgeAdapter.selector, stranger)
        );
        vault.receiveBridgedYield{value: ONE}(ORIGIN_CHAIN, spoke);

        assertEq(vault.nativeFeesReceived(), 0);
    }

    function test_ReceiveBridgedYieldRejectsUnregisteredChain() public {
        vm.deal(bridge, ONE);

        vm.prank(bridge);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceVault.UnknownRemoteSpoke.selector, 999, spoke)
        );
        vault.receiveBridgedYield{value: ONE}(999, spoke);
    }

    function test_ReceiveBridgedYieldRejectsUnregisteredSpokeForKnownChain() public {
        vm.deal(bridge, ONE);

        vm.prank(bridge);
        vm.expectRevert(
            abi.encodeWithSelector(
                MaoTangSustenanceVault.UnknownRemoteSpoke.selector, ORIGIN_CHAIN, otherSpoke
            )
        );
        vault.receiveBridgedYield{value: ONE}(ORIGIN_CHAIN, otherSpoke);
    }

    function test_ReceiveBridgedYieldRejectsZeroOriginSpoke() public {
        vm.deal(bridge, ONE);

        vm.prank(bridge);
        vm.expectRevert(
            abi.encodeWithSelector(
                MaoTangSustenanceVault.UnknownRemoteSpoke.selector, ORIGIN_CHAIN, address(0)
            )
        );
        vault.receiveBridgedYield{value: ONE}(ORIGIN_CHAIN, address(0));
    }

    function test_ReceiveBridgedYieldRejectsZeroValue() public {
        vm.prank(bridge);
        vm.expectRevert(MaoTangSustenanceVault.ZeroAmount.selector);
        vault.receiveBridgedYield{value: 0}(ORIGIN_CHAIN, spoke);
    }

    function test_ReceiveBridgedYieldCreditsVaultAndEmits() public {
        vm.deal(bridge, 3 * ONE);

        vm.prank(bridge);
        vm.expectEmit(true, true, true, true, address(vault));
        emit MaoTangSustenanceVault.BridgedYieldReceived(
            ORIGIN_CHAIN, spoke, bridge, ONE, address(0)
        );
        vault.receiveBridgedYield{value: ONE}(ORIGIN_CHAIN, spoke);

        assertEq(vault.nativeFeesReceived(), ONE);
        assertEq(vault.availableNative(), ONE);
        assertEq(address(vault).balance, ONE);

        // A second delivery from the same spoke accumulates rather than overwriting.
        vm.prank(bridge);
        vault.receiveBridgedYield{value: 2 * ONE}(ORIGIN_CHAIN, spoke);

        assertEq(vault.nativeFeesReceived(), 3 * ONE);
        assertEq(address(vault).balance, 3 * ONE);
    }

    function test_BridgedYieldIsRoutableToPrincipals() public {
        vm.deal(bridge, ONE);

        vm.prank(bridge);
        vault.receiveBridgedYield{value: ONE}(ORIGIN_CHAIN, spoke);

        vm.prank(authority);
        vault.creditNativeSustenance(alice, ONE);

        assertEq(vault.pendingSustenance(alice, address(0)), ONE);
        assertEq(vault.availableNative(), 0);

        // The owner still cannot credit more than the bridged deposit actually delivered.
        vm.prank(authority);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceVault.InsufficientVaultBalance.selector, 1, 0)
        );
        vault.creditNativeSustenance(alice, 1);
    }

    function test_ReceiveBridgedYieldTokenPullsAndCredits() public {
        token.mint(bridge, TOKEN_AMOUNT);

        vm.prank(bridge);
        token.approve(address(vault), TOKEN_AMOUNT);

        vm.prank(bridge);
        vm.expectEmit(true, true, true, true, address(vault));
        emit MaoTangSustenanceVault.BridgedYieldReceived(
            ORIGIN_CHAIN, spoke, bridge, TOKEN_AMOUNT, address(token)
        );
        vault.receiveBridgedYieldToken(ORIGIN_CHAIN, spoke, address(token), TOKEN_AMOUNT);

        assertEq(vault.tokenFeesReceived(address(token)), TOKEN_AMOUNT);
        assertEq(vault.availableToken(address(token)), TOKEN_AMOUNT);
        assertEq(token.balanceOf(address(vault)), TOKEN_AMOUNT);
        assertEq(token.balanceOf(bridge), 0);
    }

    function test_ReceiveBridgedYieldTokenRejectsUntrustedBridge() public {
        token.mint(stranger, TOKEN_AMOUNT);

        vm.prank(stranger);
        token.approve(address(vault), TOKEN_AMOUNT);

        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceVault.UntrustedBridgeAdapter.selector, stranger)
        );
        vault.receiveBridgedYieldToken(ORIGIN_CHAIN, spoke, address(token), TOKEN_AMOUNT);

        assertEq(token.balanceOf(address(vault)), 0);
    }

    function test_ReceiveBridgedYieldTokenRejectsUnregisteredSpoke() public {
        token.mint(bridge, TOKEN_AMOUNT);

        vm.prank(bridge);
        token.approve(address(vault), TOKEN_AMOUNT);

        vm.prank(bridge);
        vm.expectRevert(
            abi.encodeWithSelector(
                MaoTangSustenanceVault.UnknownRemoteSpoke.selector, ORIGIN_CHAIN, otherSpoke
            )
        );
        vault.receiveBridgedYieldToken(ORIGIN_CHAIN, otherSpoke, address(token), TOKEN_AMOUNT);
    }

    function test_ReceiveBridgedYieldTokenRejectsNativeSentinel() public {
        vm.prank(bridge);
        vm.expectRevert(MaoTangSustenanceVault.NativeAssetRequiresDepositFee.selector);
        vault.receiveBridgedYieldToken(ORIGIN_CHAIN, spoke, address(0), TOKEN_AMOUNT);
    }

    function test_ReceiveBridgedYieldTokenRejectsZeroAmount() public {
        vm.prank(bridge);
        vm.expectRevert(MaoTangSustenanceVault.ZeroAmount.selector);
        vault.receiveBridgedYieldToken(ORIGIN_CHAIN, spoke, address(token), 0);
    }

    function test_ReceiveBridgedYieldTokenFailsWhenBridgeHasNotApproved() public {
        token.mint(bridge, TOKEN_AMOUNT);

        vm.prank(bridge);
        vm.expectRevert();
        vault.receiveBridgedYieldToken(ORIGIN_CHAIN, spoke, address(token), TOKEN_AMOUNT);
    }

    function test_RevokedSpokeStopsIntake() public {
        vm.prank(authority);
        vault.setRemoteSpoke(ORIGIN_CHAIN, address(0));

        vm.deal(bridge, ONE);
        vm.prank(bridge);
        vm.expectRevert(
            abi.encodeWithSelector(
                MaoTangSustenanceVault.UnknownRemoteSpoke.selector, ORIGIN_CHAIN, spoke
            )
        );
        vault.receiveBridgedYield{value: ONE}(ORIGIN_CHAIN, spoke);
    }

    function test_RevokedBridgeStopsIntake() public {
        vm.prank(authority);
        vault.setTrustedBridgeAdapter(bridge, false);

        vm.deal(bridge, ONE);
        vm.prank(bridge);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceVault.UntrustedBridgeAdapter.selector, bridge)
        );
        vault.receiveBridgedYield{value: ONE}(ORIGIN_CHAIN, spoke);
    }

    function test_PlainReceiveAfterBridgedYieldCountsSeparately() public {
        vm.deal(bridge, 2 * ONE);

        vm.prank(bridge);
        vault.receiveBridgedYield{value: ONE}(ORIGIN_CHAIN, spoke);

        // A plain transfer afterwards is still recorded exactly once, as a Swap fee.
        vm.prank(bridge);
        (bool ok,) = address(vault).call{value: ONE}("");
        assertTrue(ok);

        assertEq(vault.nativeFeesReceived(), 2 * ONE);
    }
}
