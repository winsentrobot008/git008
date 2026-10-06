import type { MemoryEstimate, SlmModelSpec } from "./types.js";

export class SlmError extends Error {}

/** Raised when a native backend is selected but its runtime is not installed. */
export class SlmRuntimeUnavailableError extends SlmError {
  constructor(moduleName: string, hint: string) {
    super(`local SLM backend "${moduleName}" is not available: ${hint}`);
    this.name = "SlmRuntimeUnavailableError";
  }
}

/** Raised when a model would not fit inside the configured memory ceiling. */
export class MemoryBudgetExceededError extends SlmError {
  constructor(spec: SlmModelSpec, estimate: MemoryEstimate) {
    super(
      `model "${spec.id}" needs ~${mebibytes(estimate.totalBytes)} MiB but the budget is ` +
        `${mebibytes(estimate.budgetBytes)} MiB; pass a smaller model or raise maxMemoryBytes explicitly`,
    );
    this.name = "MemoryBudgetExceededError";
  }
}

/** Raised when a cloud endpoint or credential is configured. This runtime is local-only. */
export class CloudDependencyError extends SlmError {
  constructor(field: string) {
    super(`"${field}" is not allowed: the local SLM runtime must not depend on any cloud API`);
    this.name = "CloudDependencyError";
  }
}

export class UnknownModelError extends SlmError {
  constructor(id: string, known: readonly string[]) {
    super(`unknown model "${id}"; known presets: ${known.join(", ")}`);
    this.name = "UnknownModelError";
  }
}

export class SlmNotLoadedError extends SlmError {
  constructor(id: string) {
    super(`engine "${id}" is not loaded; call load() first`);
    this.name = "SlmNotLoadedError";
  }
}

export function mebibytes(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}