import { type Diagnostic, type EvaluateOptions, type JsonValue, evaluate } from "@xjson/core";

export function evalValue(source: string, options?: EvaluateOptions): JsonValue {
  return evaluate(source, options).value;
}

export function codes(diagnostics: Diagnostic[]): string[] {
  return diagnostics.map((d) => d.code);
}

export function errorCodes(diagnostics: Diagnostic[]): string[] {
  return diagnostics.filter((d) => d.severity === "error").map((d) => d.code);
}

export function warningCodes(diagnostics: Diagnostic[]): string[] {
  return diagnostics.filter((d) => d.severity === "warning").map((d) => d.code);
}

/** Run a top-level override block over an injected base object. */
export function runOps(
  ops: string,
  base: Record<string, unknown>,
): { value: JsonValue; diagnostics: Diagnostic[] } {
  return evaluate(`override { ${ops} }`, { base: structuredClone(base) as JsonValue });
}

export function keysOf(value: unknown): string[] {
  return Object.keys(value as Record<string, unknown>);
}
