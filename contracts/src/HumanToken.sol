// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAIAgentRegistry} from "./AIAgentRegistry.sol";

/// @title HumanToken ($mHUMAN)
/// @notice One human, one identity, one quota — claimed through a registered AI agent.
/// @dev Fixed-precision ERC-20. `decimals` is hardcoded to 6, so the smallest amount that can ever
/// move is 1 Micro-HUMAN; integer arithmetic makes sub-unit amounts unrepresentable. Supply only
/// grows through {claimHumanQuota}, and never past {MAX_GLOBAL_SUPPLY}.
contract HumanToken {
    /// @notice Registry deciding which AI agents may claim for which human.
    IAIAgentRegistry public immutable agentRegistry;

    /// @notice Token name.
    string public constant name = "Micro Human";

    /// @notice Token symbol.
    string public constant symbol = "mHUMAN";

    /// @notice Fixed precision. 1 whole HUMAN equals 1,000,000 Micro-HUMAN.
    uint8 public constant DECIMALS = 6;

    /// @notice Smallest representable amount, in micro-units. The token cannot be split further.
    uint256 public constant MICRO_UNIT = 1;

    /// @notice Micro-HUMAN minted per verified human identity: 1,000,000 * 10^6.
    uint256 public constant HUMAN_QUOTA = 1_000_000 * 10 ** 6;

    /// @notice Hard global supply cap: 8,300,000,000 humans * 1,000,000 * 10^6 micro-units.
    uint256 public constant MAX_GLOBAL_SUPPLY = 8_300_000_000 * 1_000_000 * 10 ** 6;

    /// @notice Total minted supply, denominated in micro-units.
    uint256 public totalSupply;

    /// @notice Micro-unit balance of each wallet.
    mapping(address account => uint256 balance) public balanceOf;

    /// @notice Micro-unit allowance granted by an owner to a spender.
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    /// @notice Personhood nullifiers that already consumed their one-time quota.
    mapping(bytes32 personhoodId => bool claimed) public claimedPersonhood;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event HumanQuotaClaimed(address indexed wallet, address indexed agent, bytes32 indexed personhoodId, uint256 amount);

    error EmptyProof();
    error InvalidAgentRegistry();
    error QuotaAlreadyClaimed(bytes32 personhoodId);
    error GlobalSupplyCapExceeded(uint256 requested, uint256 remaining);
    error InsufficientBalance(address from, uint256 balance, uint256 needed);
    error InsufficientAllowance(address spender, uint256 allowance, uint256 needed);
    error TransferToZeroAddress();

    /// @param agentRegistry_ AI agent registry that authorizes claims. Immutable: there is no admin
    /// path to redirect claims to a different registry.
    constructor(address agentRegistry_) {
        if (agentRegistry_ == address(0)) revert InvalidAgentRegistry();
        agentRegistry = IAIAgentRegistry(agentRegistry_);
    }

    /// @notice Fixed number of decimals: 6.
    function decimals() external pure returns (uint8) {
        return DECIMALS;
    }

    /// @notice Quotas that can still be claimed before the global cap is reached.
    function remainingHumanQuota() external view returns (uint256) {
        return (MAX_GLOBAL_SUPPLY - totalSupply) / HUMAN_QUOTA;
    }

    /// @notice Mints one human quota to the wallet the calling agent is authorized for.
    /// @dev AI-agent native: only a registered agent may call this, and the quota always lands in the
    /// human wallet that agent was registered for. The derived personhood nullifier is written before
    /// minting, so a given proof (a given person) can trigger this exactly once.
    /// @param zkProof Personhood proof; its nullifier is the identity handle.
    /// @return minted Amount minted, always {HUMAN_QUOTA}.
    function claimHumanQuota(bytes memory zkProof) external returns (uint256 minted) {
        if (zkProof.length == 0) revert EmptyProof();

        address wallet = agentRegistry.requireAuthorizedAgent(msg.sender);

        bytes32 personhoodId = personhoodNullifier(zkProof);
        if (claimedPersonhood[personhoodId]) revert QuotaAlreadyClaimed(personhoodId);
        claimedPersonhood[personhoodId] = true;

        minted = HUMAN_QUOTA;
        uint256 remaining = MAX_GLOBAL_SUPPLY - totalSupply;
        if (minted > remaining) revert GlobalSupplyCapExceeded(minted, remaining);

        _mint(wallet, minted);
        emit HumanQuotaClaimed(wallet, msg.sender, personhoodId, minted);
    }

    /// @notice Derives the single-use identity handle from a personhood proof.
    /// @dev Placeholder for the real ZK verifier (Groth16 / PLONK). The default implementation binds
    /// one proof to one nullifier but does not prove personhood; override it before production.
    function personhoodNullifier(bytes memory zkProof) public pure virtual returns (bytes32) {
        return keccak256(zkProof);
    }

    /// @notice Moves `amount` micro-units to `to`.
    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    /// @notice Sets the micro-unit allowance of `spender` to `amount`.
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /// @notice Moves `amount` micro-units from `from` to `to` using the caller's allowance.
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance(msg.sender, allowed, amount);
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert TransferToZeroAddress();

        uint256 balance = balanceOf[from];
        if (balance < amount) revert InsufficientBalance(from, balance, amount);

        unchecked {
            balanceOf[from] = balance - amount;
        }
        balanceOf[to] += amount;

        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        if (to == address(0)) revert TransferToZeroAddress();

        totalSupply += amount;
        balanceOf[to] += amount;

        emit Transfer(address(0), to, amount);
    }
}