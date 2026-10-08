// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AIAgentRegistry} from "../src/AIAgentRegistry.sol";
import {HumanToken} from "../src/HumanToken.sol";
import {MaoTangSustenanceDripper} from "../src/MaoTangSustenanceDripper.sol";
import {MaoTangSustenanceVault} from "../src/MaoTangSustenanceVault.sol";
import {MockErc20} from "./mocks/MockErc20.sol";
import {MockNullifierVerifier} from "./mocks/MockZKVerifier.sol";

/// @dev Covers the Phase P4 autonomous drip (`docs/MAOTANG_ARCHITECTURE.md` section 15): a holder
/// presents a signed hardware-telemetry weight and the contract prices a payout from that weight and
/// from the $mHUMAN balance the holder carries, paying out of the budget the vault owner reserved.
///
/// The four protections the suite pins down are the ones that keep an autonomous payout from becoming
/// an autonomous drain: the per-account cooldown, the windowed telemetry signature, the $mHUMAN holder
/// floor and the vault budget bound. Signature fixtures are built with `vm.sign`, which signs the
/// 32-byte digest directly, exactly as `ecrecover` consumes it, and are always hoisted into a local
/// before `vm.prank` / `vm.expectRevert` so the cheatcode applies to the claim and not to the signing.
contract SustenanceDripperTest is Test {
    MockNullifierVerifier internal verifier;
    AIAgentRegistry internal registry;
    MaoTangSustenanceVault internal vault;
    HumanToken internal mhuman;
    MaoTangSustenanceDripper internal dripper;
    MockErc20 internal dripToken;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal authority = address(0xA00);
    address internal stranger = address(0xBAD);
    address internal aliceAgent;

    uint256 internal constant FEE_DEPOSIT = 10 ether;
    uint256 internal constant DRIP_BUDGET = 5 ether;
    uint256 internal constant QUOTA = 1_000_000 * 10 ** 6;
    uint256 internal constant START_TIMESTAMP = 1_700_000_000;
    uint256 internal constant WEIGHT = 1_000_000;
    uint256 internal clock;

    uint256 internal signerPk = 0xA11CE5EED;
    address internal signer;

    /// @dev secp256k1 group order, used to build a malleable high-s variant of a good signature.
    uint256 internal constant SECP256K1_N =
        0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    event YieldClaimed(address indexed account, uint256 amount, uint256 telemetryWeight);

    function setUp() public {
        clock = START_TIMESTAMP;
        vm.warp(clock);

        signer = vm.addr(signerPk);
        verifier = new MockNullifierVerifier();
        registry = new AIAgentRegistry(address(verifier));
        vault = new MaoTangSustenanceVault(address(registry), authority);
        mhuman = new HumanToken(address(registry), address(verifier));
        dripper = new MaoTangSustenanceDripper(address(vault), address(mhuman), authority, signer);
        dripToken = new MockErc20();

        bytes memory hardwareProof = abi.encodePacked("alice-hardware");
        vm.prank(alice);
        aliceAgent = registry.registerAgent(keccak256("alice-agent-key"), hardwareProof, keccak256(hardwareProof));

        bytes memory personhoodProof = abi.encodePacked("alice-personhood");
        vm.prank(aliceAgent);
        mhuman.claimHumanQuota(personhoodProof, keccak256(personhoodProof));

        vm.deal(address(this), 100 ether);
        vault.depositFee{value: FEE_DEPOSIT}(MaoTangSustenanceVault.FeeSource.Swap);

        vm.prank(authority);
        vault.setDripper(address(dripper));
        vm.prank(authority);
        vault.fundDripBudget(DRIP_BUDGET);
    }

    // ------------------------------------------------------------------------------------- deployment

    function test_InitialConfigMatchesSpec() public view {
        assertEq(address(dripper.vault()), address(vault));
        assertEq(address(dripper.mHuman()), address(mhuman));
        assertEq(dripper.owner(), authority);
        assertEq(dripper.telemetrySigner(), signer);
        assertEq(dripper.claimCooldown(), 1 days);
        assertEq(dripper.maxDripPerClaim(), 0.01 ether);
        assertEq(dripper.claimWindow(), START_TIMESTAMP / 1 days);
        assertFalse(dripper.paused());
        assertTrue(dripper.canClaim(alice));
    }

    function test_ConstructorRejectsZeroAddresses() public {
        vm.expectRevert(MaoTangSustenanceDripper.InvalidVault.selector);
        new MaoTangSustenanceDripper(address(0), address(mhuman), authority, signer);

        vm.expectRevert(MaoTangSustenanceDripper.InvalidHumanToken.selector);
        new MaoTangSustenanceDripper(address(vault), address(0), authority, signer);

        vm.expectRevert(MaoTangSustenanceDripper.InvalidOwner.selector);
        new MaoTangSustenanceDripper(address(vault), address(mhuman), address(0), signer);

        vm.expectRevert(MaoTangSustenanceDripper.InvalidTelemetrySigner.selector);
        new MaoTangSustenanceDripper(address(vault), address(mhuman), authority, address(0));
    }

    // ------------------------------------------------------------------------------------- happy path

    function test_ClaimPaysWeightLegPlusBalanceLegAndEmitsYieldClaimed() public {
        uint256 expected = dripper.previewDrip(alice, WEIGHT);
        assertEq(expected, WEIGHT * dripper.weightRate() + QUOTA * dripper.balanceRate());
        assertEq(expected, 2e15);

        bytes memory signature = _sign(signerPk, alice, WEIGHT);
        uint256 balanceBefore = alice.balance;

        vm.expectEmit(true, true, true, true, address(dripper));
        emit YieldClaimed(alice, expected, WEIGHT);

        vm.prank(alice);
        uint256 paid = dripper.claimDripYield(WEIGHT, signature);

        assertEq(paid, expected);
        assertEq(alice.balance, balanceBefore + expected);
    }

    function test_ClaimArmsCooldownAndUpdatesVaultAccounting() public {
        uint256 paid = _claim(alice, WEIGHT);

        assertEq(dripper.lastClaimTimestamp(alice), clock);
        assertFalse(dripper.canClaim(alice));
        assertEq(vault.nativeDripPaid(), paid);
        assertEq(vault.unspentDripNative(), DRIP_BUDGET - paid);
    }

    function test_PayoutIsCappedByMaxDripPerClaim() public {
        uint256 expected = dripper.previewDrip(alice, 1e18);
        assertEq(expected, dripper.maxDripPerClaim());
        assertEq(_claim(alice, 1e18), dripper.maxDripPerClaim());
    }

    function test_ClaimSucceedsAfterCooldownWithFreshSignature() public {
        _claim(alice, WEIGHT);
        uint256 firstPaid = vault.nativeDripPaid();

        _advance(dripper.claimCooldown());
        assertTrue(dripper.canClaim(alice));

        uint256 paid = _claim(alice, 2 * WEIGHT);
        assertEq(paid, dripper.previewDrip(alice, 2 * WEIGHT));
        assertEq(vault.nativeDripPaid(), firstPaid + paid);
        assertEq(dripper.lastClaimTimestamp(alice), clock);
    }

    function test_RepeatedClaimsNeverExceedTheVaultBudget() public {
        uint256 totalPaid;
        for (uint256 i = 0; i < 4; i++) {
            totalPaid += _claim(alice, WEIGHT);
            _advance(dripper.claimCooldown());
        }

        assertEq(totalPaid, vault.nativeDripPaid());
        assertLe(totalPaid, DRIP_BUDGET);
    }

    // ---------------------------------------------------------------------------------------- cooldown

    function test_SecondClaimInsideCooldownReverts() public {
        _claim(alice, WEIGHT);

        bytes memory signature = _sign(signerPk, alice, WEIGHT);
        uint256 readyAt = dripper.lastClaimTimestamp(alice) + dripper.claimCooldown();

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceDripper.ClaimCooldownActive.selector, alice, readyAt)
        );
        dripper.claimDripYield(WEIGHT, signature);
    }

    function test_CooldownMustStayWithinBounds() public {
        vm.startPrank(authority);
        vm.expectRevert(abi.encodeWithSelector(MaoTangSustenanceDripper.InvalidClaimCooldown.selector, 30 minutes));
        dripper.setClaimCooldown(30 minutes);
        vm.expectRevert(abi.encodeWithSelector(MaoTangSustenanceDripper.InvalidClaimCooldown.selector, 31 days));
        dripper.setClaimCooldown(31 days);
        dripper.setClaimCooldown(2 days);
        vm.stopPrank();

        assertEq(dripper.claimCooldown(), 2 days);
        assertEq(dripper.claimWindow(), clock / 2 days);
    }

    // --------------------------------------------------------------------------------------- signature

    function test_TelemetrySignatureIsBoundToTheCurrentWindow() public {
        bytes memory stale = _sign(signerPk, alice, WEIGHT);
        uint256 staleWindow = dripper.claimWindow();

        _advance(dripper.claimCooldown());
        assertGt(dripper.claimWindow(), staleWindow);
        assertTrue(dripper.canClaim(alice));

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceDripper.InvalidTelemetrySignature.selector, alice)
        );
        dripper.claimDripYield(WEIGHT, stale);
    }

    function test_TelemetrySignatureIsBoundToTheClaimant() public {
        bytes memory signatureForAlice = _sign(signerPk, alice, WEIGHT);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MaoTangSustenanceDripper.InvalidTelemetrySignature.selector, bob));
        dripper.claimDripYield(WEIGHT, signatureForAlice);
    }

    function test_TelemetrySignatureIsBoundToTheWeight() public {
        bytes memory signature = _sign(signerPk, alice, WEIGHT);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceDripper.InvalidTelemetrySignature.selector, alice)
        );
        dripper.claimDripYield(WEIGHT + 1, signature);
    }

    function test_AcceptsBothFlatSignatureEncodings() public {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, dripper.claimDigest(alice, WEIGHT));
        bytes memory compact = abi.encodePacked(r, s);
        uint256 expected = dripper.previewDrip(alice, WEIGHT);

        assertTrue(dripper.verifyTelemetrySignature(alice, WEIGHT, abi.encodePacked(r, s, v)));
        assertTrue(dripper.verifyTelemetrySignature(alice, WEIGHT, compact));

        vm.prank(alice);
        assertEq(dripper.claimDripYield(WEIGHT, compact), expected);
    }

    function test_RejectsSignerThatIsNotTheTelemetrySigner() public {
        bytes memory forged = _sign(0xF0E1D, alice, WEIGHT);
        assertFalse(dripper.verifyTelemetrySignature(alice, WEIGHT, forged));

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceDripper.InvalidTelemetrySignature.selector, alice)
        );
        dripper.claimDripYield(WEIGHT, forged);
    }

    function test_RejectsMangledSignature() public {
        bytes memory mangled = _mangle(_sign(signerPk, alice, WEIGHT));
        assertFalse(dripper.verifyTelemetrySignature(alice, WEIGHT, mangled));

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceDripper.InvalidTelemetrySignature.selector, alice)
        );
        dripper.claimDripYield(WEIGHT, mangled);
    }

    function test_RejectsMalleableHighSSignature() public {
        bytes memory highS = _highSVariant(_sign(signerPk, alice, WEIGHT));
        assertFalse(dripper.verifyTelemetrySignature(alice, WEIGHT, highS));

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceDripper.InvalidTelemetrySignature.selector, alice)
        );
        dripper.claimDripYield(WEIGHT, highS);
    }

    function test_RejectsMalformedSignatureLength() public {
        bytes memory truncated = abi.encodePacked(bytes32(uint256(1)));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MaoTangSustenanceDripper.InvalidSignatureLength.selector, 32));
        dripper.claimDripYield(WEIGHT, truncated);
    }

    function test_OwnerCanRotateTelemetrySigner() public {
        uint256 newPk = 0xBEEF;
        address newSigner = vm.addr(newPk);
        bytes memory oldSignature = _sign(signerPk, alice, WEIGHT);

        assertTrue(dripper.verifyTelemetrySignature(alice, WEIGHT, oldSignature));
        assertFalse(dripper.verifyTelemetrySignature(alice, WEIGHT, _sign(newPk, alice, WEIGHT)));

        vm.prank(authority);
        dripper.setTelemetrySigner(newSigner);
        assertEq(dripper.telemetrySigner(), newSigner);

        assertFalse(dripper.verifyTelemetrySignature(alice, WEIGHT, oldSignature));
        assertTrue(dripper.verifyTelemetrySignature(alice, WEIGHT, _sign(newPk, alice, WEIGHT)));

        vm.prank(authority);
        vm.expectRevert(MaoTangSustenanceDripper.InvalidTelemetrySigner.selector);
        dripper.setTelemetrySigner(address(0));
    }

    // ------------------------------------------------------------------------------------ claim guards

    function test_ZeroTelemetryWeightReverts() public {
        bytes memory signature = _sign(signerPk, alice, 0);

        vm.prank(alice);
        vm.expectRevert(MaoTangSustenanceDripper.ZeroTelemetryWeight.selector);
        dripper.claimDripYield(0, signature);
    }

    function test_NonHolderCannotClaim() public {
        assertEq(mhuman.balanceOf(bob), 0);
        bytes memory signature = _sign(signerPk, bob, WEIGHT);
        uint256 floor = dripper.minHumanBalance();

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceDripper.InsufficientHumanBalance.selector, bob, 0, floor)
        );
        dripper.claimDripYield(WEIGHT, signature);
    }

    function test_PayoutBelowDustFloorReverts() public {
        uint256 floor = dripper.minHumanBalance();
        uint256 expected = dripper.previewDrip(alice, WEIGHT);
        bytes memory signature = _sign(signerPk, alice, WEIGHT);

        vm.prank(authority);
        dripper.setClaimGuardrails(floor, 1 ether);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(MaoTangSustenanceDripper.DripBelowMinimum.selector, expected, 1 ether)
        );
        dripper.claimDripYield(WEIGHT, signature);
    }

    function test_PausedDripperRefusesClaims() public {
        bytes memory signature = _sign(signerPk, alice, WEIGHT);

        vm.prank(authority);
        dripper.setPaused(true);
        assertFalse(dripper.canClaim(alice));

        vm.prank(alice);
        vm.expectRevert(MaoTangSustenanceDripper.DripPaused.selector);
        dripper.claimDripYield(WEIGHT, signature);

        vm.prank(authority);
        dripper.setPaused(false);
        assertTrue(dripper.canClaim(alice));
    }

    // ------------------------------------------------------------------------------ vault accounting

    function test_VaultBudgetBoundsTheDrip() public {
        uint256 expected = dripper.previewDrip(alice, WEIGHT);
        bytes memory signature = _sign(signerPk, alice, WEIGHT);

        vm.prank(authority);
        vault.reclaimDripBudget(DRIP_BUDGET - 1e15);
        assertEq(vault.unspentDripNative(), 1e15);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                MaoTangSustenanceVault.DripBudgetExceeded.selector, address(0), expected, 1e15
            )
        );
        dripper.claimDripYield(WEIGHT, signature);
    }

    function test_DripBudgetIsExcludedFromPrincipalCredit() public {
        uint256 unreserved = FEE_DEPOSIT - DRIP_BUDGET;
        assertEq(vault.availableNative(), FEE_DEPOSIT);
        assertEq(vault.unreservedNative(), unreserved);

        vm.prank(authority);
        vm.expectRevert(
            abi.encodeWithSelector(
                MaoTangSustenanceVault.InsufficientVaultBalance.selector, FEE_DEPOSIT, unreserved
            )
        );
        vault.creditNativeSustenance(alice, FEE_DEPOSIT);

        vm.prank(authority);
        vault.creditNativeSustenance(alice, unreserved);
        assertEq(vault.unreservedNative(), 0);
    }

    function test_UnreservedNativeIsInvariantAcrossDrips() public {
        uint256 unreservedBefore = vault.unreservedNative();
        assertEq(unreservedBefore, FEE_DEPOSIT - DRIP_BUDGET);

        _claim(alice, WEIGHT);
        _advance(dripper.claimCooldown());
        _claim(alice, 2 * WEIGHT);

        assertEq(vault.unreservedNative(), unreservedBefore);
    }

    function test_OnlyTheDripperMayDrawTheBudget() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(MaoTangSustenanceVault.NotDripper.selector, stranger));
        vault.withdrawDripAllowance(stranger, 1, address(0));
    }

    // -------------------------------------------------------------------------------------- token drip

    function test_TokenDripPaysOutOfTheTokenBudget() public {
        dripToken.mint(address(this), 10 ether);
        dripToken.approve(address(vault), 10 ether);
        vault.depositFeeToken(MaoTangSustenanceVault.FeeSource.Graduation, address(dripToken), 10 ether);

        vm.prank(authority);
        vault.fundDripBudgetToken(address(dripToken), 5 ether);
        vm.prank(authority);
        dripper.setTokenDripRates(address(dripToken), 1e15, 1e3, 1 ether);

        uint256 expected = dripper.previewDripToken(alice, 1, address(dripToken));
        assertEq(expected, 2e15);

        bytes memory signature = _sign(signerPk, alice, 1);
        vm.prank(alice);
        uint256 paid = dripper.claimDripYieldToken(1, signature, address(dripToken));

        assertEq(paid, expected);
        assertEq(dripToken.balanceOf(alice), expected);
        assertEq(vault.tokenDripPaid(address(dripToken)), expected);
        assertEq(vault.unspentDripToken(address(dripToken)), 5 ether - expected);
    }

    function test_TokenDripRequiresConfiguredRates() public {
        bytes memory signature = _sign(signerPk, alice, 1);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                MaoTangSustenanceDripper.UnsupportedDripAsset.selector, address(dripToken)
            )
        );
        dripper.claimDripYieldToken(1, signature, address(dripToken));

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(MaoTangSustenanceDripper.InvalidDripAsset.selector, address(0)));
        dripper.claimDripYieldToken(1, signature, address(0));
    }

    // ------------------------------------------------------------------------------------ admin surface

    function test_OnlyOwnerCanTuneTheDrip() public {
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(MaoTangSustenanceDripper.NotOwner.selector, stranger));
        dripper.setTelemetrySigner(stranger);
        vm.expectRevert(abi.encodeWithSelector(MaoTangSustenanceDripper.NotOwner.selector, stranger));
        dripper.setClaimCooldown(2 days);
        vm.expectRevert(abi.encodeWithSelector(MaoTangSustenanceDripper.NotOwner.selector, stranger));
        dripper.setDripRates(1, 1, 1);
        vm.expectRevert(abi.encodeWithSelector(MaoTangSustenanceDripper.NotOwner.selector, stranger));
        dripper.setClaimGuardrails(1, 1);
        vm.expectRevert(abi.encodeWithSelector(MaoTangSustenanceDripper.NotOwner.selector, stranger));
        dripper.setPaused(true);
        vm.expectRevert(abi.encodeWithSelector(MaoTangSustenanceDripper.NotOwner.selector, stranger));
        dripper.setTokenDripRates(address(dripToken), 1, 1, 1);
        vm.stopPrank();
    }

    function test_TokenRatesRejectTheNativeAsset() public {
        vm.prank(authority);
        vm.expectRevert(abi.encodeWithSelector(MaoTangSustenanceDripper.InvalidDripAsset.selector, address(0)));
        dripper.setTokenDripRates(address(0), 1, 1, 1);
    }

    function test_OwnerRetunedRatesDriveThePayout() public {
        vm.prank(authority);
        dripper.setDripRates(0, 0, 0.01 ether);
        assertEq(dripper.previewDrip(alice, WEIGHT), 0);

        vm.prank(authority);
        dripper.setDripRates(1e9, 0, 0.02 ether);
        assertEq(dripper.previewDrip(alice, WEIGHT), WEIGHT * 1e9);
        assertEq(_claim(alice, WEIGHT), WEIGHT * 1e9);
    }

    // ----------------------------------------------------------------------------------------- helpers

    /// @dev Advances the simulated clock. Tests never read `block.timestamp` inside `vm.warp`, which
    /// keeps the environment-read-across-mutation lint quiet and makes the timeline explicit.
    function _advance(uint256 seconds_) internal {
        clock += seconds_;
        vm.warp(clock);
    }

    function _claim(address account, uint256 weight) internal returns (uint256 paid) {
        bytes memory signature = _sign(signerPk, account, weight);
        vm.prank(account);
        paid = dripper.claimDripYield(weight, signature);
    }

    function _sign(uint256 pk, address account, uint256 weight) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, dripper.claimDigest(account, weight));
        return abi.encodePacked(r, s, v);
    }

    function _mangle(bytes memory signature) internal pure returns (bytes memory) {
        signature[0] = bytes1(uint8(signature[0]) ^ 0x01);
        return signature;
    }

    /// @dev Re-encodes a good signature as its malleable high-s twin: s becomes `n - s` and the
    /// recovery id flips, which is the second signature that recovers the same key for the same digest.
    function _highSVariant(bytes memory signature) internal pure returns (bytes memory) {
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        uint8 flipped = v == 27 ? 28 : 27;
        return abi.encodePacked(r, bytes32(SECP256K1_N - uint256(s)), flipped);
    }
}
