/**
 * Imports an optional native module without making it a hard dependency.
 * Dynamic specifiers are used on purpose: TypeScript must not resolve these at build time.
 */
export interface ModuleLoadResult {
  available: boolean;
  module: Record<string, unknown> | null;
  error: string | null;
}

export async function tryImportModule(specifier: string): Promise<ModuleLoadResult> {
  try {
    const imported = (await import(specifier)) as Record<string, unknown>;
    return { available: true, module: imported, error: null };
  } catch (error) {
    return { available: false, module: null, error: error instanceof Error ? error.message : String(error) };
  }
}