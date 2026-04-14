# @agentscript/lsp-server

Node.js LSP server for AgentScript. Thin wrapper over `@agentscript/lsp` that provides the native tree-sitter parser and dialect registry.

## How It Works

This package creates a Node.js LSP connection and calls `setupServer()` from `@agentscript/lsp` with:

- **Native tree-sitter parser** — uses `@agentscript/parser-tree-sitter` for fast, native parsing
- **Query executor** — tree-sitter query API for semantic token highlighting
- **Dialect registry** — ships with `agentforce` and `agentscript` dialects

All LSP features (diagnostics, hover, completion, go-to-definition, references, rename, symbols, code actions, semantic tokens) are provided by `@agentscript/lsp` — this package only wires up the Node.js-specific bindings.

See [`@agentscript/lsp` README](../lsp/README.md) for the full architecture and feature list.

## Installation

```bash
pnpm add @agentscript/lsp-server
```

## Usage

### As a CLI

The package provides an `agentscript-lsp` binary that auto-detects IPC or stdio transport:

```bash
agentscript-lsp --stdio
```

### As a library

```typescript
import '@agentscript/lsp-server';
// The module self-starts: creates a connection, configures the parser, and listens.
```

### From VS Code

The `@agentscript/vscode` extension bundles this server and launches it via IPC — no manual setup needed.

## Adding a Dialect

Register your dialect in `packages/lsp/src/dialect-registry.ts` (the shared registry in `@agentscript/lsp`):

```typescript
import { mydialect } from '@agentscript/mydialect-dialect';

export const defaultDialects: DialectConfig[] = [
  agentforceDialect,
  agentscriptDialect,
  mydialect, // add here
];
```

See the [Adding a New Dialect](../lsp/README.md#adding-a-new-dialect) guide for full instructions.

## Development

```bash
pnpm build     # Build
pnpm dev       # Watch mode
pnpm typecheck # Type-check
```

## License

MIT
