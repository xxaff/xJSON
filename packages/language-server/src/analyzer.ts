import {
  type Document,
  type KeyNode,
  type ObjectOp,
  type SeverityConfig,
  type ValueNode,
  type Diagnostic as XDiagnostic,
  type XJSONHost,
  evaluate,
} from "@xjson/core";
import {
  type CodeAction,
  CodeActionKind,
  type CompletionItem,
  CompletionItemKind,
  type Diagnostic,
  DiagnosticSeverity,
  type DocumentHighlight,
  DocumentHighlightKind,
  type DocumentLink,
  type Hover,
  type Location,
  type MarkupContent,
  MarkupKind,
  type Position,
  type Range,
  type TextEdit,
  type WorkspaceEdit,
} from "vscode-languageserver-types";
import { schemaInfo } from "./schema-validation";
import {
  type AnalyzeOptions,
  KEYWORD_DOCS,
  type KeyEntry,
  OPERATION_KEYWORDS,
  baseValue,
  collectKeyEntries,
  getValueAtPath,
  objectKeys,
  parseDocument,
  positionInRange,
  resolvedValue,
  toLspRange,
} from "./shared";

// --- Diagnostics ------------------------------------------------------------

function toLspDiagnostic(diagnostic: XDiagnostic): Diagnostic {
  return {
    range: toLspRange(diagnostic.range),
    message: diagnostic.message,
    severity:
      diagnostic.severity === "error" ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
    code: diagnostic.code,
    source: "xjson",
  };
}

// When a root override has no `extends` and no injected base, the base is
// genuinely unknown (it is provided at runtime), so base-dependent diagnostics
// would be false positives in the editor. They are silenced.
const BASE_DEPENDENT_OFF: SeverityConfig = {
  "no-base-for-override": "off",
  "override-unknown-key": "off",
  "delete-unknown-key": "off",
  "unknown-key-reference": "off",
  "type-mismatch-override": "off",
  "delete-index-out-of-range": "off",
  "add-index-out-of-range": "off",
};

export function analyzeDiagnostics(source: string, options: AnalyzeOptions = {}): Diagnostic[] {
  const uri = options.uri ?? "<input>";
  const doc = parseDocument(source, options);
  const baseUnknown =
    doc.kind === "override-document" && !doc.specifier && options.base === undefined;
  const severity = baseUnknown ? { ...BASE_DEPENDENT_OFF, ...options.severity } : options.severity;
  const { diagnostics } = evaluate(source, {
    uri,
    host: options.host,
    base: options.base,
    severity,
  });
  return diagnostics.filter((d) => d.source === undefined || d.source === uri).map(toLspDiagnostic);
}

// --- Definition + document links --------------------------------------------

export function definitionAt(
  source: string,
  position: Position,
  options: AnalyzeOptions = {},
): Location | null {
  const doc = parseDocument(source, options);
  if (doc.kind !== "override-document") return null;

  // On the extends specifier: jump to the base file.
  if (doc.specifier && options.host && positionInRange(position, toLspRange(doc.specifier.range))) {
    const target = safeResolve(options.host, doc.specifier.value, options.uri ?? "<input>");
    return target ? { uri: target, range: zeroRange() } : null;
  }

  // On a key (or a delete / before / after reference): jump to its base definition.
  const entry = entryAt(collectKeyEntries(doc), position);
  if (entry && entry.path.length > 0) return findDefinitionLocation(entry.path, doc, options);
  return null;
}

function zeroRange(): Range {
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
}

function safeResolve(host: XJSONHost, specifier: string, fromUri: string): string | undefined {
  try {
    return host.resolve(specifier, fromUri);
  } catch {
    return undefined;
  }
}

/** Walk the extends chain to find where a key path is defined. */
function findDefinitionLocation(
  path: string[],
  doc: Document,
  options: AnalyzeOptions,
): Location | null {
  if (doc.kind !== "override-document" || !doc.specifier || !options.host || !options.uri) {
    return null;
  }
  const host = options.host;
  let currentUri: string | undefined = safeResolve(host, doc.specifier.value, options.uri);
  const visited = new Set<string>();
  while (currentUri && !visited.has(currentUri)) {
    visited.add(currentUri);
    let text: string;
    try {
      text = host.readFile(currentUri);
    } catch {
      return null;
    }
    const parsed = parseDocument(text, { uri: currentUri });
    const keyNode = findKeyNodeAtPath(parsed, path);
    if (keyNode) return { uri: currentUri, range: toLspRange(keyNode.range) };
    currentUri =
      parsed.kind === "override-document" && parsed.specifier
        ? safeResolve(host, parsed.specifier.value, currentUri)
        : undefined;
  }
  return null;
}

function findKeyNodeAtPath(doc: Document, path: string[]): KeyNode | undefined {
  if (path.length === 0) return undefined;
  return doc.kind === "data-document"
    ? findKeyInValue(doc.value, path)
    : findKeyInOps(doc.ops, path);
}

function findKeyInValue(node: ValueNode, path: string[]): KeyNode | undefined {
  if (node.kind !== "object" || path.length === 0) return undefined;
  const [head, ...rest] = path;
  const member = node.members.find((m) => m.key.name === head);
  if (!member) return undefined;
  return rest.length === 0 ? member.key : findKeyInValue(member.value, rest);
}

function findKeyInOps(ops: ObjectOp[], path: string[]): KeyNode | undefined {
  if (path.length === 0) return undefined;
  const [head, ...rest] = path;
  for (const op of ops) {
    if (op.kind === "clear" || op.kind === "inherit" || op.kind === "delete") continue;
    if (op.key.name !== head) continue;
    if (rest.length === 0) return op.key;
    if (op.kind === "override-merge" && op.value.kind === "object-ops") {
      return findKeyInOps(op.value.ops, rest);
    }
    if (op.kind === "set" || op.kind === "add") return findKeyInValue(op.value, rest);
    return undefined;
  }
  return undefined;
}

export function documentLinks(source: string, options: AnalyzeOptions = {}): DocumentLink[] {
  const doc = parseDocument(source, options);
  if (doc.kind !== "override-document" || !doc.specifier || !options.host || !options.uri)
    return [];
  try {
    const target = options.host.resolve(doc.specifier.value, options.uri);
    return [{ range: toLspRange(doc.specifier.range), target }];
  } catch {
    return [];
  }
}

// --- Completion -------------------------------------------------------------

export function completions(): CompletionItem[] {
  return OPERATION_KEYWORDS.map((label) => ({ label, kind: CompletionItemKind.Keyword }));
}

export function completionsAt(
  source: string,
  _position: Position,
  options: AnalyzeOptions = {},
): CompletionItem[] {
  const doc = parseDocument(source, options);
  const present = topLevelKeyNames(doc);
  const items: CompletionItem[] = [];

  // Schema-defined property names (for instances declaring `$schema`).
  for (const property of schemaInfo(source, options)) {
    if (present.has(property.name)) continue;
    items.push({
      label: property.name,
      kind: CompletionItemKind.Field,
      detail: property.required ? "required (schema)" : "schema property",
    });
  }

  // Operation keywords and inherited keys only make sense inside an override block.
  if (doc.kind === "override-document") {
    for (const label of OPERATION_KEYWORDS) {
      items.push({ label, kind: CompletionItemKind.Keyword, documentation: docFor(label) });
    }
    for (const key of objectKeys(baseValue(doc, options))) {
      if (!present.has(key)) {
        items.push({ label: key, kind: CompletionItemKind.Field, detail: "inherited key" });
      }
    }
  }
  return items;
}

function topLevelKeyNames(doc: Document): Set<string> {
  const names = new Set<string>();
  if (doc.kind === "data-document") {
    if (doc.value.kind === "object") {
      for (const member of doc.value.members) names.add(member.key.name);
    }
  } else {
    for (const op of doc.ops) {
      if ("key" in op) names.add(op.key.name);
    }
  }
  return names;
}

function docFor(label: string): MarkupContent | undefined {
  const value = KEYWORD_DOCS[label];
  return value ? { kind: MarkupKind.Markdown, value } : undefined;
}

// --- Hover ------------------------------------------------------------------

export function hoverAt(
  source: string,
  position: Position,
  options: AnalyzeOptions = {},
): Hover | null {
  const doc = parseDocument(source, options);

  if (doc.kind === "override-document" && doc.specifier) {
    const specRange = toLspRange(doc.specifier.range);
    if (positionInRange(position, specRange) && options.host && options.uri) {
      try {
        const target = options.host.resolve(doc.specifier.value, options.uri);
        return markdown(`Extends \`${target}\``, specRange);
      } catch {
        return markdown("Could not resolve this `extends` target.", specRange);
      }
    }
  }

  const entries = collectKeyEntries(doc);
  const entry = entryAt(entries, position);
  if (entry) {
    const value = resolvedValue(source, options);
    const path = entry.path.length > 0 ? entry.path : [entry.key.name];
    const resolved = getValueAtPath(value, path);
    const range = toLspRange(entry.key.range);
    if (resolved !== undefined) {
      return markdown(`\`${entry.key.name}\`\n\n\`\`\`json\n${pretty(resolved)}\n\`\`\``, range);
    }
    return markdown(`\`${entry.key.name}\``, range);
  }

  const word = wordAt(source, position);
  if (word && KEYWORD_DOCS[word.text]) {
    return markdown(KEYWORD_DOCS[word.text] as string, word.range);
  }
  return null;
}

function markdown(value: string, range: Range): Hover {
  return { contents: { kind: MarkupKind.Markdown, value }, range };
}

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

// --- Document highlights / references / rename ------------------------------

function entryAt(entries: KeyEntry[], position: Position): KeyEntry | undefined {
  return entries.find((entry) => positionInRange(position, toLspRange(entry.key.range)));
}

function occurrences(entries: KeyEntry[], target: KeyEntry): KeyEntry[] {
  return entries.filter(
    (entry) => entry.scopeId === target.scopeId && entry.key.name === target.key.name,
  );
}

export function documentHighlights(
  source: string,
  position: Position,
  options: AnalyzeOptions = {},
): DocumentHighlight[] {
  const entries = collectKeyEntries(parseDocument(source, options));
  const target = entryAt(entries, position);
  if (!target) return [];
  return occurrences(entries, target).map((entry) => ({
    range: toLspRange(entry.key.range),
    kind: entry.kind === "key" ? DocumentHighlightKind.Write : DocumentHighlightKind.Read,
  }));
}

export function references(
  source: string,
  position: Position,
  options: AnalyzeOptions = {},
): Location[] {
  const entries = collectKeyEntries(parseDocument(source, options));
  const target = entryAt(entries, position);
  if (!target) return [];
  const uri = options.uri ?? "<input>";
  return occurrences(entries, target).map((entry) => ({ uri, range: toLspRange(entry.key.range) }));
}

export function renameEdits(
  source: string,
  position: Position,
  newName: string,
  options: AnalyzeOptions = {},
): WorkspaceEdit | null {
  const entries = collectKeyEntries(parseDocument(source, options));
  const target = entryAt(entries, position);
  if (!target) return null;
  const uri = options.uri ?? "<input>";
  const edits: TextEdit[] = occurrences(entries, target).map((entry) => ({
    range: toLspRange(entry.key.range),
    newText: formatKey(newName, entry.key.quoted),
  }));
  return { changes: { [uri]: edits } };
}

/** Render a key name, quoting it when it was quoted or is not a bare identifier. */
function formatKey(name: string, wasQuoted: boolean): string {
  const isIdentifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
  return wasQuoted || !isIdentifier ? JSON.stringify(name) : name;
}

// --- Code actions (quick fixes) ---------------------------------------------

export function codeActions(
  source: string,
  diagnostics: Diagnostic[],
  options: AnalyzeOptions = {},
): CodeAction[] {
  const map = new LineMap(source);
  const actions: CodeAction[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.code === "duplicate-inherit" || diagnostic.code === "clear-not-at-start") {
      actions.push(removeAction(source, map, diagnostic, options));
    } else if (diagnostic.code === "expected-comma") {
      actions.push({
        title: "Insert ','",
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        edit: edit(options, {
          range: { start: diagnostic.range.start, end: diagnostic.range.start },
          newText: ", ",
        }),
      });
    }
  }
  return actions;
}

function removeAction(
  source: string,
  map: LineMap,
  diagnostic: Diagnostic,
  options: AnalyzeOptions,
): CodeAction {
  let endOffset = map.offsetAt(diagnostic.range.end);
  while (endOffset < source.length && /\s/.test(source[endOffset] as string)) endOffset++;
  if (source[endOffset] === ",") endOffset++;
  const removal: TextEdit = {
    range: { start: diagnostic.range.start, end: map.positionAt(endOffset) },
    newText: "",
  };
  const title =
    diagnostic.code === "duplicate-inherit"
      ? "Remove duplicate 'inherit'"
      : "Remove misplaced 'clear'";
  return {
    title,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit: edit(options, removal),
  };
}

function edit(options: AnalyzeOptions, ...edits: TextEdit[]): WorkspaceEdit {
  return { changes: { [options.uri ?? "<input>"]: edits } };
}

// --- Word + line helpers ----------------------------------------------------

interface Word {
  text: string;
  range: Range;
}

function wordAt(source: string, position: Position): Word | undefined {
  const map = new LineMap(source);
  const offset = map.offsetAt(position);
  const isPart = (c: string | undefined): boolean => c !== undefined && /[A-Za-z0-9_$]/.test(c);
  let start = offset;
  let end = offset;
  while (start > 0 && isPart(source[start - 1])) start--;
  while (end < source.length && isPart(source[end])) end++;
  if (start === end) return undefined;
  return {
    text: source.slice(start, end),
    range: { start: map.positionAt(start), end: map.positionAt(end) },
  };
}

class LineMap {
  private readonly starts: number[] = [0];

  constructor(private readonly source: string) {
    for (let i = 0; i < source.length; i++) {
      if (source[i] === "\n") this.starts.push(i + 1);
    }
  }

  offsetAt(position: Position): number {
    const base = this.starts[position.line] ?? this.source.length;
    return Math.min(base + position.character, this.source.length);
  }

  positionAt(offset: number): Position {
    let low = 0;
    let high = this.starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((this.starts[mid] as number) <= offset) low = mid;
      else high = mid - 1;
    }
    return { line: low, character: offset - (this.starts[low] as number) };
  }
}
