// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMaoTangCurve} from "./interfaces/IMaoTangCurve.sol";
import {IMaoTangGraduate} from "./interfaces/IMaoTangGraduate.sol";
import {IMaoTangSustenanceVault} from "./interfaces/IMaoTangSustenanceVault.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {MemeToken} from "./MemeToken.sol";

/// @title MaoTangBondingCurve
/// @notice Deterministic constant-product curve over virtual reserves, plus permissionless graduation.
/// @dev Off-chain twin: `sdk/src/curve-math.ts`. The formulas, constants and integer-truncation
/// behaviour are deliberately identical so a quote taken off chain matches execution on chain.
///
/// Fees are never retained as liquidity. Every buy and sell routes 0.5% (50 BPS) of the reserve leg
/// to `MaoTangSustenanceVault`, and graduation routes a further 1.00% (100 BPS) of the migrated
/// reserve. The vault is the only fee sink.
contract MaoTangBondingCurve is IMaoTangCurve, IMaoTangGraduate {
    /// @notice Virtual reserve seeded into every curve, in wei. Sets the starting price floor.
    uint256 public constant VIRTUAL_RESERVE_WEI = 30 ether;

    /// @notice Virtual token inventory, in 18-decimal token units.
    uint256 public constant VIRTUAL_TOKEN_SUPPLY = 1_073_000_000 * 10 ** 18;

    /// @notice Real reserve, in wei, that graduates the curve at 100%.
    uint256 public constant GRADUATION_TARGET_WEI = 5 ether;

    /// @notice Swap fee, in basis points of the reserve leg. Mirrors `TRADE_FEE_BPS` in the SDK.
    uint256 public constant SWAP_FEE_BPS = 50;

    /// @notice Graduation fee, in basis points of the migrated reserve.
    uint256 public constant GRADUATION_FEE_BPS = 100;

    /// @notice Basis point denominator.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Sustenance vault receiving both fee streams. Immutable: the sink cannot be redirected.
    address public immutable vault;

    /// @notice Human that launched this curve.
    address public immutable creator;

    /// @notice Venue that receives the reserve and remaining inventory at graduation.
    address public immutable market;

    /// @notice Factory that deployed this curve.
    address public immutable factory;

    /// @notice Meme token sold by this curve.
    address public immutable tokenAddress;

    /// @notice Real reserve held by the curve, in wei (the `R` of the invariant).
    uint256 public reserve;

    /// @notice Tokens sold by the curve so far, in 18-decimal units (the `S` of the invariant).
    uint256 public tokensSold;

    /// @notice True once liquidity has migrated to the market.
    bool public graduated;

    uint256 private _reentrancyStatus = 1;

    /// @notice Emitted when a fee is routed to the sustenance vault.
    /// @param asset `address(0)` for native ETH, otherwise the ERC-20 address.
    /// @param amount Fee amount routed.
    /// @param source Which fee stream the amount belongs to.
    event FeeRouted(address indexed asset, uint256 amount, IMaoTangSustenanceVault.FeeSource source);

    /// @notice Emitted once per launch, at curve construction.
    event CurveDeployed(
        address indexed token, address indexed creator, address indexed vault, address market
    );

    error InvalidVault();
    error InvalidCreator();
    error InvalidMarket();
    error InvalidTokenMetadata();
    error ZeroAmount();
    error ReentrantCall();
    error TokenTransferFailed();
    error NativeTransferFailed();

    /// @param vault_ Sustenance vault receiving the 0.5% swap and 1.00% graduation fees.
    /// @param creator_ Human credited with launching this curve.
    /// @param market_ Venue that receives liquidity at graduation.
    /// @param name_ Meme token name.
    /// @param symbol_ Meme token symbol.
    constructor(
        address vault_,
        address creator_,
        address market_,
        string memory name_,
        string memory symbol_
    ) {
        if (vault_ == address(0)) revert InvalidVault();
        if (creator_ == address(0)) revert InvalidCreator();
        if (market_ == address(0)) revert InvalidMarket();
        if (bytes(name_).length == 0 || bytes(symbol_).length == 0) revert InvalidTokenMetadata();

        vault = vault_;
        creator = creator_;
        market = market_;
        factory = msg.sender;

        address deployed = address(new MemeToken(name_, symbol_, address(this), VIRTUAL_TOKEN_SUPPLY));
        tokenAddress = deployed;

        // Deploying a fresh contract cannot reenter this uninitialised curve, so the advisory is a
        // false positive.
        // forge-lint: disable-next-line(reentrancy-events)
        emit CurveDeployed(deployed, creator_, vault_, market_);
    }

    /// @dev Blocks nested entry into any value-moving entry point.
    modifier nonReentrant() {
        if (_reentrancyStatus != 1) revert ReentrantCall();
        _reentrancyStatus = 2;
        _;
        _reentrancyStatus = 1;
    }

    /// @notice Spot price, in reserve wei per one whole meme token.
    function calculatePrice() public view override returns (uint256) {
        return ((reserve + VIRTUAL_RESERVE_WEI) * 10 ** 18) / (tokensSold + VIRTUAL_TOKEN_SUPPLY);
    }

    /// @notice Meme token traded by this curve.
    function token() external view override returns (address) {
        return tokenAddress;
    }

    /// @notice Reserve, in wei, that graduates the curve.
    function target() external pure override returns (uint256) {
        return GRADUATION_TARGET_WEI;
    }

    /// @notice Progress towards graduation in basis points, capped at 10000.
    function graduationProgressBps() public view override returns (uint256) {
        uint256 bps = (reserve * BPS_DENOMINATOR) / GRADUATION_TARGET_WEI;
        return bps > BPS_DENOMINATOR ? BPS_DENOMINATOR : bps;
    }

    /// @notice Buys tokens, accepting whatever the curve returns.
    /// @dev Prefer the {buyTokensOnCurve} overload that carries a slippage bound.
    function buyTokensOnCurve() external payable override nonReentrant returns (uint256 tokensOut) {
        return _buy(msg.sender, msg.value, 0);
    }

    /// @notice Buys tokens with a minimum-output bound.
    /// @param minTokensOut Smallest acceptable output; reverts with {SlippageExceeded} below it.
    function buyTokensOnCurve(uint256 minTokensOut)
        external
        payable
        nonReentrant
        returns (uint256 tokensOut)
    {
        return _buy(msg.sender, msg.value, minTokensOut);
    }

    /// @notice Sells exactly the allowance the caller granted this curve.
    /// @dev This entry point has no amount parameter, so approve the amount you intend to sell.
    /// Prefer the {sellTokensOnCurve} overload that carries an explicit amount and slippage bound.
    function sellTokensOnCurve() external override nonReentrant returns (uint256 amountOut) {
        uint256 tokensIn = IERC20(tokenAddress).allowance(msg.sender, address(this));
        return _sell(msg.sender, tokensIn, 0);
    }

    /// @notice Sells `tokensIn` tokens with a minimum-output bound.
    /// @param tokensIn Tokens to sell; the curve must be approved for at least this amount.
    /// @param minReserveOut Smallest acceptable payout; reverts with {SlippageExceeded} below it.
    function sellTokensOnCurve(uint256 tokensIn, uint256 minReserveOut)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        return _sell(msg.sender, tokensIn, minReserveOut);
    }

    /// @notice Migrates the reserve and remaining inventory into the market.
    /// @dev Permissionless. A 1.00% graduation fee is taken off the reserve and routed to the
    /// sustenance vault before the remainder moves on.
    /// @return market_ Venue that received the liquidity.
    function graduateToMarket() external override nonReentrant returns (address market_) {
        if (graduated) revert MarketAlreadyDeployed(market);

        uint256 progress = graduationProgressBps();
        if (progress < BPS_DENOMINATOR) revert CurveNotComplete(progress);

        uint256 graduatedReserve = reserve;
        uint256 fee = (graduatedReserve * GRADUATION_FEE_BPS) / BPS_DENOMINATOR;
        uint256 net = graduatedReserve - fee;
        uint256 inventory = IERC20(tokenAddress).balanceOf(address(this));

        // Effects first: the curve is closed and drained before any external call.
        graduated = true;
        reserve = 0;

        _routeFee(fee, IMaoTangSustenanceVault.FeeSource.Graduation);

        // State is finalised above and this entry point is nonReentrant, so the migration payouts
        // cannot reorder the log; the advisory is a false positive.
        // forge-lint: disable-next-line(reentrancy-events)
        emit TokenGraduated(address(this), market, net, inventory);

        if (net > 0) {
            (bool ok,) = market.call{value: net}("");
            if (!ok) revert NativeTransferFailed();
        }
        if (inventory > 0) {
            if (!IERC20(tokenAddress).transfer(market, inventory)) revert TokenTransferFailed();
        }

        return market;
    }

    function _buy(address buyer, uint256 reserveIn, uint256 minTokensOut)
        private
        returns (uint256 tokensOut)
    {
        if (graduated) revert CurveAlreadyGraduated();
        if (reserveIn == 0) revert ZeroAmount();

        uint256 fee = (reserveIn * SWAP_FEE_BPS) / BPS_DENOMINATOR;
        uint256 net = reserveIn - fee;

        uint256 tokenSide = tokensSold + VIRTUAL_TOKEN_SUPPLY;
        uint256 reserveSide = reserve + VIRTUAL_RESERVE_WEI;
        uint256 nextReserveSide = reserveSide + net;
        uint256 nextTokenSide = (tokenSide * reserveSide) / nextReserveSide;

        tokensOut = tokenSide - nextTokenSide;
        if (tokensOut == 0) revert ZeroAmount();
        if (tokensOut > IERC20(tokenAddress).balanceOf(address(this))) revert CurveNotFunded();
        if (tokensOut < minTokensOut) revert SlippageExceeded(minTokensOut, tokensOut);

        reserve += net;
        tokensSold += tokensOut;

        _routeFee(fee, IMaoTangSustenanceVault.FeeSource.Swap);

        // Effects and the fee interaction are complete and this entry point is nonReentrant, so a
        // callback cannot reorder the log; the advisory is a false positive.
        // forge-lint: disable-next-line(reentrancy-events)
        emit TokenPurchased(buyer, reserveIn, tokensOut, calculatePrice());

        if (!IERC20(tokenAddress).transfer(buyer, tokensOut)) revert TokenTransferFailed();
    }

    function _sell(address seller, uint256 tokensIn, uint256 minReserveOut)
        private
        returns (uint256 amountOut)
    {
        if (graduated) revert CurveAlreadyGraduated();
        if (tokensIn == 0) revert ZeroAmount();

        uint256 tokenSide = tokensSold + VIRTUAL_TOKEN_SUPPLY;
        if (tokensIn >= tokenSide) revert CurveNotFunded();

        uint256 reserveSide = reserve + VIRTUAL_RESERVE_WEI;
        uint256 nextReserveSide = (tokenSide * reserveSide) / (tokenSide - tokensIn);
        // A sell walks the invariant in the opposite direction to a buy, so the reserve side grows
        // and the payout is that growth. Subtracting in the other order yields a negative number.
        uint256 grossReserveOut = nextReserveSide - reserveSide;
        if (grossReserveOut > reserve) revert CurveNotFunded();

        uint256 fee = (grossReserveOut * SWAP_FEE_BPS) / BPS_DENOMINATOR;
        amountOut = grossReserveOut - fee;
        if (amountOut == 0) revert ZeroAmount();
        if (amountOut < minReserveOut) revert SlippageExceeded(minReserveOut, amountOut);

        reserve -= grossReserveOut;
        tokensSold -= tokensIn;

        _routeFee(fee, IMaoTangSustenanceVault.FeeSource.Swap);

        // Effects are complete before the payouts and this entry point is nonReentrant, so a callback
        // cannot reorder the log; the advisory is a false positive.
        // forge-lint: disable-next-line(reentrancy-events)
        emit TokenSold(seller, tokensIn, amountOut, calculatePrice());

        if (!IERC20(tokenAddress).transferFrom(seller, address(this), tokensIn)) {
            revert TokenTransferFailed();
        }
        MemeToken(tokenAddress).burn(tokensIn);

        // Proceeds return to the seller that supplied the tokens (the audited msg.sender), not an
        // arbitrary caller-supplied address, so the advisory is a false positive.
        // forge-lint: disable-next-line(arbitrary-send-eth)
        (bool ok,) = seller.call{value: amountOut}("");
        if (!ok) revert NativeTransferFailed();
    }

    function _routeFee(uint256 amount, IMaoTangSustenanceVault.FeeSource source) private {
        if (amount == 0) return;
        emit FeeRouted(address(0), amount, source);
        IMaoTangSustenanceVault(vault).depositFee{value: amount}(source);
    }
}
