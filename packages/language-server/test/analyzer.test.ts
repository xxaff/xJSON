import { MemoryHost } from "@xjson/core";
import { analyzeDiagnostics, completions, definitionAt } from "@xjson/language-server";
import { describe, expect, it } from "vitest";

describe("language-server analyzer", () => {
  it("produces LSP diagnostics with zero-based ranges", () => {
    const diagnostics = analyzeDiagnostics("override { inherit, inherit }", { uri: "/a.xjson" });
    const duplicate = diagnostics.find((d) => String(d.code) === "duplicate-inherit");
    expect(duplicate).toBeDefined();
    expect(duplicate?.severity).toBe(1);
    expect(duplicate?.range.start.line).toBe(0);
    expect(duplicate?.source).toBe("xjson");
  });

  it("reports only the open document's diagnostics, not its extends targets", () => {
    const host = new MemoryHost({ "/base.xjson": "override { inherit, inherit }" });
    const diagnostics = analyzeDiagnostics('override extends "./base.xjson" { add a: 1 }', {
      uri: "/child.xjson",
      host,
    });
    expect(diagnostics.find((d) => String(d.code) === "duplicate-inherit")).toBeUndefined();
  });

  it("resolves go-to-definition on the extends specifier", () => {
    const host = new MemoryHost({ "/base.xjson": "{ a: 1 }" });
    const source = 'override extends "./base.xjson" { }';
    const onSpecifier = definitionAt(
      source,
      { line: 0, character: 20 },
      { uri: "/child.xjson", host },
    );
    expect(onSpecifier?.uri).toBe("/base.xjson");
    const offSpecifier = definitionAt(
      source,
      { line: 0, character: 0 },
      { uri: "/child.xjson", host },
    );
    expect(offSpecifier).toBeNull();
  });

  it("offers keyword completions", () => {
    expect(completions().map((c) => c.label)).toContain("override");
  });
});
