// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IMaoTangCurve
/// @notice Deterministic bonding curve AMM backing a single meme token.
/// @dev The curve custodies the reserve asset (native ETH) and the remaining token inventory.
/// Buys are paid through `msg.value`; sells transfer tokens back into the curve. Both operations
/// revert once the curve has graduated and its liquidity moved to a market.
///
/// Fees: every buy and sell carries a 0.5% swap fee (50 BPS) levied on the gross reserve amount.
/// The fee is not retained as liquidity; implementations must route it to `MaoTangSustenanceVault`
/// (see `sdk/src/curve-math.ts` for the off-chain mirror of the same arithmetic). Changing either
/// rate is a protocol-economic change and requires a superseding ADR entry.
interface IMaoTangCurve {
    /// @notice Emitted when a trader buys tokens from the curve.
    /// @param buyer Account that paid the reserve.
    /// @param reserveIn Reserve amount credited to the curve, net of the 0.5% swap fee.
    /// @param tokensOut Meme tokens transferred to `buyer` out of the curve inventory.
    /// @param newPrice Spot price after the trade, in reserve wei per whole token.
    event TokenPurchased(address indexed buyer, uint256 reserveIn, uint256 tokensOut, uint256 newPrice);

    /// @notice Emitted when a trader sells tokens back into the curve.
    /// @param seller Account that returned the tokens.
    /// @param tokensIn Meme tokens burned from `seller`.
    /// @param reserveOut Reserve amount paid out to `seller`, net of the 0.5% swap fee.
    /// @param newPrice Spot price after the trade, in reserve wei per whole token.
    event TokenSold(address indexed seller, uint256 tokensIn, uint256 reserveOut, uint256 newPrice);

    /// @notice Reverts when the curve has already graduated to a market.
    error CurveAlreadyGraduated();

    /// @notice Reverts when the curve holds no inventory to trade against.
    error CurveNotFunded();

    /// @notice Reverts when a trade would settle outside the caller supplied bounds.
    /// @param expected Minimum (buy) or maximum (sell) amount the caller accepted.
    /// @param actual Amount the trade would settle at.
    error SlippageExceeded(uint256 expected, uint256 actual);

    /// @notice Buys meme tokens from the curve.
    /// @dev The reserve is taken from `msg.value`. Output is minted from the curve inventory, so
    /// the caller must enforce its own minimum-out bound before submitting the transaction.
    /// A 0.5% swap fee is deducted from `msg.value` before the curve is priced, and routed to
    /// `MaoTangSustenanceVault`.
    /// @return tokensOut Amount of meme tokens minted to the caller.
    function buyTokensOnCurve() external payable returns (uint256 tokensOut);

    /// @notice Sells meme tokens back into the curve.
    /// @dev The curve must be approved to transfer the caller's meme tokens beforehand. This entry
    /// point has no amount parameter, so it sells exactly the allowance the caller granted the curve;
    /// approve the amount you intend to sell.
    /// A 0.5% swap fee is deducted from the gross reserve owed before payout, and routed to
    /// `MaoTangSustenanceVault`.
    /// @return amountOut Amount of reserve (native ETH) returned to the caller.
    function sellTokensOnCurve() external returns (uint256 amountOut);

    /// @notice Current spot price on the curve.
    /// @return price Spot price in reserve wei per one whole meme token.
    function calculatePrice() external view returns (uint256 price);

    /// @notice Meme token traded by this curve.
    function token() external view returns (address token);

    /// @notice Raise target, in reserve wei, that triggers graduation at 100%.
    function target() external view returns (uint256 target);
}
