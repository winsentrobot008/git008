// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";
import {IBridgeAdapter} from "./interfaces/IBridgeAdapter.sol";

/// @title SustenanceVaultSpoke
/// @notice Fee intake on a secondary L2 (Base, Arbitrum, Optimism) that aggregates protocol yield on
///         that chain and forwards it to the `MaoTangSustenanceVault` hub.
/// @dev Phase P3 cross-chain routing. Whitepaper v2.2 section 5.1 defines one aggregation pool; that
/// pool is the hub on the settlement chain. Curves deployed on an L2 pay the identical 0.5% swap and
/// 1.00% graduation fees, but moving every individual fee across chains would be uneconomic, so each
/// L2 gets a spoke that:
///
///   1. Accepts fees through the same {depositFee} / {depositFeeToken} surface as the hub, so curve
///      integration code is chain-agnostic.
///   2. Accumulates them locally, with the same double-entry accounting the hub uses
///      ({availableNative} / {availableToken} are received minus bridged, never zero, never negative).
///   3. Flushes the accumulated balance to the hub on demand through {bridgeYieldToHub}, which
///      delegates the transport to an allowlisted {IBridgeAdapter}.
///
/// Trust model:
///
///   * {owner} is immutable, mirroring the hub: no admin takeover path, and no function lets the
///     owner withdraw fees to itself.
///   * Fees can only leave through {bridgeYieldToHub} / {bridgeYieldTokenToHub}, which always name
///     {hubVault} on {hubChainId} as the recipient and only accept an adapter the owner has
///     allowlisted. A compromised keeper can therefore trigger a transfer the owner would have
///     triggered anyway, but cannot redirect funds: this is why the adapter argument is validated
///     against {bridgeAdapters} instead of being trusted as given.
///   * Yield is never minted here. Every bridged amount is bounded by what was actually siphoned.
///
/// Fee rates are mirrored from `sdk/src/curve-math.ts` (`TRADE_FEE_BPS = 50n`), the same reference the
/// hub cites. Changing either is a protocol-economic change and requires a superseding entry in
/// `memory/ARCHITECTURE_DECISIONS.md`.
///
/// Known limitation (tracked for the next P3 slice): `MaoTangSustenanceVault` consumes fees through
/// {depositFee}, which is payable from an EOA on the hub chain. There is no hub-side cross-chain
/// intake hook yet, so this contract is the spoke half of the topology and a hub-side
/// `receiveBridgedYield` (gated on an allowlisted remote spoke) is required before mainnet.
contract SustenanceVaultSpoke {
    /// @notice The two fee streams the protocol collects, mirroring `MaoTangSustenanceVault.FeeSource`.
    /// @dev ABI-encoded as `uint8`, so a curve written against the hub interface call is byte-compatible.
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

    /// @notice Protocol authority on this chain: keeper and adapter administration only.
    /// @dev Immutable, mirroring the hub. It cannot move accrued yield to itself.
    address public immutable owner;

    /// @notice `MaoTangSustenanceVault` on the hub chain: the only destination yield can be sent to.
    address public immutable hubVault;

    /// @notice Chain id carrying the hub vault, as reported by that chain `eth_chainId`.
    uint16 public immutable hubChainId;

    /// @notice Accounts allowed to flush accrued yield to the hub. The owner is always one.
    mapping(address account => bool allowed) public keepers;

    /// @notice Bridge adapters the owner has allowlisted as yield transports.
    mapping(address adapter => bool allowed) public bridgeAdapters;

    /// @notice Total native fee value siphoned through this spoke.
    uint256 public nativeFeesSiphoned;

    /// @notice Native fee value already sent to the hub.
    uint256 public nativeYieldBridged;

    /// @notice Total fee value siphoned through this spoke, per ERC-20 asset.
    mapping(address asset => uint256 amount) public tokenFeesSiphoned;

    /// @notice Fee value already sent to the hub, per ERC-20 asset.
    mapping(address asset => uint256 amount) public tokenYieldBridged;

    /// @notice Emitted whenever a fee is siphoned into this spoke.
    /// @param depositor Account that funded the spoke, normally a bonding curve.
    /// @param source Which fee stream the deposit belongs to.
    /// @param asset `NATIVE` for ETH, otherwise the ERC-20 address.
    /// @param amount Amount received, in the asset smallest unit.
    event FeeSiphoned(address indexed depositor, FeeSource indexed source, address indexed asset, uint256 amount);

    /// @notice Emitted when the owner grants or revokes keeper rights.
    /// @param keeper Account whose rights changed.
    /// @param allowed Whether the account may now flush yield.
    event KeeperUpdated(address indexed keeper, bool allowed);

    /// @notice Emitted when the owner grants or revokes an adapter allowlisting.
    /// @param adapter Adapter whose status changed.
    /// @param allowed Whether the adapter may now carry yield.
    event BridgeAdapterUpdated(address indexed adapter, bool allowed);

    /// @notice Emitted when accrued yield leaves for the hub.
    /// @param adapter Allowlisted transport that carried the value.
    /// @param asset `NATIVE` for ETH, otherwise the ERC-20 address.
    /// @param amount Bridged amount, in the asset smallest unit.
    /// @param dstChainId Chain the value was sent to; always {hubChainId}.
    /// @param messageId Transport-assigned identifier, logged for reconciliation against the hub.
    event YieldBridged(
        address indexed adapter, address indexed asset, uint256 amount, uint16 dstChainId, bytes32 messageId
    );

    error InvalidOwner();
    error InvalidHubVault();
    error InvalidHubChainId();
    error NotOwner(address caller);
    error NotKeeper(address caller);
    error UnknownBridgeAdapter(address adapter);
    error ZeroAmount();
    error NothingToBridge(address asset);
    error InsufficientSpokeBalance(uint256 requested, uint256 available);
    error NativeAssetRequiresDepositFee();
    error NativeTransferFailed(address to, uint256 amount);
    error TokenTransferFailed(address asset, address to, uint256 amount);

    /// @dev Reverts unless the caller is the protocol authority.
    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    /// @dev Reverts unless the caller is the owner or an account the owner has designated a keeper.
    modifier onlyKeepers() {
        if (msg.sender != owner && !keepers[msg.sender]) revert NotKeeper(msg.sender);
        _;
    }

    /// @param owner_ Protocol authority on this chain, allowed to manage keepers and adapters.
    /// @param hubVault_ `MaoTangSustenanceVault` on the hub chain; every bridged yield lands here.
    /// @param hubChainId_ Chain id of the hub chain.
    constructor(address owner_, address hubVault_, uint16 hubChainId_) {
        if (owner_ == address(0)) revert InvalidOwner();
        if (hubVault_ == address(0)) revert InvalidHubVault();
        if (hubChainId_ == 0) revert InvalidHubChainId();
        owner = owner_;
        hubVault = hubVault_;
        hubChainId = hubChainId_;
    }

    /// @notice Accepts a native fee transfer that does not name its source.
    /// @dev Recorded against {FeeSource.Swap}, the dominant stream, exactly as the hub does. Curves
    /// should call {depositFee} so the source is attributed explicitly.
    receive() external payable {
        _recordNative(FeeSource.Swap, msg.sender, msg.value);
    }

    /// @notice Siphons a native fee into the spoke.
    /// @dev Same selector and encoding as `MaoTangSustenanceVault.depositFee`, so a curve addressed to
    /// a spoke instead of the hub needs no code change.
    /// @param source Which fee stream is being paid.
    function depositFee(FeeSource source) external payable {
        if (msg.value == 0) revert ZeroAmount();
        _recordNative(source, msg.sender, msg.value);
    }

    /// @notice Siphons an ERC-20 fee into the spoke.
    /// @dev The caller must {IERC20-approve} this contract for `amount` first.
    /// @param source Which fee stream is being paid.
    /// @param asset ERC-20 being paid. Reverts for {NATIVE}; use {depositFee} for native.
    /// @param amount Amount to pull from the caller.
    function depositFeeToken(FeeSource source, address asset, uint256 amount) external {
        if (asset == NATIVE) revert NativeAssetRequiresDepositFee();
        if (amount == 0) revert ZeroAmount();

        tokenFeesSiphoned[asset] += amount;
        emit FeeSiphoned(msg.sender, source, asset, amount);

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
    /// @dev Integer division truncates in favour of the payer, matching `sdk/src/curve-math.ts`.
    /// @param source Which fee stream applies.
    /// @param grossAmount Gross reserve amount the fee is levied on.
    function quoteFee(FeeSource source, uint256 grossAmount) public pure returns (uint256) {
        return (grossAmount * feeRateBps(source)) / BPS_DENOMINATOR;
    }

    /// @notice Native yield siphoned but not yet sent to the hub.
    function availableNative() public view returns (uint256) {
        return nativeFeesSiphoned - nativeYieldBridged;
    }

    /// @notice Yield siphoned in `asset` but not yet sent to the hub.
    function availableToken(address asset) public view returns (uint256) {
        return tokenFeesSiphoned[asset] - tokenYieldBridged[asset];
    }

    /// @notice Grants or revokes keeper rights.
    /// @param keeper Account that may flush accrued yield to the hub.
    /// @param allowed Whether the account may do so.
    function setKeeper(address keeper, bool allowed) external onlyOwner {
        if (keeper == address(0)) revert InvalidOwner();
        keepers[keeper] = allowed;
        emit KeeperUpdated(keeper, allowed);
    }

    /// @notice Grants or revokes an adapter allowlisting.
    /// @param adapter Transport allowed to carry yield to the hub.
    /// @param allowed Whether the adapter may do so.
    function setBridgeAdapter(address adapter, bool allowed) external onlyOwner {
        if (adapter == address(0)) revert UnknownBridgeAdapter(adapter);
        bridgeAdapters[adapter] = allowed;
        emit BridgeAdapterUpdated(adapter, allowed);
    }

    /// @notice Sends every accrued native fee to the hub vault through `bridgeAdapter`.
    /// @dev Callable by the owner or a keeper. `msg.value` is the transport relay fee, paid on top of
    /// the yield, so the bridged amount always equals {availableNative} exactly. The bookkeeping is
    /// updated before the external call, so a reentrant call sees nothing left to bridge.
    /// @param bridgeAdapter Allowlisted transport to carry the value.
    /// @return messageId Transport-assigned identifier, also emitted in {YieldBridged}.
    function bridgeYieldToHub(address bridgeAdapter) external payable onlyKeepers returns (bytes32 messageId) {
        _requireAdapter(bridgeAdapter);

        uint256 amount = availableNative();
        if (amount == 0) revert NothingToBridge(NATIVE);
        nativeYieldBridged += amount;

        IBridgeAdapter adapter = IBridgeAdapter(bridgeAdapter);
        // `bridgeAdapter` is owner-allowlisted and the recipient is the immutable hub vault, so the
        // destination is not caller-controlled; the advisory is a false positive.
        // forge-lint: disable-next-line(arbitrary-send-eth)
        messageId = adapter.bridgeYield{value: amount + msg.value}(hubVault, hubChainId, NATIVE, amount);
        // The event carries the transport-assigned messageId, so it cannot precede the call that
        // produced it. Yield accounting is already committed above, before any external call.
        // forge-lint: disable-next-line(reentrancy-events)
        emit YieldBridged(bridgeAdapter, NATIVE, amount, hubChainId, messageId);
    }

    /// @notice Sends `amount` of accrued ERC-20 fee to the hub vault through `bridgeAdapter`.
    /// @dev Callable by the owner or a keeper, and bounded by {availableToken}. The adapter pulls the
    /// tokens with `transferFrom`, so this contract approves exactly `amount` and then clears the
    /// allowance back to zero.
    /// @param bridgeAdapter Allowlisted transport to carry the value.
    /// @param asset ERC-20 being bridged. Reverts for {NATIVE}; use {bridgeYieldToHub}.
    /// @param amount Amount to bridge, in the token smallest unit.
    /// @return messageId Transport-assigned identifier, also emitted in {YieldBridged}.
    function bridgeYieldTokenToHub(address bridgeAdapter, address asset, uint256 amount)
        external
        payable
        onlyKeepers
        returns (bytes32 messageId)
    {
        if (asset == NATIVE) revert NativeAssetRequiresDepositFee();
        _requireAdapter(bridgeAdapter);
        if (amount == 0) revert ZeroAmount();

        uint256 available = availableToken(asset);
        if (amount > available) revert InsufficientSpokeBalance(amount, available);
        tokenYieldBridged[asset] += amount;

        _safeApprove(asset, bridgeAdapter, amount);
        IBridgeAdapter adapter = IBridgeAdapter(bridgeAdapter);
        // `bridgeAdapter` is owner-allowlisted and the recipient is the immutable hub vault, so the
        // destination is not caller-controlled; the advisory is a false positive.
        // forge-lint: disable-next-line(arbitrary-send-eth)
        messageId = adapter.bridgeYieldToken{value: msg.value}(hubVault, hubChainId, asset, amount);
        _safeApprove(asset, bridgeAdapter, 0);

        // The event carries the transport-assigned messageId, so it cannot precede the call that
        // produced it. Yield accounting is already committed above, before any external call.
        // forge-lint: disable-next-line(reentrancy-events)
        emit YieldBridged(bridgeAdapter, asset, amount, hubChainId, messageId);
    }

    function _requireAdapter(address bridgeAdapter) private view {
        if (!bridgeAdapters[bridgeAdapter]) revert UnknownBridgeAdapter(bridgeAdapter);
    }

    function _recordNative(FeeSource source, address depositor, uint256 amount) private {
        nativeFeesSiphoned += amount;
        emit FeeSiphoned(depositor, source, NATIVE, amount);
    }

    /// @dev Tolerates tokens that return no data, rejects tokens that return false.
    function _safeApprove(address asset, address spender, uint256 amount) private {
        (bool ok, bytes memory data) = asset.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert TokenTransferFailed(asset, spender, amount);
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
