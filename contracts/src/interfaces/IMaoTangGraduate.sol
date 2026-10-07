// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IMaoTangGraduate
/// @notice Migrates a completed bonding curve into an open AMM market.
/// @dev Graduation is permissionless: any account may call {graduateToMarket} once the curve has
/// reached 100% of its raise target. The call is idempotent per curve and reverts afterwards.
///
/// Fees: graduation carries a 1.00% fee (100 BPS) on the reserve migrated into the market. The market
/// receives the reserve net of that fee, and the fee itself is routed to `MaoTangSustenanceVault`.
/// See `sdk/src/curve-math.ts::graduationFee` for the off-chain mirror of the same arithmetic.
interface IMaoTangGraduate {
    /// @notice Emitted when a curve's liquidity is migrated into a market.
    /// @param curve Curve that was graduated.
    /// @param market Market that now holds the migrated liquidity.
    /// @param reserveMigrated Reserve (native ETH) moved into the market, net of the 1.00% graduation fee.
    /// @param tokensMigrated Meme tokens moved from the curve inventory into the market.
    event TokenGraduated(
        address indexed curve, address indexed market, uint256 reserveMigrated, uint256 tokensMigrated
    );

    /// @notice Reverts while the curve is still below 100% of its raise target.
    /// @param progressBps Progress towards graduation, in basis points.
    error CurveNotComplete(uint256 progressBps);

    /// @notice Reverts when the curve already has a market.
    /// @param market Address of the existing market.
    error MarketAlreadyDeployed(address market);

    /// @notice Migrates the curve reserve and remaining inventory into a market.
    /// @dev Reverts with {CurveNotComplete} while the curve is below its raise target, and with
    /// {MarketAlreadyDeployed} once the curve has graduated. A 1.00% graduation fee is deducted from
    /// the migrated reserve and routed to `MaoTangSustenanceVault`.
    /// @return market Address of the market that now holds the migrated liquidity.
    function graduateToMarket() external returns (address market);

    /// @notice Progress of a curve towards graduation.
    /// @return progressBps Progress in basis points, where 10000 equals 100% of the raise target.
    function graduationProgressBps() external view returns (uint256 progressBps);
}
