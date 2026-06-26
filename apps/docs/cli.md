# Command line (`@x-json/cli`)

```
xjson eval <file> [--compact]      Evaluate a document and print the JSON result
xjson validate <file>              Report diagnostics; exit non-zero on errors
xjson check <file> --schema <s>    Validate an instance against an XJSON schema
xjson help                         Show help
```

## Examples

```sh
# Evaluate (resolves extends) and pretty-print the JSON
xjson eval config.xjson

# Minified output
xjson eval config.xjson --compact

# Lint a document; exit code 1 if there are errors
xjson validate config.xjson

# Validate an instance against a schema written in XJSON
xjson check user.xjson --schema user.schema.xjson
```

Diagnostics are written to standard error as
`file:line:column severity [code] message`; the evaluated value (or validation
result) goes to standard output.
