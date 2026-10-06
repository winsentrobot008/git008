// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IAIAgentRegistry
/// @notice Read surface consumed by protocol contracts that only registered AI agents may call.
interface IAIAgentRegistry {
    /// @notice On-chain identity of the agent bound to `agentPubKey`.
    function agentAddress(bytes32 agentPubKey) external view returns (address agent);

    /// @notice True when `agent` is registered and not revoked.
    function isAuthorizedAgent(address agent) external view returns (bool authorized);

    /// @notice Human wallet `agent` acts for; reverts when the agent is not authorized.
    function requireAuthorizedAgent(address agent) external view returns (address owner);
}

/// @title AIAgentRegistry
/// @notice Registers the personal AI agents that may act on behalf of a human.
/// @dev One human authorizes one agent per hardware-backed identity. The agent's on-chain identity is
/// derived deterministically from its public key, so the agent operates from its own counterfactual
/// smart-account address while every quota it claims still lands in the human's wallet.
contract AIAgentRegistry {
    struct AgentRecord {
        address owner;
        bytes32 agentPubKey;
        bytes32 hardwareId;
        uint64 registeredAt;
        bool active;
    }

    string private constant _AGENT_DOMAIN = "maotang.agent.v1";
    string private constant _HARDWARE_DOMAIN = "maotang.hardware.v1";

    mapping(address agent => AgentRecord record) private _records;

    /// @notice Agent address bound to each registered public key.
    mapping(bytes32 agentPubKey => address agent) public agentByKey;

    /// @notice Agent address bound to each consumed hardware attestation.
    mapping(bytes32 hardwareId => address agent) public hardwareBinding;

    event AgentRegistered(address indexed agent, address indexed owner, bytes32 agentPubKey, bytes32 hardwareId);
    event AgentRevoked(address indexed agent, address indexed owner);

    error InvalidAgentKey();
    error InvalidHardwareProof();
    error AgentAlreadyRegistered(address agent);
    error HardwareAlreadyBound(bytes32 hardwareId, address agent);
    error UnauthorizedAgent(address agent);
    error NotAgentOwner(address agent, address caller);

    /// @notice Registers and authorizes the caller's personal AI agent.
    /// @dev The caller becomes the owner (the human wallet the agent acts for). One public key and
    /// one hardware attestation can each be bound only once.
    /// @param agentPubKey Public key of the agent; its address is derived from this key.
    /// @param zkHardwareProof Proof that the agent runs on genuine, unmodified hardware.
    /// @return agent Address of the registered agent.
    function registerAgent(bytes32 agentPubKey, bytes memory zkHardwareProof) external returns (address agent) {
        if (agentPubKey == bytes32(0)) revert InvalidAgentKey();
        if (zkHardwareProof.length == 0) revert InvalidHardwareProof();

        agent = agentAddress(agentPubKey);
        if (_records[agent].active) revert AgentAlreadyRegistered(agent);

        bytes32 hardwareId = hardwareNullifier(zkHardwareProof);
        address bound = hardwareBinding[hardwareId];
        if (bound != address(0)) revert HardwareAlreadyBound(hardwareId, bound);

        _records[agent] = AgentRecord({
            owner: msg.sender,
            agentPubKey: agentPubKey,
            hardwareId: hardwareId,
            registeredAt: uint64(block.timestamp),
            active: true
        });
        agentByKey[agentPubKey] = agent;
        hardwareBinding[hardwareId] = agent;

        emit AgentRegistered(agent, msg.sender, agentPubKey, hardwareId);
    }

    /// @notice Revokes an agent. Only the human that registered it may do so.
    function revokeAgent(address agent) external {
        AgentRecord storage record = _records[agent];
        if (record.owner == address(0)) revert UnauthorizedAgent(agent);
        if (record.owner != msg.sender) revert NotAgentOwner(agent, msg.sender);

        record.active = false;
        emit AgentRevoked(agent, msg.sender);
    }

    /// @notice Derives the agent identity address from its public key.
    function agentAddress(bytes32 agentPubKey) public pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(_AGENT_DOMAIN, agentPubKey)))));
    }

    /// @notice True when `agent` is registered and not revoked.
    function isAuthorizedAgent(address agent) public view returns (bool) {
        return _records[agent].active;
    }

    /// @notice Returns the human wallet `agent` acts for.
    /// @dev Reverts with {UnauthorizedAgent} when the caller is not a registered agent. This is the
    /// gate every agent-only entry point (token claims, curve trades, market swaps) must go through.
    function requireAuthorizedAgent(address agent) public view returns (address owner) {
        AgentRecord storage record = _records[agent];
        if (!record.active || record.owner == address(0)) revert UnauthorizedAgent(agent);
        return record.owner;
    }

    /// @notice Full record of a registered agent.
    function agentRecord(address agent) external view returns (AgentRecord memory) {
        return _records[agent];
    }

    /// @notice Hardware identity derived from an attestation proof.
    /// @dev Placeholder for the real ZK hardware verifier; override before production.
    function hardwareNullifier(bytes memory zkHardwareProof) public pure virtual returns (bytes32) {
        return keccak256(abi.encodePacked(_HARDWARE_DOMAIN, zkHardwareProof));
    }
}

/// @title AgentGated
/// @notice Base contract for protocol entry points restricted to registered AI agents.
/// @dev Bonding-curve and market implementations inherit this so that DEX trades carry the same
/// authorization requirement as token claims.
abstract contract AgentGated {
    /// @notice Registry consulted for every gated call.
    IAIAgentRegistry public immutable agentRegistry;

    constructor(address registry) {
        agentRegistry = IAIAgentRegistry(registry);
    }

    /// @dev Reverts with the registry's {UnauthorizedAgent} error for unregistered callers.
    modifier onlyAuthorizedAgent() {
        agentRegistry.requireAuthorizedAgent(msg.sender);
        _;
    }

    /// @notice Human wallet the calling agent acts for.
    function _agentOwner() internal view returns (address) {
        return agentRegistry.requireAuthorizedAgent(msg.sender);
    }
}