# @agentscript/parser-tree-sitter

Tree-sitter grammar and parser for the AgentScript language. Provides incremental parsing via Node.js native bindings and WASM for browser environments.

## Overview

This package defines the AgentScript grammar and compiles it into a fast C parser that can be used from Node.js (native N-API bindings) or the browser (WebAssembly). It is one of two parser implementations in the toolchain — the other is [`@agentscript/parser-javascript`](../parser-javascript/), a pure TypeScript parser. Both produce the same `SyntaxNode` tree consumed by downstream packages.

Zero internal AgentScript dependencies — this is a foundation-layer package.

## How It Works

The parser is built from three pieces:

1. **`grammar.js`** — the grammar definition, written in tree-sitter's JavaScript DSL. It describes all AgentScript syntax: blocks, fields, expressions, statements, template literals, and more. The tree-sitter CLI (`tree-sitter generate`) processes this file into a generated C parser (`src/parser.c`).

2. **`src/scanner.c`** — a hand-written external scanner that handles tokens the generated parser cannot: `INDENT`, `DEDENT`, `NEWLINE`, `TEMPLATE_CONTENT`, and `TEMPLATE_END`. It maintains an indentation stack and is called by tree-sitter during parsing whenever these external tokens are valid.

3. **`queries/highlights.scm`** — tree-sitter highlight queries that map AST node types to semantic token categories (keyword, string, comment, type, etc.). Used by the LSP and Monaco integrations for syntax highlighting.

Together, these produce:

- **Node.js native bindings** (N-API) — compiled via `node-gyp` from the C sources. Fast, no JS overhead. Prebuilt binaries are included for Linux x64, macOS, and Windows so most users skip compilation.
- **WASM binary** (`tree-sitter-agentscript.wasm`) — compiled via `tree-sitter build --wasm`. Runs in browsers and Electron via `web-tree-sitter`.

Tree-sitter's key advantage is **incremental parsing**: after an edit, only the changed region of the syntax tree is re-parsed, which makes it well-suited for editor integrations where the user is typing continuously.

## Installation

```bash
pnpm add @agentscript/parser-tree-sitter
```

For Node.js usage, also install the tree-sitter runtime:

```bash
pnpm add tree-sitter
```

## Usage

### Node.js

```typescript
import Parser from 'tree-sitter';
import AgentScript from '@agentscript/parser-tree-sitter';

const parser = new Parser();
parser.setLanguage(AgentScript);

const tree = parser.parse(`
topic billing:
    description: "Handle billing inquiries"
`);

console.log(tree.rootNode.toString());
```

### Browser (WASM)

```typescript
import initTreeSitter from 'web-tree-sitter';

await initTreeSitter.init();
const parser = new initTreeSitter();
const lang = await initTreeSitter.Language.load('path/to/tree-sitter-agentscript.wasm');
parser.setLanguage(lang);
```

## Exports

| Export Path | Description |
|-------------|-------------|
| `@agentscript/parser-tree-sitter` | Node.js native bindings |
| `@agentscript/parser-tree-sitter/wasm` | WASM binary |
| `@agentscript/parser-tree-sitter/queries/highlights.scm` | Syntax highlighting queries |

## Scripts

```bash
pnpm build          # Generate grammar + build Node.js bindings
pnpm build:full     # Generate + build Node.js + WASM
pnpm build:wasm     # Build WASM only
pnpm test           # Run Node.js binding tests + tree-sitter corpus tests
pnpm test:wasm      # Run WASM tests
pnpm start          # Launch tree-sitter playground (builds WASM first)
pnpm prebuild       # Create prebuilt binaries for distribution
```

After modifying `grammar.js`, always run `pnpm build` to regenerate the C parser and rebuild bindings.

## Project Layout

```
grammar.js              — Grammar definition (tree-sitter DSL)
src/
  parser.c              — Generated C parser (do not edit)
  scanner.c             — Hand-written external scanner (indentation, templates)
  grammar.json          — Generated grammar metadata
queries/
  highlights.scm        — Syntax highlighting queries
bindings/
  node/                 — Node.js N-API bindings
prebuilds/              — Prebuilt binaries (Linux x64, macOS, Windows)
*.wasm                  — WebAssembly binary (after build:wasm)
```

## License

MIT
