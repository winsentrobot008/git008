/**
 * M1 - public surface of the edge SLM layer.
 *
 * Two modules, split along one line: `slm-engine.ts` produces text offline (and enforces that it stays
 * offline), `intent-translator.ts` refuses to trust any of it until it validates into a `TransactionIntent`.
 * A host composes them as `engine.infer(input)` -> `translator.translate(result.raw)` -> `wallet.signIntent`.
 *
 * Nothing here holds a key, opens a socket or spends: M1 proposes, the translator validates, the M2 policy
 * disposes.
 */

export * from "./intent-translator.js";
export * from "./slm-engine.js";