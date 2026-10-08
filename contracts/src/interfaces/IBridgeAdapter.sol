// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IBridgeAdapter
/// @notice Cross-chain transport used by {SustenanceVaultSpoke} to aggregate secondary-chain yield
///         into the main-chain `MaoTangSustenanceVault` hub.
/// @dev Kept deliberately narrow so the spoke never depends on a messaging vendor: the adapter owns
/// the protocol specifics (Rollup native bridge, LayerZero v2 OFT, Axelar ITS), and swapping
/// transports means registering a different adapter, not redeploying the spoke.
///
/// Every entry point is payable: `amount` is the yield being moved, and any relay/messaging fee is
/// supplied separately as `msg.value`. Keeping the two apart is what lets the spoke account for the
/// bridged yield exactly, so the hub can never be told it received more than was actually sent.
interface IBridgeAdapter {
    /// @notice Bridges `amount` of the native asset held by the caller to `dstVault` on `dstChainId`.
    /// @param dstVault Hub vault address on the destination chain; the only accepted recipient.
    /// @param dstChainId Destination chain id, as reported by the hub chain `eth_chainId`.
    /// @param asset `SustenanceVaultSpoke.NATIVE` for ETH, otherwise the bridged ERC-20.
    /// @param amount Native yield to move, in wei. Never less than `msg.value`.
    /// @return messageId Transport-assigned identifier the spoke logs for reconciliation.
    function bridgeYield(address dstVault, uint16 dstChainId, address asset, uint256 amount)
        external
        payable
        returns (bytes32 messageId);

    /// @notice Bridges `amount` of `asset`, pulling it from the caller through `transferFrom`.
    /// @dev The caller must {IERC20-approve} this adapter for `amount` first.
    /// @param dstVault Hub vault address on the destination chain; the only accepted recipient.
    /// @param dstChainId Destination chain id, as reported by the hub chain `eth_chainId`.
    /// @param asset ERC-20 yield being moved. Must not be the native sentinel.
    /// @param amount Token yield to move, in the token smallest unit.
    /// @return messageId Transport-assigned identifier the spoke logs for reconciliation.
    function bridgeYieldToken(address dstVault, uint16 dstChainId, address asset, uint256 amount)
        external
        payable
        returns (bytes32 messageId);
}
