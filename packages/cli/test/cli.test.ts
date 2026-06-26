import { type CliEnv, run } from "@x-json/cli";
import { MemoryHost } from "@x-json/core";
import { describe, expect, it } from "vitest";

function makeEnv(files: Record<string, string>) {
  const host = new MemoryHost(files);
  const out: string[] = [];
  const err: string[] = [];
  const env: CliEnv = {
    host,
    readFile: (path) => host.readFile(path),
    resolve: (path) => path,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  };
  return { env, stdout: () => out.join(""), stderr: () => err.join("") };
}

describe("xjson CLI", () => {
  it("eval prints the JSON result", () => {
    const { env, stdout } = makeEnv({ "/a.xjson": "{ a: 1, b: 2 }" });
    expect(run(["eval", "/a.xjson"], env)).toBe(0);
    expect(JSON.parse(stdout())).toEqual({ a: 1, b: 2 });
  });

  it("eval resolves extends", () => {
    const { env, stdout } = makeEnv({
      "/base.xjson": "{ a: 1 }",
      "/c.xjson": 'override extends "./base.xjson" { add b: 2 }',
    });
    run(["eval", "/c.xjson"], env);
    expect(JSON.parse(stdout())).toEqual({ a: 1, b: 2 });
  });

  it("validate returns 0 for a clean document", () => {
    const { env } = makeEnv({ "/a.xjson": "{ a: 1 }" });
    expect(run(["validate", "/a.xjson"], env)).toBe(0);
  });

  it("validate returns 1 and reports errors", () => {
    const { env, stderr } = makeEnv({ "/a.xjson": "override { inherit, inherit }" });
    expect(run(["validate", "/a.xjson"], env)).toBe(1);
    expect(stderr()).toContain("duplicate-inherit");
  });

  it("check validates an instance against a schema", () => {
    const files = {
      "/schema.xjson":
        "{ type: 'object', required: ['id'], properties: { id: { type: 'integer' } }, additionalProperties: false }",
      "/ok.xjson": "{ id: 1 }",
      "/bad.xjson": "{ name: 'x' }",
    };
    expect(run(["check", "/ok.xjson", "--schema", "/schema.xjson"], makeEnv(files).env)).toBe(0);
    expect(run(["check", "/bad.xjson", "--schema", "/schema.xjson"], makeEnv(files).env)).toBe(1);
  });

  it("prints help and returns 0 with no command", () => {
    const { env, stdout } = makeEnv({});
    expect(run([], env)).toBe(0);
    expect(stdout()).toContain("Usage:");
  });

  it("returns a non-zero exit code for an unknown command", () => {
    expect(run(["frobnicate"], makeEnv({}).env)).toBe(2);
  });
});
