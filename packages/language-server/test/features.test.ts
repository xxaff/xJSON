import { MemoryHost } from "@x-json/core";
import {
  analyzeDiagnostics,
  codeActions,
  codeLenses,
  completionsAt,
  definitionAt,
  documentHighlights,
  documentLinks,
  documentSymbols,
  foldingRanges,
  hoverAt,
  inlayHints,
  references,
  renameEdits,
  selectionRanges,
  semanticTokens,
} from "@x-json/language-server";
import { describe, expect, it } from "vitest";
import type { Position } from "vscode-languageserver-types";

function posOf(source: string, needle: string, occurrence = 1): Position {
  let index = -1;
  for (let i = 0; i < occurrence; i++) index = source.indexOf(needle, index + 1);
  const before = source.slice(0, index);
  return { line: before.split("\n").length - 1, character: index - (before.lastIndexOf("\n") + 1) };
}

function hoverText(hover: ReturnType<typeof hoverAt>): string {
  if (!hover) return "";
  const contents = hover.contents as { value?: string };
  return contents.value ?? "";
}

describe("hover", () => {
  it("documents keywords", () => {
    const source = "override { add x: 1 }";
    expect(hoverText(hoverAt(source, posOf(source, "override")))).toContain("merge");
  });

  it("shows the evaluated value of a key", () => {
    const source = "override { a: 1 }";
    expect(hoverText(hoverAt(source, posOf(source, "a"), { base: {} }))).toContain("1");
  });

  it("shows the resolved path of an extends specifier", () => {
    const host = new MemoryHost({ "/base.xjson": "{ a: 1 }" });
    const source = 'override extends "./base.xjson" { }';
    const text = hoverText(hoverAt(source, posOf(source, "base.xjson"), { uri: "/c.xjson", host }));
    expect(text).toContain("/base.xjson");
  });
});

describe("structure", () => {
  it("produces document symbols (outline)", () => {
    const symbols = documentSymbols("override { add a: 1, override b: { add c: 2 } }");
    const names = symbols.map((s) => s.name);
    expect(names).toContain("a");
    expect(names).toContain("b");
    const b = symbols.find((s) => s.name === "b");
    expect(b?.children?.map((c) => c.name)).toContain("c");
  });

  it("produces folding ranges for multi-line blocks", () => {
    const source = "override {\n  add a: 1,\n}";
    expect(foldingRanges(source).length).toBeGreaterThan(0);
  });

  it("produces semantic tokens for keywords and properties", () => {
    const tokens = semanticTokens("override { add x: 1 }");
    expect(tokens.some((t) => t.tokenType === 0)).toBe(true); // keyword
    expect(tokens.some((t) => t.tokenType === 1)).toBe(true); // property
  });

  it("does not overflow the override keyword onto the property", () => {
    const tokens = semanticTokens("override { override server: { add x: 1 } }");
    // Every keyword token must be a real keyword length (override = 8), never "override-merge" = 13.
    expect(tokens.filter((t) => t.tokenType === 0).every((t) => t.length <= 8)).toBe(true);
    const server = tokens.find((t) => t.line === 0 && t.char === 20);
    expect(server?.tokenType).toBe(1); // "server" is a property, not a keyword
  });

  it("expands selection ranges", () => {
    const source = "override { a: 1 }";
    const ranges = selectionRanges(source, [posOf(source, "1")]);
    expect(ranges[0]?.range).toBeDefined();
  });

  it("shows evaluated values as inlay hints", () => {
    const hints = inlayHints("override { a: 1, b: 2 }", { base: {} });
    expect(hints).toHaveLength(2);
    expect(hints.some((h) => String(h.label).includes("1"))).toBe(true);
  });

  it("offers code lenses (preview + extends)", () => {
    const host = new MemoryHost({ "/base.xjson": "{ a: 1 }" });
    const lenses = codeLenses('override extends "./base.xjson" { }', { uri: "/c.xjson", host });
    expect(lenses.some((l) => l.command?.command === "xjson.preview")).toBe(true);
  });
});

describe("navigation", () => {
  const source = "override { override foo, delete foo }";

  it("highlights all occurrences of a key", () => {
    expect(documentHighlights(source, posOf(source, "foo"))).toHaveLength(2);
  });

  it("finds references", () => {
    expect(references(source, posOf(source, "foo"), { uri: "/a.xjson" })).toHaveLength(2);
  });

  it("renames all occurrences", () => {
    const edit = renameEdits(source, posOf(source, "foo"), "bar", { uri: "/a.xjson" });
    const edits = edit?.changes?.["/a.xjson"] ?? [];
    expect(edits).toHaveLength(2);
    expect(edits.every((e) => e.newText === "bar")).toBe(true);
  });

  it("provides a document link for the extends target", () => {
    const host = new MemoryHost({ "/base.xjson": "{ a: 1 }" });
    const links = documentLinks('override extends "./base.xjson" { }', { uri: "/c.xjson", host });
    expect(links[0]?.target).toBe("/base.xjson");
  });
});

describe("completion and code actions", () => {
  it("completes keywords and inherited keys", () => {
    const host = new MemoryHost({ "/base.xjson": "{ a: 1, b: 2 }" });
    const labels = completionsAt(
      'override extends "./base.xjson" { }',
      { line: 0, character: 33 },
      {
        uri: "/c.xjson",
        host,
      },
    ).map((c) => c.label);
    expect(labels).toContain("override");
    expect(labels).toContain("a");
  });

  it("offers a quick fix for a duplicate inherit", () => {
    const source = "override { inherit, inherit }";
    const diagnostics = analyzeDiagnostics(source);
    const actions = codeActions(source, diagnostics);
    expect(actions.some((a) => a.title.includes("Remove duplicate"))).toBe(true);
  });

  it("does not warn for a root override without extends or base (unknown base)", () => {
    expect(analyzeDiagnostics("override { override server: { port: 9090 } }")).toHaveLength(0);
  });

  it("still reports structural errors even when the base is unknown", () => {
    const codes = analyzeDiagnostics("override { inherit, inherit }").map((d) => String(d.code));
    expect(codes).toContain("duplicate-inherit");
  });

  it("completes schema-defined properties for an instance", () => {
    const host = new MemoryHost({
      "/s.xjson":
        "{ type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } }, required: ['name'] }",
    });
    const labels = completionsAt(
      "{ $schema: './s.xjson', id: 1 }",
      { line: 0, character: 28 },
      {
        uri: "/d.xjson",
        host,
      },
    ).map((c) => c.label);
    expect(labels).toContain("name");
    expect(labels).not.toContain("id"); // already present
  });

  it("does not offer operation keywords inside a plain data document", () => {
    const labels = completionsAt("{ a: 1 }", { line: 0, character: 5 }, {}).map((c) => c.label);
    expect(labels).not.toContain("override");
  });
});

describe("definition navigation", () => {
  const host = new MemoryHost({
    "/base.xjson": "{ server: { port: 8080, headers: { a: 1 } }, name: 'x' }",
  });
  const source =
    'override extends "./base.xjson" { override server: { override headers: { a: 2 } }, delete name }';
  const options = { uri: "/child.xjson", host };

  it("navigates an overridden key to the base definition", () => {
    expect(definitionAt(source, posOf(source, "server"), options)?.uri).toBe("/base.xjson");
  });

  it("navigates a nested overridden key to the base definition", () => {
    expect(definitionAt(source, posOf(source, "headers"), options)?.uri).toBe("/base.xjson");
  });

  it("navigates a deleted key to the base definition", () => {
    expect(definitionAt(source, posOf(source, "name"), options)?.uri).toBe("/base.xjson");
  });

  it("returns null on a brand-new key", () => {
    const s = 'override extends "./base.xjson" { add brandNew: 1 }';
    expect(definitionAt(s, posOf(s, "brandNew"), options)).toBeNull();
  });

  it("still jumps to the base file on the extends specifier", () => {
    expect(definitionAt(source, posOf(source, "base.xjson"), options)?.uri).toBe("/base.xjson");
  });
});
