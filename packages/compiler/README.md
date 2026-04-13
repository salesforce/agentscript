# @agentscript/compiler

Compiler for AgentScript — transforms a parsed AST into Salesforce runtime specification with source-map support.

## Overview

The compiler takes a parsed AgentScript AST and produces the JSON representation that runtime engines consume. It supports source mapping so that positions in the generated output can be traced back to the original `.agent` source.

## Installation

```bash
pnpm add @agentscript/compiler
```

## Usage

```typescript
import { compile, serialize } from '@agentscript/compiler';

// Compile AST to a Salesforce runtime specification
const result = compile(ast, dialect);

// Compile with source map
const { json, sourceMap } = serialize(ast, dialect);
```

Most consumers should use `@agentscript/agentforce` instead, which wraps the compiler with parsing and dialect setup:

```typescript
import { compileSource } from '@agentscript/agentforce';
const result = compileSource(agentScriptSource);
```

## Exports

| Export Path | Description |
|-------------|-------------|
| `@agentscript/compiler` | Main entry — `compile()`, `serialize()`, source-map utilities |
| `@agentscript/compiler/generated/agent-dsl` | Generated Salesforce runtime schema types |

## Key APIs

| Function | Description |
|----------|-------------|
| `compile(ast, dialect)` | Compile an AST to a Salesforce runtime specification |
| `serialize(ast, dialect)` | Compile with source-map generation |
| `findGeneratedPosition(map, original)` | Map original position to generated |
| `findOriginalPosition(map, generated)` | Map generated position back to original |
| `buildCursorMap(map)` | Build a range-to-range mapping |

## Scripts

```bash
pnpm build            # Compile TypeScript
pnpm test             # Run tests
pnpm typecheck        # Type-check
pnpm dev              # Watch mode
pnpm test:compare     # Generate comparison report against reference outputs
```

## License

MIT
