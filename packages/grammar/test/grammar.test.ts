import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import * as oniguruma from "vscode-oniguruma";
import { type IGrammar, INITIAL, Registry, parseRawGrammar } from "vscode-textmate";

const here = dirname(fileURLToPath(import.meta.url));
const grammarPath = resolve(here, "../syntaxes/xjson.tmLanguage.json");
const require = createRequire(import.meta.url);

let grammar: IGrammar;

beforeAll(async () => {
  const wasmPath = require.resolve("vscode-oniguruma/release/onig.wasm");
  await oniguruma.loadWASM(readFileSync(wasmPath));
  const registry = new Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (text) => new oniguruma.OnigString(text),
    }),
    loadGrammar: async () => parseRawGrammar(readFileSync(grammarPath, "utf8"), grammarPath),
  });
  const loaded = await registry.loadGrammar("source.xjson");
  if (!loaded) throw new Error("Failed to load the XJSON grammar");
  grammar = loaded;
});

function scopesFor(line: string, token: string): string {
  const result = grammar.tokenizeLine(line, INITIAL);
  const index = line.indexOf(token);
  for (const t of result.tokens) {
    if (index >= t.startIndex && index < t.endIndex) return t.scopes.join(" ");
  }
  return "";
}

describe("XJSON TextMate grammar", () => {
  it("highlights override as a keyword", () => {
    expect(scopesFor("override { add x: 1 }", "override")).toContain("keyword");
  });

  it("highlights add (used as an operation) as a keyword", () => {
    expect(scopesFor("override { add x: 1 }", "add")).toContain("keyword");
  });

  it("highlights a property key", () => {
    expect(scopesFor("{ name: 1 }", "name")).toContain("property-name");
  });

  it("treats a keyword used as a key as a property name", () => {
    expect(scopesFor("{ add: 1 }", "add")).toContain("property-name");
  });

  it("highlights double-quoted strings", () => {
    expect(scopesFor('{ a: "hi" }', '"hi"')).toContain("string");
  });

  it("highlights numbers (including hex)", () => {
    expect(scopesFor("{ a: 0xFF }", "0xFF")).toContain("numeric");
  });

  it("highlights comments", () => {
    expect(scopesFor("// hello", "hello")).toContain("comment");
  });

  it("highlights language constants", () => {
    expect(scopesFor("{ a: true }", "true")).toContain("constant.language");
  });
});
