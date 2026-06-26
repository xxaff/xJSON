import type { Document } from "./ast";
import { DiagnosticBag } from "./diagnostics";
import type { Diagnostic, SeverityConfig } from "./diagnostics";
import { Evaluator } from "./evaluator";
import type { XJSONHost } from "./host";
import { tokenize } from "./lexer";
import { parseTokens } from "./parser";
import type { Comment } from "./token";
import type { JsonValue } from "./value";

export type * from "./ast";
export * from "./diagnostics";
export * from "./host";
export * from "./position";
export type * from "./token";
export * from "./value";
export { tokenize } from "./lexer";
export { parseTokens } from "./parser";

export interface ParseOptions {
  /** Path/URI of the source, used for relative resolution and diagnostics. */
  uri?: string;
  severity?: SeverityConfig;
}

export interface ParseResult {
  document: Document;
  comments: Comment[];
  diagnostics: Diagnostic[];
}

/** Lex and parse an XJSON document without evaluating it. */
export function parse(source: string, options: ParseOptions = {}): ParseResult {
  const bag = new DiagnosticBag(options.severity);
  const src = options.uri ?? "<input>";
  const { tokens, comments } = tokenize(source, bag, src);
  const document = parseTokens(tokens, bag, src);
  return { document, comments, diagnostics: bag.items };
}

export interface EvaluateOptions {
  /** Path/URI of the source, used for relative resolution and diagnostics. */
  uri?: string;
  /** Host used to resolve and read `extends` targets. */
  host?: XJSONHost;
  /** Base injected for an `override` block that declares no `extends`. */
  base?: JsonValue;
  /** Per-code severity overrides (set a code to `"off"` to silence it). */
  severity?: SeverityConfig;
  /** When true, throw an {@link XJSONError} if any error-severity diagnostic is produced. */
  strict?: boolean;
}

export interface EvaluateResult {
  value: JsonValue;
  diagnostics: Diagnostic[];
}

/** Thrown by {@link evaluate} when `strict` is enabled and errors are present. */
export class XJSONError extends Error {
  readonly diagnostics: Diagnostic[];

  constructor(diagnostics: Diagnostic[]) {
    const errorCount = diagnostics.filter((d) => d.severity === "error").length;
    super(`XJSON evaluation failed with ${errorCount} error(s).`);
    this.name = "XJSONError";
    this.diagnostics = diagnostics;
  }
}

/** Parse and evaluate an XJSON document into a plain JSON value. */
export function evaluate(source: string, options: EvaluateOptions = {}): EvaluateResult {
  const bag = new DiagnosticBag(options.severity);
  const src = options.uri ?? "<input>";
  const { tokens } = tokenize(source, bag, src);
  const document = parseTokens(tokens, bag, src);
  const evaluator = new Evaluator(bag, options.host);
  const value = evaluator.evaluateRoot(document, src, options.base);
  if (options.strict && bag.hasErrors()) {
    throw new XJSONError(bag.items);
  }
  return { value, diagnostics: bag.items };
}
