# Getting started

## Install

```sh
pnpm add @xjson/core
```

## Evaluate a document

```ts
import { evaluate } from "@xjson/core";
import { NodeHost } from "@xjson/core/node";
import { readFileSync } from "node:fs";

const path = "/abs/path/to/config.xjson";
const source = readFileSync(path, "utf8");

const { value, diagnostics } = evaluate(source, {
  uri: path,
  host: new NodeHost(), // needed only when the document uses `extends`
});

console.log(value);
for (const d of diagnostics) {
  console.log(`${d.severity} [${d.code}] ${d.message}`);
}
```

- `value` is a plain JSON value (object/array/scalar).
- `diagnostics` is never thrown by default; pass `{ strict: true }` to make
  evaluation throw an `XJSONError` when there are error-severity diagnostics.

## Diagnostics model

- **Structural** problems (independent of the data) default to `error`
  — e.g. invalid syntax, `clear` not at the start of a block, duplicate `inherit`,
  an `extends` cycle.
- **Data-dependent** problems (the base may vary, especially with `extends`)
  default to `warning` — e.g. merging a non-combinable type, a `before`/`after`
  reference that does not exist.

Every code's severity can be overridden via the `severity` option
(`"off"` to silence it).
