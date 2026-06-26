# Syntax

An `.xjson` file is **a single block**, just like JSON5. That block is one of:

- **JSON5 data** — a base document (any valid JSON5);
- **`override extends "…" { }`** — extends another file (relative path or
  Node-style specifier, e.g. `@scope/pkg/file.xjson`);
- **`override { }`** — without `extends`; the base is injected by configuration.

Items are separated by **commas** in both data and operation blocks (trailing
comma allowed). There is no `;` separator.

The fully-commented, executable reference for every feature lives in the
[`examples/`](../../examples) directory:

| Feature | Example |
|---|---|
| JSON5 data layer | `examples/base.xjson` |
| Object operations (`set` / `add` / `override` / `delete`) | `examples/objects.xjson` |
| Array operations (`add` / `add(n)` / `delete(n)` / `clear`) | `examples/arrays.xjson` |
| Ordering (`inherit`, `before` / `after`) | `examples/inherit-and-order.xjson` |
| `clear` | `examples/clear.xjson` |
| Non-combinable type | `examples/type-mismatch.xjson` |
| Cross-file inheritance | `examples/extends-chain/` |
| Override without `extends` | `examples/override-without-extends.xjson` |
| Schema written in XJSON | `examples/schema/` |

## Operation cheatsheet

Inside an `override` block, on objects:

| Operation | Effect |
|---|---|
| `prop: v` | create or replace (upsert), positioned here |
| `add prop [before/after X]: v` | same, but explicit and supports relative position |
| `override prop [before/after X]` | reposition without changing the value |
| `override prop [before/after X]: v` | merge the value, positioned here |
| `delete prop` | remove the property |
| `clear` *(first only)* | start from an empty object |
| `inherit` | where the remaining inherited keys go (default: at the start) |

On arrays: `add v`, `add(n) v`, a bare `v` (append), `delete(n)`, and `clear`
(first only). Indices are evaluated over the **mutating state**.

`override` means **merge**; without it, a `{ }` / `[ ]` body is a plain JSON5
literal (replace).
