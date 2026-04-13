---
sidebar_position: 1
---

# Development Setup

## Prerequisites

**Required:**

- Node.js >= 18.0.0
- pnpm >= 8.0.0

**Optional:**

- tree-sitter CLI (for parser development)
- Docker (for DevContainer)

## Clone and Build

```bash
git clone <repo-url>
cd agentscript
pnpm install
pnpm build
pnpm test
```

## Common Development Tasks

| Task | Command |
|------|---------|
| Building everything | `pnpm build` |
| Running tests | `pnpm test` |
| Formatting | `pnpm format` |
| Linting | `pnpm lint` |
| Docs dev server | `pnpm docs:dev` (port 27000) |

:::warning
Do not start the docs dev server automatically in scripts. Run `pnpm docs:dev` manually when needed.
:::

## After Parser Changes

Any changes in `packages/parser-tree-sitter/` require a full rebuild including WASM:

```bash
cd packages/parser-tree-sitter && pnpm run build
```

This rebuilds both native Node.js bindings and WASM. Always rebuild and run tests before considering parser changes complete.

## After Dialect Changes

Any changes in `dialect/agentscript/src/` or `dialect/agentforce/src/` require a rebuild:

```bash
pnpm build --filter @agentscript/agentscript-dialect
# or for agentforce:
pnpm build --filter @agentscript/agentforce-dialect
```

## Working with Specific Packages

Use Turborepo filter to build or test individual packages:

```bash
pnpm build --filter @agentscript/language
pnpm test --filter @agentscript/compiler
```

## Node Version Pinning

Some tests (e.g., compiler parity tests) may require Node 18.20.8 for CI parity:

```bash
volta pin node@18.20.8
# or
nvm use 18.20.8
```

## Package Manager

Always use `pnpm`. Never use `npm` or `yarn`. Use the `workspace:*` protocol for internal dependencies.
