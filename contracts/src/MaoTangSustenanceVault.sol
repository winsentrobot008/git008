// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentGated} from "./AIAgentRegistry.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @title MaoTangSustenanceVault
/// @notice The single aggregation pool for the protocol's two fee streams.
/// @dev Whitepaper v2.2 section 5.1: swap fees (0.5%) and graduation fees (1.00%) are routed here and
/// nowhere else. The vault is a custody and accounting contract, not a mint:
///
///   * Fees enter only through {depositFee} / {depositFeeToken} (or a plain native transfer), so the
///     vault can never create value that a curve did not actually collect.
///   * The owner routes accrued fees to human principals via {creditNativeSustenance} /
///     {creditTokenSustenance}. Routing is bounded by what has actually been received, so the owner
///     cannot credit more than the vault holds.
///   * A human's registered agent withdraws with {withdrawSustenance}, and the payout always lands in
///     the human wallet the agent was registered for - never in the agent's own account.
///
/// Fee rates are mirrored from `sdk/src/curve-math.ts` (`TRADE_FEE_BPS = 50n`,
/// `GRADUATION_FEE_BPS = 100n`). Changing either is a protocol-economic change and requires a
/// superseding entry in `memory/ARCHITECTURE_DECISIONS.md`.
contract MaoTangSustenanceVault is AgentGated {
    /// @notice The two fee streams the protocol collects.
    enum FeeSource {
        /// 0.5% levied by the bonding curve on every buy and sell.
        Swap,
        /// 1.00% levied on the reserve migrated into a market at graduation.
        Graduation
    }

    /// @notice Swap fee rate, in basis points. Mirrors `TRADE_FEE_BPS` in the SDK.
    uint256 public constant SWAP_FEE_BPS = 50;

    /// @notice Graduation fee rate, in basis points. Mirrors `GRADUATION_FEE_BPS` in the SDK.
    uint256 public constant GRADUATION_FEE_BPS = 100;

    /// @notice Basis point denominator.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Sentinel used for the native asset (ETH) in token-keyed accounting.
    address public constant NATIVE = address(0);

    /// @notice Protocol authority allowed to route accrued fees to principals.
    /// @dev Immutable: there is no admin takeover path. The owner cannot withdraw to itself, only
    /// credit principals, and only up to what the vault has actually received.
    address public immutable owner;

    /// @notice Total native fees ever received.
    uint256 public nativeFeesReceived;

    /// @notice Native fees already routed to principals.
    uint256 public nativeSustenanceCredited;

    /// @notice Total fees ever received per ERC-20 asset.
    mapping(address asset => uint256 amount) public tokenFeesReceived;

    /// @notice Fees already routed to principals, per ERC-20 asset.
    mapping(address asset => uint256 amount) public tokenSustenanceCredited;

    /// @notice Accrued, unclaimed sustenance per principal and asset.
    mapping(address principal => mapping(address asset => uint256 amount)) public claimableSustenance;

    /// @notice Emitted whenever a fee is paid into the vault.
    /// @param depositor Account that funded the vault, normally a bonding curve.
    /// @param source Which fee stream the deposit belongs to.
    /// @param asset `NATIVE` for ETH, otherwise the ERC-20 address.
    /// @param amount Amount received, in the asset's smallest unit.
    event FeeReceived(address indexed depositor, FeeSource indexed source, address indexed asset, uint256 amount);

    /// @notice Emitted when the owner routes accrued fees to a principal.
    /// @param principal Human wallet the sustenance was credited to.
    /// @param asset `NATIVE` for ETH, otherwise the ERC-20 address.
    /// @param amount Amount credited, in the asset's smallest unit.
    event SustenanceCredited(address indexed principal, address indexed asset, uint256 amount);

    /// @notice Emitted when a registered agent withdraws its principal's sustenance.
    /// @param agent Registered agent that triggered the payout.
    /// @param principal Human wallet that received the funds.
    /// @param asset `NATIVE` for ETH, otherwise the ERC-20 address.
    /// @param amount Amount paid out, in the asset's smallest unit.
    event SustenanceDisbursed(
        address indexed agent, address indexed principal, address indexed asset, uint256 amount
    );

    error InvalidOwner();
    error NotOwner(address caller);
    error InvalidAgentRegistry();
    error InvalidPrincipal();
    error ZeroAmount();
    error NativeAssetRequiresDepositFee();
    error InsufficientVaultBalance(uint256 requested, uint256 available);
    error NothingToWithdraw(address principal, address asset);
    error NativeTransferFailed(address to, uint256 amount);
    error TokenTransferFailed(address asset, address to, uint256 amount);

    /// @dev Reverts unless the caller is the protocol authority.
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    /// @param agentRegistry_ Registry deciding which agent acts for which human.
    /// @param owner_ Protocol authority allowed to route accrued fees to principals.
    constructor(address agentRegistry_, address owner_) AgentGated(agentRegistry_) {
        if (agentRegistry_ == address(0)) revert InvalidAgentRegistry();
        if (owner_ == address(0)) revert InvalidOwner();
        owner = owner_;
    }

    /// @notice Accepts a native fee transfer that does not name its source.
    /// @dev Recorded against {FeeSource.Swap}, the dominant stream. Curves should call {depositFee}
    /// so the source is attributed explicitly.
    receive() external payable {
        _recordNative(FeeSource.Swap, msg.sender);
    }

    /// @notice Pays a native fee into the vault.
    /// @dev Called by a bonding curve when it splits the 0.5% swap or 1.00% graduation fee.
    /// @param source Which fee stream is being paid.
    function depositFee(FeeSource source) external payable {
        if (msg.value == 0) revert ZeroAmount();
        _recordNative(source, msg.sender);
    }

    /// @notice Pays an ERC-20 fee into the vault.
    /// @dev The caller must {approve} this contract for `amount` first. Non-standard tokens that
    /// return no data are accepted; tokens that return false are rejected.
    /// @param source Which fee stream is being paid.
    /// @param asset ERC-20 being paid. Reverts for {NATIVE}; use {depositFee} for native.
    /// @param amount Amount to pull from the caller.
    function depositFeeToken(FeeSource source, address asset, uint256 amount) external {
        if (asset == NATIVE) revert NativeAssetRequiresDepositFee();
        if (amount == 0) revert ZeroAmount();

        tokenFeesReceived[asset] += amount;
        emit FeeReceived(msg.sender, source, asset, amount);

        _safeTransferFrom(asset, msg.sender, address(this), amount);
    }

    /// @notice Fee rate of `source`, in basis points.
    function feeRateBps(FeeSource source) public pure returns (uint256) {
        if (source == FeeSource.Swap) {
            return SWAP_FEE_BPS;
        }
        return GRADUATION_FEE_BPS;
    }

    /// @notice Fee a curve owes on `grossAmount` for the given stream.
    /// @dev The automated payout calculation curves use before splitting a fee. Integer division
    /// truncates in favour of the payer, matching `sdk/src/curve-math.ts`.
    /// @param source Which fee stream applies.
    /// @param grossAmount Gross reserve amount the fee is levied on.
    function quoteFee(FeeSource source, uint256 grossAmount) public pure returns (uint256) {
        return (grossAmount * feeRateBps(source)) / BPS_DENOMINATOR;
    }

    /// @notice Native fees received but not yet routed to a principal.
    function availableNative() public view returns (uint256) {
        return nativeFeesReceived - nativeSustenanceCredited;
    }

    /// @notice Fees received in `asset` but not yet routed to a principal.
    function availableToken(address asset) public view returns (uint256) {
        return tokenFeesReceived[asset] - tokenSustenanceCredited[asset];
    }

    /// @notice Accrued, unclaimed sustenance for `principal` in `asset`.
    /// @dev The automated settlement loop reads this per asset to decide what to off-ramp.
    function pendingSustenance(address principal, address asset) external view returns (uint256) {
        return claimableSustenance[principal][asset];
    }

    /// @notice Routes accrued native fees to a human principal.
    /// @dev Bounded by {availableNative}: the owner can never credit more than was received.
    /// @param principal Human wallet that becomes entitled to the funds.
    /// @param amount Amount to credit, in wei.
    function creditNativeSustenance(address principal, uint256 amount) external onlyOwner {
        if (principal == address(0)) revert InvalidPrincipal();
        if (amount == 0) revert ZeroAmount();

        uint256 available = availableNative();
        if (amount > available) revert InsufficientVaultBalance(amount, available);

        nativeSustenanceCredited += amount;
        claimableSustenance[principal][NATIVE] += amount;
        emit SustenanceCredited(principal, NATIVE, amount);
    }

    /// @notice Routes accrued ERC-20 fees to a human principal.
    /// @dev Bounded by {availableToken}, for the same reason as {creditNativeSustenance}.
    /// @param principal Human wallet that becomes entitled to the funds.
    /// @param asset ERC-20 being credited. Reverts for {NATIVE}.
    /// @param amount Amount to credit, in the token's smallest unit.
    function creditTokenSustenance(address principal, address asset, uint256 amount) external onlyOwner {
        if (principal == address(0)) revert InvalidPrincipal();
        if (asset == NATIVE) revert NativeAssetRequiresDepositFee();
        if (amount == 0) revert ZeroAmount();

        uint256 available = availableToken(asset);
        if (amount > available) revert InsufficientVaultBalance(amount, available);

        tokenSustenanceCredited[asset] += amount;
        claimableSustenance[principal][asset] += amount;
        emit SustenanceCredited(principal, asset, amount);
    }

    /// @notice Pays out the calling agent's principal and clears the entitlement.
    /// @dev Agent-native, mirroring `MaoTangMining`: only a registered agent may call this, and the
    /// funds always land in the human wallet that agent was registered for.
    /// @param asset `NATIVE` for ETH, otherwise the ERC-20 address.
    /// @return amount Amount paid to the principal.
    function withdrawSustenance(address asset) external onlyAuthorizedAgent returns (uint256 amount) {
        address principal = _agentOwner();

        amount = claimableSustenance[principal][asset];
        if (amount == 0) revert NothingToWithdraw(principal, asset);
        claimableSustenance[principal][asset] = 0;

        emit SustenanceDisbursed(msg.sender, principal, asset, amount);

        if (asset == NATIVE) {
            // The payout destination is the principal bound to the calling agent, never a
            // caller-supplied address, so the advisory is a false positive.
            // forge-lint: disable-next-line(arbitrary-send-eth)
            (bool ok,) = principal.call{value: amount}("");
            if (!ok) revert NativeTransferFailed(principal, amount);
        } else {
            _safeTransfer(asset, principal, amount);
        }
    }

    function _recordNative(FeeSource source, address depositor) private {
        uint256 amount = msg.value;
        nativeFeesReceived += amount;
        emit FeeReceived(depositor, source, NATIVE, amount);
    }

    /// @dev Tolerates tokens that return no data, rejects tokens that return false.
    function _safeTransfer(address asset, address to, uint256 amount) private {
        (bool ok, bytes memory data) = asset.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TokenTransferFailed(asset, to, amount);
        }
    }

    /// @dev Tolerates tokens that return no data, rejects tokens that return false.
    function _safeTransferFrom(address asset, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) =
            asset.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TokenTransferFailed(asset, to, amount);
        }
    }
}
