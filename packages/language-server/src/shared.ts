import {
  type Comment,
  type Range as CoreRange,
  DiagnosticBag,
  type Document,
  type JsonValue,
  type KeyNode,
  type ObjectOp,
  type SeverityConfig,
  type Token,
  type ValueNode,
  type XJSONHost,
  evaluate,
  parse,
  tokenize,
} from "@x-json/core";
import { type Position, Range } from "vscode-languageserver-types";

export interface AnalyzeOptions {
  /** Path/URI of the document being analyzed. */
  uri?: string;
  /** Host used to resolve `extends` targets. */
  host?: XJSONHost;
  /** Base injected for an `override` block that declares no `extends`. */
  base?: JsonValue;
  /** Per-code severity overrides. */
  severity?: SeverityConfig;
  /** A schema URI associated with this document by configuration (used when there is no in-file `$schema`). */
  schemaUri?: string;
}

/** Match a file path against a glob pattern (supports `*` and `**`). */
export function matchesGlob(pattern: string, filePath: string): boolean {
  const path = filePath.replace(/\\/g, "/");
  let regex = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i++;
        if (pattern[i + 1] === "/") {
          i++;
          regex += "(?:.*/)?";
        } else {
          regex += ".*";
        }
      } else {
        regex += "[^/]*";
      }
    } else if (".+^${}()|[]\\".includes(c)) {
      regex += `\\${c}`;
    } else {
      regex += c;
    }
  }
  return new RegExp(`(?:^|/)${regex}$`).test(path);
}

export const SEMANTIC_TOKEN_TYPES = [
  "keyword",
  "property",
  "string",
  "number",
  "operator",
  "comment",
] as const;

export type SemanticTokenType = (typeof SEMANTIC_TOKEN_TYPES)[number];

export const OPERATION_KEYWORDS = [
  "override",
  "extends",
  "add",
  "delete",
  "clear",
  "inherit",
  "before",
  "after",
] as const;

export const KEYWORD_DOCS: Record<string, string> = {
  override: "**override** — merge into the existing value; without `:` it repositions the key.",
  extends: '**extends "…"** — inherit from another file (relative or Node-style path).',
  add: "**add** — create a property or element; supports `before`/`after` and `add(n)` for arrays.",
  delete: "**delete** — remove a property, or `delete(n)` an array element.",
  clear: "**clear** — empty the collection. Only valid at the start of a block.",
  inherit: "**inherit** — marks where the remaining inherited keys go (default: at the start).",
  before: "**before `<key>`** — position relative to another key.",
  after: "**after `<key>`** — position relative to another key.",
};

// --- Range / position helpers -----------------------------------------------

export function toLspRange(range: CoreRange): Range {
  return Range.create(
    range.start.line - 1,
    range.start.column - 1,
    range.end.line - 1,
    range.end.column - 1,
  );
}

export function comparePositions(a: Position, b: Position): number {
  return a.line !== b.line ? a.line - b.line : a.character - b.character;
}

export function positionInRange(position: Position, range: Range): boolean {
  return comparePositions(position, range.start) >= 0 && comparePositions(position, range.end) <= 0;
}

// --- Parsing / evaluation wrappers ------------------------------------------

export function parseDocument(source: string, options: AnalyzeOptions): Document {
  return parse(source, { uri: options.uri }).document;
}

export function lex(source: string): { tokens: Token[]; comments: Comment[] } {
  return tokenize(source, new DiagnosticBag());
}

export function resolvedValue(source: string, options: AnalyzeOptions): JsonValue {
  return evaluate(source, {
    uri: options.uri,
    host: options.host,
    base: options.base,
    severity: options.severity,
  }).value;
}

/** Resolve the base of a document (its `extends` chain or injected base), without its own ops. */
export function baseValue(doc: Document, options: AnalyzeOptions): JsonValue {
  if (doc.kind !== "override-document") return {};
  if (doc.specifier) {
    const synthetic = `override extends ${JSON.stringify(doc.specifier.value)} { }`;
    return evaluate(synthetic, { uri: options.uri, host: options.host }).value;
  }
  return options.base ?? {};
}

export function objectKeys(value: JsonValue): string[] {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
}

export function getValueAtPath(value: JsonValue, path: string[]): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const segment of path) {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      current = (current as Record<string, JsonValue>)[segment];
    } else if (Array.isArray(current)) {
      const index = Number(segment);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else {
      return undefined;
    }
  }
  return current;
}

// --- Key collection (with object scopes and value paths) --------------------

export interface KeyEntry {
  key: KeyNode;
  /** "key" defines/positions a key here; "reference" points at another key. */
  kind: "key" | "reference";
  /** Object path of a defined key (for value lookup). Empty for references. */
  path: string[];
  /** Identifier of the object scope the entry belongs to. */
  scopeId: number;
}

export function collectKeyEntries(doc: Document): KeyEntry[] {
  const entries: KeyEntry[] = [];
  const counter = { value: 0 };
  if (doc.kind === "data-document") {
    walkValueKeys(doc.value, [], entries, counter);
  } else {
    walkOpKeys(doc.ops, [], entries, counter);
  }
  return entries;
}

function walkOpKeys(
  ops: ObjectOp[],
  parentPath: string[],
  entries: KeyEntry[],
  counter: { value: number },
): void {
  const scopeId = counter.value++;
  for (const op of ops) {
    switch (op.kind) {
      case "set":
        entries.push({ key: op.key, kind: "key", path: [...parentPath, op.key.name], scopeId });
        walkValueKeys(op.value, [...parentPath, op.key.name], entries, counter);
        break;
      case "add":
        entries.push({ key: op.key, kind: "key", path: [...parentPath, op.key.name], scopeId });
        if (op.position)
          entries.push({
            key: op.position.key,
            kind: "reference",
            path: [...parentPath, op.position.key.name],
            scopeId,
          });
        walkValueKeys(op.value, [...parentPath, op.key.name], entries, counter);
        break;
      case "override-move":
        entries.push({ key: op.key, kind: "key", path: [...parentPath, op.key.name], scopeId });
        if (op.position)
          entries.push({
            key: op.position.key,
            kind: "reference",
            path: [...parentPath, op.position.key.name],
            scopeId,
          });
        break;
      case "override-merge":
        entries.push({ key: op.key, kind: "key", path: [...parentPath, op.key.name], scopeId });
        if (op.position)
          entries.push({
            key: op.position.key,
            kind: "reference",
            path: [...parentPath, op.position.key.name],
            scopeId,
          });
        if (op.value.kind === "object-ops") {
          walkOpKeys(op.value.ops, [...parentPath, op.key.name], entries, counter);
        }
        break;
      case "delete":
        entries.push({
          key: op.key,
          kind: "reference",
          path: [...parentPath, op.key.name],
          scopeId,
        });
        break;
    }
  }
}

function walkValueKeys(
  node: ValueNode,
  path: string[],
  entries: KeyEntry[],
  counter: { value: number },
): void {
  if (node.kind === "object") {
    const scopeId = counter.value++;
    for (const member of node.members) {
      entries.push({ key: member.key, kind: "key", path: [...path, member.key.name], scopeId });
      walkValueKeys(member.value, [...path, member.key.name], entries, counter);
    }
  } else if (node.kind === "array") {
    node.elements.forEach((element, index) =>
      walkValueKeys(element, [...path, String(index)], entries, counter),
    );
  }
}
