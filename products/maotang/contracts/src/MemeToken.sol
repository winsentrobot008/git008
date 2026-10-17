// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MemeToken
/// @notice Fixed-supply 18-decimal ERC-20 minted once, in full, to its bonding curve.
/// @dev The curve holds the entire inventory at deployment and sells out of that balance, so the
/// supply cap is structural: no mint function exists. Sells return tokens to the curve, which burns
/// them, so `totalSupply` only ever shrinks after deployment.
/// The surface is structurally identical to `IERC20`, but is declared standalone (like `HumanToken`)
/// so the repository keeps a single, dependency-free ERC-20 idiom per token.
contract MemeToken {
    /// @notice Token name, as requested by the creator.
    string public name;

    /// @notice Token symbol, as requested by the creator.
    string public symbol;

    /// @notice Fixed precision. Meme tokens use 18 decimals, unlike the 6-decimal $mHUMAN.
    uint8 public constant DECIMALS = 18;

    /// @notice Supply still in existence, in wei-scale token units.
    uint256 public totalSupply;

    /// @notice Token balance of each account.
    mapping(address account => uint256 amount) public balanceOf;

    /// @notice Allowance granted by an owner to a spender.
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    /// @notice The only address allowed to burn, set to the launch curve at deployment.
    address public immutable curve;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Burned(address indexed from, uint256 amount);

    error InvalidCurve();
    error NotCurve(address caller);
    error InsufficientBalance(address from, uint256 balance, uint256 needed);
    error InsufficientAllowance(address spender, uint256 allowance, uint256 needed);
    error TransferToZeroAddress();

    /// @param name_ Token name.
    /// @param symbol_ Token symbol.
    /// @param curve_ Bonding curve that owns the whole supply and holds the sole burn right.
    /// @param initialSupply Amount minted to `curve_`, in wei-scale units.
    constructor(string memory name_, string memory symbol_, address curve_, uint256 initialSupply) {
        if (curve_ == address(0)) revert InvalidCurve();
        name = name_;
        symbol = symbol_;
        curve = curve_;
        totalSupply = initialSupply;
        balanceOf[curve_] = initialSupply;
        emit Transfer(address(0), curve_, initialSupply);
    }

    /// @notice Fixed number of decimals: 18.
    function decimals() external pure returns (uint8) {
        return DECIMALS;
    }

    /// @notice Burns `amount` from the calling curve's own balance.
    /// @dev Only the launch curve may burn, so supply can never be destroyed by a third party.
    /// @param amount Amount to burn, in wei-scale units.
    function burn(uint256 amount) external {
        if (msg.sender != curve) revert NotCurve(msg.sender);
        _burn(msg.sender, amount);
    }

    /// @notice Moves `amount` to `to`.
    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    /// @notice Sets the allowance of `spender` to `amount`.
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /// @notice Moves `amount` from `from` to `to` using the caller's allowance.
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance(msg.sender, allowed, amount);
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) private {
        if (to == address(0)) revert TransferToZeroAddress();

        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance(from, balance, amount);

        unchecked {
            balanceOf[from] = balance - amount;
        }
        balanceOf[to] += amount;

        emit Transfer(from, to, amount);
    }

    function _burn(address from, uint256 amount) private {
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance(from, balance, amount);

        unchecked {
            balanceOf[from] = balance - amount;
        }
        totalSupply -= amount;

        emit Transfer(from, address(0), amount);
        emit Burned(from, amount);
    }
}
