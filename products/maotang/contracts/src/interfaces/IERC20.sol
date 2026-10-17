// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IERC20
/// @notice Minimal ERC-20 surface used by the sustenance vault.
/// @dev Declared locally so the vault stays dependency-free: the repository vendors no OpenZeppelin
/// and `libs = ["lib"]` is empty. `contracts/src/HumanToken.sol` implements exactly this surface, and
/// so do the stablecoins and wrapped BTC the vault accepts.
interface IERC20 {
    /// @notice Total supply of the token, in its smallest unit.
    function totalSupply() external view returns (uint256);

    /// @notice Balance of `account`, in the token's smallest unit.
    function balanceOf(address account) external view returns (uint256);

    /// @notice Moves `amount` from the caller to `to`. Returns false on failure.
    function transfer(address to, uint256 amount) external returns (bool);

    /// @notice Remaining allowance `spender` may draw from `holder`.
    function allowance(address holder, address spender) external view returns (uint256);

    /// @notice Sets the caller's allowance for `spender` to `amount`.
    function approve(address spender, uint256 amount) external returns (bool);

    /// @notice Moves `amount` from `from` to `to` using the caller's allowance.
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}
