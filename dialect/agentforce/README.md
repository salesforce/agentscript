# @agentscript/agentforce-dialect

Agentforce dialect — extends the base AgentScript dialect with Salesforce Agentforce-specific blocks, fields, and lint rules.

## Overview

This dialect adds Agentforce platform concepts on top of the core AgentScript schema. It includes additional block types, field constraints, and compilation support tailored for the Salesforce Agentforce runtime.

## Installation

```bash
pnpm add @agentscript/agentforce-dialect
```

## Usage

```typescript
import { agentforceDialect } from '@agentscript/agentforce-dialect';

// Use as a DialectConfig
console.log(agentforceDialect.name);       // 'agentforce'
console.log(agentforceDialect.schemaInfo); // extended schema with Agentforce-specific blocks
```

## What It Provides

- **Extended schema** — Agentforce-specific blocks and fields on top of the base AgentScript schema
- **Lint rules** — Agentforce-specific validation (in addition to base rules)
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
