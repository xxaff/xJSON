# Core API (`@x-json/core`)

## `evaluate(source, options?)`

Parse and evaluate a document into a plain JSON value.

```ts
function evaluate(source: string, options?: EvaluateOptions): {
  value: JsonValue;
  diagnostics: Diagnostic[];
};

interface EvaluateOptions {
  uri?: string;        // path/URI of the source (relative resolution + diagnostics)
  host?: XJSONHost;    // resolves and reads `extends` targets
  base?: JsonValue;    // base injected for an `override` with no `extends`
  severity?: Partial<Record<DiagnosticCode, "error" | "warning" | "off">>;
  strict?: boolean;    // throw XJSONError if any error-severity diagnostic
}
```

## `parse(source, options?)`

Lex and parse without evaluating; returns `{ document, comments, diagnostics }`.

## Hosts

```ts
interface XJSONHost {
  readFile(absolutePath: string): string;
  resolve(specifier: string, fromFile: string): string;
}
```

- `MemoryHost` (from `@x-json/core`) — in-memory, ideal for tests and browsers.
- `NodeHost` (from `@x-json/core/node`) — backed by the filesystem, with relative
  and `node_modules` resolution.

## Cycle safety

`extends` chains are resolved with a resolution stack, so any cyclic dependency —
direct (`A → A`), mutual (`A → B → A`) or deep mid-chain (`A → B → C → D → B`) —
is reported as an `extends-cycle` error and evaluation still terminates.
