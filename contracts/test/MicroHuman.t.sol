// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {HumanToken} from "../src/HumanToken.sol";

contract MicroHumanTest is Test {
    /// @dev 1,000,000 whole tokens at 6 decimals.
    uint256 internal constant QUOTA = 1_000_000 * 10 ** 6;

    /// @dev 8.3 billion humans, one quota each.
    uint256 internal constant MAX_SUPPLY = 8_300_000_000 * 1_000_000 * 10 ** 6;

    HumanToken internal token;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        token = new HumanToken();
    }

    /// @dev Claims a quota for `human` with a deterministic personhood proof.
    function _claim(address human, uint256 identity) internal returns (bytes memory proof) {
        proof = abi.encodePacked("personhood-", identity);
        vm.prank(human);
        token.claimHumanQuota(proof);
    }

    function test_DecimalsAreStrictlySix() public view {
        assertEq(uint256(token.decimals()), 6);
        assertEq(uint256(token.DECIMALS()), 6);
        assertEq(token.HUMAN_QUOTA(), QUOTA);
        assertEq(token.HUMAN_QUOTA(), 1_000_000 * 10 ** uint256(token.DECIMALS()));
    }

    /// @dev The smallest amount the token can move is exactly 1 micro-unit.
    function test_TransferMovesSingleMicroUnit() public {
        _claim(alice, 1);
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
        _claim(alice, 1);

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
        _claim(alice, 1);

        assertEq(token.totalSupply(), QUOTA);
        assertEq(token.balanceOf(alice), QUOTA);
        assertEq(token.remainingHumanQuota(), 8_300_000_000 - 1);
    }

    /// @dev One proof, one claim: the same identity cannot be replayed.
    function test_ClaimCannotBeReplayedWithSameProof() public {
        bytes memory proof = abi.encodePacked("personhood-", uint256(42));

        vm.prank(alice);
        token.claimHumanQuota(proof);

        vm.prank(alice);
        vm.expectRevert(HumanToken.QuotaAlreadyClaimed.selector);
        token.claimHumanQuota(proof);

        assertEq(token.totalSupply(), QUOTA);
    }

    /// @dev A consumed identity cannot be replayed from a different wallet either.
    function test_ConsumedIdentityCannotClaimFromAnotherWallet() public {
        bytes memory proof = abi.encodePacked("personhood-", uint256(7));

        vm.prank(alice);
        token.claimHumanQuota(proof);

        vm.prank(bob);
        vm.expectRevert(HumanToken.QuotaAlreadyClaimed.selector);
        token.claimHumanQuota(proof);

        assertEq(token.balanceOf(bob), 0);
    }

    function test_ClaimRejectsEmptyProof() public {
        vm.prank(alice);
        vm.expectRevert(HumanToken.EmptyProof.selector);
        token.claimHumanQuota("");
    }

    /// @dev Minted supply scales exactly as 8.3B humans * 1M units * 10^6.
    function test_TotalMintedSupplyScalesToFullHumanity() public {
        assertEq(token.MAX_GLOBAL_SUPPLY(), MAX_SUPPLY);
        assertEq(token.MAX_GLOBAL_SUPPLY(), 8_300_000_000 * QUOTA);
        assertEq(token.MAX_GLOBAL_SUPPLY() / QUOTA, 8_300_000_000);

        uint256 humans = 8;
        for (uint256 i = 0; i < humans; i++) {
            _claim(address(uint160(0x1000 + i)), i);
        }

        assertEq(token.totalSupply(), humans * QUOTA);
        assertEq(token.totalSupply(), humans * 1_000_000 * 10 ** 6);
        assertEq(token.remainingHumanQuota(), 8_300_000_000 - humans);
    }

    function testFuzz_MintedSupplyScalesLinearlyWithHumans(uint16 humans) public {
        humans = uint16(bound(humans, 1, 200));

        for (uint256 i = 0; i < humans; i++) {
            _claim(address(uint160(0x10000 + i)), i);
        }

        assertEq(token.totalSupply(), uint256(humans) * QUOTA);
    }
}