---
sidebar_position: 2
---

# Parsing Pipeline

AgentScript processes source files through three stages: parsing (CST), dialect parsing (AST), and lint validation. The `parseAndLint` function combines all three into a single call.

## Stage 1: Parse (CST)

**Input**: `.agent` file source text

Two parser backends are available behind the unified `@agentscript/parser` entry point:

- **parser-javascript** (default): Hand-written TypeScript parser. Pure JS, zero native dependencies, works in Node.js and browser. Re-parses from scratch on each edit.
- **tree-sitter** (optional): Native C parser with WASM browser support. Enable via the `tree-sitter` exports condition (see [Parser Backends](./parser-backends.md)). Provides incremental re-parsing, so only changed regions are processed on each edit.

Both backends produce nodes conforming to the `SyntaxNode` interface from `@agentscript/types`.

Key CST node types produced by the grammar:

- `source_file` -- root node
- `mapping` -- a block of key-value pairs
- `mapping_element` -- a single key-value entry with optional `colinear_value` (inline) and/or `block_value` (indented)
- `key` -- the left-hand side of a mapping element
- `colinear_value` -- value on the same line as the key (string, number, boolean, identifier, template, expression)
- `block_value` -- indented value below the key (mapping, sequence, atom, or empty keyword)
- `sequence` -- a list of items
- `template` -- template literal content
- `procedure` -- a block of statements introduced by `->`
- `expression` -- inline expressions

See [Parser Backends](./parser-backends.md) for details on choosing and configuring a backend.

## Stage 2: Dialect Parse (AST)

**Input**: CST root node + schema definition

The `Dialect.parse(cstNode, schema)` method walks the CST and builds a typed AST. The schema defines the expected block structure: what fields each block has, their types, and their constraints.

Each schema field type knows how to parse its corresponding CST nodes:

- `StringValue` -- scalar string fields
- `BooleanValue` -- boolean fields
- `ProcedureValue` -- procedure (statement list) fields
- `ExpressionValue` -- expression fields
- `Block` -- nested anonymous block fields
- `NamedBlock` -- named block fields (key becomes the name)
- `CollectionBlock` -- collection of named blocks

**Output**: A `ParseResult` containing:
- `value` -- the typed AST root (`AstRoot`)
- `diagnostics` -- parse-level diagnostics (syntax errors, unknown fields)

ERROR nodes in Tree-sitter's CST are handled gracefully. Rather than discarding them, the dialect parser recurses into their children, since Tree-sitter's error recovery maintains valid structure inside ERROR wrappers.

## Stage 3: Lint Engine (Validation)

**Input**: AST root + schema context

`LintEngine.run(root, schemaContext)` executes all registered passes in four phases:

1. **Init** -- each pass initializes its internal state
2. **Walk** -- a single recursive AST traversal dispatches `enterNode`, `exitNode`, `visitVariables`, and `visitExpression` hooks to all active passes
3. **Finalize** -- passes store extracted data (symbol table, type map, position index) into the `PassStore`, topologically sorted by `finalizeAfter` dependencies
4. **Run** -- validation passes execute, gated by `requires` keys in the `PassStore`

**Output**: `{ diagnostics, store }` where diagnostics are attached to AST nodes and the store contains extracted analysis data.

## Full Pipeline

The `parseAndLint` function (from `@agentscript/language`) combines all stages:

```
Source text
    |
    v
[Parse (CST)] --> CST (SyntaxNode)
    |
    v
[Dialect.parse(cst, schema)] --> AST (AstRoot) + parse diagnostics
    |
    v
[LintEngine.run(ast, schemaContext)] --> validation diagnostics + PassStore
    |
    v
Merged diagnostics + typed AST + store
```

The function accepts a CST `SyntaxNode` (not raw source text) and a `DialectConfig`. It creates a `SchemaContext` from the dialect's `schemaInfo`, runs the dialect parser, then runs the lint engine with the dialect's `createRules()` passes. Parse diagnostics and lint diagnostics are deduplicated and merged in the result.

The stateless `parseAndLint` is used by CLI and CI tooling. For editor use, the `LanguageService` wraps the same pipeline with caching and incremental updates.
