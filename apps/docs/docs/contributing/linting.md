---
sidebar_position: 2
---

# Linting & Formatting

## Overview

The repository uses ESLint 9 (flat config), Prettier 3, TypeScript strict mode, Husky pre-commit hooks, and lint-staged.

## Configuration Files

| File | Purpose |
|------|---------|
| `eslint.config.js` | ESLint flat config |
| `.prettierrc.json` | Prettier formatting rules |
| `.prettierignore` | Files excluded from formatting |
| `tsconfig.json` | Base TypeScript config (strict) |
| `.lintstagedrc.json` | Pre-commit hooks config |
| `.husky/pre-commit` | Pre-commit hook |

Each package has its own `tsconfig.json` extending the root config.

## Commands

```bash
pnpm lint            # Run ESLint
pnpm format          # Format with Prettier
pnpm format:check    # Check formatting without modifying
```

## ESLint Rules

### TypeScript-Specific

- `@typescript-eslint/no-explicit-any: warn` -- Discourages `any` (project policy: never use `any`)
- `@typescript-eslint/no-unused-vars: error` -- Catches unused variables (allows `_` prefix)
- `@typescript-eslint/consistent-type-definitions: error` -- Enforces interfaces over type aliases
- `@typescript-eslint/no-floating-promises: error` -- Requires handling promises
- `@typescript-eslint/await-thenable: error` -- Prevents awaiting non-promises
- `@typescript-eslint/no-misused-promises: error` -- Prevents promise misuse
- `@typescript-eslint/require-await: warn` -- Warns about async without await

### General

- `no-console: warn` -- Warns about console usage (allows `warn`/`error`)
- `prefer-const: error` -- Enforces `const` for non-reassigned variables
- `no-var: error` -- Disallows `var`

### Test Files (`*.test.ts`, `*.spec.ts`)

- `@typescript-eslint/no-explicit-any: off`
- `no-console: off`

## TypeScript Strict Settings

The base `tsconfig.json` enables the following strict checks:

- `strict: true`
- `noImplicitAny`
- `strictNullChecks`
- `noUnusedLocals`
- `noUnusedParameters`
- `noImplicitReturns`
- `noUncheckedIndexedAccess`

## Pre-commit Hooks

Husky runs lint-staged before each commit:

- **ESLint** with auto-fix on `.ts`/`.tsx` files
- **Prettier** on all staged files

## ESLint Ignored Paths

The following paths are excluded from linting:

- `node_modules/`, `dist/`, `build/`, `.turbo/`, `artifacts/`, `coverage/`
- `packages/parser-tree-sitter/bindings/` (native bindings)
- `packages/parser-tree-sitter/src/**/*.c` (generated C code)

## Troubleshooting

**Pre-commit hooks not running:**

Run `pnpm install` and verify that `.husky/pre-commit` is executable.

**Prettier/ESLint conflicts:**

Prettier takes precedence over ESLint formatting rules. If you encounter conflicts, run `pnpm format` to let Prettier resolve them.
