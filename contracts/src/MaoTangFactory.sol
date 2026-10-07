// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMaoTangFactory} from "./interfaces/IMaoTangFactory.sol";
import {MaoTangBondingCurve} from "./MaoTangBondingCurve.sol";

/// @title MaoTangFactory
/// @notice Launches meme tokens together with the bonding curve that prices them.
/// @dev One symbol, one launch, enforced by a symbol hash. The factory supplies the sustenance vault
/// and the graduation market, so every curve it deploys routes fees to the same sink.
contract MaoTangFactory is IMaoTangFactory {
    /// @notice Sustenance vault every deployed curve routes its fees to.
    address public immutable vault;

    /// @notice Venue every deployed curve migrates into at graduation.
    address public immutable market;

    address[] private _launches;

    /// @notice True once a symbol has been launched, keyed by `keccak256(symbol)`.
    mapping(bytes32 symbolHash => bool used) public symbolUsed;

    /// @notice Curve bound to each launched token.
    mapping(address token => address curve) public curveOf;

    /// @notice Token bound to each deployed curve.
    mapping(address curve => address token) public tokenOf;

    error InvalidVault();
    error InvalidMarket();

    /// @param vault_ Sustenance vault passed to every curve.
    /// @param market_ Graduation venue passed to every curve.
    constructor(address vault_, address market_) {
        if (vault_ == address(0)) revert InvalidVault();
        if (market_ == address(0)) revert InvalidMarket();
        vault = vault_;
        market = market_;
    }

    /// @notice Deploys a meme token and its dedicated bonding curve.
    /// @param name Human readable token name.
    /// @param symbol Token symbol; may only be launched once.
    /// @return token Address of the deployed meme ERC-20.
    /// @return curve Address of the bonding curve that trades `token`.
    function createMemeToken(string calldata name, string calldata symbol)
        external
        override
        returns (address token, address curve)
    {
        if (bytes(name).length == 0 || bytes(symbol).length == 0) revert InvalidTokenMetadata();

        bytes32 key = keccak256(bytes(symbol));
        if (symbolUsed[key]) revert SymbolAlreadyUsed(symbol);
        symbolUsed[key] = true;

        MaoTangBondingCurve deployed = new MaoTangBondingCurve(vault, msg.sender, market, name, symbol);
        curve = address(deployed);
        token = deployed.token();

        curveOf[token] = curve;
        tokenOf[curve] = token;
        _launches.push(curve);

        emit MemeTokenCreated(token, curve, msg.sender, name, symbol);
    }

    /// @notice Number of launches created by this factory.
    function launchCount() external view returns (uint256) {
        return _launches.length;
    }

    /// @notice Curve of the `index`-th launch, oldest first.
    function launchAt(uint256 index) external view returns (address) {
        return _launches[index];
    }
}
