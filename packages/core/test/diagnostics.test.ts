import { XJSONError, evaluate, parse } from "@xjson/core";
import { describe, expect, it } from "vitest";
import { codes, errorCodes } from "./helpers";

describe("diagnostics and severity", () => {
  it("reports duplicate inherit as an error", () => {
    const { diagnostics } = evaluate("override { inherit, add x: 1, inherit }", { base: { a: 1 } });
    expect(errorCodes(diagnostics)).toContain("duplicate-inherit");
  });

  it("reports an unterminated string", () => {
    const { diagnostics } = parse('{ a: "oops }');
    expect(codes(diagnostics)).toContain("unterminated-string");
  });

  it("reports an unterminated block comment", () => {
    const { diagnostics } = parse("/* open { a: 1 }");
    expect(codes(diagnostics)).toContain("unterminated-comment");
  });

  it("reports an unexpected character", () => {
    const { diagnostics } = parse("{ a: 1 } @");
    expect(codes(diagnostics)).toContain("unexpected-character");
  });

  it("reports a missing comma between operations", () => {
    const { diagnostics } = evaluate("override { add a: 1 add b: 2 }", { base: {} });
    expect(codes(diagnostics)).toContain("expected-comma");
  });

  it("silences a code via severity config", () => {
    const { diagnostics } = evaluate("override { override n: 1234 }", {
      base: { n: { x: 1 } },
      severity: { "type-mismatch-override": "off" },
    });
    expect(diagnostics).toHaveLength(0);
  });

  it("raises a warning to an error via severity config", () => {
    const { diagnostics } = evaluate("override { override n: 1234 }", {
      base: { n: { x: 1 } },
      severity: { "type-mismatch-override": "error" },
    });
    expect(errorCodes(diagnostics)).toContain("type-mismatch-override");
  });

  it("throws in strict mode when there are errors", () => {
    expect(() =>
      evaluate("override { override o: [ add 1, clear ] }", { base: { o: [0] }, strict: true }),
    ).toThrow(XJSONError);
  });

  it("does not throw in strict mode when there are only warnings", () => {
    expect(() =>
      evaluate("override { override n: 1234 }", { base: { n: { x: 1 } }, strict: true }),
    ).not.toThrow();
  });
});
