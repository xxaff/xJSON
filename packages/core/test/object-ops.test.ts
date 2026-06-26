import { describe, expect, it } from "vitest";
import { runOps, warningCodes } from "./helpers";

const base = { id: 1, name: "old", role: "admin", active: true };

describe("object operations", () => {
  it("set replaces an existing value", () => {
    const { value } = runOps('name: "new"', base);
    expect(value).toEqual({ id: 1, name: "new", role: "admin", active: true });
  });

  it("set creates a new key (upsert)", () => {
    const { value } = runOps('theme: "dark"', base);
    expect(value).toEqual({ ...base, theme: "dark" });
  });

  it("add creates a new key", () => {
    const { value } = runOps('add email: "e"', base);
    expect(value).toEqual({ ...base, email: "e" });
  });

  it("add over an existing key replaces it (upsert)", () => {
    const { value } = runOps('add name: "X"', base);
    expect(value).toEqual({ ...base, name: "X" });
  });

  it("override prop repositions without changing the value", () => {
    const { value, diagnostics } = runOps("override role", base);
    expect(value).toEqual(base);
    expect(diagnostics).toHaveLength(0);
  });

  it("override of a missing key warns and does not create it", () => {
    const { value, diagnostics } = runOps("override ghost", base);
    expect(value).toEqual(base);
    expect(warningCodes(diagnostics)).toContain("override-unknown-key");
  });

  it("override merges nested objects", () => {
    const { value } = runOps('override profile: { add city: "NYC" }', { profile: { name: "A" } });
    expect(value).toEqual({ profile: { name: "A", city: "NYC" } });
  });

  it("override merges deeply nested objects", () => {
    const { value } = runOps("override a: { override b: { add c: 1 } }", { a: { b: { x: 0 } } });
    expect(value).toEqual({ a: { b: { x: 0, c: 1 } } });
  });

  it("delete removes a property", () => {
    const { value } = runOps("delete active", base);
    expect(value).toEqual({ id: 1, name: "old", role: "admin" });
  });

  it("delete of a missing key warns", () => {
    const { value, diagnostics } = runOps("delete ghost", base);
    expect(value).toEqual(base);
    expect(warningCodes(diagnostics)).toContain("delete-unknown-key");
  });

  it("applies several operations in cascade", () => {
    const { value } = runOps('name: "new", add email: "e", delete active', base);
    expect(value).toEqual({ id: 1, name: "new", role: "admin", email: "e" });
  });
});
