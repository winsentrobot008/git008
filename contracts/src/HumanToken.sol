// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAIAgentRegistry} from "./AIAgentRegistry.sol";
import {IZKVerifier} from "./interfaces/IZKVerifier.sol";

/// @title HumanToken ($mHUMAN)
/// @notice One human, one identity, one quota — claimed through a registered AI agent.
/// @dev Fixed-precision ERC-20. `decimals` is hardcoded to 6, so the smallest amount that can ever
/// move is 1 Micro-HUMAN; integer arithmetic makes sub-unit amounts unrepresentable. Supply only
/// grows through {claimHumanQuota}, which requires a Groth16 personhood proof and never past
/// {MAX_GLOBAL_SUPPLY}.
contract HumanToken {
    /// @notice Registry deciding which AI agents may claim for which human.
    IAIAgentRegistry public immutable agentRegistry;

    /// @notice Groth16 verifier every personhood proof must satisfy before a quota is minted.
    /// @dev Immutable: there is no admin path to swap the verifier after deployment, so the rules
    /// under which a human is recognized cannot change under the holders' feet.
    IZKVerifier public immutable zkVerifier;

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
    mapping(bytes32 nullifierHash => bool used) public nullifierUsed;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event HumanQuotaClaimed(
        address indexed wallet, address indexed agent, bytes32 indexed nullifierHash, uint256 amount
    );

    error EmptyProof();
    error InvalidAgentRegistry();
    error InvalidZKVerifier();
    error InvalidPersonhoodProof(bytes32 nullifierHash);
    error QuotaAlreadyClaimed(bytes32 nullifierHash);
    error GlobalSupplyCapExceeded(uint256 requested, uint256 remaining);
    error InsufficientBalance(address from, uint256 balance, uint256 needed);
    error InsufficientAllowance(address spender, uint256 allowance, uint256 needed);
    error TransferToZeroAddress();

    /// @param agentRegistry_ AI agent registry that authorizes claims. Immutable: there is no admin
    /// path to redirect claims to a different registry.
    /// @param zkVerifier_ Groth16 verifier for personhood proofs. Also immutable.
    constructor(address agentRegistry_, address zkVerifier_) {
        if (agentRegistry_ == address(0)) revert InvalidAgentRegistry();
        if (zkVerifier_ == address(0)) revert InvalidZKVerifier();
        agentRegistry = IAIAgentRegistry(agentRegistry_);
        zkVerifier = IZKVerifier(zkVerifier_);
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
    /// human wallet that agent was registered for. The claim is accepted only when
    /// {IZKVerifier-verifyProof} accepts `proof` for `nullifierHash`, the circuit's single public
    /// input. The nullifier is written before minting, so one person (one nullifier) can trigger this
    /// exactly once, even across different agents.
    /// @param proof Groth16 personhood proof, `abi.encode(uint256[8])` in SnarkJS limb order.
    /// @param nullifierHash Single-use identity handle; must be a canonical BN254 scalar.
    /// @return minted Amount minted, always {HUMAN_QUOTA}.
    function claimHumanQuota(bytes calldata proof, bytes32 nullifierHash) external returns (uint256 minted) {
        if (proof.length == 0) revert EmptyProof();
        if (nullifierHash == bytes32(0)) revert InvalidPersonhoodProof(nullifierHash);

        address wallet = agentRegistry.requireAuthorizedAgent(msg.sender);

        if (nullifierUsed[nullifierHash]) revert QuotaAlreadyClaimed(nullifierHash);
        if (!zkVerifier.verifyProof(proof, nullifierHash)) revert InvalidPersonhoodProof(nullifierHash);
        nullifierUsed[nullifierHash] = true;

        minted = HUMAN_QUOTA;
        uint256 remaining = MAX_GLOBAL_SUPPLY - totalSupply;
        if (minted > remaining) revert GlobalSupplyCapExceeded(minted, remaining);

        _mint(wallet, minted);
        emit HumanQuotaClaimed(wallet, msg.sender, nullifierHash, minted);
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