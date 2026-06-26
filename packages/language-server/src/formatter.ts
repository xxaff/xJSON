import type { Token } from "@x-json/core";
import { lex } from "./shared";

type Kind =
  | "open"
  | "close"
  | "lparen"
  | "rparen"
  | "colon"
  | "comma"
  | "word"
  | "comment-line"
  | "comment-block";

interface Item {
  kind: Kind;
  text: string;
  ownLine: boolean;
  offset: number;
}

function tokenKind(token: Token): Kind | undefined {
  switch (token.type) {
    case "{":
    case "[":
      return "open";
    case "}":
    case "]":
      return "close";
    case "(":
      return "lparen";
    case ")":
      return "rparen";
    case ":":
      return "colon";
    case ",":
      return "comma";
    case "string":
    case "number":
    case "identifier":
      return "word";
    default:
      return undefined;
  }
}

function startsLine(source: string, offset: number): boolean {
  for (let i = offset - 1; i >= 0; i--) {
    const c = source[i];
    if (c === "\n") return true;
    if (c !== " " && c !== "\t" && c !== "\r") return false;
  }
  return true;
}

/**
 * Reformat an XJSON document. Only whitespace changes: every literal and
 * comment is reprinted verbatim, so the result is guaranteed to evaluate to
 * the same value.
 */
export function format(source: string, indentUnit = "  "): string {
  const { tokens, comments } = lex(source);
  const items: Item[] = [];
  for (const token of tokens) {
    const kind = tokenKind(token);
    if (kind)
      items.push({ kind, text: token.text, ownLine: false, offset: token.range.start.offset });
  }
  for (const comment of comments) {
    items.push({
      kind: comment.kind === "line" ? "comment-line" : "comment-block",
      text: comment.text,
      ownLine: startsLine(source, comment.range.start.offset),
      offset: comment.range.start.offset,
    });
  }
  items.sort((a, b) => a.offset - b.offset);
  return render(items, indentUnit);
}

function render(items: Item[], indentUnit: string): string {
  let out = "";
  let indent = 0;
  let lineHasContent = false;
  let pendingBreak = false;
  let prev: Kind | "none" = "none";

  const newline = (): void => {
    out = out.replace(/[ \t]+$/, "");
    out += "\n";
    lineHasContent = false;
  };
  const write = (text: string): void => {
    if (!lineHasContent) out += indentUnit.repeat(indent);
    out += text;
    lineHasContent = true;
  };

  for (const item of items) {
    const { kind, text, ownLine } = item;
    const isComment = kind === "comment-line" || kind === "comment-block";

    if (kind === "close") {
      indent = Math.max(0, indent - 1);
      if (lineHasContent) newline();
      pendingBreak = false;
      write(text);
      prev = kind;
      continue;
    }

    if (pendingBreak && !(isComment && !ownLine)) {
      newline();
      pendingBreak = false;
    }
    if (isComment && ownLine && lineHasContent) newline();

    if (lineHasContent) out += spaceBetween(prev, kind);
    write(text);

    if (kind === "open") {
      indent++;
      pendingBreak = true;
    } else if (kind === "comma" || kind === "comment-line") {
      pendingBreak = true;
    } else if (kind === "comment-block" && text.includes("\n")) {
      pendingBreak = true;
    }
    prev = kind;
  }

  return `${out.replace(/\s+$/, "")}\n`;
}

function spaceBetween(prev: Kind | "none", next: Kind): string {
  if (next === "comma" || next === "colon" || next === "lparen" || next === "rparen") return "";
  if (prev === "lparen") return "";
  if (prev === "colon" || prev === "comma") return " ";
  const prevWordish = prev === "word" || prev === "rparen" || prev === "comment-block";
  const nextWordish =
    next === "word" || next === "open" || next === "comment-line" || next === "comment-block";
  return prevWordish && nextWordish ? " " : "";
}
