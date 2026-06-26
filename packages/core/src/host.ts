/**
 * Host abstraction for resolving and reading `extends` targets. The core
 * evaluator is pure (no I/O); all file access goes through a host, so runtime
 * and editor share exactly the same behavior.
 */
export interface XJSONHost {
  /** Read a file's text by absolute path. Throws if it cannot be read. */
  readFile(absolutePath: string): string;
  /**
   * Resolve a specifier against the importing file and return an absolute,
   * canonical path. Supports relative paths (`./`, `../`) and Node-style
   * specifiers (`@scope/pkg/file.xjson`).
   */
  resolve(specifier: string, fromFile: string): string;
}

// --- POSIX-style path helpers (used by the in-memory host) ---------------

function normalizePosix(path: string): string {
  const isAbsolute = path.startsWith("/");
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      const top = out[out.length - 1];
      if (out.length > 0 && top !== "..") out.pop();
      else if (!isAbsolute) out.push("..");
    } else {
      out.push(part);
    }
  }
  return (isAbsolute ? "/" : "") + out.join("/");
}

function dirnamePosix(path: string): string {
  const i = path.lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return path.slice(0, i);
}

function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/** An in-memory host, ideal for tests and browser playgrounds. */
export class MemoryHost implements XJSONHost {
  private readonly files = new Map<string, string>();

  constructor(files?: Record<string, string>) {
    if (files) {
      for (const [path, content] of Object.entries(files)) {
        this.files.set(normalizePosix(path), content);
      }
    }
  }

  set(path: string, content: string): void {
    this.files.set(normalizePosix(path), content);
  }

  readFile(absolutePath: string): string {
    const content = this.files.get(normalizePosix(absolutePath));
    if (content === undefined) throw new Error(`File not found: ${absolutePath}`);
    return content;
  }

  resolve(specifier: string, fromFile: string): string {
    if (specifier.startsWith("/")) return normalizePosix(specifier);
    if (isRelative(specifier)) {
      return normalizePosix(`${dirnamePosix(fromFile)}/${specifier}`);
    }
    // Bare / @scope specifier: resolve against a virtual node_modules root.
    return normalizePosix(`/node_modules/${specifier}`);
  }
}
