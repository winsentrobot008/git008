// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IMaoTangSustenanceVault
/// @notice Fee-intake surface of the sustenance vault, as consumed by bonding curves.
/// @dev `MaoTangSustenanceVault` declares its own equivalent `FeeSource` enum. Enum parameters are
/// ABI-encoded as `uint8`, so the selectors match and an integrator may use either declaration.
interface IMaoTangSustenanceVault {
    /// @notice The two fee streams, mirroring `MaoTangSustenanceVault.FeeSource`.
    enum FeeSource {
        /// 0.5% levied on every curve buy and sell.
        Swap,
        /// 1.00% levied on the reserve migrated at graduation.
        Graduation
    }

    /// @notice Pays a native fee into the vault.
    /// @param source Which fee stream is being paid.
    function depositFee(FeeSource source) external payable;

    /// @notice Pays an ERC-20 fee into the vault, pulling `amount` from the caller.
    /// @param source Which fee stream is being paid.
    /// @param asset ERC-20 being paid.
    /// @param amount Amount to pull from the caller.
    function depositFeeToken(FeeSource source, address asset, uint256 amount) external;

    /// @notice Fee owed on `grossAmount` for the given stream, in basis points of the gross amount.
    /// @param source Which fee stream applies.
    /// @param grossAmount Gross reserve amount the fee is levied on.
    function quoteFee(FeeSource source, uint256 grossAmount) external pure returns (uint256);
}
