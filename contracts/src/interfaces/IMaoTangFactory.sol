// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IMaoTangFactory
/// @notice Launches MAOTANG meme tokens and the bonding curve that prices them.
/// @dev Every meme token is paired with its own `IMaoTangCurve`. The factory owns the curve until
/// graduation migrates the remaining liquidity into an open market.
interface IMaoTangFactory {
    /// @notice Emitted when a meme token and its bonding curve are deployed.
    /// @param token Address of the deployed meme ERC-20.
    /// @param curve Address of the bonding curve bound to `token`.
    /// @param creator Account that called {createMemeToken}.
    /// @param name Token name as requested by the creator.
    /// @param symbol Token symbol as requested by the creator.
    event MemeTokenCreated(
        address indexed token,
        address indexed curve,
        address indexed creator,
        string name,
        string symbol
    );

    /// @notice Reverts when the caller passes an empty name or symbol.
    error InvalidTokenMetadata();

    /// @notice Reverts when the requested symbol was already launched by this factory.
    /// @param symbol The duplicated symbol.
    error SymbolAlreadyUsed(string symbol);

    /// @notice Deploys a meme token together with its dedicated bonding curve.
    /// @param name Human readable token name, for example `"Mao Tang"`.
    /// @param symbol Token symbol, for example `"MAOTANG"`.
    /// @return token Address of the deployed meme ERC-20.
    /// @return curve Address of the bonding curve that trades `token`.
    function createMemeToken(string name, string symbol) external returns (address token, address curve);
}