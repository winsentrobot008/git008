/**
 * M1 - public surface of the edge SLM layer.
 *
 * Three modules, split along one line: `slm-engine.ts` produces text offline (and enforces that it stays
 * offline), `intent-translator.ts` refuses to trust any of it until it validates into a `TransactionIntent`,
 * and `compute-center-adapter.ts` offloads heavy inference and Groth16 proof generation to a compute center
 * without ever letting authority leave the device.
 *
 * A host composes the edge path as `engine.infer(input)` -> `translator.translate(result.raw)` ->
 * `wallet.signIntent`, or the hybrid path as `remote.propose(input)` -> `remote.authorizeLocally(wallet, ...)`.
 * In both paths the local schema gate and the local M2 policy run, and only the local enclave signs.
 *
 * Nothing here holds a key, opens a socket on the signing path, or spends: M1 proposes, the translator
 * validates, the M2 policy disposes.
 */

export * from "./compute-center-adapter.js";
export * from "./intent-translator.js";
export * from "./slm-engine.js";