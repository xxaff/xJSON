import { MemoryHost, evaluate } from "@xjson/core";
import { describe, expect, it } from "vitest";
import { errorCodes, warningCodes } from "./helpers";

describe("extends resolution", () => {
  it("merges a single parent", () => {
    const host = new MemoryHost({ "/base.xjson": "{ a: 1, b: 2 }" });
    const { value, diagnostics } = evaluate('override extends "./base.xjson" { add c: 3 }', {
      uri: "/child.xjson",
      host,
    });
    expect(value).toEqual({ a: 1, b: 2, c: 3 });
    expect(diagnostics).toHaveLength(0);
  });

  it("resolves a multi-level chain", () => {
    const host = new MemoryHost({
      "/a.xjson": "{ x: 1 }",
      "/b.xjson": 'override extends "./a.xjson" { add y: 2 }',
      "/c.xjson": 'override extends "./b.xjson" { add z: 3 }',
    });
    const { value } = evaluate('override extends "./c.xjson" { add w: 4 }', {
      uri: "/d.xjson",
      host,
    });
    expect(value).toEqual({ x: 1, y: 2, z: 3, w: 4 });
  });

  it("overrides values inherited through the chain", () => {
    const host = new MemoryHost({
      "/a.xjson": "{ v: 1, keep: true }",
      "/b.xjson": 'override extends "./a.xjson" { v: 2 }',
    });
    const { value } = evaluate('override extends "./b.xjson" { v: 3 }', { uri: "/c.xjson", host });
    expect(value).toEqual({ v: 3, keep: true });
  });

  it("errors when extends is used without a host", () => {
    const { diagnostics } = evaluate('override extends "./x.xjson" { }', { uri: "/c.xjson" });
    expect(errorCodes(diagnostics)).toContain("extends-without-host");
  });

  it("errors when the target cannot be read", () => {
    const host = new MemoryHost({});
    const { diagnostics } = evaluate('override extends "./missing.xjson" { }', {
      uri: "/c.xjson",
      host,
    });
    expect(errorCodes(diagnostics)).toContain("extends-read-failed");
  });

  it("warns for an override block without extends or injected base", () => {
    const { value, diagnostics } = evaluate("override { add a: 1 }", { uri: "/c.xjson" });
    expect(value).toEqual({ a: 1 });
    expect(warningCodes(diagnostics)).toContain("no-base-for-override");
  });
});
