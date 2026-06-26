import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const grammarDir = resolve(here, "../../packages/grammar");

// Copy the portable grammar + language configuration into the extension.
mkdirSync(resolve(here, "syntaxes"), { recursive: true });
cpSync(
  resolve(grammarDir, "syntaxes/xjson.tmLanguage.json"),
  resolve(here, "syntaxes/xjson.tmLanguage.json"),
);
cpSync(
  resolve(grammarDir, "language-configuration.json"),
  resolve(here, "language-configuration.json"),
);

await build({
  entryPoints: {
    extension: resolve(here, "src/extension.ts"),
    server: resolve(here, "../../packages/language-server/src/server.ts"),
  },
  outdir: resolve(here, "dist"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
  logLevel: "info",
});

console.log("Built extension + server bundles.");
