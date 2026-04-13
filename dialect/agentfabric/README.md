# @agentscript/agentfabric-dialect

AgentFabric dialect — defines the schema, lint rules, and compiler for the AgentFabric platform.

## Overview

This dialect extends the base AgentScript schema with AgentFabric-specific blocks, fields, and a full compiler. It is an alternative to the Agentforce dialect for targeting the AgentFabric runtime.

## Installation

```bash
pnpm add @agentscript/agentfabric-dialect
```

## Usage

```typescript
import { agentfabricDialect } from '@agentscript/agentfabric-dialect';

// Use as a DialectConfig
console.log(agentfabricDialect.name);       // 'agentfabric'
console.log(agentfabricDialect.schemaInfo); // AgentFabric-specific schema
```

## What It Provides

- **Schema** — AgentFabric-specific block types and field definitions
- **Lint rules** — AgentFabric-specific validation passes
- **Compiler** — full compilation pipeline for the AgentFabric output format
- **Dialect config** — `DialectConfig` object for use with `@agentscript/language` and `@agentscript/lsp`

## Dependencies

- `@agentscript/agentscript-dialect` — inherits the base schema and rules
- `@agentscript/language` — language infrastructure

## Scripts

```bash
pnpm build        # Compile TypeScript
pnpm test         # Run tests
pnpm typecheck    # Type-check
pnpm dev          # Watch mode
```

## License

MIT
