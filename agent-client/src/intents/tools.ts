import type { JsonSchema } from "./validate.js";

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

const NULLIFIER_PATTERN = "^0x[a-fA-F0-9]{64}$";
const HEX_PATTERN = "^0x[a-fA-F0-9]+$";
const UINT_PATTERN = "^[0-9]+$";

/**
 * Claims the one-time human quota. There is no amount argument: the contract mints exactly
 * `HUMAN_QUOTA` (1_000_000 * 10^6 micro-units) or reverts.
 */
export const claimMhumanQuotaTool: ToolDefinition = {
  type: "function",
  function: {
    name: "claim_mhuman_quota",
    description:
      "Claim the caller's one-time human quota of 1,000,000 $mHUMAN (1_000_000 * 10^6 micro-units), " +
      "minted to the human wallet the calling agent is registered for. Reverts when the personhood " +
      "nullifier was already used or when the caller is not a registered AI agent.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["nullifier_hash", "zk_proof"],
      properties: {
        nullifier_hash: {
          type: "string",
          pattern: NULLIFIER_PATTERN,
          description: "Personhood nullifier as a 32-byte hex string.",
        },
        zk_proof: {
          type: "string",
          pattern: HEX_PATTERN,
          minLength: 4,
          description: "Hex encoded personhood proof.",
        },
      },
    },
  },
};

/** Buys or sells $mHUMAN on the bonding curve. Amounts are base-unit decimal strings. */
export const swapMicroHumanTool: ToolDefinition = {
  type: "function",
  function: {
    name: "swap_micro_human",
    description:
      "Buy or sell $mHUMAN on the MAOTANG bonding curve. amount_in and min_out are base-unit decimal " +
      "strings: wei when direction is \"buy\", micro-units (6 decimals) when direction is \"sell\". " +
      "min_out is the slippage floor and must never be zero on a real trade.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["amount_in", "min_out", "direction"],
      properties: {
        amount_in: {
          type: "string",
          pattern: UINT_PATTERN,
          description: "Exact input amount in base units, as a decimal string.",
        },
        min_out: {
          type: "string",
          pattern: UINT_PATTERN,
          description: "Minimum acceptable output in base units, as a decimal string.",
        },
        direction: {
          type: "string",
          enum: ["buy", "sell"],
          description: "\"buy\" spends ETH for $mHUMAN, \"sell\" returns $mHUMAN for ETH.",
        },
      },
    },
  },
};

/** Every tool the local model is allowed to emit. */
export const MAOTANG_TOOLS: readonly ToolDefinition[] = [claimMhumanQuotaTool, swapMicroHumanTool];

export function findTool(
  name: string,
  tools: readonly ToolDefinition[] = MAOTANG_TOOLS,
): ToolDefinition | undefined {
  return tools.find((tool) => tool.function.name === name);
}

/** Compact schema listing for the system prompt. */
export function toolSchemasForPrompt(tools: readonly ToolDefinition[] = MAOTANG_TOOLS): string {
  return JSON.stringify(
    tools.map((tool) => tool.function),
    null,
    2,
  );
}