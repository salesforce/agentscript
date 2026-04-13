---
sidebar_position: 4
---

# Tooling

This page covers the tooling packages that provide parsing, editor integration, and compilation for AgentScript.

## Parser

**Package**: `@agentscript/parser-tree-sitter` (`packages/parser-tree-sitter`)

Tree-sitter grammar for AgentScript defined in `grammar.js`. An external scanner (`scanner.c`) handles indentation-sensitive constructs, templates, and comments.

Highlight queries are exported for syntax highlighting in editors.

After making any changes to the parser:

```bash
cd packages/parser-tree-sitter && pnpm run build
```

This regenerates the parser from the grammar and builds the native Node.js bindings.

## LSP Core

**Package**: `@agentscript/lsp` (`packages/lsp`)

Dialect-agnostic Language Server Protocol implementation. Provides:

- Completions
- Hover
- Diagnostics
- Semantic tokens
- References
- Rename
- Code actions
- Document symbols

The LSP core is consumed by the transport packages below, which handle communication with specific editor environments.

## LSP Server

**Package**: `@agentscript/lsp-server` (`packages/lsp-server`)

Node.js transport layer for desktop editors such as VS Code. Connects the LSP core to a stdio or socket-based transport.

## LSP Browser

**Package**: `@agentscript/lsp-browser` (`packages/lsp-browser`)

Browser transport layer for web-based editors. Connects the LSP core to a web worker or message-port-based transport.

## Monaco

**Package**: `@agentscript/monaco` (`packages/monaco`)

Monaco editor integration for web applications. Key exports:

- `buildMonacoRules()` -- Generates TextMate-style tokenization rules from highlight queries.
- `createDiagnosticMarkers()` -- Converts AgentScript diagnostics to Monaco editor markers.
- `createHoverProvider()` -- Provides hover information from the language service.
- `WorkerParserManager` -- Manages the parser running in a web worker for non-blocking parsing.

Additional Monaco features:

- **Worker-based parsing**: The parser runs in a Web Worker via `WorkerParserManager` for crash isolation — if the parser crashes, it can be recovered without reloading the page
- **Theme customization**: Built-in dark and light theme color definitions (`darkThemeColors`, `lightThemeColors`). Generate editor rules with `buildMonacoRules()` or VS Code rules with `buildVscodeRules()`
- **Parser control**: `disableParser()` and `enableParser()` to toggle parsing. `clearCrashCache()` to reset crash recovery state

## VS Code Extension

**Package**: `@agentscript/vscode` (`packages/vscode`)

Full VS Code language support for `.agent` files. Uses the LSP server package for language features including completions, diagnostics, hover, go-to-definition, references, and rename.

## CLI

**Package**: `@agentscript/cli` (`packages/cli`)

Command-line interface for parsing and validating `.agent` files. Useful for CI pipelines and scripting.

## Compiler

**Package**: `@agentscript/compiler` (`packages/compiler`)

Transforms a parsed AST into Salesforce runtime specification.

Key capabilities:

- **Reference validation** -- Verifies that all references in the AST resolve to defined symbols.
- **Configuration compilation** -- Compiles system, config, and language blocks into the Salesforce runtime specification structure.
- **Variable compilation** -- Processes variable definitions and their types.
- **Source maps** -- Generates source maps linking runtime specification output back to `.agent` source positions for debugging.
- **Schema validation** -- Uses Zod to validate the generated Salesforce runtime specification against the output schema.

Additional compiler details:

- **Output format**: Produces a Salesforce runtime specification with `schema_version`, `global_configuration`, and `agent_version` sections
- **Source maps**: `SourceAnnotations` tracks source-to-generated position mappings for debugging and error reporting
- **Schema validation**: Output is validated against a Zod schema to ensure correctness
