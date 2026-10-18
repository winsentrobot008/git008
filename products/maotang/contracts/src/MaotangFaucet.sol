// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMaotangFaucetToken {
    function mint(address to, uint256 amount) external returns (bool);
}

/// @title MaotangFaucet
/// @notice On-chain cold-start claim ledger for the testnet MAOTANG reward token.
/// @dev The ledger is the mapping, not a server database: one `identityHash` can claim exactly once,
/// no matter how many serverless instances answer the request. `mintAuthority` is the dedicated
/// faucet wallet; the owner can pause claims but cannot rewrite a consumed identity hash.
contract MaotangFaucet {
    struct ClaimRecord {
        address recipient;
        uint256 amount;
        uint64 claimedAt;
        bytes32 identityHash;
    }

    IMaotangFaucetToken public immutable token;
    address public immutable mintAuthority;
    uint256 public immutable rewardUnits;
    uint256 public immutable maxRewardUnits;
    address public owner;
    bool public paused;

    mapping(bytes32 identityHash => ClaimRecord record) public claims;
    uint256 public totalClaims;
    uint256 public totalMinted;

    event Claimed(
        bytes32 indexed identityHash, address indexed recipient, uint256 amount, address indexed mintAuthority
    );
    event PausedSet(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);

    error NotOwner();
    error NotMintAuthority();
    error ContractPaused();
    error ZeroAddress();
    error InvalidIdentityHash();
    error InvalidAmount(uint256 amount, uint256 maxAmount);
    error AlreadyClaimed(bytes32 identityHash);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyMintAuthority() {
        if (msg.sender != mintAuthority) revert NotMintAuthority();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    constructor(address token_, address mintAuthority_, uint256 rewardUnits_, uint256 maxRewardUnits_, address owner_) {
        if (token_ == address(0) || mintAuthority_ == address(0) || owner_ == address(0)) {
            revert ZeroAddress();
        }
        if (rewardUnits_ == 0 || maxRewardUnits_ < rewardUnits_) {
            revert InvalidAmount(rewardUnits_, maxRewardUnits_);
        }
        token = IMaotangFaucetToken(token_);
        mintAuthority = mintAuthority_;
        rewardUnits = rewardUnits_;
        maxRewardUnits = maxRewardUnits_;
        owner = owner_;
    }

    /// @notice Records one claim for `identityHash` and mints `amount` to `recipient`.
    /// @dev The caller must be the configured server-side faucet wallet. The mapping is written before
    /// the external mint call, so a reentrant token cannot claim the same identity twice.
    function claim(address recipient, bytes32 identityHash, uint256 amount) external onlyMintAuthority whenNotPaused {
        if (recipient == address(0)) revert ZeroAddress();
        if (identityHash == bytes32(0)) revert InvalidIdentityHash();
        if (amount == 0 || amount > maxRewardUnits) revert InvalidAmount(amount, maxRewardUnits);
        if (claims[identityHash].claimedAt != 0) revert AlreadyClaimed(identityHash);

        claims[identityHash] = ClaimRecord({
            recipient: recipient, amount: amount, claimedAt: uint64(block.timestamp), identityHash: identityHash
        });
        totalClaims += 1;
        totalMinted += amount;

        emit Claimed(identityHash, recipient, amount, msg.sender);

        token.mint(recipient, amount);
    }

    /// @notice The same claim using the deployment's default reward.
    function claimDefault(address recipient, bytes32 identityHash) external onlyMintAuthority whenNotPaused {
        if (recipient == address(0)) revert ZeroAddress();
        if (identityHash == bytes32(0)) revert InvalidIdentityHash();
        if (claims[identityHash].claimedAt != 0) revert AlreadyClaimed(identityHash);

        uint256 amount = rewardUnits;
        claims[identityHash] = ClaimRecord({
            recipient: recipient, amount: amount, claimedAt: uint64(block.timestamp), identityHash: identityHash
        });
        totalClaims += 1;
        totalMinted += amount;

        emit Claimed(identityHash, recipient, amount, msg.sender);

        token.mint(recipient, amount);
    }

    function hasClaimed(bytes32 identityHash) external view returns (bool) {
        return claims[identityHash].claimedAt != 0;
    }

    function claimOf(bytes32 identityHash) external view returns (ClaimRecord memory) {
        return claims[identityHash];
    }

    function setPaused(bool next) external onlyOwner {
        paused = next;
        emit PausedSet(next);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert ZeroAddress();
        address previous = owner;
        owner = nextOwner;
        emit OwnershipTransferred(previous, nextOwner);
    }
}
