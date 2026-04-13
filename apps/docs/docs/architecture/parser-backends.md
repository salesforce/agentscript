---
sidebar_position: 6
---

# Parser Backends

AgentScript supports two parser backends behind a unified interface (`@agentscript/parser`).

## Choosing a Backend

The default backend is **parser-javascript** — no configuration needed. To use **tree-sitter**, pass the `tree-sitter` condition to your build tool or runtime:

| Tool       | How to enable tree-sitter                         |
|------------|---------------------------------------------------|
| esbuild    | `conditions: ['tree-sitter']`                     |
| Node.js    | `node --conditions=tree-sitter`                   |
| TypeScript | `"customConditions": ["tree-sitter"]` in tsconfig |
| Vitest     | `resolve: { conditions: ['tree-sitter'] }`        |

### parser-javascript (default)

- Pure TypeScript, synchronous
- Works in Node.js and browser without WASM
- Error-tolerant with NEWLINE/DEDENT recovery points
- Re-parses from scratch on each edit

### tree-sitter

- Native C parser with WASM browser variant
- Incremental re-parsing (only changed regions)
- Requires `tree-sitter` and `@agentscript/parser-tree-sitter` packages
- Node.js: uses native bindings; Browser: requires WASM setup

## Usage

```typescript
import { parse, parseAndHighlight } from '@agentscript/parser';
const { rootNode } = parse(source);
```

Both backends produce nodes conforming to `SyntaxNode` from `@agentscript/types`.

## How Switching Works

`@agentscript/parser` uses [package.json `exports` conditions](https://nodejs.org/api/packages.html#conditional-exports):

```jsonc
// parser/package.json
"exports": {
  ".": {
    "tree-sitter": { "import": "./dist/index.tree-sitter.js" },
    "import": "./dist/index.js"  // default → parser-javascript
  }
}
```

- The default entry (`index.ts`) imports `ts-backend.ts` — no tree-sitter code is touched.
- The `tree-sitter` entry (`index.tree-sitter.ts`) imports `tree-sitter-backend.ts` — requires native deps.
- Both share the public API surface via `api.ts`.

No files are rewritten, no environment variables are read at runtime. The resolution happens at import time based on the condition your toolchain passes.

## Bundling

### Node.js
Both backends work. Tree-sitter requires native bindings:
```bash
pnpm add tree-sitter @agentscript/parser-tree-sitter
```

### Browser

**Default (parser-javascript):** Works out of the box — pure JS, no WASM or native modules needed.

**Tree-sitter in browser:** Requires `await init()` from `@agentscript/agentforce` to load WASM binaries before the first parse.

```typescript
import { init, parse } from '@agentscript/agentforce';

await init();  // loads tree-sitter WASM
const doc = parse(source);
```

When using esbuild/webpack with the default parser-javascript build, mark `tree-sitter` and `@agentscript/parser-tree-sitter` as external to prevent bundler errors:
```javascript
external: ['tree-sitter', '@agentscript/parser-tree-sitter']
```

## Building @agentscript/agentforce

- **`pnpm build`** (default) — parser-javascript mode. Node.js ESM + declarations only. Simple, fast.
- **`pnpm build:tree-sitter`** — tree-sitter mode. Node.js ESM, browser ESM (`@agentscript/agentforce/browser`), browser IIFE (`@agentscript/agentforce/browser.iife.js`), and WASM constants (`@agentscript/agentforce/wasm`) bundles.

## Building @agentscript/lsp-browser

- **`pnpm build`** (default) — parser-javascript mode. `tree-sitter`, `web-tree-sitter`, and `@agentscript/parser-tree-sitter` are externalized.
- **`pnpm build:tree-sitter`** — tree-sitter mode. Bundles `web-tree-sitter` into the bundle. WASM is loaded via `init()` in the `onBeforeInitialize` hook.

## Parity Testing

The dual-parser architecture requires both backends to agree on valid input.

### Invariant

> If an input parses without errors in one parser, it must parse without errors
> in the other parser, and the resulting parse trees must be identical.

Parse trees are **allowed to deviate** when the input is not valid AgentScript.
Both parsers will report errors, but their error recovery strategies differ:
- **parser-javascript**: recursive descent with NEWLINE/DEDENT synchronization
- **tree-sitter**: GLR with automatic error recovery

These deviations are tracked via snapshots in `parity.test.ts` and measured
via CST coverage metrics in `error-recovery.test.ts`.

### Test suites

| Test | What it checks |
|------|----------------|
| `parity.test.ts` | Static corpus inputs: both parsers agree |
| `fuzz-parity.test.ts` | Random mutations: both parsers agree on error-free parses |
| `error-recovery.test.ts` | CST coverage comparison for known error scenarios |

### Running parity tests

```bash
cd packages/parser-javascript
npx vitest run test/parity.test.ts       # static corpus parity
npx vitest run test/fuzz-parity.test.ts  # fuzz parity (requires tree-sitter)
npx vitest run test/error-recovery.test.ts  # error recovery metrics
```

Parity tests require tree-sitter native bindings. They skip gracefully if unavailable.

### Running the full test suite with each backend

```bash
# parser-javascript (default)
pnpm test

# tree-sitter
AGENTSCRIPT_PARSER=tree-sitter pnpm test
```

## SyntaxNode Interface

Both backends produce nodes conforming to:

```typescript
interface SyntaxNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  children: SyntaxNode[];
  namedChildren: SyntaxNode[];
  childForFieldName(name: string): SyntaxNode | null;
  childrenForFieldName(name: string): SyntaxNode[];
  parent: SyntaxNode | null;
  previousSibling: SyntaxNode | null;
  // Optional fields (present on both backends)
  isError?: boolean;
  isMissing?: boolean;
  isNamed?: boolean;
  hasError?: boolean;
  startOffset?: number;
  endOffset?: number;
  fieldNameForChild?(index: number): string | null;
  toSExp?(): string;
}
```
