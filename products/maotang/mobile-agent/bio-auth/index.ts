/**
 * M5 - public surface of the bio-sovereign layer.
 *
 * `biometric-gate.ts` is the human-presence channel that the M2 wallet consumes through its
 * `AuthorizationGate` seam. `nullifier.ts` derives and tracks the one-shot handles an on-chain
 * personhood claim consumes. Both default to refusing to work, so an unconfigured build cannot claim a
 * capability it does not have.
 */

export * from "./biometric-gate.js";
export * from "./native-biometric-gate.js";
export * from "./nullifier.js";
