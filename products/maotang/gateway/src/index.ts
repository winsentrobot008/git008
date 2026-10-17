/**
 * `@maotang/gateway` - the public surface.
 *
 * The gateway is the *server* half of the MAOTANG wallet: it reads the chain for the asset panel, keeps the
 * 24h SpendWindow ledger the M2 policy is evaluated against, gates a leg behind an M5 hardware nullifier and
 * finally proxies the broadcast. Everything it can do is reachable through {@link createRuntime} and
 * {@link createServer}; a host that embeds it should build the runtime once and mount the server, not reach
 * past this file into a module.
 *
 * Three refusals it will not make on a caller's behalf, restated here because they are the first things an
 * integrator trips over:
 *
 *   - **A signed transaction is bound to its declaration, not trusted.** `POST /v1/broadcast` takes both the
 *     intent and the signed bytes, decodes the bytes (`tx.ts`) and refuses the pair when they disagree.
 *     `INTENT_MISMATCH` is a 409 and it means "you told me one thing and signed another".
 *   - **A hardware-backed authorization is required, not verified.** The gateway enforces that a request
 *     *claims* one and reports `authorization.verifiedByGateway: false`, because verifying an assertion needs
 *     the device's own authenticator. This is the largest honest limit in the package.
 *   - **The chain half of the personhood check is not read.** `personhood.chain.status` is `unavailable`:
 *     reconciling a nullifier against `HumanToken.nullifierUsed(bytes32)` needs a selector this build cannot
 *     derive (no keccak256), so the local one-shot guard runs and the operator step is documented in
 *     `gateway/README.md`.
 *
 * Re-exporting `server.ts` pulls `node:http` into any consumer. That is intentional: a gateway that could be
 * imported without its transport would invite a second, unreviewed HTTP surface to be built beside it.
 */

export * from "./errors.js";
export * from "./config.js";
export * from "./policy.js";
export * from "./json-rpc.js";
export * from "./spend-window.js";
export * from "./personhood.js";
export * from "./history.js";
export * from "./rlp.js";
export * from "./tx.js";
export * from "./broadcast.js";
export * from "./server.js";