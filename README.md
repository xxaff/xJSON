# xJSON

xJSON (`.xjson`) is a superset of JSON5 that adds an override system and
cross-file inheritance. A document is either plain JSON5 data or an `override`
block that layers changes onto a base — a base inherited from another file with
`extends`, or one provided by the host at runtime.

The repository is a TypeScript monorepo: a pure parser and evaluator, a JSON
Schema layer, a language server, a TextMate grammar, a command-line tool and a
VS Code extension.

## Format

A file is a single block. Without an `override` block it is ordinary JSON5:
line and block comments, quoted or unquoted keys, single or double quotes,
trailing commas, hexadecimal numbers, `Infinity`/`NaN`. Items are always
separated by commas; there is no `;`.

```xjson
// base.xjson
{
  name: "service",
  retries: 3,
  server: { host: "localhost", port: 8080 },
  tags: ["a", "b"],
}
```

An `override` block applies operations to a base. With `extends` the base is
another file, resolved relative to the current one or as a Node-style specifier
such as `@scope/pkg/file.xjson`:

```xjson
override extends "./base.xjson" {
  retries: 5,            // replace a value
  add timeout: 30,       // create a new key
  override server: {     // merge into an object (recurses)
    port: 9090,
    add tls: true,
  },
  override tags: [       // array operations, evaluated over the running state
    add "c",             // append
    add(0) "first",      // insert at index 0
    delete(1),           // remove the element now at index 1
  ],
  delete name,           // remove a key
}
```

### Object operations

| Operation | Effect |
|---|---|
| `prop: v` | create or replace, positioned here |
| `add prop [before/after K]: v` | same, with an explicit relative position |
| `override prop [before/after K]` | reposition the key without changing its value |
| `override prop [before/after K]: v` | merge the value, recursing into objects and arrays |
| `delete prop` | remove the property |
| `clear` | start from an empty object; only valid as the first operation |
| `inherit` | where the remaining inherited keys go; defaults to the start |

`override` means merge. Without it, a `{ }` or `[ ]` value is a JSON5 literal
that replaces. Merging a non-combinable type (for example a number over an
object) substitutes the value and emits a warning.

### Arrays

Inside `override key: [ ... ]`: `add v` or a bare `v` appends, `add(n) v`
inserts at an index, `delete(n)` removes an index, and `clear` empties the array
(first operation only). Indices are evaluated against the running state, so each
operation sees the array as the previous ones left it.

### Ordering

Key order is significant. Every operation that names a key positions it in the
order it appears; `inherit` marks where the untouched inherited keys are placed
(by default, at the start). Relative position is by key name, and the
`before`/`after` clause goes between the name and the `:value`.

```xjson
override extends "./base.xjson" {
  override server,     // positioned first
  inherit,             // the untouched keys follow here
  add audit: true,     // and the new key last
}
```

### Schemas

A schema is a JSON Schema (draft 2020-12) written in xJSON, and it can `extends`
another schema. An instance is bound to a schema by a top-level `$schema` key or
by an editor file association:

```xjson
{ $schema: "./user.schema.xjson", id: 1, name: "Ada", role: "admin" }
```

## Packages

| Package | Description |
|---|---|
| `@xjson/core` | Parser, evaluator (overrides, merge, `extends`, cycle detection) and diagnostics. Pure: file access is injected through a host. |
| `@xjson/schema` | JSON Schema written in xJSON, validated with AJV. |
| `@xjson/language-server` | Language server over core and schema. |
| `@xjson/grammar` | TextMate grammar and language configuration, portable to other editors. |
| `@xjson/cli` | `eval`, `validate` and `check` commands. |
| `xjson-vscode` | VS Code extension: grammar plus a language-server client. |

## Library

```ts
import { evaluate } from "@xjson/core";
import { NodeHost } from "@xjson/core/node";

const { value, diagnostics } = evaluate(source, { uri: path, host: new NodeHost() });
```

`evaluate` returns the plain JSON value and a list of diagnostics; it does not
throw by default (pass `strict: true` to throw on errors). Diagnostics are
classified by design: structural problems that do not depend on the data —
syntax, a misplaced `clear`, a duplicate `inherit`, an `extends` cycle — are
errors; data-dependent ones — a non-combinable merge, a missing `before`/`after`
target — are warnings. Each code's severity is configurable.

`extends` chains are resolved with a stack, so any cycle, whether direct
(`A -> A`), mutual (`A -> B -> A`) or deep in the chain (`A -> B -> C -> D -> B`),
is reported and evaluation still terminates. File resolution goes through the
host (`MemoryHost` for in-memory use and tests, `NodeHost` for the filesystem),
so the runtime and the editor behave identically.

## Command line

```
xjson eval <file> [--compact]     evaluate a document and print JSON
xjson validate <file>             report diagnostics; non-zero exit on errors
xjson check <file> --schema <s>   validate an instance against a schema
```

## Editor support

The VS Code extension provides syntax highlighting and semantic tokens,
diagnostics, hover (keyword help, the resolved `extends` path, a key's evaluated
value), go-to-definition that jumps to the base property and follows the
`extends` chain, document links, find references, document highlights, rename,
code actions, context-aware completion (schema properties, inherited keys,
keywords), document and workspace symbols, folding, selection ranges, code
lenses, formatting, and a live preview of the evaluated JSON. Schemas are
validated from a `$schema` key or from `xjson.schemas` file associations
configured by glob. The features live in the language server, so the same server
runs in any LSP client, including Monaco.

## Development

```
pnpm install
pnpm check          # lint, type-check and tests
pnpm build:vscode   # bundle the extension
```

Tooling: pnpm workspaces, TypeScript in strict mode, vitest and biome. The
commented files under `examples/` are the reference for the syntax.

## Publishing

Each library builds to `dist` (ESM, CJS and type declarations) on pack, while the
working tree keeps importing the TypeScript sources directly.

```
pnpm release                              # build and publish every package to npm
pnpm --filter xjson-vscode run package    # build the extension as a .vsix
pnpm --filter xjson-vscode run publish    # publish the extension to the Marketplace
```

Publishing the packages needs an account with access to the `@xjson` scope
(`npm login`); the Marketplace needs a registered publisher and a personal access
token (`vsce login <publisher>`).

## License

MIT
