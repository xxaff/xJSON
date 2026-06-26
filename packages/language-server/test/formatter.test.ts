import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate } from "@x-json/core";
import { NodeHost } from "@x-json/core/node";
import { format } from "@x-json/language-server";
import { describe, expect, it } from "vitest";

const examplesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../examples");
const host = new NodeHost();

const exampleFiles = [
  "base.xjson",
  "objects.xjson",
  "arrays.xjson",
  "inherit-and-order.xjson",
  "clear.xjson",
  "type-mismatch.xjson",
  "override-without-extends.xjson",
  "diagnostics.xjson",
  "extends-chain/level1.xjson",
  "extends-chain/level2.xjson",
  "schema/user.schema.xjson",
  "schema/admin.schema.xjson",
];

describe("formatter", () => {
  it("reflows a compact document with indentation", () => {
    const out = format("override{add x:1,add y:2}");
    expect(out).toContain("\n");
    expect(out).toContain("  add x: 1");
    expect(format(out)).toBe(out); // idempotent
  });

  it.each(exampleFiles)("is idempotent and semantics-preserving for %s", (relativePath) => {
    const path = resolve(examplesDir, relativePath);
    const source = readFileSync(path, "utf8");
    const formatted = format(source);

    // Idempotent
    expect(format(formatted)).toBe(formatted);

    // Semantics preserved
    const before = evaluate(source, { uri: path, host });
    const after = evaluate(formatted, { uri: path, host });
    expect(after.value).toEqual(before.value);
    expect(after.diagnostics.map((d) => d.code).sort()).toEqual(
      before.diagnostics.map((d) => d.code).sort(),
    );
  });
});
