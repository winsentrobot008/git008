/**
 * M2 - public surface of the autonomous local wallet.
 *
 * Consumers import from here rather than from the individual modules, so the internal split (types,
 * digest, policy, enclave, ABI encoder, wallet) can move without breaking a host or a test. Nothing in
 * this package holds a private key, opens a socket, or broadcasts: `AutonomousWallet.signIntent`
 * produces a signature and stops there.
 *
 * A host that wants a *working* wallet supplies two collaborators and nothing else:
 *
 *   - a `SecureEnclave` implementation. `createSecureEnclave()` returns the refusing default on purpose,
 *     because a software key that silently stands in for a hardware one would make every guardrail in
 *     this package decorative.
 *   - an `AuthorizationGate` implementation. `../bio-auth` provides a biometric adapter; without one,
 *     every intent at or above the policy threshold is refused.
 */

export * from "./abi.js";
export * from "./enclave.js";
export * from "./native-enclave.js";
export * from "./policy.js";
export * from "./types.js";
export * from "./wallet.js";
