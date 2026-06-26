# XJSON documentation

**XJSON** (`.xjson`) is a superset of **JSON5** that adds an *override* system and
*cross-file inheritance*, designed for layered configuration.

- [Getting started](./getting-started.md)
- [Syntax](./syntax.md)
- [Core API](./api.md)
- [Command line](./cli.md)

## Packages

| Package | Description |
|---|---|
| `@xjson/core` | Parser, evaluator and diagnostics. Pure, no I/O (file access via a host). |
| `@xjson/schema` | JSON Schema written in XJSON, validated with AJV. |
| `@xjson/language-server` | Language Server (LSP): diagnostics, go-to-definition, completion. |
| `@xjson/grammar` | TextMate grammar + language configuration (portable). |
| `@xjson/cli` | `eval` / `validate` / `check` commands. |
| `xjson-vscode` | VS Code extension (highlighting + LSP client). |

## At a glance

```
// config.xjson
override extends "./base.xjson" {
  version: "2.0.0",
  override server: {
    port: 9090,
    add tls: true,
  },
}
```

Evaluating `config.xjson` flattens the `extends` chain and applies the operations,
producing a plain JSON value. See [Syntax](./syntax.md) for the full feature set.
