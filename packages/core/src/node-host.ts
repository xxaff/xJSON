import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import type { XJSONHost } from "./host";

/**
 * A host backed by the Node.js filesystem. Supports relative paths and a
 * basic Node-style resolution that walks up `node_modules`.
 *
 * Kept out of the browser-safe entry point so the core stays dependency-free.
 */
export class NodeHost implements XJSONHost {
  readFile(absolutePath: string): string {
    return readFileSync(absolutePath, "utf8");
  }

  resolve(specifier: string, fromFile: string): string {
    if (specifier.startsWith("./") || specifier.startsWith("../") || isAbsolute(specifier)) {
      return resolve(dirname(fromFile), specifier);
    }
    // Bare / @scope specifier: walk up node_modules from the importing file.
    let dir = dirname(fromFile);
    for (;;) {
      const candidate = resolve(dir, "node_modules", specifier);
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    // Fallback (will surface a clear read error if it does not exist).
    return resolve(dirname(fromFile), "node_modules", specifier);
  }
}
