import type {
  ArrayNode,
  ArrayOp,
  Document,
  KeyNode,
  MergeValue,
  ObjectMember,
  ObjectNode,
  ObjectOp,
  RelativePosition,
  StringNode,
  ValueNode,
} from "./ast";
import { type DiagnosticBag, DiagnosticCode } from "./diagnostics";
import type { Range } from "./position";
import { rangeBetween } from "./position";
import type { Token, TokenType } from "./token";

export function parseTokens(tokens: Token[], bag: DiagnosticBag, sourceName?: string): Document {
  return new Parser(tokens, bag, sourceName).parseDocument();
}

const RELATIVE_KEYWORDS = new Set(["before", "after"]);

class Parser {
  private i = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly bag: DiagnosticBag,
    private readonly sourceName?: string,
  ) {}

  parseDocument(): Document {
    const first = this.peek();
    if (first.type === "eof") {
      this.emit(DiagnosticCode.UnexpectedEndOfInput, first.range, "Empty document.");
      return {
        kind: "data-document",
        value: { kind: "null", range: first.range },
        range: first.range,
      };
    }

    let doc: Document;
    if (first.type === "identifier" && first.text === "override") {
      doc = this.parseOverrideDocument();
    } else {
      const value = this.parseValue();
      doc = { kind: "data-document", value, range: value.range };
    }

    if (!this.check("eof")) {
      this.emit(
        DiagnosticCode.UnexpectedToken,
        this.peek().range,
        "Unexpected trailing content after the document.",
      );
    }
    return doc;
  }

  // --- Token helpers -----------------------------------------------------

  private peek(offset = 0): Token {
    const idx = this.i + offset;
    if (idx < 0) return this.tokens[0] as Token;
    if (idx >= this.tokens.length) return this.tokens[this.tokens.length - 1] as Token;
    return this.tokens[idx] as Token;
  }

  private advance(): Token {
    const token = this.peek();
    if (token.type !== "eof") this.i++;
    return token;
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private checkIdent(text: string): boolean {
    const t = this.peek();
    return t.type === "identifier" && t.text === text;
  }

  private match(type: TokenType): boolean {
    if (this.check(type)) {
      this.advance();
      return true;
    }
    return false;
  }

  private expect(type: TokenType, code: DiagnosticCode, message: string): Token | undefined {
    if (this.check(type)) return this.advance();
    this.emit(code, this.peek().range, message);
    return undefined;
  }

  private emit(code: DiagnosticCode, range: Range, message: string): void {
    this.bag.emit(code, range, message, this.sourceName);
  }

  // --- Documents ---------------------------------------------------------

  private parseOverrideDocument(): Document {
    const start = this.advance(); // "override"
    let specifier: StringNode | undefined;
    if (this.checkIdent("extends")) {
      this.advance();
      if (this.check("string")) {
        const tok = this.advance();
        specifier = { kind: "string", value: tok.value ?? "", range: tok.range };
      } else {
        this.emit(
          DiagnosticCode.ExpectedValue,
          this.peek().range,
          "Expected a string path after 'extends'.",
        );
      }
    }
    const block = this.parseObjectOpsBlock();
    return {
      kind: "override-document",
      specifier,
      ops: block.ops,
      range: rangeBetween(start.range, block.range),
    };
  }

  // --- Object operations -------------------------------------------------

  private parseObjectOpsBlock(): { ops: ObjectOp[]; range: Range } {
    const openToken = this.peek();
    if (!this.match("{")) {
      this.emit(DiagnosticCode.UnexpectedToken, openToken.range, "Expected '{'.");
      return { ops: [], range: openToken.range };
    }
    const ops: ObjectOp[] = [];
    while (!this.check("}") && !this.check("eof")) {
      const before = this.i;
      const op = this.parseObjectOp();
      if (op) ops.push(op);
      if (this.check("}")) break;
      if (!this.match(",") && !this.check("}")) {
        this.emit(
          DiagnosticCode.ExpectedComma,
          this.peek().range,
          "Expected ',' between operations.",
        );
      }
      if (this.i === before) this.advance();
    }
    const close = this.expect("}", DiagnosticCode.UnexpectedEndOfInput, "Expected '}'.");
    return { ops, range: rangeBetween(openToken.range, (close ?? this.peek()).range) };
  }

  private parseObjectOp(): ObjectOp | undefined {
    const t = this.peek();
    if (t.type === "identifier") {
      if (this.peek(1).type === ":") return this.parseSetOp();
      switch (t.text) {
        case "override":
          return this.parseOverrideOp();
        case "add":
          return this.parseAddOp();
        case "delete":
          return this.parseDeleteOp();
        case "clear":
          return this.parseClearOp();
        case "inherit":
          return this.parseInheritOp();
        default:
          return this.parseSetOp();
      }
    }
    if (t.type === "string") return this.parseSetOp();
    this.emit(
      DiagnosticCode.UnexpectedToken,
      t.range,
      `Unexpected token '${t.text || t.type}' in operation block.`,
    );
    this.advance();
    return undefined;
  }

  private parseSetOp(): ObjectOp {
    const key = this.parseKey();
    this.expect(":", DiagnosticCode.UnexpectedToken, "Expected ':' after the property name.");
    const value = this.parseValue();
    return { kind: "set", key, value, range: rangeBetween(key.range, value.range) };
  }

  private parseAddOp(): ObjectOp {
    const start = this.advance(); // "add"
    const key = this.parseKey();
    const position = this.parseOptionalRelativePosition();
    this.expect(":", DiagnosticCode.UnexpectedToken, "Expected ':' after the property name.");
    const value = this.parseValue();
    return { kind: "add", key, position, value, range: rangeBetween(start.range, value.range) };
  }

  private parseOverrideOp(): ObjectOp {
    const start = this.advance(); // "override"
    const key = this.parseKey();
    const position = this.parseOptionalRelativePosition();
    if (this.check(":")) {
      this.advance();
      const value = this.parseMergeValue();
      return {
        kind: "override-merge",
        key,
        position,
        value,
        range: rangeBetween(start.range, mergeValueRange(value)),
      };
    }
    const endRange = position?.range ?? key.range;
    return { kind: "override-move", key, position, range: rangeBetween(start.range, endRange) };
  }

  private parseDeleteOp(): ObjectOp {
    const start = this.advance(); // "delete"
    const key = this.parseKey();
    return { kind: "delete", key, range: rangeBetween(start.range, key.range) };
  }

  private parseClearOp(): ObjectOp {
    const t = this.advance(); // "clear"
    return { kind: "clear", range: t.range };
  }

  private parseInheritOp(): ObjectOp {
    const t = this.advance(); // "inherit"
    return { kind: "inherit", range: t.range };
  }

  private parseOptionalRelativePosition(): RelativePosition | undefined {
    const t = this.peek();
    if (t.type === "identifier" && RELATIVE_KEYWORDS.has(t.text)) {
      const start = this.advance();
      const key = this.parseKey();
      return {
        kind: "relative-position",
        placement: t.text as "before" | "after",
        key,
        range: rangeBetween(start.range, key.range),
      };
    }
    return undefined;
  }

  private parseMergeValue(): MergeValue {
    if (this.check("{")) {
      const block = this.parseObjectOpsBlock();
      return { kind: "object-ops", ops: block.ops, range: block.range };
    }
    if (this.check("[")) {
      return this.parseArrayOpsValue();
    }
    return this.parseValue();
  }

  // --- Array operations --------------------------------------------------

  private parseArrayOpsValue(): MergeValue {
    const openToken = this.peek();
    this.advance(); // "["
    const ops: ArrayOp[] = [];
    while (!this.check("]") && !this.check("eof")) {
      const before = this.i;
      const op = this.parseArrayOp();
      if (op) ops.push(op);
      if (this.check("]")) break;
      if (!this.match(",") && !this.check("]")) {
        this.emit(
          DiagnosticCode.ExpectedComma,
          this.peek().range,
          "Expected ',' between operations.",
        );
      }
      if (this.i === before) this.advance();
    }
    const close = this.expect("]", DiagnosticCode.UnexpectedEndOfInput, "Expected ']'.");
    return {
      kind: "array-ops",
      ops,
      range: rangeBetween(openToken.range, (close ?? this.peek()).range),
    };
  }

  private parseArrayOp(): ArrayOp | undefined {
    const t = this.peek();
    if (t.type === "identifier") {
      switch (t.text) {
        case "add":
          return this.parseArrayAdd();
        case "delete":
          return this.parseArrayDelete();
        case "clear": {
          const tok = this.advance();
          return { kind: "array-clear", range: tok.range };
        }
        case "true":
        case "false":
        case "null":
        case "Infinity":
        case "NaN": {
          const value = this.parseValue();
          return { kind: "array-add", value, range: value.range };
        }
        default:
          this.emit(
            DiagnosticCode.ExpectedValue,
            t.range,
            `Unexpected token '${t.text}' in array operations.`,
          );
          this.advance();
          return undefined;
      }
    }
    if (t.type === "string" || t.type === "number" || t.type === "{" || t.type === "[") {
      const value = this.parseValue();
      return { kind: "array-add", value, range: value.range };
    }
    this.emit(DiagnosticCode.ExpectedValue, t.range, "Expected an array operation or value.");
    this.advance();
    return undefined;
  }

  private parseArrayAdd(): ArrayOp {
    const start = this.advance(); // "add"
    let index: number | undefined;
    if (this.match("(")) {
      if (this.check("number")) {
        index = Math.trunc(this.advance().numberValue ?? 0);
      }
      this.expect(")", DiagnosticCode.UnexpectedToken, "Expected ')'.");
    }
    const value = this.parseValue();
    return { kind: "array-add", index, value, range: rangeBetween(start.range, value.range) };
  }

  private parseArrayDelete(): ArrayOp {
    const start = this.advance(); // "delete"
    let index = 0;
    let endRange: Range = start.range;
    this.expect("(", DiagnosticCode.UnexpectedToken, "Expected '(' after 'delete'.");
    if (this.check("number")) {
      index = Math.trunc(this.advance().numberValue ?? 0);
    } else {
      this.emit(
        DiagnosticCode.ExpectedValue,
        this.peek().range,
        "Expected an index inside 'delete(...)'.",
      );
    }
    const close = this.expect(")", DiagnosticCode.UnexpectedToken, "Expected ')'.");
    if (close) endRange = close.range;
    return { kind: "array-delete", index, range: rangeBetween(start.range, endRange) };
  }

  // --- Keys and JSON5 values --------------------------------------------

  private parseKey(): KeyNode {
    const t = this.peek();
    if (t.type === "identifier") {
      this.advance();
      return { kind: "key", name: t.text, quoted: false, range: t.range };
    }
    if (t.type === "string") {
      this.advance();
      return { kind: "key", name: t.value ?? "", quoted: true, range: t.range };
    }
    this.emit(DiagnosticCode.ExpectedKey, t.range, "Expected a property name.");
    return { kind: "key", name: "", quoted: false, range: t.range };
  }

  private parseValue(): ValueNode {
    const t = this.peek();
    switch (t.type) {
      case "{":
        return this.parseObjectLiteral();
      case "[":
        return this.parseArrayLiteral();
      case "string":
        this.advance();
        return { kind: "string", value: t.value ?? "", range: t.range };
      case "number":
        this.advance();
        return { kind: "number", value: t.numberValue ?? Number.NaN, raw: t.text, range: t.range };
      case "identifier":
        return this.parseIdentifierValue(t);
      default:
        this.emit(DiagnosticCode.ExpectedValue, t.range, "Expected a value.");
        if (t.type !== "eof") this.advance();
        return { kind: "null", range: t.range };
    }
  }

  private parseIdentifierValue(t: Token): ValueNode {
    switch (t.text) {
      case "true":
        this.advance();
        return { kind: "boolean", value: true, range: t.range };
      case "false":
        this.advance();
        return { kind: "boolean", value: false, range: t.range };
      case "null":
        this.advance();
        return { kind: "null", range: t.range };
      case "Infinity":
        this.advance();
        return { kind: "number", value: Number.POSITIVE_INFINITY, raw: t.text, range: t.range };
      case "NaN":
        this.advance();
        return { kind: "number", value: Number.NaN, raw: t.text, range: t.range };
      default:
        this.emit(
          DiagnosticCode.ExpectedValue,
          t.range,
          `Unexpected identifier '${t.text}' where a value was expected.`,
        );
        this.advance();
        return { kind: "null", range: t.range };
    }
  }

  private parseObjectLiteral(): ObjectNode {
    const open = this.advance(); // "{"
    const members: ObjectMember[] = [];
    while (!this.check("}") && !this.check("eof")) {
      const before = this.i;
      const key = this.parseKey();
      this.expect(":", DiagnosticCode.UnexpectedToken, "Expected ':' after the property name.");
      const value = this.parseValue();
      members.push({ kind: "member", key, value, range: rangeBetween(key.range, value.range) });
      if (!this.match(",")) break;
      if (this.i === before) this.advance();
    }
    const close = this.expect("}", DiagnosticCode.UnexpectedEndOfInput, "Expected '}'.");
    return {
      kind: "object",
      members,
      range: rangeBetween(open.range, (close ?? this.peek()).range),
    };
  }

  private parseArrayLiteral(): ArrayNode {
    const open = this.advance(); // "["
    const elements: ValueNode[] = [];
    while (!this.check("]") && !this.check("eof")) {
      const before = this.i;
      elements.push(this.parseValue());
      if (!this.match(",")) break;
      if (this.i === before) this.advance();
    }
    const close = this.expect("]", DiagnosticCode.UnexpectedEndOfInput, "Expected ']'.");
    return {
      kind: "array",
      elements,
      range: rangeBetween(open.range, (close ?? this.peek()).range),
    };
  }
}

function mergeValueRange(value: MergeValue): Range {
  return value.range;
}
