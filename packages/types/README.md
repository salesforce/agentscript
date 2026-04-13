# @agentscript/types

Shared foundational types for the AgentScript toolchain. This package defines the core interfaces used across all other packages.

## Overview

Zero-dependency package that provides the type contracts between parsers, the language engine, linting, and editor integrations.

## Installation

```bash
pnpm add @agentscript/types
```

## Key Types

| Type | Description |
|------|-------------|
| `SyntaxNode` | AST node interface produced by parsers and consumed by analysis |
| `Position` | Line/character position in source text |
| `Range` | Start/end position pair |
| `Diagnostic` | Error, warning, or hint with location and message |
| `DiagnosticSeverity` | `Error`, `Warning`, `Information`, `Hint` |
| `DiagnosticTag` | `Unnecessary`, `Deprecated` |
| `Comment` | Comment attachment metadata |
| `CstMeta` | Concrete Syntax Tree metadata |

## Usage

```typescript
import type { SyntaxNode, Diagnostic, Range } from '@agentscript/types';
import { DiagnosticSeverity } from '@agentscript/types';
```

## Scripts

```bash
pnpm build    # Compile TypeScript
```

## License

MIT
