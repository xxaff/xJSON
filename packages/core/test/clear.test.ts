import { describe, expect, it } from "vitest";
import { keysOf, runOps } from "./helpers";

describe("clear", () => {
  it("clears an object and rebuilds it", () => {
    const { value } = runOps('override o: { clear, add id: 9, add name: "n" }', {
      o: { a: 1, b: 2 },
    });
    expect(value).toEqual({ o: { id: 9, name: "n" } });
    expect(keysOf((value as { o: object }).o)).toEqual(["id", "name"]);
  });

  it("errors and ignores a clear that is not at the start of an object block", () => {
    const { value, diagnostics } = runOps("override o: { add x: 1, clear }", { o: { a: 1, b: 2 } });
    expect(value).toEqual({ o: { a: 1, b: 2, x: 1 } });
    expect(diagnostics.map((d) => d.code)).toContain("clear-not-at-start");
  });
});
