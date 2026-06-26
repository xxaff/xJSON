import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type EvaluateResult, evaluate } from "@x-json/core";
import { NodeHost } from "@x-json/core/node";
import { describe, expect, it } from "vitest";
import { errorCodes, warningCodes } from "./helpers";

const examplesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");
const host = new NodeHost();

function evalExample(relativePath: string): EvaluateResult {
  const path = resolve(examplesDir, relativePath);
  const source = readFileSync(path, "utf8");
  return evaluate(source, { uri: path, host });
}

describe("real example files", () => {
  it("base.xjson is valid JSON5", () => {
    const { value, diagnostics } = evalExample("base.xjson");
    expect(diagnostics).toHaveLength(0);
    expect((value as { name: string }).name).toBe("xJSON");
  });

  it("objects.xjson merges nested objects without errors", () => {
    const { value, diagnostics } = evalExample("objects.xjson");
    expect(errorCodes(diagnostics)).toHaveLength(0);
    const v = value as {
      user: { email: string; name: string; active?: unknown };
      server: { headers: { encoding: string } };
      features: { cache: { store: { evict: string } } };
    };
    expect(v.user.email).toBe("ada@x.io");
    expect(v.user.name).toBe("Ada Lovelace");
    expect(v.user.active).toBeUndefined();
    expect(v.server.headers.encoding).toBe("gzip");
    expect(v.features.cache.store.evict).toBe("lru");
  });

  it("arrays.xjson applies array operations", () => {
    const { value, diagnostics } = evalExample("arrays.xjson");
    expect(errorCodes(diagnostics)).toHaveLength(0);
    const v = value as { tags: string[]; plugins: string[] };
    expect(v.tags).toEqual(["core", "override", "schema", "v2", "extra"]);
    expect(v.plugins).toEqual(["fresh"]);
  });

  it("inherit-and-order.xjson evaluates without errors", () => {
    const { diagnostics } = evalExample("inherit-and-order.xjson");
    expect(errorCodes(diagnostics)).toHaveLength(0);
  });

  it("clear.xjson evaluates without errors", () => {
    const { value, diagnostics } = evalExample("clear.xjson");
    expect(errorCodes(diagnostics)).toHaveLength(0);
    expect((value as { user: object }).user).toEqual({ id: 99, name: "New" });
  });

  it("type-mismatch.xjson substitutes and warns", () => {
    const { value, diagnostics } = evalExample("type-mismatch.xjson");
    const v = value as { server: unknown; tags: unknown };
    expect(v.server).toBe(1234);
    expect(v.tags).toBe("now I'm a string");
    expect(warningCodes(diagnostics)).toContain("type-mismatch-override");
  });

  it("override-without-extends.xjson warns about the missing base", () => {
    const { diagnostics } = evalExample("override-without-extends.xjson");
    expect(warningCodes(diagnostics)).toContain("no-base-for-override");
  });

  it("diagnostics.xjson produces the expected diagnostics", () => {
    const { diagnostics } = evalExample("diagnostics.xjson");
    const all = diagnostics.map((d) => d.code);
    expect(all).toContain("clear-not-at-start");
    expect(all).toContain("duplicate-inherit");
    expect(all).toContain("unknown-key-reference");
    expect(all).toContain("delete-unknown-key");
  });

  it("resolves the extends chain base -> level1 -> level2", () => {
    const { value, diagnostics } = evalExample("extends-chain/level2.xjson");
    expect(errorCodes(diagnostics)).toHaveLength(0);
    const v = value as {
      version: string;
      stage: string;
      stage2: string;
      server: { port: number; tls: boolean; region: string };
      features: { cache: { enabled: boolean } };
      description?: unknown;
    };
    expect(v.version).toBe("1.2.0");
    expect(v.stage).toBe("level1");
    expect(v.stage2).toBe("level2");
    expect(v.server.port).toBe(9090);
    expect(v.server.tls).toBe(true);
    expect(v.server.region).toBe("eu-west");
    expect(v.features.cache.enabled).toBe(true);
    expect(v.description).toBeUndefined();
  });

  it("admin.schema.xjson extends user.schema.xjson", () => {
    const { value, diagnostics } = evalExample("schema/admin.schema.xjson");
    expect(errorCodes(diagnostics)).toHaveLength(0);
    const v = value as { title: string; required: string[]; properties: Record<string, unknown> };
    expect(v.title).toBe("Admin");
    expect(v.required).toContain("permissions");
    expect(v.properties.permissions).toBeDefined();
  });
});
