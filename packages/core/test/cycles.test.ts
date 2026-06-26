import { MemoryHost, evaluate } from "@xjson/core";
import { describe, expect, it } from "vitest";
import { errorCodes } from "./helpers";

function evalRoot(host: MemoryHost, path: string) {
  return evaluate(host.readFile(path), { uri: path, host });
}

describe("extends cycle detection", () => {
  it("detects a self cycle", () => {
    const host = new MemoryHost({ "/a.xjson": 'override extends "./a.xjson" { add a: 1 }' });
    const { diagnostics } = evalRoot(host, "/a.xjson");
    expect(errorCodes(diagnostics)).toContain("extends-cycle");
  });

  it("detects a two-file cycle", () => {
    const host = new MemoryHost({
      "/a.xjson": 'override extends "./b.xjson" { add a: 1 }',
      "/b.xjson": 'override extends "./a.xjson" { add b: 1 }',
    });
    const { diagnostics } = evalRoot(host, "/a.xjson");
    expect(errorCodes(diagnostics)).toContain("extends-cycle");
  });

  it("detects a complex mid-chain cycle (A -> B -> C -> D -> B)", () => {
    const host = new MemoryHost({
      "/a.xjson": 'override extends "./b.xjson" { add a: 1 }',
      "/b.xjson": 'override extends "./c.xjson" { add b: 1 }',
      "/c.xjson": 'override extends "./d.xjson" { add c: 1 }',
      "/d.xjson": 'override extends "./b.xjson" { add d: 1 }',
    });
    const { diagnostics } = evalRoot(host, "/a.xjson");
    expect(errorCodes(diagnostics)).toContain("extends-cycle");
  });

  it("terminates and returns a value when a cycle is present", () => {
    const host = new MemoryHost({
      "/a.xjson": 'override extends "./b.xjson" { add a: 1 }',
      "/b.xjson": 'override extends "./a.xjson" { add b: 1 }',
    });
    const { value } = evalRoot(host, "/a.xjson");
    expect(value).toMatchObject({ a: 1 });
  });

  it("does not flag a deep acyclic chain", () => {
    const files: Record<string, string> = { "/f0.xjson": "{ n: 0 }" };
    for (let i = 1; i < 20; i++) {
      files[`/f${i}.xjson`] = `override extends "./f${i - 1}.xjson" { add k${i}: ${i} }`;
    }
    const host = new MemoryHost(files);
    const { value, diagnostics } = evalRoot(host, "/f19.xjson");
    expect(errorCodes(diagnostics)).not.toContain("extends-cycle");
    expect((value as { k19: number }).k19).toBe(19);
  });
});
