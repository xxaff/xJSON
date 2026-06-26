# XJSON for VS Code

Language support for the **XJSON** format (`.xjson`) — a superset of JSON5 with
an override system and cross-file inheritance.

## Features

- Syntax highlighting and semantic tokens
- Diagnostics (errors and warnings), including schema validation
- Hover, go-to-definition (jumps to the base property, following `extends`)
- Find references, document highlights, rename
- Completion: schema properties, inherited keys and keywords
- Document and workspace symbols, folding, selection ranges
- Code actions, document links, code lenses, formatting
- A live preview of the evaluated JSON

Schemas are bound through a top-level `$schema` key or via `xjson.schemas` file
associations in your settings.
