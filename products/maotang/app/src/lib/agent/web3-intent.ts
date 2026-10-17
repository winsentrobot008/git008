/**
 * The lightweight on-chain intent adapter: TRON-USDT and Uniswap phrasing, recognised locally.
 *
 * Why this exists. The M1 translator that fronts `/api/agent/intent` parses one grammar - value transfers
 * and mints against the manifest's EVM contracts - and the M2 policy in `runtime.ts` decides what may be
 * signed by comparing the destination against that same manifest. Neither knows what a TRON address is.
 * Before those two can be extended (which needs its own audit, its own allow-list entry and its own
 * tests), a TRON-USDT or Uniswap sentence would reach M1 and come back refused with a code that says
 * nothing about the chain the owner actually meant.
 *
 * So this module does the one thing that is safe to do today: it reads the sentence and *says what it
 * understood*. It is deliberately narrow and deliberately honest:
 *
 *   - it parses two grammars and nothing else. A sentence it does not recognise returns `null`, which
 *     means "not an on-chain intent of this adapters' shape" - the text is then handled by the normal
 *     M1 path, not silently reinterpreted here;
 *   - it never normalises a number. `amount` is the digits the owner typed, verbatim. A parse is a
 *     reading of the request, not a quote, so rounding it would be inventing a figure;
 *   - it never reports `supported: true`. The shipped M2 allow-list is manifest-derived EVM destinations,
 *     so a TRON leg cannot reach a signature today: the type pins `supported` to `false` so the card
 *     cannot render an "enabled" state that the pipeline would then refuse;
 *   - it signs nothing and touches no network. Settlement, when it lands, is an audit-gated extension of
 *     M1 + M2, not a branch in this file.
 *
 * Pure and dependency-free on purpose: it is called during render from the C-end view, and a parser that
 * can reach the network or the clock is a parser whose output can change between two paints.
 */

/** The chains this adapter understands by name. `evm` covers Uniswap-style swap phrasing. */
export type Web3Chain = "tron" | "evm";

/** Which grammar matched. A stable id, safe to branch on and to render as a label key. */
export type Web3IntentId = "tron-usdt-transfer" | "uniswap-swap";

export interface Web3IntentParse {
  /** Which grammar matched. */
  readonly id: Web3IntentId;
  readonly chain: Web3Chain;
  /** The amount digits exactly as typed. Never normalised, never rounded. */
  readonly amount: string;
  /** The asset being spent, as the sentence named it. */
  readonly asset: string;
  /** The asset being acquired. `null` for a transfer, which acquires nothing. */
  readonly targetAsset: string | null;
  /** The destination the sentence named, or `null` when the grammar has no destination. */
  readonly counterparty: string | null;
  /**
   * Whether the shipped policy can carry this intent to a signature. Pinned to `false`: the M2
   * allow-list is the manifest's EVM destinations, so a TRON-USDT leg or an unlisted swap pair is a
   * preview, not a spendable intent. The literal type is what keeps a future edit from quietly flipping
   * the card to "enabled" without the policy change that would have to come with it.
   */
  readonly supported: false;
}

/**
 * A TRON base58check address: `T` followed by 33 base58 characters. Checked by shape only - a real
 * checksum check belongs to whatever library ends up owning TRON, not to a render-time parser.
 */
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/** One number token. Deliberately not `[0-9.eE+-]`, so a sentence cannot smuggle an expression through. */
const AMOUNT = "([0-9]+(?:\\.[0-9]+)?)";

/** `send 12.5 USDT to T...` / `tip 3 usdt-trc20 to T...` */
const TRON_USDT = new RegExp(`^(?:send|tip)\\s+${AMOUNT}\\s+usdt(?:-trc20)?\\s+to\\s+(\\S+)$`, "i");

/** `swap 100 USDT for ETH` */
const UNISWAP_SWAP = new RegExp(`^swap\\s+${AMOUNT}\\s+([a-z0-9]{2,10})\\s+for\\s+([a-z0-9]{2,10})$`, "i");

/** ASCII uppercase, locale-independent: `toUpperCase` on a Turkish locale maps `i` to a dotted capital. */
function upper(token: string): string {
  return token.replace(/[a-z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) - 32));
}

/**
 * Read `text` as a TRON-USDT transfer or a Uniswap swap, or return `null` if it is neither.
 *
 * `null` is not a failure: it means the sentence is not this adapter's shape, and the caller keeps
 * treating it as an ordinary M1 prompt.
 */
export function parseWeb3Intent(text: string): Web3IntentParse | null {
  const trimmed = text.trim();

  const transfer = TRON_USDT.exec(trimmed);
  if (transfer !== null) {
    const [, amount, destination] = transfer;
    // A destination that is not a well-formed TRON address makes this *not* a TRON intent; handing it
    // back to M1 lets the EVM path answer for itself instead of this adapter guessing a chain.
    if (!TRON_ADDRESS.test(destination)) {
      return null;
    }
    return {
      id: "tron-usdt-transfer",
      chain: "tron",
      amount,
      asset: "USDT-TRC20",
      targetAsset: null,
      counterparty: destination,
      supported: false,
    };
  }

  const swap = UNISWAP_SWAP.exec(trimmed);
  if (swap !== null) {
    const [, amount, from, to] = swap;
    return {
      id: "uniswap-swap",
      chain: "evm",
      amount,
      asset: upper(from),
      targetAsset: upper(to),
      counterparty: null,
      supported: false,
    };
  }

  return null;
}