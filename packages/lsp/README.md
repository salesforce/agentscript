# @agentscript/lsp

Dialect-agnostic LSP core for AgentScript. Provides all LSP features — dialects and parser are injected by the caller.

## Architecture

Follows the [Volar](https://github.com/volarjs/volar.js) dependency-injection pattern: this package contains no dialect or parser code. Instead, the caller (e.g., `@agentscript/lsp-server` or `@agentscript/lsp-browser`) passes them via `LspConfig`.

```
┌───────────────────────────────────────────┐
│  @agentscript/lsp  (core, dialect-agnostic) │
│  setupServer(connection, config)           │
│  Providers · Pipeline · Document Store     │
└────────────────────┬──────────────────────┘
                     │  LspConfig { dialects, parser }
        ┌────────────┴────────────┐
        ▼                         ▼
┌────────────────┐       ┌─────────────────┐
│  lsp-server    │       │  lsp-browser    │
│  (Node.js)     │       │  (Web Worker)   │
│  native parser │       │  WASM parser    │
│  owns dialects │       │  owns dialects  │
└────────────────┘       └─────────────────┘
```

## Features

All providers are fully implemented:

- **Diagnostics** — parse, lint, and compile errors
- **Hover** — type and documentation info
- **Completion** — field and namespace completions
- **Go to Definition**
- **Find References**
- **Rename**
- **Document Symbols / Workspace Symbols**
- **Code Actions** — quick fixes with suggestions
- **Semantic Tokens** — tree-sitter query-based highlighting

## Installation

```bash
pnpm add @agentscript/lsp
```

You typically won't use this package directly — use `@agentscript/lsp-server` (Node.js) or `@agentscript/lsp-browser` (web worker) instead.

## LspConfig

The `setupServer` function accepts a connection and an `LspConfig`:

```typescript
import { setupServer } from '@agentscript/lsp';

setupServer(connection, {
  // Required
  dialects: [myDialect, anotherDialect],
  parser: { parse: (source) => treeSitterParser.parse(source) },

  // Optional
  defaultDialect: 'mydialect',         // Falls back to first dialect
  queryExecutor: { ... },               // For semantic token highlights
  compile: (name) => compileHookOrUndefined,
  enableCompletionProvider: true,       // Default: true
  enableSemanticTokens: true,           // Default: true
  onBeforeInitialize: async () => {},   // e.g., WASM parser init
});
```

## Dialect Annotation

Documents can declare their dialect with a comment in the first 10 lines:

```
# @dialect: agentforce=2.2
```

The LSP resolves the dialect by matching the annotation name against the `dialects` array. If no annotation is found, `defaultDialect` (or the first dialect) is used.

## Adding a New Dialect

### 1. Create the dialect package

Create a new package under `dialect/` (e.g., `dialect/mydialect/`):

```
dialect/mydialect/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts        # Exports DialectConfig
    ├── pkg-meta.ts     # Auto-generated name + version
    ├── schema.ts       # Block and field definitions
    └── lint/
        └── passes/     # Lint rules
```

**`package.json`** — include the prebuild script to auto-generate `pkg-meta.ts`:

```json
{
  "name": "@agentscript/mydialect-dialect",
  "version": "0.1.0",
  "scripts": {
    "prebuild": "node ../../scripts/sync-pkg-meta.mjs",
    "build": "tsc"
  },
  "dependencies": {
    "@agentscript/language": "workspace:*"
  }
}
```

**`src/index.ts`** — export a `DialectConfig`:

```typescript
import type { DialectConfig } from '@agentscript/language';
import { MySchemaInfo } from './schema.js';
import { myRules } from './lint/passes/index.js';
import { DIALECT_NAME, DIALECT_VERSION } from './pkg-meta.js';

export const mydialect: DialectConfig = {
  name: DIALECT_NAME,
  displayName: 'My Dialect',
  description: 'A custom AgentScript dialect',
  version: DIALECT_VERSION,
  schemaInfo: MySchemaInfo,
  createRules: myRules,
  source: 'mydialect-lint',
};
```

The `DialectConfig` interface (`@agentscript/language`):

```typescript
interface DialectConfig {
  readonly name: string;               // Unique identifier (e.g., 'mydialect')
  readonly displayName: string;        // Human-readable name (e.g., 'My Dialect')
  readonly description: string;        // Short description for UI display
  readonly version: string;            // Semver from package.json
  readonly schemaInfo: SchemaInfo;     // Root schema, aliases, global scopes
  readonly createRules: () => LintPass[];  // Factory for fresh lint passes
  readonly source?: string;            // Diagnostic source tag
}
```

- **`schemaInfo`** defines the blocks, fields, and types your dialect supports. See the existing `agentscript` or `agentforce` schemas for reference.
- **`createRules`** returns a fresh array of `LintPass` instances for each analysis run (no shared state between runs).

### 2. Register the dialect in each consumer

Each consumer that needs the dialect imports it directly. There is no central registry — `@agentscript/lsp` is purely dialect-agnostic.

Add your dialect package as a dependency of each consumer that needs it (e.g., `@agentscript/lsp-server`, `@agentscript/lsp-browser`, `@agentscript/ui`):

```bash
pnpm add @agentscript/mydialect-dialect --filter @agentscript/lsp-server --workspace
```

Then import and add it to the `dialects` array in that consumer's entry point:

```typescript
import { mydialect } from '@agentscript/mydialect-dialect';

const dialects: DialectConfig[] = [
  agentforceDialect,
  agentscriptDialect,
  mydialect,  // ← add here
];
```

### 3. Build and test

```bash
pnpm build
pnpm test
```

Each consumer where the dialect was added will pick it up. Users select it with `# @dialect: mydialect` at the top of their document, or it can be set as the `defaultDialect`.

## Development

```bash
pnpm build     # Build
pnpm test      # Run tests
pnpm typecheck # Type-check
pnpm dev       # Watch mode
```

## License

MIT
