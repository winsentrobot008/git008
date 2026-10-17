/** The JSON-Schema subset this package needs. Kept tiny on purpose: no validator dependency. */
export interface JsonSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  additionalProperties?: boolean;
  enum?: readonly (string | number)[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  items?: JsonSchema;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

function matchesType(value: unknown, type: NonNullable<JsonSchema["type"]>): boolean {
  switch (type) {
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return typeof value === type;
  }
}

function describe(value: unknown): string {
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "array" : typeof value;
}

function validateObject(value: unknown, schema: JsonSchema, path: string, issues: ValidationIssue[]): void {
  const record = value as Record<string, unknown>;

  for (const key of schema.required ?? []) {
    if (record[key] === undefined) {
      issues.push({ path: `${path}.${key}`, message: "is required" });
    }
  }

  for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
    const child = record[key];
    if (child === undefined) {
      continue;
    }
    issues.push(...validateAgainstSchema(child, childSchema, `${path}.${key}`));
  }

  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(schema.properties ?? {}));
    for (const key of Object.keys(record)) {
      if (!allowed.has(key)) {
        issues.push({ path: `${path}.${key}`, message: "is not allowed (additionalProperties: false)" });
      }
    }
  }
}

function validateScalar(value: unknown, schema: JsonSchema, path: string, issues: ValidationIssue[]): void {
  if (schema.enum !== undefined && !(schema.enum as readonly unknown[]).includes(value)) {
    issues.push({ path, message: `must be one of ${schema.enum.join(", ")}` });
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      issues.push({ path, message: `must be at least ${schema.minLength} characters` });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      issues.push({ path, message: `must be at most ${schema.maxLength} characters` });
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      issues.push({ path, message: `must match ${schema.pattern}` });
    }
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      issues.push({ path, message: `must be >= ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      issues.push({ path, message: `must be <= ${schema.maximum}` });
    }
  }

  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => {
      issues.push(...validateAgainstSchema(item, schema.items as JsonSchema, `${path}[${index}]`));
    });
  }
}

/** Validates `value` against the supported schema subset; returns every issue found. */
export function validateAgainstSchema(value: unknown, schema: JsonSchema, path = "$"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (schema.type !== undefined && !matchesType(value, schema.type)) {
    issues.push({ path, message: `must be ${schema.type}, received ${describe(value)}` });
    return issues;
  }

  if (schema.type === "object") {
    validateObject(value, schema, path, issues);
  } else {
    validateScalar(value, schema, path, issues);
  }

  return issues;
}