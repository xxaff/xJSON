import { describe, expect, it } from "vitest";
import { keysOf, runOps, warningCodes } from "./helpers";

const abcd = { a: 1, b: 2, c: 3, d: 4 };

describe("key ordering: inherit", () => {
  it("places non-mentioned keys at the start by default", () => {
    expect(keysOf(runOps("override c, override a", abcd).value)).toEqual(["b", "d", "c", "a"]);
  });

  it("places inherited keys where inherit appears", () => {
    expect(keysOf(runOps("override c, inherit, override a", abcd).value)).toEqual([
      "c",
      "b",
      "d",
      "a",
    ]);
  });

  it("treats a leading inherit like the default", () => {
    expect(keysOf(runOps("inherit, override c, override a", abcd).value)).toEqual([
      "b",
      "d",
      "c",
      "a",
    ]);
  });

  it("places inherited keys last with a trailing inherit", () => {
    expect(keysOf(runOps("override c, override a, inherit", abcd).value)).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });
});

describe("key ordering: relative position", () => {
  it("moves a key before another", () => {
    expect(keysOf(runOps("override d before a, inherit", abcd).value)).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
  });

  it("moves a key after another", () => {
    expect(keysOf(runOps("override a after c, inherit", abcd).value)).toEqual(["b", "c", "a", "d"]);
  });

  it("adds a new key before another", () => {
    expect(keysOf(runOps("add x before a, inherit", { a: 1, b: 2 }).value)).toEqual([
      "x",
      "a",
      "b",
    ]);
  });

  it("adds a new key after another", () => {
    expect(keysOf(runOps("add x after a, inherit", { a: 1, b: 2 }).value)).toEqual(["a", "x", "b"]);
  });

  it("merges a subproperty and repositions it", () => {
    const { value } = runOps("override f before a: { add z: 1 }, inherit", {
      a: 1,
      f: { y: 0 },
      b: 2,
    });
    expect(keysOf(value)).toEqual(["f", "a", "b"]);
    expect(value).toEqual({ f: { y: 0, z: 1 }, a: 1, b: 2 });
  });

  it("warns when the reference key does not exist and keeps the key in place", () => {
    const { diagnostics } = runOps("override a before missing, inherit", abcd);
    expect(warningCodes(diagnostics)).toContain("unknown-key-reference");
  });
});
