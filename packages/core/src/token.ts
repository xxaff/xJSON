import type { Range } from "./position";

export type TokenType =
  | "{"
  | "}"
  | "["
  | "]"
  | "("
  | ")"
  | ":"
  | ","
  | "string"
  | "number"
  | "identifier"
  | "eof";

export interface Token {
  type: TokenType;
  /** Raw source text of the token. */
  text: string;
  /** Decoded value, for string tokens. */
  value?: string;
  /** Parsed numeric value, for number tokens. */
  numberValue?: number;
  range: Range;
}

export interface Comment {
  kind: "line" | "block";
  text: string;
  range: Range;
}
