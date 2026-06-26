import type { Range } from "./position";

export type Severity = "error" | "warning";

/**
 * Diagnostic codes. By design:
 * - structural problems (independent of the data) default to `error`;
 * - data-dependent problems (the base may vary, especially with `extends`)
 *   default to `warning`.
 */
export const DiagnosticCode = {
  // Lexer (structural)
  UnexpectedCharacter: "unexpected-character",
  UnterminatedString: "unterminated-string",
  UnterminatedComment: "unterminated-comment",
  InvalidNumber: "invalid-number",
  // Parser (structural)
  UnexpectedToken: "unexpected-token",
  UnexpectedEndOfInput: "unexpected-end-of-input",
  ExpectedKey: "expected-key",
  ExpectedValue: "expected-value",
  ExpectedComma: "expected-comma",
  DuplicateInherit: "duplicate-inherit",
  ClearNotAtStart: "clear-not-at-start",
  // Evaluator (data-dependent)
  TypeMismatchOverride: "type-mismatch-override",
  UnknownKeyReference: "unknown-key-reference",
  OverrideUnknownKey: "override-unknown-key",
  DeleteUnknownKey: "delete-unknown-key",
  DeleteIndexOutOfRange: "delete-index-out-of-range",
  AddIndexOutOfRange: "add-index-out-of-range",
  NoBaseForOverride: "no-base-for-override",
  // Extends resolution (structural)
  ExtendsWithoutHost: "extends-without-host",
  ExtendsResolveFailed: "extends-resolve-failed",
  ExtendsReadFailed: "extends-read-failed",
  ExtendsCycle: "extends-cycle",
} as const;

export type DiagnosticCode = (typeof DiagnosticCode)[keyof typeof DiagnosticCode];

export interface Diagnostic {
  severity: Severity;
  code: DiagnosticCode;
  message: string;
  range: Range;
  /** Source file path/URI the diagnostic belongs to, if known. */
  source?: string;
}

export type SeverityConfig = Partial<Record<DiagnosticCode, Severity | "off">>;

export const DEFAULT_SEVERITY: Record<DiagnosticCode, Severity> = {
  "unexpected-character": "error",
  "unterminated-string": "error",
  "unterminated-comment": "error",
  "invalid-number": "error",
  "unexpected-token": "error",
  "unexpected-end-of-input": "error",
  "expected-key": "error",
  "expected-value": "error",
  "expected-comma": "error",
  "duplicate-inherit": "error",
  "clear-not-at-start": "error",
  "type-mismatch-override": "warning",
  "unknown-key-reference": "warning",
  "override-unknown-key": "warning",
  "delete-unknown-key": "warning",
  "delete-index-out-of-range": "warning",
  "add-index-out-of-range": "warning",
  "no-base-for-override": "warning",
  "extends-without-host": "error",
  "extends-resolve-failed": "error",
  "extends-read-failed": "error",
  "extends-cycle": "error",
};

/** Collects diagnostics, applying the configured severity (and skipping `off`). */
export class DiagnosticBag {
  readonly items: Diagnostic[] = [];

  constructor(public config: SeverityConfig = {}) {}

  emit(code: DiagnosticCode, range: Range, message: string, source?: string): void {
    const severity = this.config[code] ?? DEFAULT_SEVERITY[code];
    if (severity === "off") return;
    this.items.push({ severity, code, message, range, source });
  }

  hasErrors(): boolean {
    return this.items.some((d) => d.severity === "error");
  }
}
