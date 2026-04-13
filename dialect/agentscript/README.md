# @agentscript/agentscript-dialect

Base AgentScript dialect — defines the core language schema, block types, field definitions, and lint rules that all other dialects extend.

## Overview

This is the foundation dialect. It specifies which blocks (e.g., `topic`, `system`, `actions`, `variables`) exist in the language, what fields each block accepts, and what types those fields require. Other dialects (like `agentforce-dialect`) inherit from this schema and add their own blocks and rules.

## Installation

```bash
pnpm add @agentscript/agentscript-dialect
```

## Usage

```typescript
import { agentscriptDialect } from '@agentscript/agentscript-dialect';

// Use as a DialectConfig
console.log(agentscriptDialect.name);       // 'agentscript'
console.log(agentscriptDialect.schemaInfo); // root schema, aliases, global scopes
```

## What It Provides

- **Schema** — block definitions, field types, constraints, and aliases for the core AgentScript language
- **Lint rules** — base lint passes shared across all dialects
- **Dialect config** — `DialectConfig` object for use with `@agentscript/language` and `@agentscript/lsp`

## Extending This Dialect

To create a new dialect that builds on AgentScript, depend on this package and extend the schema:

```typescript
import { AgentScriptSchemaInfo } from '@agentscript/agentscript-dialect';

// Use AgentScriptSchemaInfo as a base for your custom dialect's schema
```

See the [`@agentscript/lsp` README](../../packages/lsp/README.md#adding-a-new-dialect) for a full guide on creating a new dialect.

## Scripts

```bash
pnpm build        # Compile TypeScript
pnpm test         # Run tests
pnpm typecheck    # Type-check
pnpm dev          # Watch mode
```

## License

MIT
