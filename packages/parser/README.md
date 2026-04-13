# @agentscript/parser

Parser abstraction layer for AgentScript. Uses `parser-javascript` (pure TypeScript) by default, with an optional swap to `parser-tree-sitter` via conditional exports.

## Overview

This package provides a unified `parse()` API regardless of which parser backend is in use. By default, it resolves to `@agentscript/parser-javascript` — a pure TypeScript parser with zero native dependencies. When the `tree-sitter` export condition is active, it resolves to `@agentscript/parser-tree-sitter` instead.

## Installation

```bash
pnpm add @agentscript/parser
```

No additional setup needed — the default backend is pure TypeScript.

### Optional: Tree-sitter backend

To use tree-sitter, install the additional peer dependencies:

**Node.js:**
```bash
pnpm add tree-sitter @agentscript/parser-tree-sitter
```

**Browser:**
```bash
pnpm add web-tree-sitter @agentscript/parser-tree-sitter
```

Then configure your bundler to pass the `tree-sitter` export condition.

## Usage

```typescript
import { parse, parseAndHighlight, getParser } from '@agentscript/parser';

const { rootNode } = parse(source);
const captures = parseAndHighlight(source);
```

## Exports

| Export Condition | Resolves To |
|-----------------|-------------|
| Default | `@agentscript/parser-javascript` |
| `tree-sitter` | `@agentscript/parser-tree-sitter` wrapper |

## Scripts

```bash
pnpm build    # Compile TypeScript
pnpm test     # Run tests
```

## License

MIT
