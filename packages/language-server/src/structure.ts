import type { ArrayOp, Range as CoreRange, Document, ObjectOp, ValueNode } from "@x-json/core";
import {
  type CodeLens,
  type Command,
  type DocumentSymbol,
  type FoldingRange,
  type FoldingRangeKind,
  type InlayHint,
  InlayHintKind,
  type Position,
  type Range,
  type SelectionRange,
  SymbolKind,
} from "vscode-languageserver-types";
import {
  type AnalyzeOptions,
  type SemanticTokenType,
  collectKeyEntries,
  getValueAtPath,
  parseDocument,
  positionInRange,
  resolvedValue,
  toLspRange,
} from "./shared";

const SEMANTIC_INDEX: Record<SemanticTokenType, number> = {
  keyword: 0,
  property: 1,
  string: 2,
  number: 3,
  operator: 4,
  comment: 5,
};

const KEYWORD_LENGTH: Record<string, number> = {
  override: 8,
  extends: 7,
  add: 3,
  delete: 6,
  clear: 5,
  inherit: 7,
  before: 6,
  after: 5,
};

// --- Semantic tokens --------------------------------------------------------

export interface SemanticTokenAbsolute {
  line: number;
  char: number;
  length: number;
  tokenType: number;
}

export function semanticTokens(
  source: string,
  options: AnalyzeOptions = {},
): SemanticTokenAbsolute[] {
  const doc = parseDocument(source, options);
  const tokens: SemanticTokenAbsolute[] = [];

  const pushAt = (range: CoreRange, length: number, type: SemanticTokenType): void => {
    tokens.push({
      line: range.start.line - 1,
      char: range.start.column - 1,
      length,
      tokenType: SEMANTIC_INDEX[type],
    });
  };
  const pushRange = (range: CoreRange, type: SemanticTokenType): void => {
    pushAt(range, range.end.offset - range.start.offset, type);
  };
  const keyword = (range: CoreRange, word: string): void => {
    pushAt(range, KEYWORD_LENGTH[word] ?? word.length, "keyword");
  };

  if (doc.kind === "override-document") {
    keyword(doc.range, "override");
    if (doc.specifier) pushRange(doc.specifier.range, "string");
    walkOpTokens(doc.ops, tokens, pushRange, keyword);
  } else {
    walkValueTokens(doc.value, tokens, pushRange);
  }

  return tokens.sort((a, b) => a.line - b.line || a.char - b.char);
}

function walkOpTokens(
  ops: ObjectOp[],
  tokens: SemanticTokenAbsolute[],
  pushRange: (range: CoreRange, type: SemanticTokenType) => void,
  keyword: (range: CoreRange, word: string) => void,
): void {
  for (const op of ops) {
    if (op.kind === "set") {
      pushRange(op.key.range, "property");
      walkValueTokens(op.value, tokens, pushRange);
      continue;
    }
    if (op.kind === "clear" || op.kind === "inherit") {
      keyword(op.range, op.kind);
      continue;
    }
    keyword(
      op.range,
      op.kind === "override-move" || op.kind === "override-merge" ? "override" : op.kind,
    );
    pushRange(op.key.range, "property");
    if ("position" in op && op.position) {
      keyword(op.position.range, op.position.placement);
      pushRange(op.position.key.range, "property");
    }
    if (op.kind === "add") walkValueTokens(op.value, tokens, pushRange);
    if (op.kind === "override-merge") {
      if (op.value.kind === "object-ops") walkOpTokens(op.value.ops, tokens, pushRange, keyword);
      else if (op.value.kind === "array-ops")
        walkArrayOpTokens(op.value.ops, tokens, pushRange, keyword);
      else walkValueTokens(op.value, tokens, pushRange);
    }
  }
}

function walkArrayOpTokens(
  ops: ArrayOp[],
  tokens: SemanticTokenAbsolute[],
  pushRange: (range: CoreRange, type: SemanticTokenType) => void,
  keyword: (range: CoreRange, word: string) => void,
): void {
  for (const op of ops) {
    if (op.kind === "array-add") {
      if (op.index !== undefined || op.value.range.start.offset > op.range.start.offset) {
        keyword(op.range, "add");
      }
      walkValueTokens(op.value, tokens, pushRange);
    } else if (op.kind === "array-delete") {
      keyword(op.range, "delete");
    } else {
      keyword(op.range, "clear");
    }
  }
}

function walkValueTokens(
  node: ValueNode,
  tokens: SemanticTokenAbsolute[],
  pushRange: (range: CoreRange, type: SemanticTokenType) => void,
): void {
  if (node.kind === "object") {
    for (const member of node.members) {
      pushRange(member.key.range, "property");
      walkValueTokens(member.value, tokens, pushRange);
    }
  } else if (node.kind === "array") {
    for (const element of node.elements) walkValueTokens(element, tokens, pushRange);
  }
}

// --- Document symbols (outline) ---------------------------------------------

function symbolKindForValue(node: ValueNode): SymbolKind {
  switch (node.kind) {
    case "object":
      return SymbolKind.Object;
    case "array":
      return SymbolKind.Array;
    case "string":
      return SymbolKind.String;
    case "number":
      return SymbolKind.Number;
    case "boolean":
      return SymbolKind.Boolean;
    case "null":
      return SymbolKind.Null;
  }
}

export function documentSymbols(source: string, options: AnalyzeOptions = {}): DocumentSymbol[] {
  const doc = parseDocument(source, options);
  if (doc.kind === "data-document") return valueSymbols(doc.value);
  return doc.ops.map(opSymbol).filter((s): s is DocumentSymbol => s !== undefined);
}

function valueSymbols(node: ValueNode): DocumentSymbol[] {
  if (node.kind === "object") {
    return node.members.map((member) => ({
      name: member.key.name,
      kind: symbolKindForValue(member.value),
      range: toLspRange(member.range),
      selectionRange: toLspRange(member.key.range),
      children: valueSymbols(member.value),
    }));
  }
  if (node.kind === "array") {
    return node.elements.flatMap((element) => valueSymbols(element));
  }
  return [];
}

function opSymbol(op: ObjectOp): DocumentSymbol | undefined {
  if (op.kind === "clear" || op.kind === "inherit") return undefined;
  const children: DocumentSymbol[] =
    op.kind === "override-merge" && op.value.kind === "object-ops"
      ? op.value.ops.map(opSymbol).filter((s): s is DocumentSymbol => s !== undefined)
      : [];
  return {
    name: op.key.name,
    detail: op.kind,
    kind: op.kind === "delete" ? SymbolKind.Null : SymbolKind.Field,
    range: toLspRange(op.range),
    selectionRange: toLspRange(op.key.range),
    children,
  };
}

// --- Folding ranges ---------------------------------------------------------

export function foldingRanges(source: string, options: AnalyzeOptions = {}): FoldingRange[] {
  const doc = parseDocument(source, options);
  const ranges: FoldingRange[] = [];
  const add = (range: CoreRange, kind?: FoldingRangeKind): void => {
    const startLine = range.start.line - 1;
    const endLine = range.end.line - 1;
    if (endLine > startLine) ranges.push({ startLine, endLine, ...(kind ? { kind } : {}) });
  };
  if (doc.kind === "override-document") {
    add(doc.range);
    walkOpFolds(doc.ops, add);
  } else {
    walkValueFolds(doc.value, add);
  }
  return ranges;
}

function walkOpFolds(ops: ObjectOp[], add: (range: CoreRange) => void): void {
  for (const op of ops) {
    if (op.kind === "set" || op.kind === "add") walkValueFolds(op.value, add);
    if (op.kind === "override-merge") {
      add(op.value.range);
      if (op.value.kind === "object-ops") walkOpFolds(op.value.ops, add);
    }
  }
}

function walkValueFolds(node: ValueNode, add: (range: CoreRange) => void): void {
  if (node.kind === "object") {
    add(node.range);
    for (const member of node.members) walkValueFolds(member.value, add);
  } else if (node.kind === "array") {
    add(node.range);
    for (const element of node.elements) walkValueFolds(element, add);
  }
}

// --- Selection ranges -------------------------------------------------------

export function selectionRanges(
  source: string,
  positions: Position[],
  options: AnalyzeOptions = {},
): SelectionRange[] {
  const doc = parseDocument(source, options);
  const spans: Range[] = [];
  collectSpans(doc, spans);
  return positions.map((position) => buildSelectionRange(position, spans));
}

function buildSelectionRange(position: Position, spans: Range[]): SelectionRange {
  const containing = spans
    .filter((range) => positionInRange(position, range))
    .sort((a, b) => spanSize(a) - spanSize(b));
  let current: SelectionRange | undefined;
  for (let i = containing.length - 1; i >= 0; i--) {
    current = { range: containing[i] as Range, ...(current ? { parent: current } : {}) };
  }
  return current ?? { range: { start: position, end: position } };
}

function spanSize(range: Range): number {
  return (
    (range.end.line - range.start.line) * 10000 + (range.end.character - range.start.character)
  );
}

function collectSpans(doc: Document, spans: Range[]): void {
  spans.push(toLspRange(doc.range));
  if (doc.kind === "data-document") collectValueSpans(doc.value, spans);
  else for (const op of doc.ops) collectOpSpans(op, spans);
}

function collectOpSpans(op: ObjectOp, spans: Range[]): void {
  spans.push(toLspRange(op.range));
  if ("key" in op) spans.push(toLspRange(op.key.range));
  if (op.kind === "set" || op.kind === "add") collectValueSpans(op.value, spans);
  if (op.kind === "override-merge") {
    spans.push(toLspRange(op.value.range));
    if (op.value.kind === "object-ops")
      for (const inner of op.value.ops) collectOpSpans(inner, spans);
  }
}

function collectValueSpans(node: ValueNode, spans: Range[]): void {
  spans.push(toLspRange(node.range));
  if (node.kind === "object") {
    for (const member of node.members) {
      spans.push(toLspRange(member.range));
      spans.push(toLspRange(member.key.range));
      collectValueSpans(member.value, spans);
    }
  } else if (node.kind === "array") {
    for (const element of node.elements) collectValueSpans(element, spans);
  }
}

// --- Inlay hints (evaluated values) -----------------------------------------

export function inlayHints(source: string, options: AnalyzeOptions = {}): InlayHint[] {
  const doc = parseDocument(source, options);
  const value = resolvedValue(source, options);
  const hints: InlayHint[] = [];
  for (const entry of collectKeyEntries(doc)) {
    if (entry.kind !== "key" || entry.path.length !== 1) continue;
    const resolved = getValueAtPath(value, entry.path);
    if (resolved === undefined) continue;
    const end = toLspRange(entry.key.range).end;
    hints.push({
      position: end,
      label: ` = ${previewJson(resolved)}`,
      kind: InlayHintKind.Type,
      paddingLeft: true,
    });
  }
  return hints;
}

function previewJson(value: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? "undefined";
  } catch {
    text = String(value);
  }
  return text.length > 40 ? `${text.slice(0, 39)}…` : text;
}

// --- Code lens --------------------------------------------------------------

export function codeLenses(source: string, options: AnalyzeOptions = {}): CodeLens[] {
  const doc = parseDocument(source, options);
  const lenses: CodeLens[] = [];
  const topLine = doc.range.start.line - 1;
  const at: Range = {
    start: { line: topLine, character: 0 },
    end: { line: topLine, character: 0 },
  };

  const preview: Command = {
    title: "$(preview) Preview evaluated JSON",
    command: "xjson.preview",
    arguments: options.uri ? [options.uri] : [],
  };
  lenses.push({ range: at, command: preview });

  if (doc.kind === "override-document" && doc.specifier && options.host && options.uri) {
    try {
      const target = options.host.resolve(doc.specifier.value, options.uri);
      lenses.push({
        range: at,
        command: {
          title: `$(references) extends ${basename(target)}`,
          command: "xjson.openExtends",
          arguments: [target],
        },
      });
    } catch {
      // ignore unresolved specifier
    }
  }
  return lenses;
}

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}
