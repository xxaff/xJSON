import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryHost } from "@x-json/core";
import { NodeHost } from "@x-json/core/node";
import {
  completionsAt,
  matchesGlob,
  schemaDiagnostics,
  schemaLinks,
} from "@x-json/language-server";
import { describe, expect, it } from "vitest";

const examplesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");
const nodeHost = new NodeHost();

function readExample(relativePath: string): { source: string; path: string } {
  const path = resolve(examplesDir, relativePath);
  return { source: readFileSync(path, "utf8"), path };
}

describe("schema validation", () => {
  const host = new MemoryHost({
    "/schema.xjson":
      "{ type: 'object', required: ['id', 'name'], properties: { id: { type: 'integer', minimum: 1 }, name: { type: 'string' } }, additionalProperties: false }",
  });

  it("reports no errors for a valid instance", () => {
    const source = "{ $schema: './schema.xjson', id: 1, name: 'Ada' }";
    expect(schemaDiagnostics(source, { uri: "/data.xjson", host })).toHaveLength(0);
  });

  it("reports errors for an invalid instance", () => {
    const source = "{ $schema: './schema.xjson', id: 0 }";
    const diagnostics = schemaDiagnostics(source, { uri: "/data.xjson", host });
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.source === "xjson")).toBe(true);
  });

  it("ignores the meta-schema URL on a schema file", () => {
    const source = "{ $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' }";
    expect(schemaDiagnostics(source, { uri: "/x.schema.xjson", host })).toHaveLength(0);
  });

  it("provides a document link for the $schema reference", () => {
    const links = schemaLinks("{ $schema: './schema.xjson', id: 1 }", { uri: "/data.xjson", host });
    expect(links[0]?.target).toBe("/schema.xjson");
  });

  it("validates the real admin.xjson example as valid", () => {
    const { source, path } = readExample("schema/admin.xjson");
    expect(schemaDiagnostics(source, { uri: path, host: nodeHost })).toHaveLength(0);
  });

  it("flags the real admin.invalid.xjson example", () => {
    const { source, path } = readExample("schema/admin.invalid.xjson");
    expect(schemaDiagnostics(source, { uri: path, host: nodeHost }).length).toBeGreaterThan(0);
  });
});

describe("schema associations (config-based)", () => {
  const host = new MemoryHost({
    "/schemas/user.xjson":
      "{ type: 'object', required: ['id'], properties: { id: { type: 'integer', minimum: 1 }, name: { type: 'string' } }, additionalProperties: false }",
    "/a.xjson": "{ type: 'object', required: ['x'], additionalProperties: true }",
  });

  it("matches file globs", () => {
    expect(matchesGlob("*.user.xjson", "/a/b/c.user.xjson")).toBe(true);
    expect(matchesGlob("**/*.xjson", "/a/b/c.xjson")).toBe(true);
    expect(matchesGlob("config/*.xjson", "/x/config/a.xjson")).toBe(true);
    expect(matchesGlob("*.user.xjson", "/a/b.xjson")).toBe(false);
  });

  it("validates against an associated schema (no in-file $schema)", () => {
    const opts = { uri: "/data.xjson", host, schemaUri: "/schemas/user.xjson" };
    expect(schemaDiagnostics("{ id: 0 }", opts).length).toBeGreaterThan(0);
    expect(schemaDiagnostics("{ id: 1 }", opts)).toHaveLength(0);
  });

  it("completes properties from an associated schema", () => {
    const labels = completionsAt(
      "{ id: 1 }",
      { line: 0, character: 5 },
      {
        uri: "/d.xjson",
        host,
        schemaUri: "/schemas/user.xjson",
      },
    ).map((c) => c.label);
    expect(labels).toContain("name");
  });

  it("prefers an in-file $schema over a configured association", () => {
    // In-file points to /a.xjson (requires `x`); the association points elsewhere.
    const diagnostics = schemaDiagnostics("{ $schema: './a.xjson', y: 1 }", {
      uri: "/data.xjson",
      host,
      schemaUri: "/schemas/user.xjson",
    });
    expect(diagnostics.length).toBeGreaterThan(0); // `x` is required by /a.xjson
  });
});
