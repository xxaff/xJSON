import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeHost } from "@xjson/core/node";
import { compileSchema, validateSource, validateValue } from "@xjson/schema";
import { describe, expect, it } from "vitest";

const examplesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");
const host = new NodeHost();

function readExample(relativePath: string): { source: string; path: string } {
  const path = resolve(examplesDir, relativePath);
  return { source: readFileSync(path, "utf8"), path };
}

describe("@xjson/schema", () => {
  it("compiles a JSON Schema written in XJSON", () => {
    const { source } = readExample("schema/user.schema.xjson");
    const { diagnostics } = compileSchema(source);
    expect(diagnostics).toHaveLength(0);
  });

  it("accepts a valid instance", () => {
    const { source } = readExample("schema/user.schema.xjson");
    const result = validateValue(source, { id: 1, name: "Ada" });
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("rejects a missing required field", () => {
    const { source } = readExample("schema/user.schema.xjson");
    const result = validateValue(source, { id: 1 });
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("rejects a value below the minimum", () => {
    const { source } = readExample("schema/user.schema.xjson");
    expect(validateValue(source, { id: 0, name: "Ada" }).valid).toBe(false);
  });

  it("rejects additional properties", () => {
    const { source } = readExample("schema/user.schema.xjson");
    expect(validateValue(source, { id: 1, name: "Ada", extra: true }).valid).toBe(false);
  });

  it("validates the email format", () => {
    const { source } = readExample("schema/user.schema.xjson");
    expect(validateValue(source, { id: 1, name: "A", email: "nope" }).valid).toBe(false);
    expect(validateValue(source, { id: 1, name: "A", email: "a@b.com" }).valid).toBe(true);
  });

  it("supports a schema that extends another schema", () => {
    const { source, path } = readExample("schema/admin.schema.xjson");
    const options = { uri: path, host };
    const invalid = validateValue(source, { id: 1, name: "A" }, options);
    expect(invalid.valid).toBe(false);
    const valid = validateValue(source, { id: 1, name: "A", permissions: ["read"] }, options);
    expect(valid.valid).toBe(true);
    expect(valid.diagnostics.filter((d) => d.severity === "error")).toHaveLength(0);
  });

  it("validates an XJSON instance source against an XJSON schema source", () => {
    const { source } = readExample("schema/user.schema.xjson");
    expect(validateSource(source, "{ id: 1, name: 'Ada' }").valid).toBe(true);
    expect(validateSource(source, "{ id: 1 }").valid).toBe(false);
  });
});
