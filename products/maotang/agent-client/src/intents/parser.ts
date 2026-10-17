import { MAOTANG_TOOLS, findTool, type ToolDefinition } from "./tools.js";
import { validateAgainstSchema, type ValidationIssue } from "./validate.js";

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export class ToolCallParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolCallParseError";
  }
}

export class UnsupportedToolError extends Error {
  constructor(
    readonly toolName: string,
    readonly knownTools: readonly string[],
  ) {
    super(`model requested unknown tool "${toolName}"; known tools: ${knownTools.join(", ")}`);
    this.name = "UnsupportedToolError";
  }
}

export class ToolCallValidationError extends Error {
  constructor(
    readonly toolName: string,
    readonly issues: readonly ValidationIssue[],
  ) {
    super(`model output failed schema validation for "${toolName}": ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    this.name = "ToolCallValidationError";
  }
}

function preview(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 160 ? `${collapsed.slice(0, 160)}...` : collapsed;
}

/**
 * Pulls the first complete JSON object out of model output, tolerating markdown fences and the
 * prose some small models still prepend.
 */
export function extractJsonObject(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;

  const start = candidate.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < candidate.length; index++) {
    const char = candidate[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return candidate.slice(start, index + 1);
      }
    }
  }

  return null;
}

/** Validates a tool call against its own schema. Empty result means executable. */
export function validateToolCall(
  call: ToolCall,
  tools: readonly ToolDefinition[] = MAOTANG_TOOLS,
): ValidationIssue[] {
  const tool = findTool(call.name, tools);
  if (tool === undefined) {
    return [{ path: "$.name", message: `unknown tool "${call.name}"` }];
  }
  return validateAgainstSchema(call.arguments, tool.function.parameters, "$.arguments");
}

/**
 * Strict path from raw model text to an executable tool call. Anything that does not parse, name a
 * known tool and satisfy its schema throws — a malformed call must never reach a wallet.
 */
export function parseToolCall(
  text: string,
  tools: readonly ToolDefinition[] = MAOTANG_TOOLS,
): ToolCall {
  const json = extractJsonObject(text);
  if (json === null) {
    throw new ToolCallParseError(`model output contains no JSON object: "${preview(text)}"`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new ToolCallParseError(`model output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ToolCallParseError("tool call must be a JSON object");
  }

  const record = parsed as Record<string, unknown>;
  const name = record.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new ToolCallParseError('tool call is missing a string "name"');
  }

  if (findTool(name, tools) === undefined) {
    throw new UnsupportedToolError(name, tools.map((tool) => tool.function.name));
  }

  const args = record.arguments;
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new ToolCallValidationError(name, [{ path: "$.arguments", message: "must be an object" }]);
  }

  const call: ToolCall = { name, arguments: args as Record<string, unknown> };
  const issues = validateToolCall(call, tools);
  if (issues.length > 0) {
    throw new ToolCallValidationError(name, issues);
  }
  return call;
}