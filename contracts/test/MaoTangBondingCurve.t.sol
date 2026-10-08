// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AIAgentRegistry} from "../src/AIAgentRegistry.sol";
import {MockNullifierVerifier} from "./mocks/MockZKVerifier.sol";
import {MaoTangSustenanceVault} from "../src/MaoTangSustenanceVault.sol";
import {MaoTangBondingCurve} from "../src/MaoTangBondingCurve.sol";
import {MaoTangFactory} from "../src/MaoTangFactory.sol";
import {MemeToken} from "../src/MemeToken.sol";
import {IMaoTangCurve} from "../src/interfaces/IMaoTangCurve.sol";
import {IMaoTangGraduate} from "../src/interfaces/IMaoTangGraduate.sol";
import {IMaoTangFactory} from "../src/interfaces/IMaoTangFactory.sol";

/// @dev Covers P0-2: the on-chain curve must mirror `sdk/src/curve-math.ts`, and every trade must
/// route exactly 0.5% to `MaoTangSustenanceVault`, with a further 1.00% at graduation.
contract MaoTangBondingCurveTest is Test {
    MockNullifierVerifier internal verifier;
    AIAgentRegistry internal registry;
    MaoTangSustenanceVault internal vault;
    MaoTangFactory internal factory;

    MaoTangBondingCurve internal curve;
    MemeToken internal meme;

    address internal authority = address(0xA00);
    address internal liquidityVenue = address(0xBEEF);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    uint256 internal constant VIRTUAL_RESERVE = 30 ether;
    uint256 internal constant VIRTUAL_SUPPLY = 1_073_000_000 * 10 ** 18;
    uint256 internal constant TARGET = 5 ether;
    uint256 internal constant SWAP_BPS = 50;
    uint256 internal constant GRAD_BPS = 100;

    function setUp() public {
        verifier = new MockNullifierVerifier();
        registry = new AIAgentRegistry(address(verifier));
        vault = new MaoTangSustenanceVault(address(registry), authority);
        factory = new MaoTangFactory(address(vault), liquidityVenue);

        (address token, address curveAddress) = factory.createMemeToken("Mao Tang", "MAOTANG");
        curve = MaoTangBondingCurve(curveAddress);
        meme = MemeToken(token);

        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function test_LaunchBindsTokenCurveAndVault() public view {
        assertEq(curve.token(), address(meme));
        assertEq(address(meme.curve()), address(curve));
        assertEq(curve.target(), TARGET);
        assertEq(curve.vault(), address(vault));
        assertEq(curve.market(), liquidityVenue);
        assertEq(factory.launchCount(), 1);
        assertEq(factory.launchAt(0), address(curve));
        assertEq(factory.curveOf(address(meme)), address(curve));
        assertEq(meme.totalSupply(), VIRTUAL_SUPPLY);
        assertEq(meme.balanceOf(address(curve)), VIRTUAL_SUPPLY);
        assertEq(meme.decimals(), 18);
    }

    function test_DuplicateSymbolIsRejected() public {
        vm.expectRevert(abi.encodeWithSelector(IMaoTangFactory.SymbolAlreadyUsed.selector, "MAOTANG"));
        factory.createMemeToken("Copy", "MAOTANG");
    }

    function test_EmptyMetadataIsRejected() public {
        vm.expectRevert(IMaoTangFactory.InvalidTokenMetadata.selector);
        factory.createMemeToken("", "SYM");
    }

    function test_BuyMirrorsOffChainCurveMath() public {
        uint256 reserveIn = 1 ether;
        uint256 fee = (reserveIn * SWAP_BPS) / 10_000;
        uint256 net = reserveIn - fee;
        uint256 expectedTokens =
            VIRTUAL_SUPPLY - (VIRTUAL_SUPPLY * VIRTUAL_RESERVE) / (VIRTUAL_RESERVE + net);

        uint256 priceBefore = curve.calculatePrice();

        vm.prank(alice);
        uint256 tokensOut = curve.buyTokensOnCurve{value: reserveIn}();

        assertEq(tokensOut, expectedTokens);
        assertEq(meme.balanceOf(alice), expectedTokens);
        assertEq(curve.reserve(), net);
        assertEq(curve.tokensSold(), expectedTokens);
        assertGt(curve.calculatePrice(), priceBefore);
    }

    function test_BuyRoutesExactlyHalfPercentToVault() public {
        uint256 reserveIn = 1 ether;

        vm.prank(alice);
        curve.buyTokensOnCurve{value: reserveIn}();

        uint256 expectedFee = (reserveIn * SWAP_BPS) / 10_000;
        assertEq(vault.nativeFeesReceived(), expectedFee);
        assertEq(vault.quoteFee(MaoTangSustenanceVault.FeeSource.Swap, reserveIn), expectedFee);
        assertEq(address(curve).balance, reserveIn - expectedFee);
    }

    function test_BuyRejectsZeroValue() public {
        vm.prank(alice);
        vm.expectRevert(MaoTangBondingCurve.ZeroAmount.selector);
        curve.buyTokensOnCurve{value: 0}();
    }

    function test_BuyHonoursSlippageBound() public {
        vm.prank(alice);
        vm.expectPartialRevert(IMaoTangCurve.SlippageExceeded.selector);
        curve.buyTokensOnCurve{value: 1 ether}(type(uint256).max);
    }

    function test_SellReturnsReserveAndRoutesFee() public {
        vm.prank(alice);
        uint256 tokensOut = curve.buyTokensOnCurve{value: 1 ether}();

        uint256 feesAfterBuy = vault.nativeFeesReceived();

        vm.prank(alice);
        meme.approve(address(curve), tokensOut);

        uint256 balanceBefore = alice.balance;

        vm.prank(alice);
        uint256 amountOut = curve.sellTokensOnCurve();

        assertGt(amountOut, 0);
        assertLt(amountOut, 1 ether, "round trip must cost the swap fees");
        assertEq(alice.balance, balanceBefore + amountOut);
        assertGt(vault.nativeFeesReceived(), feesAfterBuy, "sell must route a swap fee");
        assertEq(meme.balanceOf(alice), 0);
        assertEq(meme.totalSupply(), VIRTUAL_SUPPLY - tokensOut);
        assertEq(curve.tokensSold(), 0);
    }

    function test_SellWithoutAllowanceReverts() public {
        vm.prank(alice);
        curve.buyTokensOnCurve{value: 1 ether}();

        vm.prank(alice);
        vm.expectRevert(MaoTangBondingCurve.ZeroAmount.selector);
        curve.sellTokensOnCurve();
    }

    function test_GraduationIsRejectedBeforeTarget() public {
        vm.prank(alice);
        curve.buyTokensOnCurve{value: 1 ether}();

        assertLt(curve.graduationProgressBps(), 10_000);

        vm.expectRevert(
            abi.encodeWithSelector(IMaoTangGraduate.CurveNotComplete.selector, curve.graduationProgressBps())
        );
        curve.graduateToMarket();
    }

    function test_GraduationTakesOnePercentAndMigratesLiquidity() public {
        vm.prank(alice);
        curve.buyTokensOnCurve{value: 5.1 ether}();

        assertEq(curve.graduationProgressBps(), 10_000);
        assertTrue(curve.reserve() >= TARGET);

        uint256 reserveBefore = curve.reserve();
        uint256 swapFees = vault.nativeFeesReceived();
        uint256 expectedGraduationFee = (reserveBefore * GRAD_BPS) / 10_000;
        uint256 expectedNet = reserveBefore - expectedGraduationFee;
        uint256 expectedInventory = meme.balanceOf(address(curve));

        address market = curve.graduateToMarket();

        assertEq(market, liquidityVenue);
        assertTrue(curve.graduated());
        assertEq(curve.reserve(), 0);
        assertEq(address(curve).balance, 0);
        assertEq(liquidityVenue.balance, expectedNet);
        assertEq(meme.balanceOf(liquidityVenue), expectedInventory);
        assertEq(
            vault.nativeFeesReceived(),
            swapFees + expectedGraduationFee,
            "graduation fee must reach the sustenance vault"
        );
    }

    function test_TradingIsClosedAfterGraduation() public {
        vm.prank(alice);
        curve.buyTokensOnCurve{value: 5.1 ether}();
        curve.graduateToMarket();

        vm.prank(bob);
        vm.expectRevert(IMaoTangCurve.CurveAlreadyGraduated.selector);
        curve.buyTokensOnCurve{value: 1 ether}();

        vm.prank(bob);
        vm.expectRevert(IMaoTangCurve.CurveAlreadyGraduated.selector);
        curve.sellTokensOnCurve();
    }

    function test_GraduationIsNotRepeatable() public {
        vm.prank(alice);
        curve.buyTokensOnCurve{value: 5.1 ether}();
        curve.graduateToMarket();

        vm.expectRevert(abi.encodeWithSelector(IMaoTangGraduate.MarketAlreadyDeployed.selector, liquidityVenue));
        curve.graduateToMarket();
    }
}
