# @agentscript/lsp-browser

Browser LSP server for AgentScript. Runs in a web worker with the TypeScript parser — the browser counterpart to `@agentscript/lsp-server`.

## How It Works

This package creates a browser LSP connection (via `BrowserMessageReader`/`BrowserMessageWriter`) and calls `setupServer()` from `@agentscript/lsp` with:

- **TypeScript parser (default)** — pure JS, no WASM initialization required
- **Tree-sitter parser (optional)** — when built with `pnpm build:tree-sitter`, `init()` loads WASM binaries in the `onBeforeInitialize` hook before the first parse
- **Query executor** — CST-walk highlighter for semantic token highlighting
- **Dialect registry** — ships with `agentforce` and `agentscript` dialects
- **Deferred initialization** — parser is loaded inside the `onBeforeInitialize` hook, so the connection is set up synchronously before any client messages arrive

All LSP features (diagnostics, hover, completion, go-to-definition, references, rename, symbols, code actions, semantic tokens) are provided by `@agentscript/lsp` — this package only wires up the browser-specific bindings.

See [`@agentscript/lsp` README](../lsp/README.md) for the full architecture and feature list.

## Installation

```bash
pnpm add @agentscript/lsp-browser
```

## Usage

Import this module from a web worker. The module self-starts: it creates a connection on the worker's message port, initializes the parser on first client handshake, and begins listening.

```typescript
// worker.ts
import '@agentscript/lsp-browser';
```

Then, from your main thread (e.g., a Monaco editor integration):

```typescript
const worker = new Worker(new URL('./worker.ts', import.meta.url), {
  type: 'module',
});
// Connect the worker to your LSP client (e.g., monaco-languageclient)
```

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
pnpm build     # Build (ESM + browser bundle + declarations)
pnpm dev       # Watch mode
pnpm typecheck # Type-check
```

## License

MIT
