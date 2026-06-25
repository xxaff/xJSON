# XJSON examples

An `.xjson` file is **a single block**, just like JSON5. That block takes one of
three forms:

- **JSON5 data** (a base) — e.g. `base.xjson`;
- **`override extends "…" { }`** — extends another file (relative path or
  Node-style specifier, e.g. `@scope/pkg/file.xjson`);
- **`override { }`** — without `extends`; the base is injected via configuration.

These files are the **source of truth for the syntax**. Each one is commented
and demonstrates a set of cases.

| File | What it shows |
|---|---|
| [`base.xjson`](./base.xjson) | Base document in **pure JSON5** (an XJSON without `override` is valid JSON5). It is the base extended by the others. |
| [`objects.xjson`](./objects.xjson) | Object value operations: `prop: v` (create/replace), `add`, `override prop` (move), `override prop: {…}` (**merge**, nested, multi-level), `delete`. |
| [`arrays.xjson`](./arrays.xjson) | **Array** operations: `add`, `add(n)`, `delete(n)`, `clear`, value without keyword. Indices over mutating state. |
| [`inherit-and-order.xjson`](./inherit-and-order.xjson) | Key **order**: `inherit` and relative position `before`/`after` in all forms (move, add, extend subproperty). |
| [`clear.xjson`](./clear.xjson) | `clear` on an **object** and on an **array** (empty and rebuild). |
| [`type-mismatch.xjson`](./type-mismatch.xjson) | `override` with a **non-combinable type**: warning + substitution. |
| [`diagnostics.xjson`](./diagnostics.xjson) | Cases that **must produce diagnostics** (errors/warnings). File with problems on purpose. |
| [`override-without-extends.xjson`](./override-without-extends.xjson) | `override` block **without `extends`** (the base is injected via configuration). |
| [`extends-chain/level1.xjson`](./extends-chain/level1.xjson) · [`level2.xjson`](./extends-chain/level2.xjson) | **Inheritance chain**: `base → level1 → level2`. |
| [`schema/user.schema.xjson`](./schema/user.schema.xjson) | Standard **JSON Schema** written in XJSON. |
| [`schema/admin.schema.xjson`](./schema/admin.schema.xjson) | A schema that **extends** another via `extends`. |

## Syntax-layer conventions

- **Data** → JSON5 (commas between elements, trailing comma allowed).
- **Operations** (inside `override { }`) → each operation ends with `;`.
- **Relative position** → `before`/`after <key>` goes between the name and the
  optional `:value`: `<op> <prop> (before|after) <other> [: value]`.
- Mnemonic: **comma = data, `;` = operations**.
