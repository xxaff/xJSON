import { type DiagnosticBag, DiagnosticCode } from "./diagnostics";
import type { Position } from "./position";
import type { Comment, Token, TokenType } from "./token";

const PUNCTUATION: Record<string, TokenType | undefined> = {
  "{": "{",
  "}": "}",
  "[": "[",
  "]": "]",
  "(": "(",
  ")": ")",
  ":": ":",
  ",": ",",
};

function isWhitespace(c: string): boolean {
  return (
    c === " " ||
    c === "\t" ||
    c === "\n" ||
    c === "\r" ||
    c === "\v" ||
    c === "\f" ||
    c === " " ||
    c === "﻿"
  );
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function isHexDigit(c: string): boolean {
  return isDigit(c) || (c >= "a" && c <= "f") || (c >= "A" && c <= "F");
}

function isIdentifierStart(c: string): boolean {
  return (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$";
}

function isIdentifierPart(c: string): boolean {
  return isIdentifierStart(c) || isDigit(c);
}

export interface LexResult {
  tokens: Token[];
  comments: Comment[];
}

export function tokenize(source: string, bag: DiagnosticBag, sourceName?: string): LexResult {
  return new Lexer(source, bag, sourceName).run();
}

class Lexer {
  private pos = 0;
  private line = 1;
  private col = 1;
  private readonly tokens: Token[] = [];
  private readonly comments: Comment[] = [];

  constructor(
    private readonly source: string,
    private readonly bag: DiagnosticBag,
    private readonly sourceName?: string,
  ) {}

  run(): LexResult {
    while (this.pos < this.source.length) {
      const c = this.charAt(this.pos);
      if (isWhitespace(c)) {
        this.advance();
        continue;
      }
      if (c === "/" && this.charAt(this.pos + 1) === "/") {
        this.lineComment();
        continue;
      }
      if (c === "/" && this.charAt(this.pos + 1) === "*") {
        this.blockComment();
        continue;
      }
      const punct = PUNCTUATION[c];
      if (punct) {
        this.single(punct);
        continue;
      }
      if (c === '"' || c === "'") {
        this.string(c);
        continue;
      }
      if (isDigit(c) || c === "." || c === "+" || c === "-") {
        this.number();
        continue;
      }
      if (isIdentifierStart(c)) {
        this.identifier();
        continue;
      }
      const start = this.position();
      this.advance();
      this.bag.emit(
        DiagnosticCode.UnexpectedCharacter,
        { start, end: this.position() },
        `Unexpected character ${JSON.stringify(c)}.`,
        this.sourceName,
      );
    }
    const end = this.position();
    this.tokens.push({ type: "eof", text: "", range: { start: end, end } });
    return { tokens: this.tokens, comments: this.comments };
  }

  private charAt(i: number): string {
    return i >= 0 && i < this.source.length ? (this.source[i] as string) : "\0";
  }

  private position(): Position {
    return { offset: this.pos, line: this.line, column: this.col };
  }

  private advance(): string {
    const c = this.source[this.pos] ?? "\0";
    this.pos++;
    if (c === "\n") {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return c;
  }

  private single(type: TokenType): void {
    const start = this.position();
    const text = this.advance();
    this.tokens.push({ type, text, range: { start, end: this.position() } });
  }

  private lineComment(): void {
    const start = this.position();
    let text = "";
    while (this.pos < this.source.length && this.charAt(this.pos) !== "\n") {
      text += this.advance();
    }
    this.comments.push({ kind: "line", text, range: { start, end: this.position() } });
  }

  private blockComment(): void {
    const start = this.position();
    let text = this.advance() + this.advance(); // consume "/*"
    while (this.pos < this.source.length) {
      if (this.charAt(this.pos) === "*" && this.charAt(this.pos + 1) === "/") {
        text += this.advance() + this.advance();
        this.comments.push({ kind: "block", text, range: { start, end: this.position() } });
        return;
      }
      text += this.advance();
    }
    this.comments.push({ kind: "block", text, range: { start, end: this.position() } });
    this.bag.emit(
      DiagnosticCode.UnterminatedComment,
      { start, end: this.position() },
      "Unterminated block comment.",
      this.sourceName,
    );
  }

  private string(quote: string): void {
    const start = this.position();
    let raw = this.advance(); // opening quote
    let value = "";
    while (this.pos < this.source.length) {
      const c = this.charAt(this.pos);
      if (c === quote) {
        raw += this.advance();
        this.tokens.push({
          type: "string",
          text: raw,
          value,
          range: { start, end: this.position() },
        });
        return;
      }
      if (c === "\n" || c === "\r") break; // raw line break: unterminated
      if (c === "\\") {
        raw += this.advance(); // backslash
        const e = this.charAt(this.pos);
        if (e === "\n" || e === "\r") {
          raw += this.advance();
          if (e === "\r" && this.charAt(this.pos) === "\n") raw += this.advance();
          continue; // line continuation
        }
        raw += this.advance(); // escape identifier char
        value += this.decodeEscape(e, (consumed) => {
          raw += consumed;
        });
        continue;
      }
      raw += this.advance();
      value += c;
    }
    this.tokens.push({ type: "string", text: raw, value, range: { start, end: this.position() } });
    this.bag.emit(
      DiagnosticCode.UnterminatedString,
      { start, end: this.position() },
      "Unterminated string literal.",
      this.sourceName,
    );
  }

  private decodeEscape(e: string, recordRaw: (consumed: string) => void): string {
    switch (e) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "v":
        return "\v";
      case "0":
        return "\0";
      case "x": {
        let hex = "";
        for (let i = 0; i < 2 && isHexDigit(this.charAt(this.pos)); i++) hex += this.advance();
        recordRaw(hex);
        return hex.length === 2 ? String.fromCharCode(Number.parseInt(hex, 16)) : "x";
      }
      case "u": {
        let hex = "";
        for (let i = 0; i < 4 && isHexDigit(this.charAt(this.pos)); i++) hex += this.advance();
        recordRaw(hex);
        return hex.length === 4 ? String.fromCharCode(Number.parseInt(hex, 16)) : "u";
      }
      default:
        return e;
    }
  }

  private number(): void {
    const start = this.position();
    let raw = "";
    if (this.charAt(this.pos) === "+" || this.charAt(this.pos) === "-") raw += this.advance();
    if (this.matchWord("Infinity")) {
      raw += this.consume(8);
      this.pushNumber(raw, start);
      return;
    }
    if (this.matchWord("NaN")) {
      raw += this.consume(3);
      this.pushNumber(raw, start);
      return;
    }
    if (
      this.charAt(this.pos) === "0" &&
      (this.charAt(this.pos + 1) === "x" || this.charAt(this.pos + 1) === "X")
    ) {
      raw += this.advance() + this.advance();
      while (isHexDigit(this.charAt(this.pos))) raw += this.advance();
      this.pushNumber(raw, start);
      return;
    }
    while (isDigit(this.charAt(this.pos))) raw += this.advance();
    if (this.charAt(this.pos) === ".") {
      raw += this.advance();
      while (isDigit(this.charAt(this.pos))) raw += this.advance();
    }
    if (this.charAt(this.pos) === "e" || this.charAt(this.pos) === "E") {
      raw += this.advance();
      if (this.charAt(this.pos) === "+" || this.charAt(this.pos) === "-") raw += this.advance();
      while (isDigit(this.charAt(this.pos))) raw += this.advance();
    }
    this.pushNumber(raw, start);
  }

  private pushNumber(raw: string, start: Position): void {
    let value: number;
    if (raw.endsWith("Infinity")) {
      value = raw.startsWith("-") ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
    } else if (raw.endsWith("NaN")) {
      value = Number.NaN;
    } else {
      value = Number(raw);
      if (Number.isNaN(value) || raw === "" || raw === "+" || raw === "-" || raw === ".") {
        this.bag.emit(
          DiagnosticCode.InvalidNumber,
          { start, end: this.position() },
          `Invalid number ${JSON.stringify(raw)}.`,
          this.sourceName,
        );
        value = Number.NaN;
      }
    }
    this.tokens.push({
      type: "number",
      text: raw,
      numberValue: value,
      range: { start, end: this.position() },
    });
  }

  private identifier(): void {
    const start = this.position();
    let text = "";
    while (isIdentifierPart(this.charAt(this.pos))) text += this.advance();
    this.tokens.push({ type: "identifier", text, range: { start, end: this.position() } });
  }

  private matchWord(word: string): boolean {
    if (!this.source.startsWith(word, this.pos)) return false;
    return !isIdentifierPart(this.charAt(this.pos + word.length));
  }

  private consume(count: number): string {
    let s = "";
    for (let i = 0; i < count; i++) s += this.advance();
    return s;
  }
}
