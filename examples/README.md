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
| [`schema/admin.xjson`](./schema/admin.xjson) · [`admin.invalid.xjson`](./schema/admin.invalid.xjson) | **Instances** validated against a schema via `$schema` (a valid one and an invalid one). |

## Validating data against a schema

An instance document associates itself with a schema through a top-level
`$schema` key pointing to a `.xjson` schema (relative or Node-style path):

```
{ $schema: "./admin.schema.xjson", id: 1, name: "Grace", role: "admin", permissions: ["read"] }
```

The editor compiles the schema (resolving its `extends` chain) and validates the
document live — open `admin.invalid.xjson` to see the violations reported. The
`$schema` key itself is ignored during validation.

## Syntax-layer conventions

- XJSON is a **superset of JSON5**: items are separated by **commas** in both
  data and operation blocks, and a **trailing comma** is allowed. There is no
  `;` separator.
- `override` switches a block into **operation mode** (merge); without it, a
  `{ }` / `[ ]` body is a plain JSON5 **literal** (replace).
- **Relative position**: `before`/`after <key>` goes between the name and the
  optional `:value`: `<op> <prop> (before|after) <other> [: value]`.
