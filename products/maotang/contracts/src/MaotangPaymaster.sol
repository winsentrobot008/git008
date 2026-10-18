// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEntryPoint {
    function depositTo(address account) external payable;
    function withdrawTo(address payable to, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
}

/// @title MaotangPaymaster
/// @notice ERC-4337 v0.7 paymaster that sponsors a bounded number of user operations per sender.
/// @dev Two independent controls protect the deposit:
///   1. every `paymasterAndData` carries an EIP-712 authorization signed by the server-side authorizer;
///   2. the contract itself keeps an exact 100-operation rolling 24h window per sender.
/// The server can refuse to sign earlier, but the on-chain window is the final authority: a leaked
/// authorization cannot be replayed past the nonce map or the window.
contract MaotangPaymaster {
    struct PackedUserOperation {
        address sender;
        uint256 nonce;
        bytes initCode;
        bytes callData;
        bytes32 accountGasLimits;
        uint256 preVerificationGas;
        bytes32 gasFees;
        bytes paymasterAndData;
        bytes signature;
    }

    enum PostOpMode {
        opSucceeded,
        opReverted,
        postOpReverted
    }

    struct Quota {
        // Ring buffer of the last 100 operation timestamps. `cursor` is the next slot to overwrite,
        // which is also the oldest slot once the ring has wrapped. A non-zero timestamp younger than
        // WINDOW at that slot means 100 operations already happened inside the trailing 24 hours.
        uint64[100] timestamps;
        uint32 cursor;
    }

    bytes32 private constant AUTHORIZATION_TYPEHASH = keccak256(
        "PaymasterAuthorization(address sender,uint256 validUntil,uint256 nonce,uint256 chainId)"
    );
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant DOMAIN_NAME_HASH = keccak256("MaotangPaymaster");
    bytes32 private constant DOMAIN_VERSION_HASH = keccak256("1");

    uint256 public constant DAILY_LIMIT = 100;
    uint256 public constant WINDOW = 24 hours;

    IEntryPoint public immutable entryPoint;
    address public owner;
    address public authorizer;
    bool public paused;
    // Incident control, not the default gate: the faucet/personhood binding already limits who can
    // request a signature, and turning this on without allow-listing anyone would halt all users.
    bool public allowlistEnabled;

    mapping(address sender => Quota quota) public quotas;
    mapping(address sender => mapping(uint256 nonce => bool used)) public usedNonce;
    mapping(address sender => bool allowed) public allowedSenders;

    event Sponsored(address indexed sender, uint256 indexed nonce, uint256 resetAt);
    event AuthorizerChanged(address indexed previousAuthorizer, address indexed nextAuthorizer);
    event SenderAllowed(address indexed sender, bool allowed);
    event PausedSet(bool paused);
    event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);
    event Deposited(address indexed from, uint256 amount);

    error NotOwner();
    error NotEntryPoint();
    error ContractPaused();
    error ZeroAddress();
    error InvalidPaymasterData();
    error AuthorizationExpired(uint256 validUntil, uint256 nowTimestamp);
    error AuthorizationNotYetValid(uint256 validUntil, uint256 nowTimestamp);
    error NonceAlreadyUsed(address sender, uint256 nonce);
    error InvalidAuthorization();
    error SenderNotAllowed(address sender);
    error QuotaExceeded(address sender, uint256 resetAt);
    error InsufficientDeposit(uint256 balance, uint256 needed);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address entryPoint_, address authorizer_, address owner_) {
        if (entryPoint_ == address(0) || authorizer_ == address(0) || owner_ == address(0)) {
            revert ZeroAddress();
        }
        entryPoint = IEntryPoint(entryPoint_);
        authorizer = authorizer_;
        owner = owner_;
    }

    /// @notice Validates the signed authorization, nonce and rolling quota, then records the use.
    function validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256)
        external
        returns (bytes memory context, uint256 validationData)
    {
        if (msg.sender != address(entryPoint)) revert NotEntryPoint();
        if (paused) revert ContractPaused();
        if (userOp.paymasterAndData.length < 52 + 96) revert InvalidPaymasterData();

        // v0.7 layout: 20-byte paymaster, 16-byte verification limit, 16-byte post-op limit, then data.
        bytes calldata data = userOp.paymasterAndData[52:];
        (uint256 validUntil, uint256 nonce, bytes memory signature) =
            abi.decode(data, (uint256, uint256, bytes));

        if (validUntil < block.timestamp) revert AuthorizationExpired(validUntil, block.timestamp);
        if (validUntil > block.timestamp + 1 hours) revert AuthorizationNotYetValid(validUntil, block.timestamp);
        if (usedNonce[userOp.sender][nonce]) revert NonceAlreadyUsed(userOp.sender, nonce);
        if (allowlistEnabled && !allowedSenders[userOp.sender]) revert SenderNotAllowed(userOp.sender);

        bytes32 digest = authorizationDigest(userOp.sender, validUntil, nonce);
        if (_recover(digest, signature) != authorizer) revert InvalidAuthorization();

        usedNonce[userOp.sender][nonce] = true;

        Quota storage quota = quotas[userOp.sender];
        uint256 cursor = quota.cursor;
        uint256 oldest = quota.timestamps[cursor];
        uint256 oldestExpiry = oldest + WINDOW;
        if (oldest != 0 && block.timestamp < oldestExpiry) {
            revert QuotaExceeded(userOp.sender, oldestExpiry);
        }

        quota.timestamps[cursor] = uint64(block.timestamp);
        quota.cursor = uint32((cursor + 1) % DAILY_LIMIT);

        emit Sponsored(
            userOp.sender,
            nonce,
            oldest == 0 ? block.timestamp + WINDOW : oldestExpiry
        );
        return ("", uint256(validUntil) << 160);
    }

    /// @notice No post-op accounting is needed: this paymaster sponsors gas from its EntryPoint deposit.
    function postOp(PostOpMode, bytes calldata, uint256, uint256) external {
        if (msg.sender != address(entryPoint)) revert NotEntryPoint();
    }

    /// @notice Remaining allowance for `sender` in the exact trailing 24h window.
    function quotaOf(address sender)
        external
        view
        returns (uint256 used, uint256 remaining, uint256 windowStart, uint256 resetAt)
    {
        Quota storage quota = quotas[sender];
        uint256 cursor = quota.cursor;
        uint256 usedNow;
        uint256 oldestLive;
        for (uint256 index = 0; index < DAILY_LIMIT; index++) {
            uint256 timestamp = quota.timestamps[(cursor + index) % DAILY_LIMIT];
            if (timestamp == 0) {
                continue;
            }
            uint256 expiry = timestamp + WINDOW;
            if (block.timestamp < expiry) {
                usedNow += 1;
                if (oldestLive == 0 || timestamp < oldestLive) {
                    oldestLive = timestamp;
                }
            }
        }
        used = usedNow;
        remaining = DAILY_LIMIT - usedNow;
        windowStart = oldestLive == 0 ? block.timestamp : oldestLive;
        resetAt = oldestLive == 0 ? block.timestamp + WINDOW : oldestLive + WINDOW;
    }

    function authorizationDigest(address sender, uint256 validUntil, uint256 nonce)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator(),
                keccak256(abi.encode(AUTHORIZATION_TYPEHASH, sender, validUntil, nonce, block.chainid))
            )
        );
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(DOMAIN_TYPEHASH, DOMAIN_NAME_HASH, DOMAIN_VERSION_HASH, block.chainid, address(this))
        );
    }

    function deposit() external payable {
        if (msg.value == 0) revert InsufficientDeposit(0, 1);
        entryPoint.depositTo{value: msg.value}(address(this));
        emit Deposited(msg.sender, msg.value);
    }

    function getDeposit() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    function withdrawTo(address payable to, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(to, amount);
    }

    function setAuthorizer(address nextAuthorizer) external onlyOwner {
        if (nextAuthorizer == address(0)) revert ZeroAddress();
        address previous = authorizer;
        authorizer = nextAuthorizer;
        emit AuthorizerChanged(previous, nextAuthorizer);
    }

    function setAllowedSender(address sender, bool allowed) external onlyOwner {
        if (sender == address(0)) revert ZeroAddress();
        allowedSenders[sender] = allowed;
        emit SenderAllowed(sender, allowed);
    }

    function setAllowlistEnabled(bool enabled) external onlyOwner {
        allowlistEnabled = enabled;
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

    receive() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function _recover(bytes32 digest, bytes memory signature) internal pure returns (address) {
        if (signature.length != 65) {
            return address(0);
        }
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (v < 27) {
            v += 27;
        }
        if (v != 27 && v != 28) {
            return address(0);
        }
        // secp256k1 half-order; reject malleable signatures.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        if (r == bytes32(0) || s == bytes32(0)) {
            return address(0);
        }
        return ecrecover(digest, v, r, s);
    }
}
