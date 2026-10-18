// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MaotangFaucetToken
/// @notice The dedicated testnet/devnet MAOTANG reward token for social distribution and
///         Chat-to-Pay micro-payments.
/// @dev Deliberately separate from $mHUMAN and from the protocol's production token. Supply only grows
/// through {mint}, which a single minter may call, and never exceeds {MAX_SUPPLY}. Every transfer burns
/// {BURN_BPS} basis points, rounded down, so sub-unit micro-payments can remain intact. The owner can
/// point the minter at the faucet once and then lock it, so a compromised server key cannot repoint
/// minting after launch.
contract MaotangFaucetToken {
    string public constant name = "MAOTANG";
    string public constant symbol = "MAOTANG";
    uint8 public constant decimals = 18;

    /// @notice Hard circulating-supply cap. The faucet can only mint into the remaining supply.
    uint256 public constant MAX_SUPPLY = 8_300_000_000 * 10 ** 18;

    /// @notice Burn-on-transfer rate: 0.10% of each transfer, rounded down to the smallest unit.
    uint16 public constant BURN_BPS = 10;
    uint16 public constant BPS_DENOMINATOR = 10_000;

    address public owner;
    address public minter;
    bool public minterLocked;
    uint256 public totalSupply;
    uint256 public totalMinted;
    uint256 public totalBurned;

    mapping(address account => uint256 balance) public balanceOf;
    mapping(address account => mapping(address spender => uint256 amount)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event MinterChanged(address indexed previousMinter, address indexed nextMinter);
    event MinterLocked(address indexed minter);
    event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);

    error NotOwner();
    error NotMinter();
    error MinterIsLocked();
    error ZeroAddress();
    error SupplyCapExceeded(uint256 requested, uint256 remaining);
    error InsufficientBalance(address from, uint256 balance, uint256 needed);
    error InsufficientAllowance(address spender, uint256 allowance, uint256 needed);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyMinter() {
        if (msg.sender != minter) revert NotMinter();
        _;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        minter = owner_;
        emit MinterChanged(address(0), owner_);
    }

    /// @notice Points minting at `nextMinter`. Rejected once {lockMinter} has run.
    function setMinter(address nextMinter) external onlyOwner {
        if (minterLocked) revert MinterIsLocked();
        if (nextMinter == address(0)) revert ZeroAddress();
        address previous = minter;
        minter = nextMinter;
        emit MinterChanged(previous, nextMinter);
    }

    /// @notice Permanently freezes the minter address. There is no unlock path.
    function lockMinter() external onlyOwner {
        minterLocked = true;
        emit MinterLocked(minter);
    }

    /// @notice Transfers token-owner custody without touching the locked minter.
    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert ZeroAddress();
        address previous = owner;
        owner = nextOwner;
        emit OwnershipTransferred(previous, nextOwner);
    }

    /// @notice Mints `amount` to `to`. Only the configured minter may call this.
    function mint(address to, uint256 amount) external onlyMinter returns (bool) {
        if (to == address(0)) revert ZeroAddress();
        uint256 remaining = MAX_SUPPLY - totalSupply;
        if (amount > remaining) revert SupplyCapExceeded(amount, remaining);
        totalSupply += amount;
        totalMinted += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        _spendAllowance(from, msg.sender, amount);
        _transfer(from, to, amount);
        return true;
    }

    /// @notice Burns `amount` from the caller's balance.
    function burn(uint256 amount) external returns (bool) {
        _burn(msg.sender, amount);
        return true;
    }

    /// @notice Burns `amount` from `from` using the caller's allowance.
    function burnFrom(address from, uint256 amount) external returns (bool) {
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
        return true;
    }

    /// @notice Returns the amount a recipient would receive and the amount burned for a transfer.
    function previewTransfer(uint256 amount) public pure returns (uint256 received, uint256 burned) {
        burned = (amount * BURN_BPS) / BPS_DENOMINATOR;
        received = amount - burned;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance(from, balance, amount);

        (uint256 received, uint256 burned) = previewTransfer(amount);
        unchecked {
            balanceOf[from] = balance - amount;
        }
        balanceOf[to] += received;

        if (burned != 0) {
            totalSupply -= burned;
            totalBurned += burned;
            emit Transfer(from, address(0), burned);
        }
        emit Transfer(from, to, received);
    }

    function _spendAllowance(address from, address spender, uint256 amount) internal {
        uint256 allowed = allowance[from][spender];
        if (allowed == type(uint256).max) {
            return;
        }
        if (allowed < amount) revert InsufficientAllowance(spender, allowed, amount);
        allowance[from][spender] = allowed - amount;
    }

    function _burn(address from, uint256 amount) internal {
        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance(from, balance, amount);
        unchecked {
            balanceOf[from] = balance - amount;
        }
        totalSupply -= amount;
        totalBurned += amount;
        emit Transfer(from, address(0), amount);
    }
}
