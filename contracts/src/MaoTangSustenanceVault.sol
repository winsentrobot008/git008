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
///   * Cross-chain yield from a registered spoke enters through {receiveBridgedYield} /
///     {receiveBridgedYieldToken}, which accept only an owner-trusted bridge adapter naming the
///     spoke registered for the origin chain. See {setRemoteSpoke} and {setTrustedBridgeAdapter}.
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

    /// @notice Chain id => the spoke contract allowed to send yield from that chain.
    /// @dev Registered by {setRemoteSpoke}. `address(0)` means no spoke is trusted for the chain.
    mapping(uint256 chainId => address spoke) public remoteSpokes;

    /// @notice Bridge adapters allowed to deliver yield into the vault.
    /// @dev Registered by {setTrustedBridgeAdapter}. The zero address is never a caller, so it is
    /// rejected rather than stored, which keeps the mapping free of a meaningless entry.
    mapping(address adapter => bool trusted) public trustedBridgeAdapters;

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

    /// @notice Emitted when the owner registers or revokes a spoke for a chain.
    /// @param chainId Chain the spoke lives on.
    /// @param spoke Spoke now trusted for that chain; `address(0)` revokes the chain.
    event RemoteSpokeSet(uint256 indexed chainId, address indexed spoke);

    /// @notice Emitted when the owner grants or revokes a cross-chain bridge adapter.
    /// @param adapter Adapter whose status changed.
    /// @param trusted Whether the adapter may now deliver yield.
    event TrustedBridgeAdapterSet(address indexed adapter, bool indexed trusted);

    /// @notice Emitted when a trusted bridge delivers yield aggregated on another chain.
    /// @param originChainId Chain the yield was siphoned on.
    /// @param originSpoke Spoke that aggregated it.
    /// @param bridge Trusted adapter that delivered it.
    /// @param amount Amount received, in the asset's smallest unit.
    /// @param token `NATIVE` for bridged ETH, otherwise the ERC-20 address.
    event BridgedYieldReceived(
        uint256 indexed originChainId,
        address indexed originSpoke,
        address indexed bridge,
        uint256 amount,
        address token
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
    error InvalidChainId();
    error InvalidBridgeAdapter(address adapter);
    error UntrustedBridgeAdapter(address adapter);
    error UnknownRemoteSpoke(uint256 chainId, address spoke);

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

    /// @notice Registers, updates or revokes the spoke trusted for `chainId`.
    /// @dev Passing `address(0)` revokes the chain, which stops {receiveBridgedYield} from accepting
    /// its yield. Rotation is therefore one owner transaction, with no window in which two spokes are
    /// simultaneously trusted for the same chain.
    /// @param chainId Chain the spoke lives on. Must not be 0, the invalid chain id.
    /// @param spoke Spoke allowed to send yield from `chainId`.
    function setRemoteSpoke(uint256 chainId, address spoke) external onlyOwner {
        if (chainId == 0) revert InvalidChainId();
        remoteSpokes[chainId] = spoke;
        emit RemoteSpokeSet(chainId, spoke);
    }

    /// @notice Grants or revokes a cross-chain bridge adapter.
    /// @param adapter Adapter allowed to deliver yield. Must not be the zero address.
    /// @param trusted Whether the adapter may now deliver yield.
    function setTrustedBridgeAdapter(address adapter, bool trusted) external onlyOwner {
        if (adapter == address(0)) revert InvalidBridgeAdapter(adapter);
        trustedBridgeAdapters[adapter] = trusted;
        emit TrustedBridgeAdapterSet(adapter, trusted);
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

    /// @notice Receives aggregated native yield from a registered spoke on another chain.
    /// @dev Attribution is what the guards protect, not solvency: a plain native transfer is already
    /// accepted by {receive} and recorded as a Swap fee, so ETH that arrives here cannot be lost. What
    /// the guards add is provenance - only a trusted adapter naming the spoke registered for the origin
    /// chain can have the deposit attributed to that chain. The amount joins {nativeFeesReceived}, so
    /// principal routing stays bounded by what the vault actually holds, and the token field is
    /// {NATIVE}.
    /// @param originChainId Chain the yield was siphoned on.
    /// @param originSpoke Spoke that aggregated it; must be the registered spoke for `originChainId`.
    function receiveBridgedYield(uint256 originChainId, address originSpoke) external payable {
        _requireTrustedBridge();
        _requireRegisteredSpoke(originChainId, originSpoke);
        if (msg.value == 0) revert ZeroAmount();

        nativeFeesReceived += msg.value;
        emit BridgedYieldReceived(originChainId, originSpoke, msg.sender, msg.value, NATIVE);
    }

    /// @notice Receives aggregated ERC-20 yield from a registered spoke on another chain.
    /// @dev The bridge must {IERC20-approve} this contract for `amount` first, exactly as a curve does
    /// for {depositFeeToken}. The deposit is recorded in {tokenFeesReceived} before the pull, so the
    /// accounting can never run ahead of a transfer that fails.
    /// @param originChainId Chain the yield was siphoned on.
    /// @param originSpoke Spoke that aggregated it; must be the registered spoke for `originChainId`.
    /// @param token ERC-20 received. Reverts for {NATIVE}; use {receiveBridgedYield} for ETH.
    /// @param amount Amount delivered, in the token's smallest unit.
    function receiveBridgedYieldToken(uint256 originChainId, address originSpoke, address token, uint256 amount)
        external
    {
        _requireTrustedBridge();
        _requireRegisteredSpoke(originChainId, originSpoke);
        if (token == NATIVE) revert NativeAssetRequiresDepositFee();
        if (amount == 0) revert ZeroAmount();

        tokenFeesReceived[token] += amount;
        emit BridgedYieldReceived(originChainId, originSpoke, msg.sender, amount, token);

        _safeTransferFrom(token, msg.sender, address(this), amount);
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

    /// @dev Reverts unless the caller is an adapter the owner has trusted to deliver yield.
    function _requireTrustedBridge() private view {
        if (!trustedBridgeAdapters[msg.sender]) revert UntrustedBridgeAdapter(msg.sender);
    }

    /// @dev Reverts unless `originSpoke` is exactly the spoke registered for `originChainId`.
    function _requireRegisteredSpoke(uint256 originChainId, address originSpoke) private view {
        if (originSpoke == address(0) || remoteSpokes[originChainId] != originSpoke) {
            revert UnknownRemoteSpoke(originChainId, originSpoke);
        }
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
