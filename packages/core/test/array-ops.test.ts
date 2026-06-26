import { type JsonValue, evaluate } from "@xjson/core";
import { describe, expect, it } from "vitest";
import { warningCodes } from "./helpers";

function runArray(
  ops: string,
  initial: JsonValue[],
): { value: JsonValue[]; diagnostics: ReturnType<typeof evaluate>["diagnostics"] } {
  const result = evaluate(`override { override arr: [ ${ops} ] }`, {
    base: { arr: structuredClone(initial) },
  });
  return { value: (result.value as { arr: JsonValue[] }).arr, diagnostics: result.diagnostics };
}

describe("array operations", () => {
  it("appends with add and with a bare value", () => {
    expect(runArray('add "d", "e"', ["a", "b", "c"]).value).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("inserts at an index with add(n)", () => {
    expect(runArray('add(0) "z"', ["a", "b"]).value).toEqual(["z", "a", "b"]);
  });

  it("deletes at an index with delete(n)", () => {
    expect(runArray("delete(1)", ["a", "b", "c"]).value).toEqual(["a", "c"]);
  });

  it("evaluates indices over the mutating state", () => {
    expect(runArray('add "d", add(0) "z", delete(1)', ["a", "b", "c"]).value).toEqual([
      "z",
      "b",
      "c",
      "d",
    ]);
  });

  it("clears then rebuilds", () => {
    expect(runArray('clear, add "x"', [1, 2, 3]).value).toEqual(["x"]);
  });

  it("errors when clear is not at the start (and ignores it)", () => {
    const { value, diagnostics } = runArray('add "x", clear', [1, 2, 3]);
    expect(value).toEqual([1, 2, 3, "x"]);
    expect(diagnostics.map((d) => d.code)).toContain("clear-not-at-start");
  });

  it("warns on a delete index out of range", () => {
    const { value, diagnostics } = runArray("delete(5)", [1]);
    expect(value).toEqual([1]);
    expect(warningCodes(diagnostics)).toContain("delete-index-out-of-range");
  });

  it("warns and clamps an add index out of range", () => {
    const { value, diagnostics } = runArray("add(5) 9", [1]);
    expect(value).toEqual([1, 9]);
    expect(warningCodes(diagnostics)).toContain("add-index-out-of-range");
  });
});
