---
sidebar_position: 1
---

# Architecture Overview

AgentScript is a language toolchain for building AI agents, providing parsing, validation, and editor support through a modular package architecture.

## Tree-sitter Parser

The parser is defined as a Tree-sitter grammar in `packages/parser-tree-sitter/grammar.js`. It builds to both native Node.js bindings and WASM for browser use, enabling the same grammar to power CLI tools and web-based editors.

An external scanner (`packages/parser-tree-sitter/src/scanner.c`) handles indentation-sensitive tokens:

- `_indent`, `_dedent`, `_newline` -- whitespace-significant block structure
- `template_content` and `_template_end` -- template literal parsing
- `comment` -- marked as an external token so the scanner is always invoked, enabling better error recovery by emitting dedent tokens whenever a dedent occurs, even if none is expected
- `error_sentinel` -- error recovery support

Tree-sitter provides incremental parsing: only changed regions of the source are re-parsed, which keeps editor responsiveness high during continuous typing.

## Monorepo Structure

The repository uses pnpm workspaces with Turborepo for build orchestration. Turborepo handles the dependency graph between packages, enabling parallel execution and incremental builds.

```
packages/
  parser-tree-sitter @agentscript/parser-tree-sitter Tree-sitter grammar and parser
  language          @agentscript/language         Language infrastructure and analysis
  compiler          @agentscript/compiler         AST to a Salesforce runtime specification compiler
  lsp               @agentscript/lsp              Language Server Protocol core
  lsp-server        @agentscript/lsp-server       LSP Node.js transport
  lsp-browser       @agentscript/lsp-browser      LSP browser transport
  monaco            @agentscript/monaco           Monaco editor integration
  vscode            @agentscript/vscode           VS Code extension
  cli               @agentscript/cli              Command-line interface
  agentforce        @agentscript/agentforce       Agentforce utilities
  salesforce        @agentscript/salesforce       Salesforce integration
  test-scripts      @agentscript/test-scripts     Test utilities and example scripts

dialect/
  agentscript       @agentscript/agentscript-dialect   Base dialect
  agentforce        @agentscript/agentforce-dialect     Agentforce dialect

apps/
  docs              @agentscript/docs             Documentation site (Docusaurus)
  ui                @agentscript/ui               Web editor and visualizer
```

## Dialect System

A dialect defines the schema and validation rules for a particular flavor of AgentScript. The `DialectConfig` interface (from `@agentscript/language`) specifies:

- `name`, `displayName`, `description`, `version` -- identity and metadata
- `schemaInfo` -- schema metadata containing the root schema definition, aliases, and global scopes
- `createRules()` -- factory returning `LintPass[]` for validation (fresh instances per analysis run)
- Optional `source` tag for diagnostics (defaults to `${name}-lint`)

The Agentforce dialect extends AgentScript with additional blocks and validation rules, registering its own `createRules()` that includes AgentScript's base passes plus Agentforce-specific checks.

## Validation Pipeline

Validation uses a multi-phase lint engine, not a visitor/decorator pattern. The `LintEngine` executes all passes in four phases:

1. **Phase 1 -- `init()`**: Initialize all passes.
2. **Phase 2 -- AST walk**: A single recursive walk dispatches visitor hooks (`enterNode`, `exitNode`, `visitVariables`, `visitExpression`) to all active passes simultaneously.
3. **Phase 3 -- `finalize()`**: Data-extraction passes run in topological order determined by `finalizeAfter` dependencies (sorted via Kahn's algorithm). Passes store extracted data (symbol tables, type maps) in a shared `PassStore`.
4. **Phase 4 -- `run()`**: Validation passes execute, gated by `requires` -- if a required `StoreKey` is missing from the `PassStore`, the pass is skipped rather than failing.

The `PassStore` enables typed data sharing between passes using `StoreKey<T>` branded strings. Each key can only be set once.

The AgentScript dialect registers 15 built-in lint passes covering symbol analysis, type checking, duplicate detection, constraint validation, and more.

### Dialect Annotation and Resolution

Files can declare their dialect using an annotation comment in the first few lines:

```agentscript
# @dialect: agentforce=2.2
```

The `resolveDialect()` function handles automatic dialect selection:
1. Parses the `# @dialect: NAME=VERSION` annotation from source
2. Matches against registered dialect configurations
3. Validates version constraints (MAJOR or MAJOR.MINOR format)
4. Returns the resolved `DialectConfig` with any version diagnostics

When no annotation is present, the default dialect is used (typically configured via editor settings or CLI flags).

## IDE Integration

The `LanguageService` (from `@agentscript/language`) is the stateful API for editors. It caches parse and lint results between updates and exposes:

- Diagnostics (parse errors + lint results)
- Document symbols
- Go-to-definition and find-references
- Completions (namespace, field, and general)
- Enclosing scope queries

The LSP packages (`@agentscript/lsp`, `@agentscript/lsp-server`, `@agentscript/lsp-browser`) wrap the `LanguageService` for editor consumption via the Language Server Protocol. LSP providers include completions, hover, semantic tokens, references, rename, and code actions.

The Monaco package (`@agentscript/monaco`) provides syntax highlighting and diagnostic markers for the browser-based editor. The VS Code extension (`@agentscript/vscode`) provides full language support in VS Code.
