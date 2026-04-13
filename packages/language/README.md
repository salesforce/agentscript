# @agentscript/language

Language infrastructure and analysis engine for AgentScript. Provides the AST type system, scope/symbol resolution, linting framework, and Language Service API that dialects and tooling build on.

## Overview

This is the core layer of the AgentScript toolchain. It defines how AgentScript programs are represented, analyzed, and queried — but contains no dialect-specific logic. Dialects plug into it via the `SchemaInfo` and `LintPass` interfaces.

## Installation

```bash
pnpm add @agentscript/language
```

## Exports

The package exposes three entry points:

| Export Path | Description |
|-------------|-------------|
| `@agentscript/language` | Everything — core types, lint, and service |
| `@agentscript/language/core` | Core AST types, blocks, expressions, statements, and analysis utilities |
| `@agentscript/language/lint` | Linting framework and built-in lint passes |
| `@agentscript/language/service` | Language Service API (hover, completions, definitions, references, symbols) |

## What It Provides

- **AST types** — block, expression, statement, and field definitions
- **Scope and symbol resolution** — tracks declarations, references, and visibility
- **Schema system** — `SchemaInfo` interface for defining blocks, fields, types, and constraints
- **Lint framework** — 18+ built-in passes (undefined references, duplicate keys, unused variables, unreachable code, etc.)
- **Dialect config** — `DialectConfig` interface for plugging in custom schemas and rules
- **Language Service** — hover info, completions, go-to-definition, find-references, document symbols, semantic tokens

## Usage

```typescript
import { DialectConfig, SchemaInfo } from '@agentscript/language';
import type { LintPass } from '@agentscript/language/lint';
```

Most consumers won't use this package directly — instead, use `@agentscript/agentforce` (the batteries-included SDK) or one of the dialect packages.

## Scripts

```bash
pnpm build        # Compile TypeScript
pnpm test         # Run tests
pnpm typecheck    # Type-check
pnpm dev          # Watch mode
```

## License

MIT
