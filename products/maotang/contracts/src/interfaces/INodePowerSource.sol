// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title INodePowerSource
/// @notice Optional second source of governance weight, read by {MaoTangGovernor}.
/// @dev `$mHUMAN` is a personhood token: one human holds one quota, so balances alone cannot express
/// how much physical or compute work a node actually contributed. A staking or mining contract that
/// can report per-account node power implements this interface and is wired in through the governor
/// itself (`MaoTangGovernor.setNodePowerSource`), so the weighting rule can change without redeploying
/// the governor.
interface INodePowerSource {
    /// @notice Governance weight `account` has earned through staked or attested node power.
    /// @dev Must be expressed in the same unit as `$mHUMAN` micro-units, because the governor adds it
    /// to the account balance before comparing against the proposal threshold and quorum.
    /// @param account Account whose node power is being read.
    /// @return power Additional voting power, in $mHUMAN micro-units.
    function votingPower(address account) external view returns (uint256 power);
}
