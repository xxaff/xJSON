import { evaluate } from "@x-json/core";
import { describe, expect, it } from "vitest";
import { evalValue } from "./helpers";

describe("JSON5 data layer", () => {
  it("parses a basic object with mixed keys and trailing comma", () => {
    const { value, diagnostics } = evaluate('{ "a": 1, b: "x", c: true, d: null, }');
    expect(value).toEqual({ a: 1, b: "x", c: true, d: null });
    expect(diagnostics).toHaveLength(0);
  });

  it("ignores line and block comments", () => {
    expect(evalValue("// header\n{ /* inline */ a: 1 }")).toEqual({ a: 1 });
  });

  it("supports single and double quotes", () => {
    expect(evalValue("{ a: 'hi', b: \"there\" }")).toEqual({ a: "hi", b: "there" });
  });

  it("supports nested objects and arrays", () => {
    expect(evalValue("{ a: [1, 2, { b: 3 }], c: { d: [4] } }")).toEqual({
      a: [1, 2, { b: 3 }],
      c: { d: [4] },
    });
  });

  it("parses hex, fractional and signed numbers", () => {
    expect(evalValue("{ a: 0xFF, b: 1.5, c: .5, d: 5., e: -3, f: 1e3 }")).toEqual({
      a: 255,
      b: 1.5,
      c: 0.5,
      d: 5,
      e: -3,
      f: 1000,
    });
  });

  it("parses Infinity and NaN", () => {
    const value = evalValue("{ a: Infinity, b: -Infinity, c: NaN }") as Record<string, number>;
    expect(value.a).toBe(Number.POSITIVE_INFINITY);
    expect(value.b).toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isNaN(value.c)).toBe(true);
  });

  it("decodes string escapes", () => {
    const value = evalValue("{ s: '\\t\\n\\u0041\\x42' }") as Record<string, string>;
    expect(value.s).toBe("\t\nAB");
  });

  it("treats a document without override blocks as valid JSON5", () => {
    expect(evalValue("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("allows a trailing comma in arrays", () => {
    expect(evalValue("[1, 2, 3,]")).toEqual([1, 2, 3]);
  });
});
