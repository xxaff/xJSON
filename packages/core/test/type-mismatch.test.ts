import { describe, expect, it } from "vitest";
import { runOps, warningCodes } from "./helpers";

describe("non-combinable override (type mismatch)", () => {
  it("substitutes a number over an object and warns", () => {
    const { value, diagnostics } = runOps("override n: 1234", { n: { x: 1 } });
    expect(value).toEqual({ n: 1234 });
    expect(warningCodes(diagnostics)).toContain("type-mismatch-override");
  });

  it("substitutes a string over an array and warns", () => {
    const { value, diagnostics } = runOps('override arr: "str"', { arr: [1, 2] });
    expect(value).toEqual({ arr: "str" });
    expect(warningCodes(diagnostics)).toContain("type-mismatch-override");
  });

  it("substitutes object operations over a scalar and warns", () => {
    const { value, diagnostics } = runOps("override n: { add a: 1 }", { n: 5 });
    expect(value).toEqual({ n: { a: 1 } });
    expect(warningCodes(diagnostics)).toContain("type-mismatch-override");
  });

  it("substitutes array operations over a scalar and warns", () => {
    const { value, diagnostics } = runOps('override n: [ add "x" ]', { n: 5 });
    expect(value).toEqual({ n: ["x"] });
    expect(warningCodes(diagnostics)).toContain("type-mismatch-override");
  });
});
