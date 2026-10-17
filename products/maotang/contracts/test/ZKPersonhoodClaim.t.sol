// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AIAgentRegistry} from "../src/AIAgentRegistry.sol";
import {HumanToken} from "../src/HumanToken.sol";
import {Groth16Verifier} from "../src/Groth16Verifier.sol";
import {NullifierFixture} from "./fixtures/NullifierFixture.sol";

/// @dev End-to-end P0-1 coverage: the real {Groth16Verifier} is wired into the registry and the token,
/// and both are driven with genuine Circom / SnarkJS proofs - agent registration with the hardware
/// attestation (proof B) and the $mHUMAN quota claim with the personhood proof (proof A).
contract ZKPersonhoodClaimTest is Test {
    Groth16Verifier internal verifier;
    AIAgentRegistry internal registry;
    HumanToken internal token;

    address internal admin = address(0xAD);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    bytes32 internal constant ALICE_KEY = keccak256("alice-agent-key");
    bytes32 internal constant BOB_KEY = keccak256("bob-agent-key");

    function setUp() public {
        verifier = new Groth16Verifier(admin);

        vm.prank(admin);
        verifier.setVerificationKey(NullifierFixture.verificationKey());

        registry = new AIAgentRegistry(address(verifier));
        token = new HumanToken(address(registry), address(verifier));
    }

    /// @dev The hardware attestation uses fixture proof B, the personhood claim fixture proof A.
    function _registerAgent(address human, bytes32 agentPubKey) internal returns (address agent) {
        bytes memory hardwareProof = abi.encode(NullifierFixture.proofB());
        bytes32 hardwareNullifier = NullifierFixture.nullifierB();

        vm.prank(human);
        agent = registry.registerAgent(agentPubKey, hardwareProof, hardwareNullifier);
    }

    function test_AgentRegistersAndClaimsWithRealGroth16Proofs() public {
        address agent = _registerAgent(alice, ALICE_KEY);

        assertTrue(registry.isAuthorizedAgent(agent));
        assertEq(registry.requireAuthorizedAgent(agent), alice);
        assertEq(registry.hardwareBinding(NullifierFixture.nullifierB()), agent);

        bytes memory personhoodProof = abi.encode(NullifierFixture.proofA());
        bytes32 personhoodNullifier = NullifierFixture.nullifierA();

        vm.prank(agent);
        uint256 minted = token.claimHumanQuota(personhoodProof, personhoodNullifier);

        assertEq(minted, token.HUMAN_QUOTA());
        assertEq(token.totalSupply(), minted);
        // The quota lands in the human wallet, never in the agent's account.
        assertEq(token.balanceOf(alice), minted);
        assertEq(token.balanceOf(agent), 0);
        assertTrue(token.nullifierUsed(personhoodNullifier));
    }

    function test_RegistrationRejectsAProofForAnotherNullifier() public {
        bytes memory hardwareProof = abi.encode(NullifierFixture.proofB());
        bytes32 wrongNullifier = NullifierFixture.nullifierA();

        vm.prank(alice);
        vm.expectRevert(AIAgentRegistry.InvalidHardwareProof.selector);
        registry.registerAgent(ALICE_KEY, hardwareProof, wrongNullifier);
    }

    function test_RegistrationRejectsATamperedProof() public {
        uint256[8] memory tampered = NullifierFixture.proofB();
        tampered[6] = tampered[6] ^ 1;

        vm.prank(alice);
        vm.expectRevert(AIAgentRegistry.InvalidHardwareProof.selector);
        registry.registerAgent(ALICE_KEY, abi.encode(tampered), NullifierFixture.nullifierB());
    }

    function test_ClaimRejectsATamperedProof() public {
        address agent = _registerAgent(alice, ALICE_KEY);

        uint256[8] memory tampered = NullifierFixture.proofA();
        tampered[0] = tampered[0] ^ 1;

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(HumanToken.InvalidPersonhoodProof.selector, NullifierFixture.nullifierA())
        );
        token.claimHumanQuota(abi.encode(tampered), NullifierFixture.nullifierA());

        assertEq(token.totalSupply(), 0);
    }

    /// @dev The proof is bound to the public input, so a valid proof cannot claim someone else's nullifier.
    function test_ClaimRejectsAProofUsedForAnotherIdentity() public {
        address agent = _registerAgent(alice, ALICE_KEY);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(HumanToken.InvalidPersonhoodProof.selector, NullifierFixture.nullifierB())
        );
        token.claimHumanQuota(abi.encode(NullifierFixture.proofA()), NullifierFixture.nullifierB());
    }

    function test_ClaimCannotBeReplayed() public {
        address agent = _registerAgent(alice, ALICE_KEY);

        bytes memory personhoodProof = abi.encode(NullifierFixture.proofA());
        bytes32 personhoodNullifier = NullifierFixture.nullifierA();

        vm.prank(agent);
        token.claimHumanQuota(personhoodProof, personhoodNullifier);

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(HumanToken.QuotaAlreadyClaimed.selector, personhoodNullifier));
        token.claimHumanQuota(personhoodProof, personhoodNullifier);

        assertEq(token.totalSupply(), token.HUMAN_QUOTA());
    }

    /// @dev A second human cannot register the same machine, even with a valid proof for it.
    function test_HardwareNullifierIsSingleUseAcrossHumans() public {
        _registerAgent(alice, ALICE_KEY);
        address bobAgent = registry.agentAddress(BOB_KEY);

        bytes memory hardwareProof = abi.encode(NullifierFixture.proofB());
        bytes32 hardwareNullifier = NullifierFixture.nullifierB();

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(
                AIAgentRegistry.HardwareAlreadyBound.selector, hardwareNullifier, registry.agentAddress(ALICE_KEY)
            )
        );
        registry.registerAgent(BOB_KEY, hardwareProof, hardwareNullifier);

        assertFalse(registry.isAuthorizedAgent(bobAgent));
    }

    /// @dev Disabling verification (no key) must make the whole flow fail closed.
    function test_UnconfiguredVerifierBlocksRegistration() public {
        Groth16Verifier bare = new Groth16Verifier(admin);
        AIAgentRegistry bareRegistry = new AIAgentRegistry(address(bare));

        bytes memory hardwareProof = abi.encode(NullifierFixture.proofB());

        vm.prank(alice);
        vm.expectRevert(AIAgentRegistry.InvalidHardwareProof.selector);
        bareRegistry.registerAgent(ALICE_KEY, hardwareProof, NullifierFixture.nullifierB());
    }
}