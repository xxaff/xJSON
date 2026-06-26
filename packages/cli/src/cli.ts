#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NodeHost } from "@x-json/core/node";
import { type CliEnv, run } from "./index";

function defaultEnv(): CliEnv {
  return {
    host: new NodeHost(),
    readFile: (path) => readFileSync(path, "utf8"),
    resolve: (path) => resolve(process.cwd(), path),
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  };
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  process.exit(run(process.argv.slice(2), defaultEnv()));
}
