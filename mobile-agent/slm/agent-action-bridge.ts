/**
 * M1/M2 - the fail-closed seam for external agent action providers.
 *
 * Why this file exists. Open-source agent stacks (`@coinbase/agentkit`, `permissionless.js`, and the
 * long tail behind them) ship a useful idea - a provider enumerates *actions* and yields *call specs* -
 * and one dangerous idea: they carry their own wallet or signing provider, so importing one wholesale
 * means shipping a second authority that decides what gets signed. In this protocol there is exactly one
 * authority (the M2 policy) and exactly one signer (the device enclave), so nothing may be imported on
 * those terms.
 *
 * What is adopted instead is the *interface*, duck-typed and dependency-free: a provider proposes, and
 * this bridge turns the proposal into a `TransactionIntent` that is handed to the local
 * `AutonomousWallet`, which re-runs the whole policy and asks the enclave. Three properties are enforced
 * rather than assumed:
 *
 *   1. **No custody, ever.** A proposal carrying custody-shaped material (a signature, a signed or
 *      serialized transaction, a private key, a seed, a keystore) is refused with
 *      {@link ExternalActionError} `CUSTODY_MATERIAL` before any field is read. This is the same posture
 *      `compute-center-adapter.ts` takes toward a relayer, applied to an action provider.
 *   2. **Closed vocabulary.** The action must be one of {@link SLM_ACTIONS} or its consumer alias
 *      ({@link CONSUMER_ACTION_NAMES}). Anything else is `UNKNOWN_ACTION` - an external provider cannot
 *      widen the catalog by naming a new verb.
 *   3. **No silent unit conversion.** Amounts are native wei decimal strings and nothing else. A proposal
 *      that names another asset (BTC, USD, a token symbol) is `MALFORMED_PROPOSAL`, because pricing it
 *      would mean inventing a rate - and an invented rate is how a "small" leg becomes a large one.
 *
 * {@link AgentActionBridge.authorize} is the only method that can end in a signature, and all it does is
 * call the injected local wallet. There is no branch here that produces key material or a signature.
 *
 * Consumer nomenclature. The owner never sees internal verbs. {@link CONSUMER_ACTION_NAMES} maps the
 * catalog onto the consumer vocabulary (`YuanYuan` = move value, `MaoMao` = launch a token,
 * `FenFen` = claim your share) and the map is **presentation-only**: it is accepted on the way in and
 * reported for display, while every wire field, policy code and audit string keeps the internal id.
 */

import type { PolicyDecision } from "../signer/policy.js";
import { isAddress, isHex, type Address, type Hex } from "../signer/types.js";
import type { IntentPreview, SignedIntent, TransactionIntent } from "../signer/wallet.js";
import { SLM_ACTIONS, type SlmAction } from "./intent-translator.js";

/** Internal action id -> the name the owner sees. Presentation-only; never written to the wire. */
export const CONSUMER_ACTION_NAMES: Readonly<Record<SlmAction, string>> = Object.freeze({
  transfer: "YuanYuan",
  createMemeToken: "MaoMao",
  claimHumanQuota: "FenFen",
});

/** The reverse lookup, folded to lowercase so `yuanyuan` and `YuanYuan` are one name. */
const CONSUMER_ACTION_IDS: ReadonlyMap<string, SlmAction> = new Map(
  (Object.entries(CONSUMER_ACTION_NAMES) as readonly (readonly [SlmAction, string])[]).map(
    ([id, name]) => [name.toLowerCase(), id] as const,
  ),
);

/** The consumer-facing name for an internal action id, or `null` when it is not in the catalog. */
export function consumerActionNameFor(action: string): string | null {
  return (SLM_ACTIONS as readonly string[]).includes(action)
    ? CONSUMER_ACTION_NAMES[action as SlmAction]
    : null;
}

/** The internal action id for a consumer name, or `null`. Never invents an id for an unknown name. */
export function internalActionFor(consumerName: string): SlmAction | null {
  return CONSUMER_ACTION_IDS.get(consumerName.trim().toLowerCase()) ?? null;
}

export type ExternalActionCode = "CUSTODY_MATERIAL" | "UNKNOWN_ACTION" | "MALFORMED_PROPOSAL";

export class ExternalActionError extends Error {
  readonly code: ExternalActionCode;

  constructor(code: ExternalActionCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "ExternalActionError";
    this.code = code;
  }
}

/**
 * Fields a proposal may carry. Anything else is a refusal, not a value quietly ignored - the same rule
 * `intent-translator.ts` applies to model output.
 */
const PROPOSAL_FIELDS: readonly string[] = ["provider", "action", "to", "valueWei", "data", "chainId", "description"];

/** Custody-shaped field names, folded: `signedTx`, `signed_tx` and `SIGNEDTX` are one match. */
const CUSTODY_FIELDS: readonly string[] = [
  "signature",
  "sig",
  "signedtx",
  "signedtransaction",
  "rawtx",
  "rawtransaction",
  "serializedtx",
  "signedpayload",
  "privatekey",
  "privkey",
  "secret",
  "secretkey",
  "seed",
  "mnemonic",
  "keystore",
  "wif",
];

/** Unit-bearing field names: naming an asset is how a unit confusion gets smuggled in. */
const ASSET_FIELDS: readonly string[] = ["asset", "token", "currency", "denomination", "unit", "symbol"];

const fold = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** What a provider hands over. Duck-typed on purpose: no package is imported to satisfy it. */
export interface ExternalActionProposal {
  /** Free-form provider label, kept for the audit trail. */
  readonly provider?: string;
  /** An internal action id ({@link SLM_ACTIONS}) or its consumer alias. */
  readonly action?: unknown;
  readonly to?: unknown;
  /** Native value in wei, as a canonical integer decimal string. */
  readonly valueWei?: unknown;
  readonly data?: unknown;
  readonly chainId?: unknown;
  readonly description?: unknown;
  readonly [field: string]: unknown;
}

/**
 * The shape an external agent's action provider is adapted to.
 *
 * `@coinbase/agentkit` and its peers expose their capabilities as *actions* and - the half this protocol
 * cannot import - carry their own wallet/signer provider. This interface keeps only the part worth having: a
 * provider that names an action and yields a call spec. It holds no key, signs nothing and cannot reach the
 * chain, because {@link AgentActionBridge.proposeFrom} hands its output to the same local gate a hand-written
 * proposal goes through, and the signature still happens in the device enclave.
 */
export interface ExternalActionProvider {
  /** Free-form label, kept for the audit trail. */
  readonly name: string;
  /** Actions the provider advertises, in the internal vocabulary or a consumer alias. */
  readonly actions: readonly string[];
  /** At most one proposal for `input`; `null` means the provider has no action for it. */
  propose(input: unknown): ExternalActionProposal | null | Promise<ExternalActionProposal | null>;
}

/** The shape this bridge produces, before the wallet has said anything about it. */
export interface ActionProposal {
  readonly provider: string;
  readonly action: SlmAction;
  /** What the owner sees (`YuanYuan` | `MaoMao` | `FenFen`). */
  readonly consumerName: string;
  readonly intent: TransactionIntent;
}

/** Why a local signature did not happen, if it did not. */
export interface ActionRefusal {
  readonly code: string;
  readonly reason: string;
}

export interface BridgeAuthorization {
  readonly proposal: ActionProposal;
  readonly decision: PolicyDecision;
  /** Present only when the local wallet released a signature. */
  readonly signed: SignedIntent | null;
  /** The M2/M5 refusal, when the policy allowed the leg and the authorization or enclave did not. */
  readonly refusal: ActionRefusal | null;
}

/**
 * The local authority. Structurally satisfied by `AutonomousWallet`; declared here so this module
 * depends on the *shape* of the wallet and not on its implementation.
 */
export interface LocalIntentAuthority {
  preview(intent: TransactionIntent): Promise<IntentPreview>;
  signIntent(intent: TransactionIntent): Promise<SignedIntent>;
}

export interface AgentActionBridgeOptions {
  readonly wallet: LocalIntentAuthority;
  /** Chains a proposal may target. Defaults to every chain the wallet's own policy will re-check. */
  readonly allowedChainIds?: readonly number[];
}

/**
 * Turns an external provider's proposal into a local intent, and nothing more.
 *
 * The bridge is deliberately unable to sign on its own: {@link authorize} can only reach a signature
 * through the injected wallet, which re-evaluates the policy and, above the threshold, demands a
 * hardware-backed owner authorization.
 */
export class AgentActionBridge {
  readonly #wallet: LocalIntentAuthority;
  readonly #allowedChainIds: readonly number[] | null;

  constructor(options: AgentActionBridgeOptions) {
    this.#wallet = options.wallet;
    this.#allowedChainIds = options.allowedChainIds ?? null;
  }

  /** Validates a proposal into a local intent. Throws {@link ExternalActionError} on anything else. */
  propose(external: ExternalActionProposal): ActionProposal {
    if (external === null || typeof external !== "object" || Array.isArray(external)) {
      throw new ExternalActionError("MALFORMED_PROPOSAL", "a proposal must be an object");
    }

    for (const field of Object.keys(external)) {
      const folded = fold(field);
      if (CUSTODY_FIELDS.includes(folded)) {
        throw new ExternalActionError(
          "CUSTODY_MATERIAL",
          `the proposal carries "${field}"; a provider may propose, never sign`,
        );
      }
      if (ASSET_FIELDS.includes(folded)) {
        throw new ExternalActionError(
          "MALFORMED_PROPOSAL",
          `the proposal names an asset ("${field}"); amounts are native wei only and this bridge prices nothing`,
        );
      }
      if (!PROPOSAL_FIELDS.includes(field)) {
        throw new ExternalActionError("MALFORMED_PROPOSAL", `unknown proposal field "${field}"`);
      }
    }

    const action = this.#resolveAction(external.action);
    const to = this.#resolveDestination(external.to);
    const valueWei = this.#resolveValue(external.valueWei);
    const data = this.#resolveData(external.data, action);
    const chainId = this.#resolveChainId(external.chainId);

    const provider = typeof external.provider === "string" && external.provider.trim() !== ""
      ? external.provider.trim()
      : "external-provider";

    return {
      provider,
      action,
      consumerName: CONSUMER_ACTION_NAMES[action],
      intent: {
        to,
        valueWei,
        data,
        chainId,
        description:
          typeof external.description === "string" && external.description.trim() !== ""
            ? external.description.trim()
            : `${CONSUMER_ACTION_NAMES[action]} proposed by ${provider}`,
      },
    };
  }

  /**
   * The same gate, entered through an external provider.
   *
   * The provider is validated first and its output is re-validated by {@link AgentActionBridge.propose}; an
   * action the provider did not advertise is refused even when it is a legal catalog entry, so a compromised
   * provider cannot quietly widen its own remit. A `null` proposal is a normal "no action here", returned as
   * `null` rather than thrown, so a caller can iterate providers without try/catch around each one.
   */
  async proposeFrom(provider: ExternalActionProvider, input: unknown): Promise<ActionProposal | null> {
    if (provider === null || typeof provider !== "object") {
      throw new ExternalActionError("MALFORMED_PROPOSAL", "an action provider must be an object");
    }
    if (typeof provider.name !== "string" || provider.name.trim() === "") {
      throw new ExternalActionError("MALFORMED_PROPOSAL", "an action provider must carry a non-empty name");
    }
    if (!Array.isArray(provider.actions) || provider.actions.some((action) => typeof action !== "string")) {
      throw new ExternalActionError(
        "MALFORMED_PROPOSAL",
        `provider ${provider.name} must advertise its actions as an array of strings`,
      );
    }
    const advertised = new Set(provider.actions.map((action) => action.toLowerCase()));
    const raw = await provider.propose(input);
    if (raw === null || raw === undefined) {
      return null;
    }
    const proposal = this.propose({ ...raw, provider: raw.provider ?? provider.name });
    if (!advertised.has(proposal.action.toLowerCase()) && !advertised.has(proposal.consumerName.toLowerCase())) {
      throw new ExternalActionError(
        "UNKNOWN_ACTION",
        `provider ${provider.name} proposed "${proposal.action}", which it does not advertise`,
      );
    }
    return proposal;
  }

  /**
   * The whole pipeline for one proposal: policy first, then (only if asked) the local signature.
   *
   * A policy denial is returned as a *value* - a closed guardrail is a normal answer, not an exception -
   * while a refused authorization or an unreachable enclave is reported in `refusal`. Either way the
   * caller gets no signature.
   */
  async authorize(
    external: ExternalActionProposal,
    options: { readonly attemptSign?: boolean } = {},
  ): Promise<BridgeAuthorization> {
    const proposal = this.propose(external);
    const preview = await this.#wallet.preview(proposal.intent);
    if (!preview.decision.allowed) {
      return { proposal, decision: preview.decision, signed: null, refusal: null };
    }
    if (options.attemptSign !== true) {
      return { proposal, decision: preview.decision, signed: null, refusal: null };
    }

    try {
      const signed = await this.#wallet.signIntent(proposal.intent);
      return { proposal, decision: preview.decision, signed, refusal: null };
    } catch (error) {
      const failure = error as { name?: string; code?: unknown; message?: string };
      const code = typeof failure.code === "string" ? failure.code : (failure.name ?? "SIGN_REFUSED");
      return {
        proposal,
        decision: preview.decision,
        signed: null,
        refusal: { code, reason: failure.message ?? "the local wallet refused to sign" },
      };
    }
  }

  #resolveAction(value: unknown): SlmAction {
    if (typeof value !== "string" || value.trim() === "") {
      throw new ExternalActionError("MALFORMED_PROPOSAL", "a proposal must name an action");
    }
    const trimmed = value.trim();
    if ((SLM_ACTIONS as readonly string[]).includes(trimmed)) {
      return trimmed as SlmAction;
    }
    const aliased = internalActionFor(trimmed);
    if (aliased !== null) {
      return aliased;
    }
    throw new ExternalActionError(
      "UNKNOWN_ACTION",
      `"${trimmed}" is not in the M1 catalog (${SLM_ACTIONS.join(", ")}) or its consumer names`,
    );
  }

  #resolveDestination(value: unknown): Address {
    if (typeof value !== "string" || !isAddress(value)) {
      throw new ExternalActionError(
        "MALFORMED_PROPOSAL",
        `destination must be a 20-byte hex address, got ${String(value)}`,
      );
    }
    return value.toLowerCase() as Address;
  }

  #resolveValue(value: unknown): bigint {
    const text = value === undefined ? "0" : value;
    if (typeof text !== "string" || !/^[0-9]+$/.test(text)) {
      throw new ExternalActionError(
        "MALFORMED_PROPOSAL",
        `valueWei must be a canonical integer decimal string, got ${String(value)}`,
      );
    }
    return BigInt(text);
  }

  #resolveData(value: unknown, action: SlmAction): Hex {
    if (value === undefined || value === null || value === "") {
      if (action === "transfer") {
        return "0x" as Hex;
      }
      throw new ExternalActionError(
        "MALFORMED_PROPOSAL",
        `"${action}" is a contract call and must carry calldata`,
      );
    }
    if (typeof value !== "string" || !isHex(value)) {
      throw new ExternalActionError("MALFORMED_PROPOSAL", `calldata must be 0x hex, got ${String(value)}`);
    }
    return value as Hex;
  }

  #resolveChainId(value: unknown): number {
    if (value === undefined) {
      throw new ExternalActionError(
        "MALFORMED_PROPOSAL",
        "a proposal must name its chainId; the bridge never guesses a chain",
      );
    }
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
      throw new ExternalActionError("MALFORMED_PROPOSAL", `chainId must be a positive integer, got ${String(value)}`);
    }
    if (this.#allowedChainIds !== null && !this.#allowedChainIds.includes(value)) {
      throw new ExternalActionError("MALFORMED_PROPOSAL", `chain ${value} is not a chain this bridge may propose for`);
    }
    return value;
  }
}
