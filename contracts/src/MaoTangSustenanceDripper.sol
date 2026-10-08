// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {HumanToken} from "./HumanToken.sol";
import {MaoTangSustenanceVault} from "./MaoTangSustenanceVault.sol";

/// @title MaoTangSustenanceDripper
/// @notice Pays accrued protocol yield straight to $mHUMAN holders, gated on a signed hardware
///         telemetry attestation, without the owner adjudicating each claim.
/// @dev Whitepaper v2.2 section 5.3. `MaoTangSustenanceVault` can only route fees to a principal when
/// the owner credits that principal by hand, which does not scale past a handful of humans. The dripper
/// is the autonomous payout path: a holder proves recent node telemetry, and the contract prices a
/// payout from that weight and from the balance the holder carries.
///
/// Three independent bounds keep an autonomous payout from becoming an autonomous drain:
///
///   1. **Cooldown.** One claim per account per {claimCooldown} (default 1 day), so a valid
///      attestation cannot be repeated into a stream.
///   2. **Windowed signature.** The digest binds the claim to the current
///      `block.timestamp / claimCooldown` window, so a signature is only usable while it is fresh.
///      Replaying last week attestation fails on the digest, not on a nullifier table.
///   3. **Vault budget.** {MaoTangSustenanceVault} only pays out of the budget its owner reserved, so
///      a bug or a compromised signer key cannot reach the rest of the vault.
///
/// Signature scheme. The payload is `abi.encode(CLAIM_DOMAIN, chainid, address(this), account,
/// telemetryWeight, window)`, hashed with SHA-256 and signed with secp256k1 ECDSA. Verification uses
/// `ecrecover` over the SHA-256 digest directly, which is why the off-chain signer must emit a flat
/// r||s (or r||s||v) signature - `node:crypto` does that with `dsaEncoding: "ieee-p1363"`. The
/// DER form `node:crypto` produces by default is not accepted; the orchestrator normalises it.
///
/// Drip math (see `docs/MAOTANG_ARCHITECTURE.md` section 15):
///
///   payout = min(telemetryWeight * weightRate + mHumanBalance * balanceRate, maxDripPerClaim)
///
/// Both legs are linear and the cap is absolute, so the price of a claim is auditable from three
/// numbers and a holder can predict a payout before spending gas on it.
contract MaoTangSustenanceDripper {
    /// @notice Vault holding the protocol fees this contract pays out of.
    MaoTangSustenanceVault public immutable vault;

    /// @notice $mHUMAN, read for the balance leg of the drip math.
    HumanToken public immutable mHuman;

    /// @notice Protocol authority that tunes the drip and can stop it.
    /// @dev Immutable, mirroring the rest of the protocol: no admin takeover path.
    address public immutable owner;

    /// @notice Domain separator mixed into every claim digest.
    bytes32 public constant CLAIM_DOMAIN = keccak256("maotang.drip.claim.v1");

    /// @notice Lowest {claimCooldown} the owner may set.
    uint256 public constant MIN_CLAIM_COOLDOWN = 1 hours;

    /// @notice Highest {claimCooldown} the owner may set.
    uint256 public constant MAX_CLAIM_COOLDOWN = 30 days;

    /// @dev secp256k1 group order divided by two; signatures above it are malleable and rejected.
    uint256 private constant HALF_ORDER =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

    /// @notice Minimum gap between two claims by the same account.
    uint256 public claimCooldown = 1 days;

    /// @notice Unix seconds of each account last successful claim; 0 for an account that never claimed.
    mapping(address account => uint256 timestamp) public lastClaimTimestamp;

    /// @notice Address whose signature attests to a telemetry weight.
    address public telemetrySigner;

    /// @notice Native wei paid per unit of telemetry weight.
    uint256 public weightRate = 1e9;

    /// @notice Native wei paid per $mHUMAN micro-unit held.
    uint256 public balanceRate = 1e3;

    /// @notice Ceiling on one native claim, in wei.
    uint256 public maxDripPerClaim = 0.01 ether;

    /// @notice $mHUMAN micro-units an account must hold to claim at all.
    uint256 public minHumanBalance = 1_000_000;

    /// @notice Payouts below this revert, so a claim never costs more gas than it pays.
    uint256 public minDripAmount = 1e12;

    /// @notice Per-asset parameters for {claimDripYieldToken}.
    mapping(address asset => DripRate rate) public tokenRates;

    /// @notice Emergency stop for the payout path, set by the owner.
    bool public paused;

    /// @notice Parameters pricing one asset drip.
    /// @param weightRate Payout units per unit of telemetry weight.
    /// @param balanceRate Payout units per $mHUMAN micro-unit held.
    /// @param maxPerClaim Absolute ceiling on a single claim.
    struct DripRate {
        uint256 weightRate;
        uint256 balanceRate;
        uint256 maxPerClaim;
    }

    /// @notice Emitted on every successful claim, in both the native and the token path.
    /// @dev `amount` is denominated in the asset that was paid; the matching
    /// `MaoTangSustenanceVault.DripAllowanceWithdrawn` log carries the asset address.
    /// @param account Claimant that received the yield.
    /// @param amount Amount paid, in the paid asset smallest unit.
    /// @param telemetryWeight Weight the payout was priced from.
    event YieldClaimed(address indexed account, uint256 amount, uint256 telemetryWeight);

    /// @notice Emitted when the owner rotates the telemetry attestation key.
    event TelemetrySignerSet(address indexed signer);

    /// @notice Emitted when the owner changes the claim cooldown.
    event ClaimCooldownSet(uint256 cooldown);

    /// @notice Emitted when the owner changes the native drip math.
    event DripRatesSet(uint256 weightRate, uint256 balanceRate, uint256 maxDripPerClaim);

    /// @notice Emitted when the owner changes one asset drip math.
    event TokenDripRatesSet(address indexed asset, uint256 weightRate, uint256 balanceRate, uint256 maxPerClaim);

    /// @notice Emitted when the owner changes the claim guardrails.
    event ClaimGuardrailsSet(uint256 minHumanBalance, uint256 minDripAmount);

    /// @notice Emitted when the owner stops or resumes payouts.
    event PausedSet(bool paused);

    error NotOwner(address caller);
    error InvalidOwner();
    error InvalidVault();
    error InvalidHumanToken();
    error InvalidTelemetrySigner();
    error InvalidDripAsset(address asset);
    error InvalidClaimCooldown(uint256 cooldown);
    error UnsupportedDripAsset(address asset);
    error ZeroTelemetryWeight();
    error ZeroAmount();
    error ClaimCooldownActive(address account, uint256 readyAt);
    error InvalidTelemetrySignature(address account);
    error InvalidSignatureLength(uint256 length);
    error InsufficientHumanBalance(address account, uint256 balance, uint256 required);
    error DripBelowMinimum(uint256 payout, uint256 minimum);
    error DripPaused();

    /// @dev Reverts unless the caller is the protocol authority.
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    /// @param vault_ Vault the drip budget is paid from.
    /// @param mHuman_ $mHUMAN contract used for the balance leg and the holder check.
    /// @param owner_ Protocol authority allowed to tune and pause the drip.
    /// @param telemetrySigner_ Key that attests telemetry weights. Rotatable, never zero.
    constructor(address vault_, address mHuman_, address owner_, address telemetrySigner_) {
        if (vault_ == address(0)) revert InvalidVault();
        if (mHuman_ == address(0)) revert InvalidHumanToken();
        if (owner_ == address(0)) revert InvalidOwner();
        if (telemetrySigner_ == address(0)) revert InvalidTelemetrySigner();

        vault = MaoTangSustenanceVault(payable(vault_));
        mHuman = HumanToken(mHuman_);
        owner = owner_;
        telemetrySigner = telemetrySigner_;

        emit TelemetrySignerSet(telemetrySigner_);
    }

    /// @notice Claims native yield against a signed telemetry attestation.
    /// @param telemetryWeight Weight the authorized signer attested for the caller.
    /// @param signature Flat secp256k1 signature (64 bytes r||s, or 65 bytes r||s||v) over the
    /// SHA-256 digest of this claim.
    /// @return paid Native amount transferred to the caller.
    function claimDripYield(uint256 telemetryWeight, bytes calldata signature)
        external
        returns (uint256 paid)
    {
        return _claim(msg.sender, telemetryWeight, signature, address(0));
    }

    /// @notice Claims ERC-20 yield against a signed telemetry attestation.
    /// @param telemetryWeight Weight the authorized signer attested for the caller.
    /// @param signature Flat secp256k1 signature (64 bytes r||s, or 65 bytes r||s||v) over the
    /// SHA-256 digest of this claim.
    /// @param asset ERC-20 to be paid. Must have rates configured via {setTokenDripRates}.
    /// @return paid Token amount transferred to the caller.
    function claimDripYieldToken(uint256 telemetryWeight, bytes calldata signature, address asset)
        external
        returns (uint256 paid)
    {
        if (asset == address(0)) revert InvalidDripAsset(asset);
        return _claim(msg.sender, telemetryWeight, signature, asset);
    }

    /// @notice Claim window the current block belongs to.
    /// @dev The signature binds this value, which is what makes an attestation expire on its own.
    function claimWindow() public view returns (uint256) {
        return block.timestamp / claimCooldown;
    }

    /// @notice Digest the telemetry signer must sign for `account` to claim `telemetryWeight` now.
    function claimDigest(address account, uint256 telemetryWeight) public view returns (bytes32) {
        return claimDigestFor(account, telemetryWeight, claimWindow());
    }

    /// @notice Digest for an explicit window, exposed so an orchestrator can pre-sign a batch.
    function claimDigestFor(address account, uint256 telemetryWeight, uint256 window)
        public
        view
        returns (bytes32)
    {
        return sha256(abi.encode(CLAIM_DOMAIN, block.chainid, address(this), account, telemetryWeight, window));
    }

    /// @notice Native payout `account` would receive for `telemetryWeight` right now.
    function previewDrip(address account, uint256 telemetryWeight) public view returns (uint256) {
        return _quote(mHuman.balanceOf(account), telemetryWeight, weightRate, balanceRate, maxDripPerClaim);
    }

    /// @notice Token payout `account` would receive for `telemetryWeight` right now.
    function previewDripToken(address account, uint256 telemetryWeight, address asset)
        public
        view
        returns (uint256)
    {
        DripRate memory rate = tokenRates[asset];
        return _quote(mHuman.balanceOf(account), telemetryWeight, rate.weightRate, rate.balanceRate, rate.maxPerClaim);
    }

    /// @notice True when `account` may claim right now, ignoring the signature.
    function canClaim(address account) public view returns (bool) {
        // forge-lint: disable-next-line(block-timestamp)
        return !paused && block.timestamp >= lastClaimTimestamp[account] + claimCooldown;
    }

    /// @notice True when `signature` is the telemetry signer attestation of this exact claim.
    /// @dev Exposed so an orchestrator can validate a vector before spending gas on a transaction.
    function verifyTelemetrySignature(address account, uint256 telemetryWeight, bytes calldata signature)
        public
        view
        returns (bool)
    {
        return _recovers(claimDigest(account, telemetryWeight), signature, telemetrySigner);
    }

    /// @notice Rotates the key that attests telemetry weights.
    /// @param signer New attestation signer. Must not be the zero address.
    function setTelemetrySigner(address signer) external onlyOwner {
        if (signer == address(0)) revert InvalidTelemetrySigner();
        telemetrySigner = signer;
        emit TelemetrySignerSet(signer);
    }

    /// @notice Changes the minimum gap between two claims by the same account.
    /// @param cooldown New cooldown, in seconds, within the documented bounds.
    function setClaimCooldown(uint256 cooldown) external onlyOwner {
        if (cooldown < MIN_CLAIM_COOLDOWN || cooldown > MAX_CLAIM_COOLDOWN) revert InvalidClaimCooldown(cooldown);
        claimCooldown = cooldown;
        emit ClaimCooldownSet(cooldown);
    }

    /// @notice Changes the native drip math.
    /// @param weightRate_ Wei per unit of telemetry weight.
    /// @param balanceRate_ Wei per $mHUMAN micro-unit held.
    /// @param maxDripPerClaim_ Absolute ceiling on one native claim, in wei.
    function setDripRates(uint256 weightRate_, uint256 balanceRate_, uint256 maxDripPerClaim_) external onlyOwner {
        weightRate = weightRate_;
        balanceRate = balanceRate_;
        maxDripPerClaim = maxDripPerClaim_;
        emit DripRatesSet(weightRate_, balanceRate_, maxDripPerClaim_);
    }

    /// @notice Changes one asset drip math, which also allowlists the asset for token claims.
    /// @param asset ERC-20 to configure. Must not be the zero address.
    /// @param weightRate_ Payout units per unit of telemetry weight.
    /// @param balanceRate_ Payout units per $mHUMAN micro-unit held.
    /// @param maxPerClaim_ Absolute ceiling on one claim of this asset.
    function setTokenDripRates(address asset, uint256 weightRate_, uint256 balanceRate_, uint256 maxPerClaim_)
        external
        onlyOwner
    {
        if (asset == address(0)) revert InvalidDripAsset(asset);
        tokenRates[asset] = DripRate({weightRate: weightRate_, balanceRate: balanceRate_, maxPerClaim: maxPerClaim_});
        emit TokenDripRatesSet(asset, weightRate_, balanceRate_, maxPerClaim_);
    }

    /// @notice Changes the holder floor and the dust floor.
    /// @param minHumanBalance_ $mHUMAN micro-units required to claim at all.
    /// @param minDripAmount_ Payout below which a claim reverts.
    function setClaimGuardrails(uint256 minHumanBalance_, uint256 minDripAmount_) external onlyOwner {
        minHumanBalance = minHumanBalance_;
        minDripAmount = minDripAmount_;
        emit ClaimGuardrailsSet(minHumanBalance_, minDripAmount_);
    }

    /// @notice Stops or resumes payouts.
    /// @param paused_ Whether claims must revert.
    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function _claim(address account, uint256 telemetryWeight, bytes calldata signature, address asset)
        private
        returns (uint256 paid)
    {
        if (paused) revert DripPaused();
        if (telemetryWeight == 0) revert ZeroTelemetryWeight();

        uint256 readyAt = lastClaimTimestamp[account] + claimCooldown;
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp < readyAt) revert ClaimCooldownActive(account, readyAt);

        if (!verifyTelemetrySignature(account, telemetryWeight, signature)) {
            revert InvalidTelemetrySignature(account);
        }

        uint256 humanBalance = mHuman.balanceOf(account);
        if (humanBalance < minHumanBalance) {
            revert InsufficientHumanBalance(account, humanBalance, minHumanBalance);
        }

        uint256 payout;
        if (asset == address(0)) {
            payout = _quote(humanBalance, telemetryWeight, weightRate, balanceRate, maxDripPerClaim);
        } else {
            DripRate memory rate = tokenRates[asset];
            if (rate.maxPerClaim == 0) revert UnsupportedDripAsset(asset);
            payout = _quote(humanBalance, telemetryWeight, rate.weightRate, rate.balanceRate, rate.maxPerClaim);
        }
        if (payout < minDripAmount) revert DripBelowMinimum(payout, minDripAmount);

        // Effects before the vault interaction, so a reentrant claim sees the cooldown already armed.
        lastClaimTimestamp[account] = block.timestamp;
        paid = vault.withdrawDripAllowance(account, payout, asset);

        // forge-lint: disable-next-line(reentrancy-events)
        emit YieldClaimed(account, paid, telemetryWeight);
    }

    /// @dev `min(weight * weightRate + balance * balanceRate, cap)`. Both legs are linear so the
    /// payout is predictable and auditable from three stored numbers.
    function _quote(
        uint256 humanBalance,
        uint256 telemetryWeight,
        uint256 weightRate_,
        uint256 balanceRate_,
        uint256 cap
    ) private pure returns (uint256) {
        uint256 payout = telemetryWeight * weightRate_ + humanBalance * balanceRate_;
        return payout > cap ? cap : payout;
    }

    /// @dev True when `signature` over `digest` was produced by `expected`.
    /// Two encodings are accepted because the off-chain producer chooses: 65 bytes carry an explicit
    /// recovery id, while 64 bytes (IEEEP1363, which `node:crypto` emits with `dsaEncoding`
    /// `ieee-p1363`) omit it. Without the id both candidates recover a valid address for a given
    /// `(r, s)`, so the 64-byte form is accepted when either candidate is the expected signer. High-s
    /// signatures are rejected as malleable.
    function _recovers(bytes32 digest, bytes calldata signature, address expected) private pure returns (bool) {
        if (signature.length == 65) {
            bytes32 r;
            bytes32 s;
            uint8 v;
            // solhint-disable-next-line no-inline-assembly
            assembly {
                r := calldataload(signature.offset)
                s := calldataload(add(signature.offset, 32))
                v := byte(0, calldataload(add(signature.offset, 64)))
            }
            if (uint256(s) > HALF_ORDER) return false;
            if (v < 27) v += 27;
            if (v != 27 && v != 28) return false;
            return ecrecover(digest, v, r, s) == expected;
        }
        if (signature.length == 64) {
            bytes32 r;
            bytes32 s;
            // solhint-disable-next-line no-inline-assembly
            assembly {
                r := calldataload(signature.offset)
                s := calldataload(add(signature.offset, 32))
            }
            if (uint256(s) > HALF_ORDER) return false;
            return ecrecover(digest, 27, r, s) == expected || ecrecover(digest, 28, r, s) == expected;
        }
        revert InvalidSignatureLength(signature.length);
    }
}
